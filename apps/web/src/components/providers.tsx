"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/talaria";

export function Providers({ children }: { children: ReactNode }) {
  const [queries] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchInterval: 12_000, retry: 2 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
