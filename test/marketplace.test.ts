import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployWithMarketplace, errorSelector, PRICE } from "./helpers/marketplace";

const REENTRANT = errorSelector("ReentrantCall()");
const Mode = { None: 0, WithdrawOnReceive: 1, BuyOnTokenReceived: 2, WithdrawOnTokenReceived: 3 };

// alice owns diamond tokens 1 and 2 and MockNFT tokens 10 and 11, the diamond is approved
async function market() {
  const ctx = await deployWithMarketplace();
  const { nft, mockNft, alice, diamond } = ctx;
  await nft.mint(alice.address, "one");
  await nft.mint(alice.address, "two");
  await mockNft.mint(alice.address, 10);
  await mockNft.mint(alice.address, 11);
  await nft.connect(alice).setApprovalForAll(diamond.target, true);
  await mockNft.connect(alice).setApprovalForAll(diamond.target, true);
  return ctx;
}

describe("MarketplaceFacet", () => {
  describe("list", () => {
    it("lists a token of the diamond's own collection", async () => {
      const { market: m, alice, diamond } = await loadFixture(market);

      await expect(m.connect(alice).list(diamond.target, 1, PRICE))
        .to.emit(m, "Listed")
        .withArgs(1, alice.address, diamond.target, 1, PRICE);
    });

    it("lists a token of an external collection", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);

      await expect(m.connect(alice).list(mockNft.target, 10, PRICE))
        .to.emit(m, "Listed")
        .withArgs(1, alice.address, mockNft.target, 10, PRICE);
    });

    it("stores the listing", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      const listing = await m.getListing(1);

      expect(listing.seller).to.equal(alice.address);
      expect(listing.nft).to.equal(mockNft.target);
      expect(listing.tokenId).to.equal(10);
      expect(listing.price).to.equal(PRICE);
      expect(listing.active).to.equal(true);
      expect(await m.activeListingOf(mockNft.target, 10)).to.equal(1);
    });

    it("keeps the token with the seller", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);

      await m.connect(alice).list(mockNft.target, 10, PRICE);

      expect(await mockNft.ownerOf(10)).to.equal(alice.address);
    });

    it("numbers listings sequentially", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);

      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE);

      expect(await m.activeListingOf(mockNft.target, 11)).to.equal(2);
    });

    it("accepts a single-token approval instead of approval for all", async () => {
      const { market: m, bob, mockNft, diamond } = await loadFixture(market);
      await mockNft.mint(bob.address, 20);
      await mockNft.connect(bob).approve(diamond.target, 20);

      await expect(m.connect(bob).list(mockNft.target, 20, PRICE)).to.emit(m, "Listed");
    });

    it("rejects a zero price", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);

      await expect(m.connect(alice).list(mockNft.target, 10, 0)).to.be.revertedWithCustomError(
        m,
        "PriceZero",
      );
    });

    it("rejects a caller who does not own the token", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);

      await expect(m.connect(bob).list(mockNft.target, 10, PRICE))
        .to.be.revertedWithCustomError(m, "NotTokenOwner")
        .withArgs(bob.address, alice.address);
    });

    it("rejects a token the diamond is not approved for", async () => {
      const { market: m, bob, mockNft } = await loadFixture(market);
      await mockNft.mint(bob.address, 30);

      await expect(m.connect(bob).list(mockNft.target, 30, PRICE))
        .to.be.revertedWithCustomError(m, "MarketplaceNotApproved")
        .withArgs(mockNft.target, 30);
    });

    it("rejects a token that does not exist", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);

      await expect(m.connect(alice).list(mockNft.target, 999, PRICE)).to.be.revertedWithCustomError(
        mockNft,
        "ERC721NonexistentToken",
      );
    });

    it("rejects listing a token that is already listed", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(alice).list(mockNft.target, 10, PRICE))
        .to.be.revertedWithCustomError(m, "AlreadyListed")
        .withArgs(1);
    });

    it("allows listing again after a cancel", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).cancel(1);

      await m.connect(alice).list(mockNft.target, 10, PRICE * 2n);

      expect((await m.getListing(2)).price).to.equal(PRICE * 2n);
      expect(await m.activeListingOf(mockNft.target, 10)).to.equal(2);
    });

    it("replaces a stale listing left by a previous owner", async () => {
      const { market: m, alice, bob, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await mockNft.connect(alice).transferFrom(alice.address, bob.address, 10);
      await mockNft.connect(bob).setApprovalForAll(diamond.target, true);

      await expect(m.connect(bob).list(mockNft.target, 10, PRICE * 3n))
        .to.emit(m, "ListingCancelled")
        .withArgs(1);

      expect((await m.getListing(1)).active).to.equal(false);
      expect((await m.getListing(2)).seller).to.equal(bob.address);
    });
  });

  describe("cancel", () => {
    it("deactivates the listing and emits", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(alice).cancel(1)).to.emit(m, "ListingCancelled").withArgs(1);

      expect((await m.getListing(1)).active).to.equal(false);
      expect(await m.activeListingOf(mockNft.target, 10)).to.equal(0);
    });

    it("can only be done by the seller", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(bob).cancel(1))
        .to.be.revertedWithCustomError(m, "NotSeller")
        .withArgs(bob.address, alice.address);
    });

    it("rejects a listing that does not exist", async () => {
      const { market: m, alice } = await loadFixture(market);

      await expect(m.connect(alice).cancel(5)).to.be.revertedWithCustomError(m, "ListingNotActive");
    });

    it("rejects a listing that was already cancelled", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).cancel(1);

      await expect(m.connect(alice).cancel(1)).to.be.revertedWithCustomError(m, "ListingNotActive");
    });

    it("makes the listing impossible to buy", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).cancel(1);

      await expect(m.connect(bob).buy(1, { value: PRICE })).to.be.revertedWithCustomError(
        m,
        "ListingNotActive",
      );
    });
  });

  describe("buy", () => {
    it("transfers a token of the diamond's own collection", async () => {
      const { market: m, nft, alice, bob, diamond } = await loadFixture(market);
      await m.connect(alice).list(diamond.target, 1, PRICE);

      await m.connect(bob).buy(1, { value: PRICE });

      expect(await nft.ownerOf(1)).to.equal(bob.address);
    });

    it("transfers a token of an external collection", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await m.connect(bob).buy(1, { value: PRICE });

      expect(await mockNft.ownerOf(10)).to.equal(bob.address);
    });

    it("emits Sale", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(bob).buy(1, { value: PRICE }))
        .to.emit(m, "Sale")
        .withArgs(1, bob.address, alice.address, mockNft.target, 10, PRICE);
    });

    it("credits the seller instead of paying directly", async () => {
      const { market: m, alice, bob, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(bob).buy(1, { value: PRICE })).to.changeEtherBalances(
        [alice, bob, diamond],
        [0, -PRICE, PRICE],
      );

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("closes the listing", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await m.connect(bob).buy(1, { value: PRICE });

      expect((await m.getListing(1)).active).to.equal(false);
      expect(await m.activeListingOf(mockNft.target, 10)).to.equal(0);
      await expect(m.connect(bob).buy(1, { value: PRICE })).to.be.revertedWithCustomError(
        m,
        "ListingNotActive",
      );
    });

    it("lets the new owner list the token again", async () => {
      const { market: m, alice, bob, carol, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await mockNft.connect(bob).setApprovalForAll(diamond.target, true);

      await m.connect(bob).list(mockNft.target, 10, PRICE * 2n);
      await m.connect(carol).buy(2, { value: PRICE * 2n });

      expect(await mockNft.ownerOf(10)).to.equal(carol.address);
    });

    it("rejects an underpayment", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(bob).buy(1, { value: PRICE - 1n }))
        .to.be.revertedWithCustomError(m, "IncorrectPayment")
        .withArgs(PRICE, PRICE - 1n);
    });

    it("rejects an overpayment", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(bob).buy(1, { value: PRICE + 1n })).to.be.revertedWithCustomError(
        m,
        "IncorrectPayment",
      );
    });

    it("rejects the seller buying their own listing", async () => {
      const { market: m, alice, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);

      await expect(m.connect(alice).buy(1, { value: PRICE })).to.be.revertedWithCustomError(
        m,
        "CannotBuyOwnListing",
      );
    });

    it("rejects a listing that does not exist", async () => {
      const { market: m, bob } = await loadFixture(market);

      await expect(m.connect(bob).buy(42, { value: PRICE })).to.be.revertedWithCustomError(
        m,
        "ListingNotActive",
      );
    });

    it("fails and keeps everything when the seller moved the token away", async () => {
      const { market: m, alice, bob, carol, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await mockNft.connect(alice).transferFrom(alice.address, carol.address, 10);

      // the new owner never approved the diamond
      await expect(m.connect(bob).buy(1, { value: PRICE })).to.be.revertedWithCustomError(
        mockNft,
        "ERC721InsufficientApproval",
      );

      expect((await m.getListing(1)).active).to.equal(true);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("fails with the wrong owner when the new owner approved the diamond", async () => {
      const { market: m, alice, bob, carol, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await mockNft.connect(alice).transferFrom(alice.address, carol.address, 10);
      await mockNft.connect(carol).setApprovalForAll(diamond.target, true);

      await expect(m.connect(bob).buy(1, { value: PRICE }))
        .to.be.revertedWithCustomError(mockNft, "ERC721IncorrectOwner")
        .withArgs(alice.address, 10, carol.address);
    });
    it("fails when the seller revoked the approval", async () => {
      const { market: m, alice, bob, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await mockNft.connect(alice).setApprovalForAll(diamond.target, false);

      await expect(m.connect(bob).buy(1, { value: PRICE })).to.be.revertedWithCustomError(
        mockNft,
        "ERC721InsufficientApproval",
      );
    });

    it("delivers to a contract buyer that implements the receiver interface", async () => {
      const { market: m, alice, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      const buyer = await (
        await ethers.getContractFactory("MockMarketActor")
      ).deploy(diamond.target);

      await expect(buyer.buy(1, PRICE, { value: PRICE })).to.not.be.reverted;
      expect(await mockNft.ownerOf(10)).to.equal(buyer.target);
    });

    it("keeps separate listings of different tokens independent", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE * 2n);

      await m.connect(bob).buy(2, { value: PRICE * 2n });

      expect((await m.getListing(1)).active).to.equal(true);
      expect(await mockNft.ownerOf(10)).to.equal(alice.address);
      expect(await mockNft.ownerOf(11)).to.equal(bob.address);
    });
  });

  describe("withdraw", () => {
    it("pays out the credited amount and zeroes the balance", async () => {
      const { market: m, alice, bob, mockNft, diamond } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });

      await expect(m.connect(alice).withdraw()).to.changeEtherBalances(
        [alice, diamond],
        [PRICE, -PRICE],
      );

      expect(await m.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("emits Withdrawal", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });

      await expect(m.connect(alice).withdraw())
        .to.emit(m, "Withdrawal")
        .withArgs(alice.address, PRICE);
    });

    it("adds up the proceeds of several sales", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE * 2n);
      await m.connect(bob).buy(1, { value: PRICE });
      await m.connect(bob).buy(2, { value: PRICE * 2n });

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE * 3n);
    });

    it("rejects an empty balance", async () => {
      const { market: m, bob } = await loadFixture(market);

      await expect(m.connect(bob).withdraw()).to.be.revertedWithCustomError(m, "NothingToWithdraw");
    });

    it("cannot be repeated", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await m.connect(alice).withdraw();

      await expect(m.connect(alice).withdraw()).to.be.revertedWithCustomError(
        m,
        "NothingToWithdraw",
      );
    });

    it("does not touch other accounts' balances", async () => {
      const { market: m, alice, bob, carol, mockNft } = await loadFixture(market);
      await mockNft.mint(carol.address, 40);
      await mockNft.connect(carol).setApprovalForAll(m.target, true);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(carol).list(mockNft.target, 40, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await m.connect(bob).buy(2, { value: PRICE });

      await m.connect(alice).withdraw();

      expect(await m.pendingWithdrawal(carol.address)).to.equal(PRICE);
    });

    it("reverts and keeps the balance when the receiver rejects ether", async () => {
      const { market: m, bob, mockNft, diamond } = await loadFixture(market);
      const seller = await (
        await ethers.getContractFactory("MockMarketActor")
      ).deploy(diamond.target);
      await mockNft.mint(seller.target, 50);
      await seller.approveAll(mockNft.target);
      await seller.list(mockNft.target, 50, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await seller.setRejectEther(true);

      await expect(seller.withdraw()).to.be.reverted;

      expect(await m.pendingWithdrawal(seller.target)).to.equal(PRICE);
    });
  });

  describe("reentrancy protection", () => {
    async function withActor() {
      const ctx = await market();
      const actor = await (
        await ethers.getContractFactory("MockMarketActor")
      ).deploy(ctx.diamond.target);
      return { ...ctx, actor };
    }

    it("blocks a second withdraw from the payout callback", async () => {
      const { market: m, alice, bob, carol, mockNft, actor } = await loadFixture(withActor);
      // the actor sells a token, and a bystander (alice) also has money waiting in the diamond
      await mockNft.mint(actor.target, 60);
      await actor.approveAll(mockNft.target);
      await actor.list(mockNft.target, 60, PRICE);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await m.connect(carol).buy(2, { value: PRICE });
      await actor.configure(Mode.WithdrawOnReceive, 0, false);

      await actor.withdraw();

      expect(await actor.attempts()).to.equal(1);
      expect((await actor.lastError()).slice(0, 10)).to.equal(REENTRANT);
      // the actor got its own PRICE once, the bystander's PRICE is still there
      expect(await ethers.provider.getBalance(actor.target)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
      expect(await ethers.provider.getBalance(m.target)).to.equal(PRICE);
    });

    it("reverts the whole withdraw when the callback bubbles the error", async () => {
      const { market: m, bob, mockNft, actor } = await loadFixture(withActor);
      await mockNft.mint(actor.target, 60);
      await actor.approveAll(mockNft.target);
      await actor.list(mockNft.target, 60, PRICE);
      await m.connect(bob).buy(1, { value: PRICE });
      await actor.configure(Mode.WithdrawOnReceive, 0, true);

      await expect(actor.withdraw()).to.be.reverted;

      expect(await m.pendingWithdrawal(actor.target)).to.equal(PRICE);
    });

    it("blocks buy from inside the token callback of another buy", async () => {
      const { market: m, alice, mockNft, actor } = await loadFixture(withActor);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE);
      // while buying listing 1 the actor tries to buy listing 2 with ether it holds
      await actor.configure(Mode.BuyOnTokenReceived, 2, false);

      await actor.buy(1, PRICE, { value: PRICE * 2n });

      expect(await actor.attempts()).to.equal(1);
      expect((await actor.lastError()).slice(0, 10)).to.equal(REENTRANT);
      expect(await mockNft.ownerOf(10)).to.equal(actor.target);
      expect(await mockNft.ownerOf(11)).to.equal(alice.address);
      expect((await m.getListing(2)).active).to.equal(true);
    });

    it("reverts the whole purchase when the callback bubbles the error", async () => {
      const { market: m, alice, mockNft, actor } = await loadFixture(withActor);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE);
      await actor.configure(Mode.BuyOnTokenReceived, 2, true);

      await expect(actor.buy(1, PRICE, { value: PRICE * 2n })).to.be.revertedWithCustomError(
        m,
        "ReentrantCall",
      );

      expect(await mockNft.ownerOf(10)).to.equal(alice.address);
      expect((await m.getListing(1)).active).to.equal(true);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("blocks withdraw from inside the token callback of a purchase", async () => {
      const { market: m, alice, mockNft, actor } = await loadFixture(withActor);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await actor.configure(Mode.WithdrawOnTokenReceived, 0, false);

      await actor.buy(1, PRICE, { value: PRICE });

      expect((await actor.lastError()).slice(0, 10)).to.equal(REENTRANT);
    });

    it("works for the diamond's own collection too", async () => {
      const { market: m, nft, alice, diamond, actor } = await loadFixture(withActor);
      await m.connect(alice).list(diamond.target, 1, PRICE);
      await m.connect(alice).list(diamond.target, 2, PRICE);
      await actor.configure(Mode.BuyOnTokenReceived, 2, true);

      await expect(actor.buy(1, PRICE, { value: PRICE * 2n })).to.be.revertedWithCustomError(
        m,
        "ReentrantCall",
      );

      expect(await nft.ownerOf(1)).to.equal(alice.address);
    });

    it("leaves the guard open after a normal call", async () => {
      const { market: m, alice, bob, mockNft } = await loadFixture(market);
      await m.connect(alice).list(mockNft.target, 10, PRICE);
      await m.connect(alice).list(mockNft.target, 11, PRICE);

      await m.connect(bob).buy(1, { value: PRICE });
      await m.connect(bob).buy(2, { value: PRICE });
      await m.connect(alice).withdraw();

      expect(await mockNft.ownerOf(11)).to.equal(bob.address);
    });
  });
});
