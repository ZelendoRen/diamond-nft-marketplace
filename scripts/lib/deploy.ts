import { ethers, network } from "hardhat";
import { FacetCut, FacetCutAction, selectorsOf } from "./selectors";

export interface DeployConfig {
  owner?: string; // gets the diamond at the end, defaults to the deployer
  name: string;
  symbol: string;
  baseURI: string; // ERC-721 base URI, "" to store full token URIs
  multiTokenURI: string; // ERC-1155 URI template
  royaltyReceiver?: string; // defaults to the owner
  royaltyBps: number;
  log?: (message: string) => void;
}

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  owner: string;
  blockNumber: number;
  diamond: string;
  facets: Record<string, string>;
  initializers: Record<string, string>;
  // constructor arguments of the Diamond, needed to verify it on Etherscan
  diamondConstructorArgs: unknown[];
  upgrades: UpgradeRecord[];
}

export interface UpgradeRecord {
  facet: string;
  address: string;
  replaces?: string;
  blockNumber: number;
  transaction: string;
}

const CORE_FACETS = ["DiamondCutFacet", "DiamondLoupeFacet", "OwnershipFacet"];

export const defaultConfig: DeployConfig = {
  name: "Diamond Collection",
  symbol: "DIA",
  baseURI: "",
  multiTokenURI: "",
  royaltyBps: 500,
};

async function deploy(name: string, log: (message: string) => void) {
  const contract = await ethers.deployContract(name);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  log(`${name.padEnd(18)} ${address}`);
  return contract;
}

/**
 * Deploys the whole project: the diamond with its three standard facets, then the ERC-721,
 * royalty, ERC-1155, marketplace and auction facets, each added with its own diamondCut
 * because a cut can run only one initializer.
 */
export async function deployProject(config: DeployConfig): Promise<Deployment> {
  const log = config.log ?? (() => undefined);
  const [deployer] = await ethers.getSigners();
  const owner = config.owner ?? deployer.address;
  const royaltyReceiver = config.royaltyReceiver ?? owner;

  log(`Deploying with ${deployer.address} to ${network.name}`);

  const facets: Record<string, string> = {};
  const initializers: Record<string, string> = {};
  const contracts: Record<string, Awaited<ReturnType<typeof deploy>>> = {};

  for (const name of [...CORE_FACETS, "ERC721Facet", "RoyaltyFacet", "ERC1155Facet"]) {
    contracts[name] = await deploy(name, log);
    facets[name] = await contracts[name].getAddress();
  }
  for (const name of ["MarketplaceFacet", "AuctionFacet"]) {
    contracts[name] = await deploy(name, log);
    facets[name] = await contracts[name].getAddress();
  }
  for (const name of ["DiamondInit", "ERC721Init", "RoyaltyInit", "ERC1155Init"]) {
    contracts[name] = await deploy(name, log);
    initializers[name] = await contracts[name].getAddress();
  }

  const addFacet = (name: string): FacetCut => ({
    facetAddress: facets[name],
    action: FacetCutAction.Add,
    functionSelectors: selectorsOf(contracts[name].interface),
  });

  // the diamond is created with the standard facets and registers its ERC-165 interfaces
  const diamondInit = contracts.DiamondInit;
  const constructorArgs = [
    CORE_FACETS.map(addFacet),
    {
      // the deployer owns the diamond while it is being set up
      owner: deployer.address,
      init: initializers.DiamondInit,
      initCalldata: diamondInit.interface.encodeFunctionData("init"),
    },
  ];
  const diamond = await ethers.deployContract("Diamond", constructorArgs);
  await diamond.waitForDeployment();
  const diamondAddress = await diamond.getAddress();
  log(`${"Diamond".padEnd(18)} ${diamondAddress}`);

  const cut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  const steps: [string[], string, string][] = [
    [
      ["ERC721Facet"],
      "ERC721Init",
      contracts.ERC721Init.interface.encodeFunctionData("init", [
        config.name,
        config.symbol,
        config.baseURI,
      ]),
    ],
    [
      ["RoyaltyFacet"],
      "RoyaltyInit",
      contracts.RoyaltyInit.interface.encodeFunctionData("init", [
        royaltyReceiver,
        config.royaltyBps,
      ]),
    ],
    [
      ["ERC1155Facet"],
      "ERC1155Init",
      contracts.ERC1155Init.interface.encodeFunctionData("init", [config.multiTokenURI]),
    ],
  ];
  for (const [names, init, initCalldata] of steps) {
    const tx = await cut.diamondCut(names.map(addFacet), initializers[init], initCalldata);
    await tx.wait();
    log(`added ${names.join(", ")}`);
  }
  const tx = await cut.diamondCut(
    ["MarketplaceFacet", "AuctionFacet"].map(addFacet),
    ethers.ZeroAddress,
    "0x",
  );
  await tx.wait();
  log("added MarketplaceFacet, AuctionFacet");

  if (owner !== deployer.address) {
    const ownership = await ethers.getContractAt("IERC173", diamondAddress);
    await (await ownership.transferOwnership(owner)).wait();
    log(`ownership transferred to ${owner}`);
  }

  const { chainId } = await ethers.provider.getNetwork();
  return {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    owner,
    blockNumber: await ethers.provider.getBlockNumber(),
    diamond: diamondAddress,
    facets,
    initializers,
    diamondConstructorArgs: JSON.parse(
      JSON.stringify(constructorArgs, (_, value) =>
        typeof value === "bigint" ? `${value}` : value,
      ),
    ) as unknown[],
    upgrades: [],
  };
}
