import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Agent console" title="An AI agent you can trust with a budget" intro="Use our hosted agent right now, with no wallet. Or connect a wallet to give an agent your own limits.">
      {children}
    </Page>
  );
}
