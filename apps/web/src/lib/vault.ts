import { inkSepolia, sepolia } from "viem/chains";
import { keccak256, toBytes, type Address, type Hex } from "viem";

// MaintenanceVault (packages/contracts). Address comes from the deploy; empty = "contract not deployed",
// and the console runs the off-chain mirror of the same rules, saying so on screen.
export const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "") as Address | "";
export const CHAIN = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? inkSepolia.id) === sepolia.id ? sepolia : inkSepolia;
export const VAULT_ENABLED = /^0x[0-9a-fA-F]{40}$/.test(VAULT_ADDRESS);

export const machineKey = (id: string): Hex => keccak256(toBytes(id));
export const refHash = (ref: string): Hex => keccak256(toBytes(ref));

export const vaultAbi = [
  {
    type: "function",
    name: "remainingCents",
    stateMutability: "view",
    inputs: [{ name: "machineId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "canSpend",
    stateMutability: "view",
    inputs: [
      { name: "machineId", type: "bytes32" },
      { name: "amountCents", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "agent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "openWorkOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "machineId", type: "bytes32" },
      { name: "quoteCents", type: "uint256" },
      { name: "diagnosisHash", type: "bytes32" },
      { name: "quoteRefHash", type: "bytes32" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  {
    type: "function",
    name: "recordPurchase",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "orderRefHash", type: "bytes32" },
      { name: "finalCents", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordRepairEvidence",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "postRepairWatts", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "WorkOrderOpened",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "machineId", type: "bytes32", indexed: true },
      { name: "reservedCents", type: "uint256", indexed: false },
      { name: "diagnosisHash", type: "bytes32", indexed: false },
      { name: "quoteRefHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const explorerTx = (hash: string) =>
  CHAIN.id === inkSepolia.id ? `https://explorer-sepolia.inkonchain.com/tx/${hash}` : `https://sepolia.etherscan.io/tx/${hash}`;
