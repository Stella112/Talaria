import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Remittance" title="Send money with a link" intro="Send to an address or a claim link. Cancel any time until it is claimed.">
      {children}
    </Page>
  );
}
