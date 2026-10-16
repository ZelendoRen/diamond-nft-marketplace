import { network } from "hardhat";
import { saveDeployment } from "./deployments";
import { defaultConfig, deployProject } from "./lib/deploy";

// Settings come from the environment, see .env.example. Usage:
//   npx hardhat run scripts/deploy.ts --network sepolia
async function main() {
  const env = process.env;
  const deployment = await deployProject({
    name: env.COLLECTION_NAME ?? defaultConfig.name,
    symbol: env.COLLECTION_SYMBOL ?? defaultConfig.symbol,
    baseURI: env.BASE_URI ?? defaultConfig.baseURI,
    multiTokenURI: env.MULTI_TOKEN_URI ?? defaultConfig.multiTokenURI,
    royaltyReceiver: env.ROYALTY_RECEIVER || undefined,
    royaltyBps: Number(env.ROYALTY_BPS ?? defaultConfig.royaltyBps),
    log: console.log,
  });

  console.log(`\nDiamond: ${deployment.diamond}`);
  // the in-process network disappears with the process, nothing to keep
  if (network.name !== "hardhat") {
    console.log(`Saved to ${saveDeployment(deployment)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
