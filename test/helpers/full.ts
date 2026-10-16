import { ethers } from "hardhat";
import { FacetCutAction, getSelectors } from "./diamond";
import { deployWithAuction } from "./auction";

// every facet of the project installed in one diamond
export async function deployFullDiamond() {
  const base = await deployWithAuction();
  const erc1155 = await (await ethers.getContractFactory("ERC1155Facet")).deploy();
  const init = await (await ethers.getContractFactory("ERC1155Init")).deploy();
  await base.cut.diamondCut(
    [
      {
        facetAddress: erc1155.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(erc1155),
      },
    ],
    init.target,
    init.interface.encodeFunctionData("init", ["https://meta.example/{id}.json"]),
  );

  const multi = await ethers.getContractAt("ERC1155Facet", base.diamond.target);
  return { ...base, multi };
}

export const replace = (facetAddress: string, selectors: string[]) => ({
  facetAddress,
  action: FacetCutAction.Replace,
  functionSelectors: selectors,
});

export const add = (facetAddress: string, selectors: string[]) => ({
  facetAddress,
  action: FacetCutAction.Add,
  functionSelectors: selectors,
});

export const remove = (selectors: string[]) => ({
  facetAddress: ethers.ZeroAddress,
  action: FacetCutAction.Remove,
  functionSelectors: selectors,
});
