import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadDeployment, saveDeployment } from "../scripts/deployments";
import { defaultConfig, DeployConfig, deployProject } from "../scripts/lib/deploy";
import { selectorsOf } from "../scripts/lib/selectors";
import { planUpgrade, upgradeFacet } from "../scripts/lib/upgrade";

const config: DeployConfig = {
  ...defaultConfig,
  name: "Test Collection",
  symbol: "TST",
  baseURI: "ipfs://base/",
  multiTokenURI: "https://meta.example/{id}.json",
  royaltyBps: 500,
};

async function deployed() {
  const [deployer, alice, bob, carol] = await ethers.getSigners();
  const deployment = await deployProject({ ...config, royaltyReceiver: carol.address });
  const at = (name: string) => ethers.getContractAt(name, deployment.diamond);
  return {
    deployment,
    deployer,
    alice,
    bob,
    carol,
    loupe: await ethers.getContractAt("DiamondLoupeFacet", deployment.diamond),
    nft: await ethers.getContractAt("ERC721Facet", deployment.diamond),
    market: await ethers.getContractAt("MarketplaceFacet", deployment.diamond),
    at,
  };
}

describe("deploy script", () => {
  it("installs all eight facets in one diamond", async () => {
    const { deployment, loupe } = await loadFixture(deployed);

    expect(Object.keys(deployment.facets)).to.have.length(8);
    expect([...(await loupe.facetAddresses())]).to.have.members(Object.values(deployment.facets));
  });

  it("registers every function of every facet", async () => {
    const { deployment, loupe } = await loadFixture(deployed);

    for (const [name, address] of Object.entries(deployment.facets)) {
      const expected = selectorsOf((await ethers.getContractFactory(name)).interface);
      expect([...(await loupe.facetFunctionSelectors(address))], name).to.have.members(expected);
    }
  });

  it("makes the deployer the owner by default", async () => {
    const { deployer, at } = await loadFixture(deployed);

    expect(await (await at("OwnershipFacet")).owner()).to.equal(deployer.address);
  });

  it("can hand ownership to another account from the start", async () => {
    const [, alice] = await ethers.getSigners();

    const deployment = await deployProject({ ...config, owner: alice.address });

    const ownership = await ethers.getContractAt("OwnershipFacet", deployment.diamond);
    expect(await ownership.owner()).to.equal(alice.address);
    expect(deployment.owner).to.equal(alice.address);
  });

  it("sets up the ERC-721 collection from the config", async () => {
    const { nft, deployer, alice } = await loadFixture(deployed);

    expect(await nft.name()).to.equal("Test Collection");
    expect(await nft.symbol()).to.equal("TST");
    await nft.connect(deployer).mint(alice.address, "1.json");
    expect(await nft.tokenURI(1)).to.equal("ipfs://base/1.json");
  });

  it("sets the default royalty from the config", async () => {
    const { at, carol } = await loadFixture(deployed);

    const royalty = await at("RoyaltyFacet");

    expect(await royalty.royaltyInfo(1, 10_000)).to.deep.equal([carol.address, 500n]);
  });

  it("sets the ERC-1155 URI from the config", async () => {
    const { at } = await loadFixture(deployed);

    expect(await (await at("ERC1155Facet")).uri(1)).to.equal("https://meta.example/{id}.json");
  });

  it("defaults the royalty receiver to the owner", async () => {
    const [deployer] = await ethers.getSigners();

    const deployment = await deployProject(config);

    const royalty = await ethers.getContractAt("RoyaltyFacet", deployment.diamond);
    expect((await royalty.royaltyInfo(1, 10_000))[0]).to.equal(deployer.address);
  });

  it("registers all ERC-165 interfaces", async () => {
    const { loupe } = await loadFixture(deployed);

    const ids = {
      erc165: "0x01ffc9a7",
      erc173: "0x7f5828d0",
      loupe: "0x48e2b093",
      erc721: "0x80ac58cd",
      erc721Metadata: "0x5b5e139f",
      erc1155: "0xd9b67a26",
      erc1155Metadata: "0x0e89341c",
      erc2981: "0x2a55205a",
    };
    for (const [name, id] of Object.entries(ids)) {
      expect(await loupe.supportsInterface(id), name).to.equal(true);
    }
  });

  it("returns a record that can be stored as JSON", async () => {
    const { deployment } = await loadFixture(deployed);

    const roundTrip = JSON.parse(JSON.stringify(deployment));

    expect(roundTrip.diamond).to.equal(deployment.diamond);
    expect(roundTrip.diamondConstructorArgs).to.have.length(2);
    expect(roundTrip.upgrades).to.deep.equal([]);
  });

  it("produces a diamond where a sale pays the royalty", async () => {
    const { nft, market, deployer, alice, bob, carol, deployment } = await loadFixture(deployed);
    await nft.connect(deployer).mint(alice.address, "1.json");
    await nft.connect(alice).setApprovalForAll(deployment.diamond, true);
    const price = ethers.parseEther("1");

    await market.connect(alice).list(deployment.diamond, 1, price);
    await market.connect(bob).buy(1, { value: price });

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await market.pendingWithdrawal(carol.address)).to.equal(price / 20n);
    expect(await market.pendingWithdrawal(alice.address)).to.equal((price * 19n) / 20n);
  });
});

