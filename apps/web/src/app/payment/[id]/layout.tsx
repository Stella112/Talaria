import type { ReactNode } from "react";
import { Page } from "@/components/ui";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Page narrow eyebrow="Payment" title="Where your money is" intro="Trust decides how long a payment is held. While it is held, you can dispute it.">
      {children}
    </Page>
  );
}
