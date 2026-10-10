// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaintenanceVault} from "../src/MaintenanceVault.sol";

contract MaintenanceVaultTest is Test {
    MaintenanceVault vault;
    address agent = address(0xA11CE);
    address stranger = address(0xBAD);
    bytes32 constant PRESS = keccak256("press-03");

    function setUp() public {
        vault = new MaintenanceVault(agent);
        // $200 budget, $60 per order, 1500 W baseline, 10% tolerance
        vault.configureMachine(PRESS, 20_000, 6_000, 1_500, 1_000);
    }

    function _open(uint256 cents) internal returns (uint256) {
        vm.prank(agent);
        return vault.openWorkOrder(PRESS, cents, keccak256("diag"), keccak256("quote"));
    }

    function test_fullLoop_verifiedWhenReadingBackToBaseline() public {
        uint256 id = _open(3_725);
        vm.prank(agent);
        vault.recordPurchase(id, keccak256("order"), 3_725);
        vm.prank(agent);
        vault.recordRepairEvidence(id, 1_560, keccak256("telemetry")); // 4% over baseline
        (, MaintenanceVault.Status s,,,,,,,,,) = vault.orders(id);
        assertEq(uint8(s), uint8(MaintenanceVault.Status.Verified));
        assertEq(vault.remainingCents(PRESS), 20_000 - 3_725);
    }

    function test_paidButNotFixed_isFailed() public {
        uint256 id = _open(3_725);
        vm.prank(agent);
        vault.recordPurchase(id, keccak256("order"), 3_725);
        vm.prank(agent);
        vault.recordRepairEvidence(id, 2_100, keccak256("telemetry")); // still 40% over
        (, MaintenanceVault.Status s,,,,,,,,,) = vault.orders(id);
        assertEq(uint8(s), uint8(MaintenanceVault.Status.Failed));
    }

    function test_rejectsOverPerOrderCap() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MaintenanceVault.OverPerOrderCap.selector, 6_001, 6_000));
        vault.openWorkOrder(PRESS, 6_001, bytes32(0), bytes32(0));
    }

    function test_rejectsOverBudget() public {
        for (uint256 i; i < 3; i++) _open(6_000); // 18,000 reserved
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MaintenanceVault.OverBudget.selector, 2_500, 2_000));
        vault.openWorkOrder(PRESS, 2_500, bytes32(0), bytes32(0));
    }

    function test_onlyAgentCanOpen() public {
        vm.prank(stranger);
        vm.expectRevert(MaintenanceVault.NotAgent.selector);
        vault.openWorkOrder(PRESS, 100, bytes32(0), bytes32(0));
    }

    function test_finalChargeCannotExceedReservation() public {
        uint256 id = _open(3_000);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MaintenanceVault.FinalOverReserved.selector, 3_001, 3_000));
        vault.recordPurchase(id, keccak256("order"), 3_001);
    }

    function test_lowerFinalChargeReleasesDifference() public {
        uint256 id = _open(4_000);
        vm.prank(agent);
        vault.recordPurchase(id, keccak256("order"), 3_500);
        assertEq(vault.remainingCents(PRESS), 20_000 - 3_500);
    }

    function test_cannotVerifyBeforePurchase() public {
        uint256 id = _open(3_000);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaintenanceVault.WrongStatus.selector, MaintenanceVault.Status.Purchased, MaintenanceVault.Status.Opened
            )
        );
        vault.recordRepairEvidence(id, 1_500, bytes32(0));
    }

    function test_cancelReleasesReservation() public {
        uint256 id = _open(5_000);
        vm.prank(agent);
        vault.cancelWorkOrder(id);
        assertEq(vault.remainingCents(PRESS), 20_000);
    }

    function test_canSpendMirrorsOpenRules() public view {
        assertTrue(vault.canSpend(PRESS, 6_000));
        assertFalse(vault.canSpend(PRESS, 6_001));
        assertFalse(vault.canSpend(keccak256("unknown"), 1));
    }
}
