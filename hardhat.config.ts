import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY, REPORT_GAS, GAS_REPORT_FILE } =
  process.env;

// test helpers stay out of the gas report
const mockContracts = readdirSync("contracts/mocks").flatMap((file) =>
  [...readFileSync(`contracts/mocks/${file}`, "utf8").matchAll(/^contract (\w+)/gm)].map(
    (match) => match[1],
  ),
);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    // sepolia is added only when its secrets are set
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [DEPLOYER_PRIVATE_KEY],
          },
        }
      : {}),
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY ?? "",
  },
  gasReporter: {
    enabled: REPORT_GAS === "true",
    offline: true, // gas units only, no price lookups
    excludeContracts: mockContracts,
    ...(GAS_REPORT_FILE ? { outputFile: GAS_REPORT_FILE, reportFormat: "markdown" as const } : {}),
  },
};

export default config;
