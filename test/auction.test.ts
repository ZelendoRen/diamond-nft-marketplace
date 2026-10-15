import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { bidAfter, DAY, deployWithAuction, HOUR, START_PRICE } from "./helpers/auction";
import { errorSelector } from "./helpers/marketplace";
import { FEE_BPS, royaltyOf } from "./helpers/royalty";

const ZERO = ethers.ZeroAddress;
const REENTRANT = errorSelector("ReentrantCall()");

// alice owns diamond tokens 1-2 and MockNFT tokens 10-11 and has approved the diamond for both
async function auction() {
  const ctx = await deployWithAuction();
  const { nft, mockNft, alice, diamond } = ctx;
  await nft.mint(alice.address, "one");
  await nft.mint(alice.address, "two");
  await mockNft.mint(alice.address, 10);
  await mockNft.mint(alice.address, 11);
  await nft.connect(alice).setApprovalForAll(diamond.target, true);
  await mockNft.connect(alice).setApprovalForAll(diamond.target, true);
  return ctx;
}

// auction 1 for MockNFT token 10, starting at START_PRICE and running for a day
async function running() {
  const ctx = await auction();
  await ctx.auction.connect(ctx.alice).createAuction(ctx.mockNft.target, 10, START_PRICE, DAY);
  return ctx;
}

// auction 1 for the diamond's own token 1 with a leading bid from bob
async function withBid() {
  const ctx = await auction();
  await ctx.auction.connect(ctx.alice).createAuction(ctx.diamond.target, 1, START_PRICE, DAY);
  await ctx.auction.connect(ctx.bob).bid(1, { value: START_PRICE });
  return ctx;
}

async function endOf(auctionId: number, a: Awaited<ReturnType<typeof auction>>["auction"]) {
  return Number((await a.getAuction(auctionId)).endTime);
}

