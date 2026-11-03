import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page narrow eyebrow="Checkout" title="Complete your payment" intro="Pay from your balance, or fund it from Base Sepolia. You sign, and the relayer pays the gas.">
      {children}
    </Page>
  );
}
