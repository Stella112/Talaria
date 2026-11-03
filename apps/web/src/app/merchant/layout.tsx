import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page eyebrow="Merchant" title="Get paid with a link" intro="Create invoices, share a link and QR code, and refund in full or in part.">
      {children}
    </Page>
  );
}
