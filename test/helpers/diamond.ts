import { ethers } from "hardhat";
import { BaseContract } from "ethers";

export const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 } as const;

export function getSelectors(contract: BaseContract): string[] {
  return contract.interface.fragments.filter(ethers.Fragment.isFunction).map((f) => f.selector);
}

export function selectorOf(contract: BaseContract, name: string): string {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) throw new Error(`no function ${name}`);
  return fragment.selector;
}

export async function deployDiamond() {
  const [owner, other, third] = await ethers.getSigners();

  const cutFacet = await (await ethers.getContractFactory("DiamondCutFacet")).deploy();
  const loupeFacet = await (await ethers.getContractFactory("DiamondLoupeFacet")).deploy();
  const ownershipFacet = await (await ethers.getContractFactory("OwnershipFacet")).deploy();
  const init = await (await ethers.getContractFactory("DiamondInit")).deploy();

  const cuts = [cutFacet, loupeFacet, ownershipFacet].map((facet) => ({
    facetAddress: facet.target,
    action: FacetCutAction.Add,
    functionSelectors: getSelectors(facet),
  }));

  const diamond = await (
    await ethers.getContractFactory("Diamond")
  ).deploy(cuts, {
    owner: owner.address,
    init: init.target,
    initCalldata: init.interface.encodeFunctionData("init"),
  });
  await diamond.waitForDeployment();

  return {
    diamond,
    cutFacet,
    loupeFacet,
    ownershipFacet,
    // the same diamond address seen through each facet ABI
    cut: await ethers.getContractAt("DiamondCutFacet", diamond.target),
    loupe: await ethers.getContractAt("DiamondLoupeFacet", diamond.target),
    ownership: await ethers.getContractAt("OwnershipFacet", diamond.target),
    owner,
    other,
    third,
  };
}
