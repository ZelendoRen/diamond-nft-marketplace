import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { getSelectors, selectorOf } from "./helpers/diamond";
import { add, deployFullDiamond, remove, replace } from "./helpers/full";
import { bidAfter, DAY, START_PRICE } from "./helpers/auction";
import { FEE_BPS, royaltyOf } from "./helpers/royalty";
import { PRICE } from "./helpers/marketplace";

const NO_DATA = "0x";

// A diamond with every facet and some history:
//   - diamond tokens 1-3 belong to alice (1 is approved to carol, 2 is listed for sale)
//   - alice holds 10 of ERC-1155 token 7
//   - auction 1 sells diamond token 3, bob leads with START_PRICE
async function history() {
  const ctx = await deployFullDiamond();
  const { nft, multi, market, auction, alice, bob, carol, diamond } = ctx;

  for (const uri of ["one", "two", "three"]) await nft.mint(alice.address, uri);
  await nft.connect(alice).setApprovalForAll(diamond.target, true);
  await nft.connect(alice).approve(carol.address, 1);
  await multi.mint(alice.address, 7, 10, NO_DATA);

  await market.connect(alice).list(diamond.target, 2, PRICE);
  await auction.connect(alice).createAuction(diamond.target, 3, START_PRICE, DAY);
  await auction.connect(bob).bid(1, { value: START_PRICE });

  return ctx;
}

