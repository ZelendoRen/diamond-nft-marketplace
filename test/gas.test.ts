import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { defaultConfig, deployProject } from "../scripts/lib/deploy";

// One ordinary run through every user-facing function, so that `npm run gas` reports typical
// costs instead of the mix of normal and hostile cases in the rest of the suite.
describe("gas scenario", () => {
  it("runs every user-facing function once or twice", async () => {
    const [owner, alice, bob, carol] = await ethers.getSigners();
    const deployment = await deployProject({
      ...defaultConfig,
      royaltyReceiver: carol.address,
      baseURI: "ipfs://base/",
      multiTokenURI: "ipfs://multi/{id}.json",
    });
    const diamond = deployment.diamond;
    const nft = await ethers.getContractAt("ERC721Facet", diamond);
    const multi = await ethers.getContractAt("ERC1155Facet", diamond);
    const royalty = await ethers.getContractAt("RoyaltyFacet", diamond);
    const market = await ethers.getContractAt("MarketplaceFacet", diamond);
    const auction = await ethers.getContractAt("AuctionFacet", diamond);
    const ownership = await ethers.getContractAt("OwnershipFacet", diamond);
    const price = ethers.parseEther("1");

    // ERC-721
    for (const uri of ["1.json", "2.json", "3.json", "4.json", "5.json"]) {
      await nft.mint(alice.address, uri);
    }
    await nft.connect(alice).setApprovalForAll(diamond, true);
    await nft.connect(alice).approve(bob.address, 5);
    await nft.connect(alice).transferFrom(alice.address, bob.address, 5);
    const safeTransfer = nft.connect(bob)["safeTransferFrom(address,address,uint256)"];
    await safeTransfer(bob.address, alice.address, 5);
    await nft.connect(alice).burn(5);
    await nft.setBaseURI("ipfs://new-base/");

    // ERC-1155
    await multi.mint(alice.address, 1, 100, "0x");
    await multi.mintBatch(alice.address, [2, 3, 4], [10, 20, 30], "0x");
    await multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 5, "0x");
    await multi
      .connect(alice)
      .safeBatchTransferFrom(alice.address, bob.address, [2, 3], [1, 2], "0x");
    await multi.connect(alice).burn(alice.address, 1, 5);
    await multi.connect(alice).burnBatch(alice.address, [2, 3], [1, 1]);
    await multi.setTokenURI(1, "ipfs://one.json");

    // royalties
    await royalty.setDefaultRoyalty(carol.address, 750);
    await royalty.setTokenRoyalty(2, owner.address, 250);
    await royalty.resetTokenRoyalty(2);

    // marketplace: list and buy, list and cancel, withdraw
    await market.connect(alice).list(diamond, 1, price);
    await market.connect(bob).buy(1, { value: price });
    await market.connect(alice).list(diamond, 2, price);
    await market.connect(alice).cancel(2);
    await market.connect(alice).withdraw();
    await market.connect(carol).withdraw();

    // auction: sold, outbid, unsold, cancelled
    await auction.connect(alice).createAuction(diamond, 3, price, 3600);
    await auction.connect(bob).bid(1, { value: price });
    await auction.connect(carol).bid(1, { value: (price * 11n) / 10n });
    await auction.connect(alice).createAuction(diamond, 4, price, 3600);
    await auction.connect(alice).createAuction(diamond, 2, price, 3600);
    await auction.connect(alice).cancelAuction(3);
    await time.increase(3601);
    await auction.settle(1);
    await auction.settle(2);
    await market.connect(bob).withdraw();

    await ownership.transferOwnership(bob.address);

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await nft.ownerOf(3)).to.equal(carol.address);
    expect(await nft.ownerOf(4)).to.equal(alice.address);
  });
});