describe("AuctionFacet", () => {
  describe("createAuction", () => {
    it("takes the token into escrow (external collection)", async () => {
      const { auction: a, alice, mockNft, diamond } = await loadFixture(auction);

      await a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, DAY);

      expect(await mockNft.ownerOf(10)).to.equal(diamond.target);
    });

    it("takes the token into escrow (the diamond's own collection)", async () => {
      const { auction: a, alice, nft, diamond } = await loadFixture(auction);

      await a.connect(alice).createAuction(diamond.target, 1, START_PRICE, DAY);

      expect(await nft.ownerOf(1)).to.equal(diamond.target);
    });

    it("emits AuctionCreated with the end time", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(auction);
      const expectedEnd = (await time.latest()) + 1 + DAY;

      await expect(a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, DAY))
        .to.emit(a, "AuctionCreated")
        .withArgs(1, alice.address, mockNft.target, 10, START_PRICE, expectedEnd);
    });

    it("stores the auction", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(running);

      const stored = await a.getAuction(1);

      expect(stored.seller).to.equal(alice.address);
      expect(stored.nft).to.equal(mockNft.target);
      expect(stored.tokenId).to.equal(10);
      expect(stored.startingPrice).to.equal(START_PRICE);
      expect(stored.highestBidder).to.equal(ZERO);
      expect(stored.highestBid).to.equal(0);
      expect(stored.finished).to.equal(false);
    });

    it("numbers auctions sequentially", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(running);

      await a.connect(alice).createAuction(mockNft.target, 11, START_PRICE, DAY);

      expect((await a.getAuction(2)).tokenId).to.equal(11);
    });

    it("accepts the shortest and the longest duration", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(auction);

      await a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, HOUR);
      expect(await endOf(1, a)).to.equal((await time.latest()) + HOUR);

      await a.connect(alice).createAuction(mockNft.target, 11, START_PRICE, 30 * DAY);
      expect(await endOf(2, a)).to.equal((await time.latest()) + 30 * DAY);
    });
    it("rejects a duration that is too short or too long", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(auction);

      await expect(a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, HOUR - 1))
        .to.be.revertedWithCustomError(a, "InvalidDuration")
        .withArgs(HOUR - 1);
      await expect(
        a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, 30 * DAY + 1),
      ).to.be.revertedWithCustomError(a, "InvalidDuration");
    });

    it("rejects a zero starting price", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(auction);

      await expect(
        a.connect(alice).createAuction(mockNft.target, 10, 0, DAY),
      ).to.be.revertedWithCustomError(a, "StartingPriceZero");
    });

    it("rejects someone who does not own the token", async () => {
      const { auction: a, alice, bob, mockNft } = await loadFixture(auction);

      await expect(a.connect(bob).createAuction(mockNft.target, 10, START_PRICE, DAY))
        .to.be.revertedWithCustomError(a, "NotTokenOwner")
        .withArgs(bob.address, alice.address);
    });

    it("rejects a token the diamond is not approved for", async () => {
      const { auction: a, bob, mockNft } = await loadFixture(auction);
      await mockNft.mint(bob.address, 30);

      await expect(
        a.connect(bob).createAuction(mockNft.target, 30, START_PRICE, DAY),
      ).to.be.revertedWithCustomError(mockNft, "ERC721InsufficientApproval");
    });

    it("rejects a token that does not exist", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(auction);

      await expect(
        a.connect(alice).createAuction(mockNft.target, 999, START_PRICE, DAY),
      ).to.be.revertedWithCustomError(mockNft, "ERC721NonexistentToken");
    });

    it("rejects a second auction for a token already in escrow", async () => {
      const { auction: a, alice, mockNft, diamond } = await loadFixture(running);

      await expect(a.connect(alice).createAuction(mockNft.target, 10, START_PRICE, DAY))
        .to.be.revertedWithCustomError(a, "NotTokenOwner")
        .withArgs(alice.address, diamond.target);
    });
  });

  describe("bid", () => {
    it("accepts a first bid equal to the starting price", async () => {
      const { auction: a, bob } = await loadFixture(running);

      await expect(a.connect(bob).bid(1, { value: START_PRICE }))
        .to.emit(a, "BidPlaced")
        .withArgs(1, bob.address, START_PRICE);

      const stored = await a.getAuction(1);
      expect(stored.highestBidder).to.equal(bob.address);
      expect(stored.highestBid).to.equal(START_PRICE);
    });

    it("rejects a first bid below the starting price", async () => {
      const { auction: a, bob } = await loadFixture(running);

      await expect(a.connect(bob).bid(1, { value: START_PRICE - 1n }))
        .to.be.revertedWithCustomError(a, "BidTooLow")
        .withArgs(START_PRICE, START_PRICE - 1n);
    });

    it("keeps the bid in the diamond", async () => {
      const { auction: a, bob, diamond } = await loadFixture(running);

      await expect(a.connect(bob).bid(1, { value: START_PRICE })).to.changeEtherBalances(
        [bob, diamond],
        [-START_PRICE, START_PRICE],
      );
    });

    it("requires the next bid to beat the leader by 5%", async () => {
      const { auction: a, carol } = await loadFixture(withBid);

      expect(await a.minimumBid(1)).to.equal(bidAfter(START_PRICE));
      await expect(
        a.connect(carol).bid(1, { value: bidAfter(START_PRICE) - 1n }),
      ).to.be.revertedWithCustomError(a, "BidTooLow");
      await expect(a.connect(carol).bid(1, { value: bidAfter(START_PRICE) })).to.emit(
        a,
        "BidPlaced",
      );
    });

    it("rounds the increment up so tiny bids still have to rise", async () => {
      const { auction: a, alice, bob, carol, mockNft } = await loadFixture(auction);
      await a.connect(alice).createAuction(mockNft.target, 10, 1, DAY);
      await a.connect(bob).bid(1, { value: 1 });

      expect(await a.minimumBid(1)).to.equal(2);
      await expect(a.connect(carol).bid(1, { value: 1 })).to.be.revertedWithCustomError(
        a,
        "BidTooLow",
      );
    });

    it("rejects a bid equal to the current highest", async () => {
      const { auction: a, carol } = await loadFixture(withBid);

      await expect(a.connect(carol).bid(1, { value: START_PRICE })).to.be.revertedWithCustomError(
        a,
        "BidTooLow",
      );
    });

    it("credits the outbid bidder instead of paying them", async () => {
      const { auction: a, market, bob, carol, diamond } = await loadFixture(withBid);

      await expect(
        a.connect(carol).bid(1, { value: bidAfter(START_PRICE) }),
      ).to.changeEtherBalances([bob, diamond], [0, bidAfter(START_PRICE)]);

      expect(await market.pendingWithdrawal(bob.address)).to.equal(START_PRICE);
    });

    it("lets the outbid bidder withdraw", async () => {
      const { auction: a, market, bob, carol } = await loadFixture(withBid);
      await a.connect(carol).bid(1, { value: bidAfter(START_PRICE) });

      await expect(market.connect(bob).withdraw()).to.changeEtherBalance(bob, START_PRICE);
    });

    it("lets the leader raise their own bid and keeps the old one withdrawable", async () => {
      const { auction: a, market, bob } = await loadFixture(withBid);

      await a.connect(bob).bid(1, { value: bidAfter(START_PRICE) });

      expect((await a.getAuction(1)).highestBid).to.equal(bidAfter(START_PRICE));
      expect(await market.pendingWithdrawal(bob.address)).to.equal(START_PRICE);
    });

    it("tracks every outbid bidder separately", async () => {
      const { auction: a, market, bob, carol, dave } = await loadFixture(withBid);
      const second = bidAfter(START_PRICE);
      const third = bidAfter(second);
      await a.connect(carol).bid(1, { value: second });
      await a.connect(dave).bid(1, { value: third });

      expect(await market.pendingWithdrawal(bob.address)).to.equal(START_PRICE);
      expect(await market.pendingWithdrawal(carol.address)).to.equal(second);
      expect(await market.pendingWithdrawal(dave.address)).to.equal(0);
    });

    it("rejects a bid from the seller", async () => {
      const { auction: a, alice } = await loadFixture(running);

      await expect(a.connect(alice).bid(1, { value: START_PRICE })).to.be.revertedWithCustomError(
        a,
        "SellerCannotBid",
      );
    });

    it("rejects a bid on an auction that does not exist", async () => {
      const { auction: a, bob } = await loadFixture(running);

      await expect(a.connect(bob).bid(42, { value: START_PRICE })).to.be.revertedWithCustomError(
        a,
        "AuctionNotFound",
      );
    });

    it("accepts a bid in the last second and rejects one at the end time", async () => {
      const { auction: a, bob, carol } = await loadFixture(running);
      const end = await endOf(1, a);

      await time.setNextBlockTimestamp(end - 1);
      await expect(a.connect(bob).bid(1, { value: START_PRICE })).to.emit(a, "BidPlaced");

      await time.setNextBlockTimestamp(end);
      await expect(
        a.connect(carol).bid(1, { value: bidAfter(START_PRICE) }),
      ).to.be.revertedWithCustomError(a, "AuctionClosed");
    });
    it("rejects a bid on a cancelled auction", async () => {
      const { auction: a, alice, bob } = await loadFixture(running);
      await a.connect(alice).cancelAuction(1);

      await expect(a.connect(bob).bid(1, { value: START_PRICE })).to.be.revertedWithCustomError(
        a,
        "AuctionClosed",
      );
    });

    it("keeps working with a contract bidder", async () => {
      const { auction: a, market, diamond } = await loadFixture(running);
      const bidder = await (
        await ethers.getContractFactory("MockAuctionBidder")
      ).deploy(diamond.target);

      await bidder.bid(1, { value: START_PRICE });

      expect((await a.getAuction(1)).highestBidder).to.equal(bidder.target);
      expect(await market.pendingWithdrawal(bidder.target)).to.equal(0);
    });
  });

  describe("settle", () => {
    it("rejects settling before the end", async () => {
      const { auction: a } = await loadFixture(withBid);

      await expect(a.settle(1)).to.be.revertedWithCustomError(a, "AuctionNotEnded");
    });

    it("rejects an auction that does not exist", async () => {
      const { auction: a } = await loadFixture(withBid);

      await expect(a.settle(9)).to.be.revertedWithCustomError(a, "AuctionNotFound");
    });

    it("is possible exactly at the end time", async () => {
      const { auction: a } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));

      await expect(a.settle(1)).to.emit(a, "AuctionSettled");
    });

    it("gives the token to the winner (the diamond's own collection)", async () => {
      const { auction: a, nft, bob } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await nft.ownerOf(1)).to.equal(bob.address);
    });

    it("gives the token to the winner (external collection)", async () => {
      const { auction: a, mockNft, bob } = await loadFixture(running);
      await a.connect(bob).bid(1, { value: START_PRICE });
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await mockNft.ownerOf(10)).to.equal(bob.address);
    });

    it("emits AuctionSettled with the winner and the price", async () => {
      const { auction: a, bob } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));

      await expect(a.settle(1)).to.emit(a, "AuctionSettled").withArgs(1, bob.address, START_PRICE);
    });

    it("splits the price between the royalty receiver and the seller", async () => {
      const { auction: a, market, alice, carol, diamond } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));

      await expect(a.settle(1))
        .to.emit(a, "RoyaltyPaid")
        .withArgs(diamond.target, 1, carol.address, royaltyOf(START_PRICE, FEE_BPS));

      expect(await market.pendingWithdrawal(carol.address)).to.equal(
        royaltyOf(START_PRICE, FEE_BPS),
      );
      expect(await market.pendingWithdrawal(alice.address)).to.equal(
        START_PRICE - royaltyOf(START_PRICE, FEE_BPS),
      );
    });

    it("pays the seller in full for a collection without royalties", async () => {
      const { auction: a, market, alice, bob } = await loadFixture(running);
      await a.connect(bob).bid(1, { value: START_PRICE });
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await market.pendingWithdrawal(alice.address)).to.equal(START_PRICE);
    });

    it("uses the winning bid, not an earlier one", async () => {
      const { auction: a, market, alice, carol, dave } = await loadFixture(running);
      const winning = bidAfter(START_PRICE);
      await a.connect(carol).bid(1, { value: START_PRICE });
      await a.connect(dave).bid(1, { value: winning });
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await market.pendingWithdrawal(alice.address)).to.equal(winning);
    });
    it("can be called by anyone", async () => {
      const { auction: a, dave } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));

      await expect(a.connect(dave).settle(1)).to.emit(a, "AuctionSettled");
    });

    it("cannot be repeated", async () => {
      const { auction: a } = await loadFixture(withBid);
      await time.increaseTo(await endOf(1, a));
      await a.settle(1);

      await expect(a.settle(1)).to.be.revertedWithCustomError(a, "AuctionAlreadyFinished");
    });

    it("lets everyone withdraw afterwards and empties the diamond", async () => {
      const { auction: a, market, alice, bob, carol, dave, diamond } = await loadFixture(withBid);
      await a.connect(dave).bid(1, { value: bidAfter(START_PRICE) });
      await time.increaseTo(await endOf(1, a));
      await a.settle(1);

      await market.connect(bob).withdraw(); // refund
      await market.connect(alice).withdraw(); // sale
      await market.connect(carol).withdraw(); // royalty

      expect(await ethers.provider.getBalance(diamond.target)).to.equal(0);
    });

    it("returns the token to the seller when nobody bid", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(running);
      await time.increaseTo(await endOf(1, a));

      await expect(a.settle(1)).to.emit(a, "AuctionUnsold").withArgs(1);

      expect(await mockNft.ownerOf(10)).to.equal(alice.address);
    });

    it("does not credit anyone when nobody bid", async () => {
      const { auction: a, market, alice } = await loadFixture(running);
      await time.increaseTo(await endOf(1, a));
      await a.settle(1);

      expect(await market.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("cannot be blocked by a winner that is a contract without a receiver function", async () => {
      const { auction: a, mockNft, diamond } = await loadFixture(running);
      const bidder = await (
        await ethers.getContractFactory("MockAuctionBidder")
      ).deploy(diamond.target);
      await bidder.bid(1, { value: START_PRICE });
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await mockNft.ownerOf(10)).to.equal(bidder.target);
    });

    it("cannot be blocked by a refund receiver that rejects ether", async () => {
      const { auction: a, market, alice, carol, diamond, mockNft } = await loadFixture(running);
      const first = await (
        await ethers.getContractFactory("MockAuctionBidder")
      ).deploy(diamond.target);
      await first.bid(1, { value: START_PRICE });
      await first.setRejectEther(true);
      await a.connect(carol).bid(1, { value: bidAfter(START_PRICE) });
      await time.increaseTo(await endOf(1, a));

      await a.settle(1);

      expect(await mockNft.ownerOf(10)).to.equal(carol.address);
      expect(await market.pendingWithdrawal(first.target)).to.equal(START_PRICE);
      expect(await market.pendingWithdrawal(alice.address)).to.equal(bidAfter(START_PRICE));
    });
  });

  describe("cancelAuction", () => {
    it("returns the token and emits", async () => {
      const { auction: a, alice, mockNft } = await loadFixture(running);

      await expect(a.connect(alice).cancelAuction(1)).to.emit(a, "AuctionCancelled").withArgs(1);

      expect(await mockNft.ownerOf(10)).to.equal(alice.address);
      expect((await a.getAuction(1)).finished).to.equal(true);
    });

    it("can only be done by the seller", async () => {
      const { auction: a, alice, bob } = await loadFixture(running);

      await expect(a.connect(bob).cancelAuction(1))
        .to.be.revertedWithCustomError(a, "NotAuctionSeller")
        .withArgs(bob.address, alice.address);
    });

    it("is not possible once there is a bid", async () => {
      const { auction: a, alice } = await loadFixture(withBid);

      await expect(a.connect(alice).cancelAuction(1))
        .to.be.revertedWithCustomError(a, "AuctionHasBids")
        .withArgs(1);
    });

    it("cannot be repeated", async () => {
      const { auction: a, alice } = await loadFixture(running);
      await a.connect(alice).cancelAuction(1);

      await expect(a.connect(alice).cancelAuction(1)).to.be.revertedWithCustomError(
        a,
        "AuctionAlreadyFinished",
      );
    });

    it("rejects an auction that does not exist", async () => {
      const { auction: a, alice } = await loadFixture(running);

      await expect(a.connect(alice).cancelAuction(7)).to.be.revertedWithCustomError(
        a,
        "AuctionNotFound",
      );
    });

    it("makes settle impossible", async () => {
      const { auction: a, alice } = await loadFixture(running);
      await a.connect(alice).cancelAuction(1);
      await time.increaseTo(await endOf(1, a));

      await expect(a.settle(1)).to.be.revertedWithCustomError(a, "AuctionAlreadyFinished");
    });

    it("lets the seller start a new auction for the same token", async () => {
      const { auction: a, alice, mockNft, diamond } = await loadFixture(running);
      await a.connect(alice).cancelAuction(1);
      await mockNft.connect(alice).approve(diamond.target, 10);

      await a.connect(alice).createAuction(mockNft.target, 10, START_PRICE * 2n, DAY);

      expect((await a.getAuction(2)).startingPrice).to.equal(START_PRICE * 2n);
    });
  });

  describe("reentrancy protection", () => {
    async function withReentrantNFT() {
      const ctx = await auction();
      const evil = await (await ethers.getContractFactory("MockReentrantNFT")).deploy();
      await evil.mint(ctx.alice.address, 1);
      await evil.connect(ctx.alice).setApprovalForAll(ctx.diamond.target, true);
      return { ...ctx, evil };
    }

    it("blocks a bid made from the token's transferFrom while the auction is created", async () => {
      const { auction: a, alice, evil, diamond } = await loadFixture(withReentrantNFT);
      // auction 1 will exist by the time the token is pulled in
      await evil.configure(diamond.target, a.interface.encodeFunctionData("bid", [1]), false);

      await a.connect(alice).createAuction(evil.target, 1, START_PRICE, DAY);

      expect(await evil.attempts()).to.equal(1);
      expect((await evil.lastError()).slice(0, 10)).to.equal(REENTRANT);
    });

    it("reverts the creation when the token bubbles the error up", async () => {
      const { auction: a, alice, evil, diamond } = await loadFixture(withReentrantNFT);
      await evil.configure(diamond.target, a.interface.encodeFunctionData("bid", [1]), true);

      await expect(
        a.connect(alice).createAuction(evil.target, 1, START_PRICE, DAY),
      ).to.be.revertedWithCustomError(a, "ReentrantCall");

      expect(await evil.ownerOf(1)).to.equal(alice.address);
    });

    it("blocks a second settle from the token's transferFrom", async () => {
      const { auction: a, alice, bob, evil, diamond } = await loadFixture(withReentrantNFT);
      await a.connect(alice).createAuction(evil.target, 1, START_PRICE, DAY);
      await a.connect(bob).bid(1, { value: START_PRICE });
      await time.increaseTo(await endOf(1, a));
      await evil.configure(diamond.target, a.interface.encodeFunctionData("settle", [1]), false);

      await a.settle(1);

      expect((await evil.lastError()).slice(0, 10)).to.equal(REENTRANT);
      expect(await evil.ownerOf(1)).to.equal(bob.address);
    });

    it("blocks a bid from the token's transferFrom while the auction is cancelled", async () => {
      const { auction: a, alice, evil, diamond } = await loadFixture(withReentrantNFT);
      await a.connect(alice).createAuction(evil.target, 1, START_PRICE, DAY);
      await evil.configure(diamond.target, a.interface.encodeFunctionData("bid", [1]), false);

      await a.connect(alice).cancelAuction(1);

      expect((await evil.lastError()).slice(0, 10)).to.equal(REENTRANT);
      expect(await evil.ownerOf(1)).to.equal(alice.address);
    });
    it("blocks withdraw from the token's transferFrom during settle", async () => {
      const { auction: a, alice, bob, evil, diamond } = await loadFixture(withReentrantNFT);
      await a.connect(alice).createAuction(evil.target, 1, START_PRICE, DAY);
      await a.connect(bob).bid(1, { value: START_PRICE });
      await time.increaseTo(await endOf(1, a));
      const withdraw = new ethers.Interface(["function withdraw()"]).encodeFunctionData("withdraw");
      await evil.configure(diamond.target, withdraw, true);

      await expect(a.settle(1)).to.be.revertedWithCustomError(a, "ReentrantCall");

      expect((await a.getAuction(1)).finished).to.equal(false);
    });
  });
});
