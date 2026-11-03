import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Agent console" title="Give agents a budget, not your key" intro="Authorise session keys with on-chain limits, run commands, and approve anything over the limit.">
      {children}
    </Page>
  );
}
