import { ethers } from "hardhat";
import { FacetCut, FacetCutAction, selectorsOf } from "./selectors";

export interface UpgradePlan {
  cuts: FacetCut[];
  replaced: string[];
  added: string[];
  removed: string[];
}

/**
 * Works out the cuts that make `newFacet` serve `facetName`'s functions:
 *  - selectors the diamond already serves are replaced (unless they already point at `newFacet`),
 *  - selectors it does not serve yet are added,
 *  - when `oldFacet` is given, its selectors that `newFacet` no longer has are removed.
 */
export async function planUpgrade(
  diamond: string,
  facetName: string,
  newFacet: string,
  oldFacet?: string,
): Promise<UpgradePlan> {
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamond);
  const wanted = selectorsOf((await ethers.getContractFactory(facetName)).interface);

  const replaced: string[] = [];
  const added: string[] = [];
  for (const selector of wanted) {
    const current = await loupe.facetAddress(selector);
    if (current === ethers.ZeroAddress) added.push(selector);
    else if (current !== newFacet) replaced.push(selector);
  }

  const removed: string[] = [];
  if (oldFacet) {
    for (const selector of await loupe.facetFunctionSelectors(oldFacet)) {
      if (!wanted.includes(selector)) removed.push(selector);
    }
  }

  const cuts: FacetCut[] = [];
  if (replaced.length > 0) {
    cuts.push({
      facetAddress: newFacet,
      action: FacetCutAction.Replace,
      functionSelectors: replaced,
    });
  }
  if (added.length > 0) {
    cuts.push({ facetAddress: newFacet, action: FacetCutAction.Add, functionSelectors: added });
  }
  if (removed.length > 0) {
    cuts.push({
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: removed,
    });
  }
  return { cuts, replaced, added, removed };
}

export interface UpgradeOptions {
  diamond: string;
  facetName: string; // contract to deploy
  oldFacet?: string; // address of the facet it replaces
  init?: string;
  initCalldata?: string;
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface UpgradeResult {
  plan: UpgradePlan;
  facet?: string; // address of the deployed facet, not set on a dry run
  blockNumber?: number;
  transaction?: string;
}

/** Deploys the new facet and sends the cut. With `dryRun` only the plan is computed. */
export async function upgradeFacet(options: UpgradeOptions): Promise<UpgradeResult> {
  const log = options.log ?? (() => undefined);

  if (options.dryRun) {
    // no deployment on a dry run, so plan against a placeholder address
    const plan = await planUpgrade(
      options.diamond,
      options.facetName,
      ethers.ZeroAddress,
      options.oldFacet,
    );
    log(describe(plan));
    return { plan };
  }

  const facet = await ethers.deployContract(options.facetName);
  await facet.waitForDeployment();
  const facetAddress = await facet.getAddress();
  log(`${options.facetName} deployed at ${facetAddress}`);

  const plan = await planUpgrade(
    options.diamond,
    options.facetName,
    facetAddress,
    options.oldFacet,
  );
  log(describe(plan));
  if (plan.cuts.length === 0) {
    log("nothing to change");
    return { plan, facet: facetAddress };
  }

  const cut = await ethers.getContractAt("IDiamondCut", options.diamond);
  const tx = await cut.diamondCut(
    plan.cuts,
    options.init ?? ethers.ZeroAddress,
    options.initCalldata ?? "0x",
  );
  const receipt = await tx.wait();
  return {
    plan,
    facet: facetAddress,
    blockNumber: receipt?.blockNumber,
    transaction: tx.hash,
  };
}

function describe(plan: UpgradePlan): string {
  return `replace ${plan.replaced.length}, add ${plan.added.length}, remove ${plan.removed.length} functions`;
}
