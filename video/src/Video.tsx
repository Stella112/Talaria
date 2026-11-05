import type { CSSProperties, ReactElement, ReactNode } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "./timeline.json";

export const FPS = 30;
// The font ships with the project, so a render never depends on a font server.
const fontFamily = "Inter";
const fontHandle = delayRender("Loading Inter");
new FontFace("Inter", `url(${staticFile("fonts/inter.woff2")}) format("woff2")`, { weight: "400 700" })
  .load()
  .then((face) => {
    document.fonts.add(face);
    continueRender(fontHandle);
  });

const C = { ink: "#24100a", cream: "#faf4ee", paper: "#fffdfb", orange: "#ff6a13", sky: "#c3dbe4", muted: "#6f5c53", line: "#e8dcd0", warm: "#fdeadf", good: "#17693f", goodBg: "#dcefe3" };

type Scene = (typeof timeline.scenes)[number];
const scene = (id: string) => timeline.scenes.find((s) => s.id === id)!;
/** Seconds into a scene at which its nth line starts. */
const at = (s: Scene, n: number) => s.lines[n].start - s.start;
const f = (seconds: number) => Math.round(seconds * FPS);

function useIn(atSec: number, delay = 0) {
  const frame = useCurrentFrame();
  return spring({ frame: frame - f(atSec) - delay, fps: FPS, config: { damping: 200, mass: 0.7 } });
}