describe("upgrade script", () => {
  const facetOf = (d: Awaited<ReturnType<typeof deployed>>, name: string) =>
    d.deployment.facets[name];
  const selector = (
    iface: { getFunction(name: string): { selector: string } | null },
    fn: string,
  ) => iface.getFunction(fn)!.selector;

  describe("planUpgrade", () => {
    it("replaces existing functions and adds new ones", async () => {
      const d = await loadFixture(deployed);
      const v2 = await ethers.deployContract("MockERC721FacetV2");
      const iface = v2.interface;

      const plan = await planUpgrade(
        d.deployment.diamond,
        "MockERC721FacetV2",
        await v2.getAddress(),
      );

      expect(plan.replaced).to.deep.equal([selector(iface, "tokenURI")]);
      expect(plan.added).to.deep.equal([selector(iface, "version")]);
      expect(plan.removed).to.deep.equal([]);
      expect(plan.cuts.map((cut) => cut.action)).to.deep.equal([1, 0]);
    });

    it("removes the old facet's functions that the new one lacks", async () => {
      const d = await loadFixture(deployed);
      const v2 = await ethers.deployContract("MockERC721FacetV2");

      const plan = await planUpgrade(
        d.deployment.diamond,
        "MockERC721FacetV2",
        await v2.getAddress(),
        facetOf(d, "ERC721Facet"),
      );

      const oldSelectors = selectorsOf((await ethers.getContractFactory("ERC721Facet")).interface);
      expect(plan.removed).to.have.length(oldSelectors.length - 1); // tokenURI stays
      expect(plan.removed).to.not.include(selector(v2.interface, "tokenURI"));
      expect(plan.cuts.at(-1)!.action).to.equal(2);
    });

    it("plans nothing when the facet is already installed", async () => {
      const d = await loadFixture(deployed);

      const plan = await planUpgrade(
        d.deployment.diamond,
        "ERC721Facet",
        facetOf(d, "ERC721Facet"),
        facetOf(d, "ERC721Facet"),
      );

      expect(plan.cuts).to.deep.equal([]);
    });
  });

  describe("upgradeFacet", () => {
    it("swaps in a fresh deployment and keeps the state", async () => {
      const d = await loadFixture(deployed);
      await d.nft.connect(d.deployer).mint(d.alice.address, "1.json");
      const oldFacet = facetOf(d, "ERC721Facet");

      const result = await upgradeFacet({
        diamond: d.deployment.diamond,
        facetName: "ERC721Facet",
        oldFacet,
      });

      expect(result.facet).to.not.equal(oldFacet);
      expect(result.plan.added).to.deep.equal([]);
      expect(result.plan.removed).to.deep.equal([]);
      expect(await d.loupe.facetAddresses()).to.not.include(oldFacet);
      expect(await d.loupe.facetAddresses()).to.include(result.facet);
      expect(await d.nft.ownerOf(1)).to.equal(d.alice.address);
      expect(await d.nft.name()).to.equal("Test Collection");
    });

    it("reports where the upgrade happened", async () => {
      const d = await loadFixture(deployed);

      const result = await upgradeFacet({
        diamond: d.deployment.diamond,
        facetName: "ERC721Facet",
        oldFacet: facetOf(d, "ERC721Facet"),
      });

      expect(result.transaction).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.blockNumber).to.be.greaterThan(d.deployment.blockNumber);
    });

    it("sends nothing on a dry run", async () => {
      const d = await loadFixture(deployed);
      const before = await ethers.provider.getBlockNumber();

      const result = await upgradeFacet({
        diamond: d.deployment.diamond,
        facetName: "ERC721Facet",
        oldFacet: facetOf(d, "ERC721Facet"),
        dryRun: true,
      });

      expect(await ethers.provider.getBlockNumber()).to.equal(before);
      expect(result.facet).to.equal(undefined);
      expect(result.plan.replaced.length).to.be.greaterThan(0);
    });

    it("removes functions that the new facet no longer has", async () => {
      const d = await loadFixture(deployed);
      const diamond = d.deployment.diamond;

      await upgradeFacet({
        diamond,
        facetName: "MockERC721FacetV2",
        oldFacet: facetOf(d, "ERC721Facet"),
      });

      const asDiamond = await ethers.getContractAt("Diamond", diamond);
      await expect(d.nft.ownerOf(1)).to.be.revertedWithCustomError(asDiamond, "FunctionNotFound");
      const v2 = await ethers.getContractAt("MockERC721FacetV2", diamond);
      expect(await v2.version()).to.equal(2);
    });

    it("runs an initializer together with the cut", async () => {
      const d = await loadFixture(deployed);
      const init = await ethers.deployContract("ERC721Init");

      await upgradeFacet({
        diamond: d.deployment.diamond,
        facetName: "ERC721Facet",
        oldFacet: facetOf(d, "ERC721Facet"),
        init: await init.getAddress(),
        initCalldata: init.interface.encodeFunctionData("init", ["Renamed", "RN", ""]),
      });

      expect(await d.nft.name()).to.equal("Renamed");
    });

    it("can only be done by the diamond owner", async () => {
      const d = await loadFixture(deployed);
      const cut = await ethers.getContractAt("IDiamondCut", d.deployment.diamond, d.alice);

      const cutFacet = await ethers.getContractAt("DiamondCutFacet", d.deployment.diamond);
      await expect(cut.diamondCut([], ethers.ZeroAddress, "0x")).to.be.revertedWithCustomError(
        cutFacet,
        "NotContractOwner",
      );
    });
  });
});

describe("deployment files", () => {
  const original = process.cwd();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deployments-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a deployment", async () => {
    const deployment = await deployProject(config);

    const path = saveDeployment(deployment);

    expect(path).to.equal(join("deployments", `${deployment.network}.json`));
    expect(loadDeployment(deployment.network)).to.deep.equal(deployment);
  });

  it("explains what to do when there is no deployment yet", () => {
    expect(() => loadDeployment("nowhere")).to.throw(/run the deploy script first/);
  });
});
