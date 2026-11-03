import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Wallet" title="Your balance, without the gas" intro="Deposit with a signature, keep your tUSD in a Talaria account, and see every receipt.">
      {children}
    </Page>
  );
}
