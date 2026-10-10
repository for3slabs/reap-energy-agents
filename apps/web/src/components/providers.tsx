"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { inkSepolia, sepolia } from "viem/chains";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";

// Injected wallets only (MetaMask, Rabby, Kraken Wallet): no third-party project id, no secret in the bundle.
// Both testnets are known; the vault's chain (NEXT_PUBLIC_CHAIN_ID) is the one every write targets.
const config = createConfig({
  chains: [inkSepolia, sepolia],
  connectors: [injected()],
  transports: { [inkSepolia.id]: http(), [sepolia.id]: http() },
});

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