describe("Facet replacement", () => {
  describe("replacing one function of ERC721Facet", () => {
    async function upgraded() {
      const ctx = await history();
      const v2 = await (await ethers.getContractFactory("MockERC721FacetV2")).deploy();
      await ctx.cut.diamondCut(
        [
          replace(v2.target as string, [selectorOf(v2, "tokenURI")]),
          add(v2.target as string, [selectorOf(v2, "version")]),
        ],
        ethers.ZeroAddress,
        NO_DATA,
      );
      const asV2 = await ethers.getContractAt("MockERC721FacetV2", ctx.diamond.target);
      return { ...ctx, v2, asV2 };
    }

    it("serves the new behaviour", async () => {
      const { nft, asV2 } = await loadFixture(upgraded);

      expect(await nft.tokenURI(1)).to.equal("one?v=2");
      expect(await asV2.version()).to.equal(2);
    });

    it("keeps owners, balances and the supply", async () => {
      const { nft, alice } = await loadFixture(upgraded);

      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(2); // token 3 is in auction escrow
      expect(await nft.totalSupply()).to.equal(3);
      expect(await nft.name()).to.equal("Diamonds");
    });

    it("keeps approvals", async () => {
      const { nft, alice, carol, diamond } = await loadFixture(upgraded);

      expect(await nft.getApproved(1)).to.equal(carol.address);
      expect(await nft.isApprovedForAll(alice.address, diamond.target)).to.equal(true);
    });

    it("keeps the other ERC-721 functions on the old facet", async () => {
      const { loupe, nft, erc721Facet, v2 } = await loadFixture(upgraded);

      expect(await loupe.facetAddress(selectorOf(nft, "ownerOf"))).to.equal(erc721Facet.target);
      expect(await loupe.facetAddress(selectorOf(nft, "tokenURI"))).to.equal(v2.target);
    });

    it("keeps minting with the next id and old tokens transferable", async () => {
      const { nft, alice, bob, carol } = await loadFixture(upgraded);

      await nft.mint(bob.address, "four");
      await nft.connect(carol).transferFrom(alice.address, bob.address, 1);

      expect(await nft.ownerOf(4)).to.equal(bob.address);
      expect(await nft.ownerOf(1)).to.equal(bob.address);
      expect(await nft.tokenURI(4)).to.equal("four?v=2");
    });

    it("does not touch the other facets' state", async () => {
      const { multi, market, auction, royalty, alice, bob, diamond, carol } =
        await loadFixture(upgraded);

      expect(await multi.balanceOf(alice.address, 7)).to.equal(10);
      expect((await market.getListing(1)).price).to.equal(PRICE);
      expect((await auction.getAuction(1)).highestBidder).to.equal(bob.address);
      expect(await royalty.royaltyInfo(1, PRICE)).to.deep.equal([
        carol.address,
        royaltyOf(PRICE, FEE_BPS),
      ]);
      expect(await ethers.provider.getBalance(diamond.target)).to.equal(START_PRICE);
    });

    it("lets a sale that was listed before the upgrade complete", async () => {
      const { nft, market, bob, carol } = await loadFixture(upgraded);

      await market.connect(bob).buy(1, { value: PRICE });

      expect(await nft.ownerOf(2)).to.equal(bob.address);
      expect(await market.pendingWithdrawal(carol.address)).to.equal(royaltyOf(PRICE, FEE_BPS));
    });
  });

  describe("replacing ERC721Facet with a fresh deployment", () => {
    async function redeployed() {
      const ctx = await history();
      const fresh = await (await ethers.getContractFactory("ERC721Facet")).deploy();
      await ctx.cut.diamondCut(
        [replace(fresh.target as string, getSelectors(fresh))],
        ethers.ZeroAddress,
        NO_DATA,
      );
      return { ...ctx, fresh };
    }

    it("moves every selector to the new address", async () => {
      const { loupe, nft, fresh, erc721Facet } = await loadFixture(redeployed);

      expect(await loupe.facetAddress(selectorOf(nft, "ownerOf"))).to.equal(fresh.target);
      expect(await loupe.facetAddresses()).to.not.include(erc721Facet.target);
      expect(await loupe.facetAddresses()).to.include(fresh.target);
    });

    it("keeps all state and works with the other facets", async () => {
      const { nft, market, alice, bob } = await loadFixture(redeployed);

      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.totalSupply()).to.equal(3);
      await market.connect(bob).buy(1, { value: PRICE });
      expect(await nft.ownerOf(2)).to.equal(bob.address);
    });

    it("keeps the ERC-1155 collection sharing the operator approvals", async () => {
      const { multi, nft, alice, bob } = await loadFixture(redeployed);
      await nft.connect(alice).setApprovalForAll(bob.address, true);

      await multi.connect(bob).safeTransferFrom(alice.address, bob.address, 7, 3, NO_DATA);

      expect(await multi.balanceOf(bob.address, 7)).to.equal(3);
    });
  });

  describe("replacing the auction logic while an auction runs", () => {
    async function auctionUpgraded() {
      const ctx = await history();
      const v2 = await (await ethers.getContractFactory("MockAuctionFacetV2")).deploy();
      await ctx.cut.diamondCut(
        [
          replace(v2.target as string, [selectorOf(v2, "bid")]),
          add(v2.target as string, [selectorOf(v2, "auctionCount")]),
        ],
        ethers.ZeroAddress,
        NO_DATA,
      );
      const asV2 = await ethers.getContractAt("MockAuctionFacetV2", ctx.diamond.target);
      return { ...ctx, v2, asV2 };
    }

    it("keeps the leading bid and the escrowed token", async () => {
      const { auction, nft, bob, diamond } = await loadFixture(auctionUpgraded);

      const stored = await auction.getAuction(1);

      expect(stored.highestBidder).to.equal(bob.address);
      expect(stored.highestBid).to.equal(START_PRICE);
      expect(await nft.ownerOf(3)).to.equal(diamond.target);
    });

    it("applies the new bidding rule to the running auction", async () => {
      const { auction, carol } = await loadFixture(auctionUpgraded);

      // the old rule asked for 5%, the new one for 10%
      await expect(auction.connect(carol).bid(1, { value: bidAfter(START_PRICE) }))
        .to.be.revertedWithCustomError(auction, "BidTooLow")
        .withArgs(START_PRICE + START_PRICE / 10n, bidAfter(START_PRICE));
      await expect(
        auction.connect(carol).bid(1, { value: START_PRICE + START_PRICE / 10n }),
      ).to.emit(auction, "BidPlaced");
    });

    it("still refunds the previous leader through withdraw", async () => {
      const { auction, market, bob, carol } = await loadFixture(auctionUpgraded);

      await auction.connect(carol).bid(1, { value: START_PRICE + START_PRICE / 10n });

      expect(await market.pendingWithdrawal(bob.address)).to.equal(START_PRICE);
      await expect(market.connect(bob).withdraw()).to.changeEtherBalance(bob, START_PRICE);
    });

    it("lets the unchanged settle finish the auction", async () => {
      const { auction, nft, market, alice, bob, carol } = await loadFixture(auctionUpgraded);
      const winning = START_PRICE + START_PRICE / 10n;
      await auction.connect(carol).bid(1, { value: winning });
      await time.increase(DAY + 1);

      await auction.settle(1);

      expect(await nft.ownerOf(3)).to.equal(carol.address);
      expect(await market.pendingWithdrawal(alice.address)).to.equal(
        winning - royaltyOf(winning, FEE_BPS),
      );
      expect(await market.pendingWithdrawal(bob.address)).to.equal(START_PRICE);
    });

    it("exposes the new view over the old data", async () => {
      const { asV2, alice, mockNft, auction } = await loadFixture(auctionUpgraded);
      await mockNft.mint(alice.address, 50);
      await mockNft.connect(alice).setApprovalForAll(auction.target, true);
      await auction.connect(alice).createAuction(mockNft.target, 50, START_PRICE, DAY);

      expect(await asV2.auctionCount()).to.equal(2);
    });
  });

  describe("removing a facet and adding it back", () => {
    async function removed() {
      const ctx = await history();
      const selectors = getSelectors(ctx.auction);
      const facet = await ctx.loupe.facetAddress(selectorOf(ctx.auction, "bid"));
      const before = await ctx.loupe.facetAddresses();
      await ctx.cut.diamondCut([remove(selectors)], ethers.ZeroAddress, NO_DATA);
      return { ...ctx, selectors, facet, before };
    }

    it("makes the functions unreachable", async () => {
      const { auction, diamond, carol } = await loadFixture(removed);

      await expect(auction.connect(carol).bid(1, { value: START_PRICE * 2n }))
        .to.be.revertedWithCustomError(diamond, "FunctionNotFound")
        .withArgs(selectorOf(auction, "bid"));
    });

    it("drops the facet from the loupe without leaving duplicates", async () => {
      const { loupe, facet, before } = await loadFixture(removed);

      const after = await loupe.facetAddresses();

      expect(after).to.not.include(facet);
      expect(after).to.have.length(before.length - 1);
      expect(new Set(after).size).to.equal(after.length);
    });

    it("keeps the auction and the escrowed token while the facet is gone", async () => {
      const { nft, diamond } = await loadFixture(removed);

      expect(await nft.ownerOf(3)).to.equal(diamond.target);
      expect(await ethers.provider.getBalance(diamond.target)).to.equal(START_PRICE);
    });

    it("finds the same auction again once the facet is added back", async () => {
      const { cut, auction, selectors, facet, bob, carol } = await loadFixture(removed);
      await cut.diamondCut([add(facet, selectors)], ethers.ZeroAddress, NO_DATA);

      const stored = await auction.getAuction(1);
      expect(stored.highestBidder).to.equal(bob.address);

      await expect(auction.connect(carol).bid(1, { value: bidAfter(START_PRICE) })).to.emit(
        auction,
        "BidPlaced",
      );
    });
  });

  describe("upgrading together with an initializer", () => {
    it("runs the initializer in the same transaction and keeps the tokens", async () => {
      const { cut, nft, alice } = await loadFixture(history);
      const init = await (await ethers.getContractFactory("ERC721Init")).deploy();
      const v2 = await (await ethers.getContractFactory("MockERC721FacetV2")).deploy();

      await cut.diamondCut(
        [replace(v2.target as string, [selectorOf(v2, "tokenURI")])],
        init.target,
        init.interface.encodeFunctionData("init", ["Diamonds II", "DIA2", "ipfs://"]),
      );

      expect(await nft.name()).to.equal("Diamonds II");
      expect(await nft.symbol()).to.equal("DIA2");
      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(2);
    });

    it("rolls back the whole upgrade when the initializer fails", async () => {
      const { cut, nft, loupe, erc721Facet } = await loadFixture(history);
      const failing = await (await ethers.getContractFactory("MockInit")).deploy();
      const v2 = await (await ethers.getContractFactory("MockERC721FacetV2")).deploy();

      await expect(
        cut.diamondCut(
          [replace(v2.target as string, [selectorOf(v2, "tokenURI")])],
          failing.target,
          failing.interface.encodeFunctionData("failWithReason"),
        ),
      ).to.be.revertedWith("init failed");

      expect(await loupe.facetAddress(selectorOf(nft, "tokenURI"))).to.equal(erc721Facet.target);
      expect(await nft.tokenURI(1)).to.equal("one");
    });

    it("rolls back when one of several cuts is invalid", async () => {
      const { cut, nft, loupe, erc721Facet } = await loadFixture(history);
      const v2 = await (await ethers.getContractFactory("MockERC721FacetV2")).deploy();

      await expect(
        cut.diamondCut(
          [
            replace(v2.target as string, [selectorOf(v2, "tokenURI")]),
            replace(v2.target as string, ["0x12345678"]), // does not exist
          ],
          ethers.ZeroAddress,
          NO_DATA,
        ),
      ).to.be.revertedWithCustomError(cut, "CannotReplaceFunctionThatDoesNotExist");

      expect(await loupe.facetAddress(selectorOf(nft, "tokenURI"))).to.equal(erc721Facet.target);
    });
  });

  describe("who may upgrade", () => {
    it("only the owner, also after ownership moved", async () => {
      const { cut, ownership, alice } = await loadFixture(history);
      const v2 = await (await ethers.getContractFactory("MockERC721FacetV2")).deploy();
      const upgrade = replace(v2.target as string, [selectorOf(v2, "tokenURI")]);

      await expect(
        cut.connect(alice).diamondCut([upgrade], ethers.ZeroAddress, NO_DATA),
      ).to.be.revertedWithCustomError(cut, "NotContractOwner");

      await ownership.transferOwnership(alice.address);

      await expect(
        cut.diamondCut([upgrade], ethers.ZeroAddress, NO_DATA),
      ).to.be.revertedWithCustomError(cut, "NotContractOwner");
      await expect(cut.connect(alice).diamondCut([upgrade], ethers.ZeroAddress, NO_DATA)).to.not.be
        .reverted;
    });
  });
});