function Rise({ at: start, delay = 0, distance = 40, children, style }: { at: number; delay?: number; distance?: number; children: ReactNode; style?: CSSProperties }) {
  const p = useIn(start, delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
}

/** Fades a block out once the voice moves on, so a scene can swap content in place. */
function Window({ from, to, children, style }: { from: number; to?: number; children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [f(from), f(from) + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outP = to === undefined ? 1 : interpolate(frame, [f(to) - 10, f(to)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: Math.min(inP, outP), ...style }}>{children}</AbsoluteFill>;
}

function Browser({ src, url, from, to, panFrom = 0, panTo = 0, width = 1240, zoom = 1.3, style }: { src: string; url: string; from: number; to: number; panFrom?: number; panTo?: number; width?: number; zoom?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const height = Math.round(width * 0.625);
  const p = spring({ frame: frame - f(from), fps: FPS, config: { damping: 200 } });
  const pan = interpolate(frame, [f(from), f(to)], [panFrom, panTo], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  return (
    <div style={{ width, borderRadius: 22, overflow: "hidden", background: C.paper, boxShadow: "0 40px 90px rgba(36,16,10,0.22)", transform: `translateY(${(1 - p) * 60}px) scale(${0.96 + p * 0.04})`, opacity: p, ...style }}>
      <div style={{ height: 46, background: "#f3e9df", display: "flex", alignItems: "center", gap: 8, padding: "0 18px" }}>
        {["#e8dcd0", "#e8dcd0", "#e8dcd0"].map((c, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
        <div style={{ marginLeft: 16, flex: 1, height: 28, borderRadius: 14, background: C.paper, display: "flex", alignItems: "center", padding: "0 14px", fontSize: 17, color: C.muted }}>{url}</div>
      </div>
      <div style={{ height, overflow: "hidden", position: "relative" }}>
        <Img src={staticFile(`shots/${src}.png`)} style={{ position: "absolute", width: width * zoom, height: height * zoom, left: (-(zoom - 1) * width) / 2, top: (-(pan / 100) * (height * zoom - height)) }} />
      </div>
    </div>
  );
}

function Chip({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "base" | "portal" | "good" }) {
  const tones = { ink: [C.ink, C.cream], base: [C.sky, C.ink], portal: [C.warm, "#7d3314"], good: [C.goodBg, C.good] } as const;
  const [bg, fg] = tones[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", borderRadius: 999, padding: "8px 18px", fontSize: 24, fontWeight: 600, background: bg, color: fg }}>{children}</span>;
}

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p style={{ fontSize: 26, fontWeight: 600, letterSpacing: 0.5, color: dark ? C.orange : "#b0451c", margin: 0 }}>{children}</p>;
}

// Scenes

function Hook() {
  const s = scene("hook");
  const frame = useCurrentFrame();
  const coin = interpolate(frame, [f(at(s, 1)) + 10, f(at(s, 1)) + 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const logo = useIn(at(s, 3));
  return (
    <AbsoluteFill style={{ background: C.ink, color: C.cream }}>
      <Window from={0} to={at(s, 3)} style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
        <Rise at={0}>
          <h1 style={{ fontSize: 118, fontWeight: 700, letterSpacing: -3, margin: 0 }}>Crypto payments are final.</h1>
        </Rise>
        <Rise at={at(s, 1)} style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <p style={{ fontSize: 50, margin: 0, color: "#e8dcd0" }}>Pay the wrong seller, and your money is gone.</p>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: C.orange, opacity: 1 - coin, transform: `translate(${coin * 380}px, ${-coin * 160}px) scale(${1 - coin * 0.6})` }} />
        </Rise>
        <Rise at={at(s, 2)}>
          <p style={{ fontSize: 50, margin: 0, color: C.orange, fontWeight: 600 }}>So people don't pay strangers.</p>
        </Rise>
      </Window>
      <Window from={at(s, 3)} style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 }}>
        <Img src={staticFile("logo-white.png")} style={{ width: 640, transform: `scale(${0.85 + logo * 0.15})`, opacity: logo }} />
        <Rise at={at(s, 4)}>
          <h2 style={{ fontSize: 76, fontWeight: 600, margin: 0, letterSpacing: -1.5, textAlign: "center" }}>
            Stripe for Portaldot, <span style={{ color: C.orange }}>with a refund button.</span>
          </h2>
        </Rise>
      </Window>
    </AbsoluteFill>
  );
}

function Lane({ label, title, tone }: { label: string; title: string; tone: "base" | "portal" | "neutral" }) {
  const bg = tone === "base" ? C.sky : tone === "portal" ? C.warm : C.paper;
  return (
    <div style={{ width: 430, padding: "30px 34px", borderRadius: 30, background: bg, border: tone === "neutral" ? `2px solid ${C.line}` : "none" }}>
      <p style={{ margin: 0, fontSize: 24, color: C.muted }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontSize: 38, fontWeight: 600, lineHeight: 1.15 }}>{title}</p>
    </div>
  );
}

function Arrow({ at: start, reverse }: { at: number; reverse?: boolean }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [f(start), f(start) + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ width: 120, height: 6, background: C.line, borderRadius: 3, position: "relative" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, [reverse ? "right" : "left"]: 0, width: `${p * 100}%`, background: C.orange, borderRadius: 3 }} />
      <div style={{ position: "absolute", top: -9, [reverse ? "left" : "right"]: -6, width: 0, height: 0, borderTop: "12px solid transparent", borderBottom: "12px solid transparent", [reverse ? "borderRight" : "borderLeft"]: `18px solid ${p > 0.95 ? C.orange : C.line}` }} />
    </div>
  );
}

function Idea() {
  const s = scene("idea");
  return (
    <AbsoluteFill style={{ background: C.cream, color: C.ink, padding: "110px 140px", gap: 50 }}>
      <Rise at={0}>
        <Eyebrow>The idea</Eyebrow>
        <h2 style={{ fontSize: 84, fontWeight: 700, margin: "10px 0 0", letterSpacing: -2 }}>Talaria prices trust.</h2>
      </Rise>
      <Rise at={at(s, 1)} style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Lane label="Base Sepolia" title="ERC-8004 reputation" tone="base" />
        <Arrow at={at(s, 1) + 1} />
        <Lane label="Signed attestation" title="Score, read live" tone="neutral" />
        <Arrow at={at(s, 1) + 2} />
        <Lane label="Portaldot V3" title="Hold and limit set" tone="portal" />
      </Rise>
      <div style={{ display: "flex", gap: 30 }}>
        <Rise at={at(s, 2)} style={{ flex: 1 }}>
          <div style={{ padding: 40, borderRadius: 30, background: C.paper, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 26, color: C.muted }}>Proven seller · score 80+</p>
              <p style={{ margin: "8px 0 0", fontSize: 54, fontWeight: 700 }}>Paid instantly</p>
            </div>
            <Chip tone="good">Trusted</Chip>
          </div>
        </Rise>
        <Rise at={at(s, 3)} style={{ flex: 1 }}>
          <div style={{ padding: 40, borderRadius: 30, background: C.paper, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 26, color: C.muted }}>New seller · no history</p>
              <p style={{ margin: "8px 0 0", fontSize: 54, fontWeight: 700 }}>Held 30 min</p>
            </div>
            <Chip tone="portal">Buyer can dispute</Chip>
          </div>
        </Rise>
      </div>
      <Rise at={at(s, 4)} style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Chip tone="portal">Settled on Portaldot</Chip>
        <Arrow at={at(s, 4) + 0.5} />
        <Chip tone="base">Feedback written to Base</Chip>
      </Rise>
    </AbsoluteFill>
  );
}

const STEPS = [
  { text: "Agent buys from New Shop", chain: "Portaldot", hash: "0x5f2a…073e", line: 1 },
  { text: "Held for 30 minutes", chain: "Portaldot", hash: "score 0 · new", line: 2 },
  { text: "Buyer disputes", chain: "Portaldot", hash: "0x803e…161b", line: 3 },
  { text: "Arbiter refunds in full", chain: "Portaldot", hash: "0x775a…1047", line: 3 },
  { text: "Refund back on Base", chain: "Base Sepolia", hash: "0x4e5b…879d", line: 4 },
  { text: "Negative feedback, New Shop", chain: "Base Sepolia", hash: "0x6b36…a61e", line: 4 },
  { text: "Trusted Coffee settles instantly", chain: "Portaldot", hash: "0xff4f…b10a", line: 5 },
];

function Story() {
  const s = scene("story");
  return (
    <AbsoluteFill style={{ background: C.cream, color: C.ink, padding: "90px 100px", flexDirection: "row", gap: 60 }}>
      <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 14 }}>
        <Rise at={0}>
          <Eyebrow>A real run, on testnet</Eyebrow>
          <h2 style={{ fontSize: 60, fontWeight: 700, margin: "8px 0 18px", letterSpacing: -1.5, lineHeight: 1.05 }}>One payment goes wrong. The next settles instantly.</h2>
        </Rise>
        {STEPS.map((step, i) => (
          <Rise key={i} at={at(s, step.line)} delay={i % 2 === 1 && STEPS[i - 1].line === step.line ? 14 : 0} distance={20}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", borderRadius: 18, background: C.paper }}>
              <span style={{ width: 38, height: 38, borderRadius: 19, background: C.ink, color: C.cream, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 600, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 25, fontWeight: 500, flex: 1 }}>{step.text}</span>
              <span style={{ fontSize: 18, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: step.chain === "Portaldot" ? C.warm : C.sky, color: step.chain === "Portaldot" ? "#7d3314" : C.ink }}>{step.chain}</span>
              <code style={{ fontSize: 18, color: C.muted, width: 150, textAlign: "right" }}>{step.hash}</code>
            </div>
          </Rise>
        ))}
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <Window from={0.2} to={at(s, 5)}>
          <Browser src="payment-4-timeline" url="talaria-pi.vercel.app/payment/4" from={0.2} to={at(s, 5)} panFrom={0} panTo={100} width={1000} zoom={1.75} />
        </Window>
        <Window from={at(s, 5)}>
          <Browser src="payment-6" url="talaria-pi.vercel.app/payment/6" from={at(s, 5)} to={s.end - s.start} panFrom={0} panTo={20} width={1000} zoom={1.65} />
        </Window>
      </div>
    </AbsoluteFill>
  );
}

function Checkout() {
  const s = scene("checkout");
  return (
    <AbsoluteFill style={{ background: C.cream, color: C.ink, padding: "90px 100px", flexDirection: "row", gap: 60, alignItems: "center" }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 26 }}>
        <Rise at={0}>
          <Eyebrow>Pay from anywhere</Eyebrow>
          <h2 style={{ fontSize: 66, fontWeight: 700, margin: "8px 0 0", letterSpacing: -1.5, lineHeight: 1.05 }}>Checkout from other chains</h2>
        </Rise>
        <Rise at={at(s, 1)}>
          <Chip tone="good">This wallet: 0 tPOT</Chip>
        </Rise>
        <Rise at={at(s, 2)} style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Chip tone="base">Lock on BNB</Chip>
          <Arrow at={at(s, 2) + 1} />
          <Chip tone="portal">Paid on Portaldot</Chip>
        </Rise>
        <Rise at={at(s, 3)}>
          <p style={{ fontSize: 30, margin: 0, color: C.muted }}>Base Sepolia works the same way.</p>
        </Rise>
        <Rise at={at(s, 4)}>
          <Chip>Merchant refund · 0x803b…040f</Chip>
        </Rise>
      </div>
      <div style={{ flex: 1, position: "relative", height: 760 }}>
        <Window from={0} to={at(s, 2)}>
          <Browser src="wallet" url="talaria-pi.vercel.app/wallet" from={0} to={at(s, 2)} width={1060} zoom={1.3} />
        </Window>
        <Window from={at(s, 2)} to={at(s, 4)}>
          <Browser src="pay-2" url="talaria-pi.vercel.app/pay/2" from={at(s, 2)} to={at(s, 4)} panFrom={0} panTo={40} width={1060} zoom={1.7} />
        </Window>
        <Window from={at(s, 4)}>
          <Browser src="payment-6" url="talaria-pi.vercel.app/payment/6" from={at(s, 4)} to={s.end - s.start} panFrom={20} panTo={60} width={1060} zoom={1.65} />
        </Window>
      </div>
    </AbsoluteFill>
  );
}

