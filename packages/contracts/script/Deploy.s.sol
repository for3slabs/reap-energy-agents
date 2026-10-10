// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MaintenanceVault} from "../src/MaintenanceVault.sol";

/// Deploys the vault and configures the demo machines.
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --account <keystore> --broadcast
/// AGENT_ADDRESS = the address the API signs with (its key never lives in this repo).
contract Deploy is Script {
    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        vm.startBroadcast();
        MaintenanceVault vault = new MaintenanceVault(agent);
        // budget, per-order cap (USD cents) · baseline watts · tolerance bps — same as apps/api demo data
        vault.configureMachine(keccak256("compressor-01"), 50_000, 15_000, 7_500, 1_000);
        vault.configureMachine(keccak256("press-03"), 20_000, 6_000, 1_500, 1_000);
        vault.configureMachine(keccak256("conveyor-02"), 15_000, 5_000, 2_200, 1_200);
        vault.configureMachine(keccak256("chiller-04"), 40_000, 12_000, 5_000, 1_000);
        vm.stopBroadcast();
        console.log("MaintenanceVault:", address(vault));
    }
}
