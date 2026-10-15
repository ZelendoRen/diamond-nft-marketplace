import { ethers } from "hardhat";
import { FacetCutAction, getSelectors } from "./diamond";
import { deployWithMarketplace } from "./marketplace";

export const FEE_BPS = 500n; // 5%
export const royaltyOf = (price: bigint, feeBps: bigint) => (price * feeBps) / 10_000n;

export async function deployWithRoyalty(defaultFeeBps = FEE_BPS) {
  const base = await deployWithMarketplace();
  const [, , , , dave] = await ethers.getSigners();
  // carol receives the collection royalty
  const facet = await (await ethers.getContractFactory("RoyaltyFacet")).deploy();
  const init = await (await ethers.getContractFactory("RoyaltyInit")).deploy();

  await base.cut.diamondCut(
    [
      {
        facetAddress: facet.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(facet),
      },
    ],
    init.target,
    init.interface.encodeFunctionData("init", [base.carol.address, defaultFeeBps]),
  );

  const royalty = await ethers.getContractAt("RoyaltyFacet", base.diamond.target);
  return { ...base, royalty, dave };
}
