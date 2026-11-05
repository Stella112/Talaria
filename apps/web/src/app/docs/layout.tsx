import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs";

export const metadata: Metadata = { title: "Talaria Docs", description: "Build on Talaria with the SDK and MCP server." };

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 pt-8 md:grid-cols-[180px_minmax(0,1fr)] md:gap-12 md:px-6 md:pt-14">
      <aside>
        <DocsNav />
      </aside>
      <article className="min-w-0">{children}</article>
    </div>
  );
}
