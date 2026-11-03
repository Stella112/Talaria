const relayer = process.env.RELAYER_URL || "http://localhost:8787";
const agent = process.env.AGENT_URL || "http://localhost:8789";

/** @type {import("next").NextConfig} */
export default {
  transpilePackages: ["@talaria-pay/sdk"],
  async rewrites() {
    return [
      { source: "/api/relayer/:path*", destination: `${relayer}/:path*` },
      { source: "/api/agent/:path*", destination: `${agent}/:path*` },
    ];
  },
};
