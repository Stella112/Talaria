import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM } from "./parser";
import { actionSchema, type Action } from "./schema";

const MODEL = "claude-opus-5-5";

/** Optional parser, used only when ANTHROPIC_API_KEY is set. Its output is untrusted and must pass the schema. */
export function anthropicParser(client: Pick<Anthropic, "beta"> = new Anthropic()) {
  return async (command: string): Promise<Action | null> => {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: command }],
    } as any);
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return null;
    try {
      const parsed = actionSchema.safeParse(JSON.parse(text.text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
}
