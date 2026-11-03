const relayer = process.env.RELAYER_URL || "http://localhost:8787";
const agent = process.env.AGENT_URL || "http://localhost:8789";
const rpc = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";

/** @type {import("next").NextConfig} */
export default {
  transpilePackages: ["@talaria-pay/sdk"],
  async rewrites() {
    return [
      // The public RPC sometimes answers without CORS headers, so the browser calls it through this server.
      { source: "/api/rpc", destination: rpc },
      { source: "/api/relayer/:path*", destination: `${relayer}/:path*` },
      { source: "/api/agent/:path*", destination: `${agent}/:path*` },
    ];
  },
};
