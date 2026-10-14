import { ethers } from "hardhat";
import { FacetCutAction, getSelectors } from "./diamond";
import { deployWithERC721 } from "./erc721";

export const PRICE = ethers.parseEther("1");

// 4-byte selector of a custom error
export const errorSelector = (signature: string) => ethers.id(signature).slice(0, 10);

export async function deployWithMarketplace() {
  const base = await deployWithERC721();
  const facet = await (await ethers.getContractFactory("MarketplaceFacet")).deploy();
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

  const market = await ethers.getContractAt("MarketplaceFacet", base.diamond.target);
  const mockNft = await (await ethers.getContractFactory("MockNFT")).deploy();
  const [, alice, bob, carol] = await ethers.getSigners();

  return { ...base, market, mockNft, alice, bob, carol };
}
