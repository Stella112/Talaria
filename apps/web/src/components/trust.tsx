"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { Pill } from "@/components/ui";
import { RELAYER_PATH } from "@/lib/talaria";

export type Trust = { agentId: string | null; score: number; feedbackCount: number; tier: "trusted" | "established" | "new"; srcBlock: string | null };

export function useTrust(subject?: Address) {
  return useQuery({
    queryKey: ["trust", subject],
    enabled: Boolean(subject),
    retry: 1,
    queryFn: async (): Promise<Trust> => {
      const response = await fetch(`${RELAYER_PATH}/trust/${subject}`);
      if (!response.ok) throw new Error("The relayer is not reachable");
      return response.json();
    },
  });
}

/** Describes a tier using what the attestation really says, never an assumed score. */
export function TrustBadge({ subject, holdMinutes }: { subject?: Address; holdMinutes: { established: number; new: number } }) {
  const { data, error, isLoading } = useTrust(subject);
  if (isLoading) return <Pill>Reading reputation from Base…</Pill>;
  if (error || !data) return <Pill tone="orange">Reputation unavailable. Treated as a new merchant.</Pill>;
  if (data.tier === "trusted") return <Pill tone="good">Trust {data.score} · from Base · instant settlement</Pill>;
  if (data.tier === "established") return <Pill tone="orange">Trust {data.score} · from Base · protected for {holdMinutes.established} min</Pill>;
  return <Pill tone="orange">New merchant · your payment is protected for {holdMinutes.new} min</Pill>;
}