function Agent() {
  const s = scene("agent");
  return (
    <AbsoluteFill style={{ background: C.cream, color: C.ink, padding: "90px 100px", flexDirection: "row", gap: 60, alignItems: "center" }}>
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 24 }}>
        <Rise at={0}>
          <Eyebrow>AI agents</Eyebrow>
          <h2 style={{ fontSize: 66, fontWeight: 700, margin: "8px 0 0", letterSpacing: -1.5, lineHeight: 1.05 }}>A budget, not your keys</h2>
        </Rise>
        <Rise at={at(s, 1)} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Chip tone="base">ERC-8004 #10589 · Base</Chip>
          <Chip tone="base">#2723 · BNB</Chip>
          <Chip tone="good">Cap rises with reputation</Chip>
        </Rise>
        <Rise at={at(s, 2)}>
          <Chip>No wallet needed</Chip>
        </Rise>
        <Rise at={at(s, 3)}>
          <p style={{ fontSize: 30, margin: 0, color: C.muted }}>Signed mandate: one merchant, one amount, 30 minutes.</p>
        </Rise>
      </div>
      <div style={{ flex: 1, position: "relative", height: 760 }}>
        <Window from={0} to={at(s, 2)}>
          <Browser src="agent" url="talaria-pi.vercel.app/agent" from={0} to={at(s, 2)} width={1060} zoom={1.3} />
        </Window>
        <Window from={at(s, 2)}>
          <Browser src="agent-result" url="talaria-pi.vercel.app/agent" from={at(s, 2)} to={s.end - s.start} panFrom={0} panTo={30} width={1060} zoom={1.35} />
        </Window>
      </div>
    </AbsoluteFill>
  );
}

