import { ethers } from "hardhat";
import { deployDiamond, FacetCutAction, getSelectors } from "./diamond";

export const NAME = "Diamonds";
export const SYMBOL = "DIA";

export async function deployWithERC721(baseURI = "") {
  const base = await deployDiamond();
  const facet = await (await ethers.getContractFactory("ERC721Facet")).deploy();
  const init = await (await ethers.getContractFactory("ERC721Init")).deploy();

  await base.cut.diamondCut(
    [
      {
        facetAddress: facet.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(facet),
      },
    ],
    init.target,
    init.interface.encodeFunctionData("init", [NAME, SYMBOL, baseURI]),
  );

  const nft = await ethers.getContractAt("ERC721Facet", base.diamond.target);
  return { ...base, nft, erc721Facet: facet };
}
