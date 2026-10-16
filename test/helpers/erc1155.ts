import { ethers } from "hardhat";
import { FacetCutAction, getSelectors } from "./diamond";
import { deployWithERC721 } from "./erc721";

export const BASE_URI = "https://meta.example/{id}.json";

export async function deployWithERC1155() {
  const base = await deployWithERC721();
  const facet = await (await ethers.getContractFactory("ERC1155Facet")).deploy();
  const init = await (await ethers.getContractFactory("ERC1155Init")).deploy();

  await base.cut.diamondCut(
    [
      {
        facetAddress: facet.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(facet),
      },
    ],
    init.target,
    init.interface.encodeFunctionData("init", [BASE_URI]),
  );

  const multi = await ethers.getContractAt("ERC1155Facet", base.diamond.target);
  const [, alice, bob, carol] = await ethers.getSigners();
  return { ...base, multi, erc1155Facet: facet, alice, bob, carol };
}