function Build() {
  const s = scene("build");
  return (
    <AbsoluteFill style={{ background: C.cream, color: C.ink, padding: "90px 100px", gap: 40 }}>
      <Window from={0} to={at(s, 1)} style={{ padding: "90px 100px", flexDirection: "row", gap: 60, alignItems: "center" }}>
        <div style={{ width: 560 }}>
          <Rise at={0}>
            <Eyebrow>Runs anywhere</Eyebrow>
            <h2 style={{ fontSize: 62, fontWeight: 700, margin: "8px 0 24px", letterSpacing: -1.5, lineHeight: 1.05 }}>Subscriptions, streams, remittance</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Chip tone="base">Base Sepolia</Chip>
              <Arrow at={1} />
              <Chip tone="portal">Settle to Portaldot</Chip>
            </div>
          </Rise>
        </div>
        <Browser src="streams" url="talaria-pi.vercel.app/streams" from={0.3} to={at(s, 1)} panFrom={0} panTo={35} width={1060} zoom={1.3} />
      </Window>
      <Window from={at(s, 1)} style={{ padding: "90px 100px", gap: 40 }}>
        <Rise at={at(s, 1)}>
          <Eyebrow>Open source · MIT</Eyebrow>
          <h2 style={{ fontSize: 62, fontWeight: 700, margin: "8px 0 0", letterSpacing: -1.5 }}>A TypeScript SDK, an MCP server, and docs</h2>
        </Rise>
        <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
          <Browser src="docs-sdk" url="talaria-pi.vercel.app/docs/sdk" from={at(s, 1) + 0.3} to={s.end - s.start} panFrom={0} panTo={25} width={820} zoom={1.25} />
          <Browser src="docs-mcp" url="talaria-pi.vercel.app/docs/mcp" from={at(s, 1) + 0.8} to={s.end - s.start} panFrom={0} panTo={25} width={820} zoom={1.25} />
        </div>
      </Window>
    </AbsoluteFill>
  );
}

