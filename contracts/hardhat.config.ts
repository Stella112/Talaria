import "@nomicfoundation/hardhat-toolbox-viem";
import { config as loadEnv } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

loadEnv({ path: "../.env" });

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { evmVersion: "cancun", viaIR: process.env.VIA_IR === "1", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    portaldot: {
      url: process.env.PORTALDOT_EVM_RPC ?? "https://test-evm-rpc-v3.portaldot.dev",
      chainId: 420420777,
      accounts,
    },
  },
};

export default config;
