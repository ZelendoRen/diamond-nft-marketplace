import { ethers } from "hardhat";
import { FacetCutAction, getSelectors } from "./diamond";
import { deployWithRoyalty } from "./royalty";

export const HOUR = 3600;
export const DAY = 24 * HOUR;
export const START_PRICE = ethers.parseEther("1");
export const bidAfter = (amount: bigint) => amount + (amount * 500n + 9_999n) / 10_000n;

export async function deployWithAuction() {
  const base = await deployWithRoyalty();
  const facet = await (await ethers.getContractFactory("AuctionFacet")).deploy();
  await base.cut.diamondCut(
    [
      {
        facetAddress: facet.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(facet),
      },
    ],
    ethers.ZeroAddress,
    "0x",
  );

  const auction = await ethers.getContractAt("AuctionFacet", base.diamond.target);
  return { ...base, auction };
}
