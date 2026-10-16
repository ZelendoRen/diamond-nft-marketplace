import { network } from "hardhat";
import { loadDeployment, saveDeployment } from "./deployments";
import { upgradeFacet } from "./lib/upgrade";

// Replaces a facet of the deployed diamond. Usage:
//   FACET=ERC721Facet npx hardhat run scripts/upgrade.ts --network sepolia
// FACET     contract to deploy (required)
// REPLACES  facet name in deployments/<network>.json that it replaces, defaults to FACET.
//           Its functions missing from the new facet are removed. Set REPLACES=none to only
//           add and replace functions.
// DRY_RUN   "true" prints the plan and sends nothing
async function main() {
  const facetName = process.env.FACET;
  if (!facetName) throw new Error("set FACET to the name of the contract to deploy");

  const deployment = loadDeployment(network.name);
  const replaces = process.env.REPLACES ?? facetName;
  const oldFacet = replaces === "none" ? undefined : deployment.facets[replaces];

  const result = await upgradeFacet({
    diamond: deployment.diamond,
    facetName,
    oldFacet,
    dryRun: process.env.DRY_RUN === "true",
    log: console.log,
  });

  if (result.facet && result.transaction) {
    deployment.facets[facetName] = result.facet;
    deployment.upgrades.push({
      facet: facetName,
      address: result.facet,
      replaces: oldFacet,
      blockNumber: result.blockNumber ?? 0,
      transaction: result.transaction,
    });
    console.log(`Saved to ${saveDeployment(deployment)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