function Counter({ value, at: start }: { value: number; at: number }) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [f(start), f(start) + 30], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <>{Math.round(v)}</>;
}

function WhyPortaldot() {
  const s = scene("portaldot");
  const stats = [
    [14, "contracts on 3 testnets"],
    [105, "transactions recorded"],
    [11, "feedback records on Base"],
  ] as const;
  return (
    <AbsoluteFill style={{ background: C.ink, color: C.cream, padding: "110px 140px", gap: 56 }}>
      <Rise at={0}>
        <Eyebrow dark>Why Portaldot</Eyebrow>
        <h2 style={{ fontSize: 92, fontWeight: 700, margin: "10px 0 0", letterSpacing: -2.5 }}>The settlement hub.</h2>
      </Rise>
      <Rise at={at(s, 1)}>
        <p style={{ fontSize: 40, margin: 0, color: "#e8dcd0", maxWidth: 1400, lineHeight: 1.35 }}>V3's EVM runs standard Solidity through pallet-revive, so value and reputation from other chains meet here.</p>
      </Rise>
      <div style={{ display: "flex", gap: 90 }}>
        {stats.map(([value, label], i) => (
          <Rise key={label} at={at(s, 2)} delay={i * 8}>
            <p style={{ fontSize: 120, fontWeight: 700, margin: 0, color: C.orange, lineHeight: 1 }}>
              <Counter value={value} at={at(s, 2) + i * 0.25} />
            </p>
            <p style={{ fontSize: 28, margin: "10px 0 0", color: "#e8dcd0" }}>{label}</p>
          </Rise>
        ))}
      </div>
      <Rise at={at(s, 3)}>
        <p style={{ fontSize: 28, margin: 0, color: "#c9b8ad" }}>Testnet only · one trusted relayer and arbiter today · more attesters and mainnet next</p>
      </Rise>
    </AbsoluteFill>
  );
}

function End() {
  const p = useIn(0);
  return (
    <AbsoluteFill style={{ background: C.ink, color: C.cream, alignItems: "center", justifyContent: "center", gap: 40 }}>
      <Img src={staticFile("logo-white.png")} style={{ width: 620, opacity: p, transform: `scale(${0.9 + p * 0.1})` }} />
      <Rise at={0.9}>
        <p style={{ fontSize: 52, fontWeight: 600, margin: 0 }}>Payments that can come back.</p>
      </Rise>
      <Rise at={1.6} style={{ display: "flex", gap: 40, fontSize: 30, color: "#c9b8ad" }}>
        <span>talaria-pi.vercel.app</span>
        <span>github.com/Stella112/Talaria</span>
      </Rise>
    </AbsoluteFill>
  );
}

function Captions() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const line = timeline.scenes.flatMap((s) => s.lines).find((l) => t >= l.start && t <= l.end + 0.25);
  if (!line) return null;
  const dark = ["hook", "portaldot", "end"].includes(timeline.scenes.find((s) => t >= s.start && t < s.end)?.id ?? "");
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 30, pointerEvents: "none" }}>
      <p style={{ margin: 0, maxWidth: 1500, textAlign: "center", fontSize: 28, fontWeight: 500, padding: "10px 22px", borderRadius: 14, background: dark ? "rgba(255,253,251,0.08)" : "rgba(36,16,10,0.78)", color: C.cream }}>{line.text}</p>
    </AbsoluteFill>
  );
}

const SCENES: Record<string, () => ReactElement> = { hook: Hook, idea: Idea, story: Story, checkout: Checkout, agent: Agent, build: Build, portaldot: WhyPortaldot, end: End };

export function Video() {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily, background: C.ink }}>
      {timeline.scenes.map((s, i) => {
        const Scene = SCENES[s.id];
        const from = i === 0 ? 0 : f(s.start);
        const next = timeline.scenes[i + 1];
        const until = next ? f(next.start) : durationInFrames;
        return (
          <Sequence key={s.id} from={from} durationInFrames={until - from}>
            <SceneFade length={until - from}>
              <Scene />
            </SceneFade>
          </Sequence>
        );
      })}
      <Captions />
      <Audio src={staticFile("audio/voice.wav")} />
    </AbsoluteFill>
  );
}

function SceneFade({ length, children }: { length: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}
