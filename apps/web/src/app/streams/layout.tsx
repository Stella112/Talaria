import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Streams and subscriptions" title="Payments that keep flowing" intro="Pay by the second, or subscribe once and get charged only when a period is due.">
      {children}
    </Page>
  );
}
