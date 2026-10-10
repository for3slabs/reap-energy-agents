// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MaintenanceVault
/// @notice On-chain policy for an energy-monitoring agent that buys repair parts in the real world.
///         The plant operator sets a budget per machine. The agent can only open a work order that fits
///         that budget, must record the purchase it made off-chain (Reap Agentic Payments), and a work
///         order only counts as VERIFIED when the post-repair energy reading is back inside tolerance.
///         A paid order is not a fixed machine: payment and repair are separate facts on purpose.
/// @dev Amounts are USD cents. Readings are watts. Off-chain references (Reap quote/order ids, diagnosis,
///      telemetry evidence) are stored as keccak256 hashes so nothing private lands on-chain.
contract MaintenanceVault {
    enum Status {
        None,
        Opened, // budget reserved, the agent may buy
        Purchased, // Reap checkout completed, part on its way
        Verified, // energy reading back to baseline: the repair is proven
        Failed, // reading still off after the repair window
        Cancelled // reservation released without a purchase
    }

    struct Machine {
        uint256 budgetCents; // total the agent may spend on this machine
        uint256 spentCents; // reserved + spent so far
        uint256 perOrderCapCents; // ceiling for a single work order
        uint256 baselineWatts; // healthy power draw
        uint16 toleranceBps; // allowed deviation over baseline, in basis points (1000 = 10%)
        bool active;
    }

    struct WorkOrder {
        bytes32 machineId;
        Status status;
        uint256 reservedCents;
        uint256 finalCents;
        bytes32 diagnosisHash;
        bytes32 quoteRefHash;
        bytes32 orderRefHash;
        bytes32 evidenceHash;
        uint256 postRepairWatts;
        uint64 openedAt;
        uint64 closedAt;
    }

    address public owner;
    address public agent;
    uint256 public nextOrderId = 1;

    mapping(bytes32 => Machine) public machines;
    mapping(uint256 => WorkOrder) public orders;

    event AgentChanged(address indexed agent);
    event MachineConfigured(bytes32 indexed machineId, uint256 budgetCents, uint256 perOrderCapCents, uint256 baselineWatts, uint16 toleranceBps);
    event WorkOrderOpened(uint256 indexed orderId, bytes32 indexed machineId, uint256 reservedCents, bytes32 diagnosisHash, bytes32 quoteRefHash);
    event PurchaseRecorded(uint256 indexed orderId, bytes32 orderRefHash, uint256 finalCents);
    event RepairVerified(uint256 indexed orderId, uint256 postRepairWatts, bytes32 evidenceHash);
    event RepairFailed(uint256 indexed orderId, uint256 postRepairWatts, bytes32 evidenceHash);
    event WorkOrderCancelled(uint256 indexed orderId);

    error NotOwner();
    error NotAgent();
    error MachineInactive();
    error OverPerOrderCap(uint256 requested, uint256 cap);
    error OverBudget(uint256 requested, uint256 remaining);
    error WrongStatus(Status expected, Status actual);
    error FinalOverReserved(uint256 finalCents, uint256 reservedCents);
    error InvalidConfig();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address agent_) {
        owner = msg.sender;
        agent = agent_;
        emit AgentChanged(agent_);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentChanged(agent_);
    }

    function configureMachine(
        bytes32 machineId,
        uint256 budgetCents,
        uint256 perOrderCapCents,
        uint256 baselineWatts,
        uint16 toleranceBps
    ) external onlyOwner {
        if (baselineWatts == 0 || perOrderCapCents > budgetCents || toleranceBps > 10_000) revert InvalidConfig();
        Machine storage m = machines[machineId];
        if (budgetCents < m.spentCents) revert InvalidConfig();
        m.budgetCents = budgetCents;
        m.perOrderCapCents = perOrderCapCents;
        m.baselineWatts = baselineWatts;
        m.toleranceBps = toleranceBps;
        m.active = true;
        emit MachineConfigured(machineId, budgetCents, perOrderCapCents, baselineWatts, toleranceBps);
    }

    /// @notice Free budget left for a machine.
    function remainingCents(bytes32 machineId) public view returns (uint256) {
        Machine storage m = machines[machineId];
        return m.budgetCents - m.spentCents;
    }

    /// @notice Would a quote of `amountCents` be allowed right now? Lets the agent check before it buys.
    function canSpend(bytes32 machineId, uint256 amountCents) external view returns (bool) {
        Machine storage m = machines[machineId];
        return m.active && amountCents <= m.perOrderCapCents && amountCents <= remainingCents(machineId);
    }

    /// @notice The agent reserves budget for a quote BEFORE it opens the Reap checkout.
    function openWorkOrder(bytes32 machineId, uint256 quoteCents, bytes32 diagnosisHash, bytes32 quoteRefHash)
        external
        onlyAgent
        returns (uint256 orderId)
    {
        Machine storage m = machines[machineId];
        if (!m.active) revert MachineInactive();
        if (quoteCents > m.perOrderCapCents) revert OverPerOrderCap(quoteCents, m.perOrderCapCents);
        uint256 remaining = m.budgetCents - m.spentCents;
        if (quoteCents > remaining) revert OverBudget(quoteCents, remaining);

        m.spentCents += quoteCents;
        orderId = nextOrderId++;
        WorkOrder storage o = orders[orderId];
        o.machineId = machineId;
        o.status = Status.Opened;
        o.reservedCents = quoteCents;
        o.diagnosisHash = diagnosisHash;
        o.quoteRefHash = quoteRefHash;
        o.openedAt = uint64(block.timestamp);
        emit WorkOrderOpened(orderId, machineId, quoteCents, diagnosisHash, quoteRefHash);
    }

    /// @notice Records the completed Reap checkout. The final charge may be lower than the reservation, never higher.
    function recordPurchase(uint256 orderId, bytes32 orderRefHash, uint256 finalCents) external onlyAgent {
        WorkOrder storage o = orders[orderId];
        if (o.status != Status.Opened) revert WrongStatus(Status.Opened, o.status);
        if (finalCents > o.reservedCents) revert FinalOverReserved(finalCents, o.reservedCents);
        machines[o.machineId].spentCents -= (o.reservedCents - finalCents); // release the unused part
        o.finalCents = finalCents;
        o.orderRefHash = orderRefHash;
        o.status = Status.Purchased;
        emit PurchaseRecorded(orderId, orderRefHash, finalCents);
    }

    /// @notice Closes the loop with the physical world: the order is VERIFIED only if the machine's power draw
    ///         is back within tolerance of its baseline. Anything else is FAILED — the money was spent, the
    ///         machine is not fixed, and that is now a public fact.
    function recordRepairEvidence(uint256 orderId, uint256 postRepairWatts, bytes32 evidenceHash) external onlyAgent {
        WorkOrder storage o = orders[orderId];
        if (o.status != Status.Purchased) revert WrongStatus(Status.Purchased, o.status);
        Machine storage m = machines[o.machineId];
        uint256 ceiling = m.baselineWatts + (m.baselineWatts * m.toleranceBps) / 10_000;
        o.postRepairWatts = postRepairWatts;
        o.evidenceHash = evidenceHash;
        o.closedAt = uint64(block.timestamp);
        if (postRepairWatts <= ceiling) {
            o.status = Status.Verified;
            emit RepairVerified(orderId, postRepairWatts, evidenceHash);
        } else {
            o.status = Status.Failed;
            emit RepairFailed(orderId, postRepairWatts, evidenceHash);
        }
    }

    /// @notice Releases a reservation when the checkout never happened (quote expired, user rejected).
    function cancelWorkOrder(uint256 orderId) external {
        if (msg.sender != agent && msg.sender != owner) revert NotAgent();
        WorkOrder storage o = orders[orderId];
        if (o.status != Status.Opened) revert WrongStatus(Status.Opened, o.status);
        machines[o.machineId].spentCents -= o.reservedCents;
        o.status = Status.Cancelled;
        o.closedAt = uint64(block.timestamp);
        emit WorkOrderCancelled(orderId);
    }
}
