import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployWithRoyalty, FEE_BPS, royaltyOf } from "./helpers/royalty";
import { PRICE } from "./helpers/marketplace";

const ZERO = ethers.ZeroAddress;
const ERC2981_ID = "0x2a55205a";
const Mode = {
  Normal: 0,
  RevertsOnRoyalty: 1,
  AbovePrice: 2,
  BurnsGas: 3,
  RevertsOnSupports: 4,
  SaysUnsupported: 5,
  ZeroReceiver: 6,
  BurnsGasOnSupports: 7,
};

// alice owns diamond tokens 1 and 2 and approved the diamond; carol gets the default royalty
async function royalty() {
  const ctx = await deployWithRoyalty();
  await ctx.nft.mint(ctx.alice.address, "one");
  await ctx.nft.mint(ctx.alice.address, "two");
  await ctx.nft.connect(ctx.alice).setApprovalForAll(ctx.diamond.target, true);
  return ctx;
}

async function withoutDefault() {
  const ctx = await royalty();
  await ctx.royalty.deleteDefaultRoyalty();
  return ctx;
}

// lists the token for alice and lets bob buy it
async function sell(
  ctx: Awaited<ReturnType<typeof royalty>>,
  nft: string,
  tokenId: number,
  price = PRICE,
) {
  await ctx.market.connect(ctx.alice).list(nft, tokenId, price);
  const listingId = await ctx.market.activeListingOf(nft, tokenId);
  return ctx.market.connect(ctx.bob).buy(listingId, { value: price, gasLimit: 3_000_000 });
}
describe("RoyaltyFacet", () => {
  describe("royaltyInfo", () => {
    it("returns the default royalty set by the initializer", async () => {
      const { royalty: r, carol } = await loadFixture(royalty);

      expect(await r.royaltyInfo(1, PRICE)).to.deep.equal([
        carol.address,
        royaltyOf(PRICE, FEE_BPS),
      ]);
    });

    it("rounds the amount down", async () => {
      const { royalty: r } = await loadFixture(royalty);

      const [, amount] = await r.royaltyInfo(1, 39);

      expect(amount).to.equal(1); // 39 * 5% = 1.95
    });

    it("registers ERC-2981 with ERC-165", async () => {
      const { loupe } = await loadFixture(royalty);

      expect(await loupe.supportsInterface(ERC2981_ID)).to.equal(true);
    });

    it("reports no royalty when none is configured", async () => {
      const { royalty: r } = await loadFixture(withoutDefault);

      expect(await r.royaltyInfo(1, PRICE)).to.deep.equal([ZERO, 0]);
    });
  });

  describe("default royalty", () => {
    it("can be changed by the owner", async () => {
      const { royalty: r, dave } = await loadFixture(royalty);

      await expect(r.setDefaultRoyalty(dave.address, 1000))
        .to.emit(r, "DefaultRoyaltySet")
        .withArgs(dave.address, 1000);

      expect(await r.royaltyInfo(1, PRICE)).to.deep.equal([dave.address, PRICE / 10n]);
    });

    it("accepts 100%", async () => {
      const { royalty: r, dave } = await loadFixture(royalty);

      await r.setDefaultRoyalty(dave.address, 10_000);

      expect((await r.royaltyInfo(1, PRICE))[1]).to.equal(PRICE);
    });

    it("rejects more than 100%", async () => {
      const { royalty: r, dave } = await loadFixture(royalty);

      await expect(r.setDefaultRoyalty(dave.address, 10_001))
        .to.be.revertedWithCustomError(r, "RoyaltyFeeTooHigh")
        .withArgs(10_001);
    });

    it("rejects the zero address", async () => {
      const { royalty: r } = await loadFixture(royalty);

      await expect(r.setDefaultRoyalty(ZERO, 500)).to.be.revertedWithCustomError(
        r,
        "InvalidRoyaltyReceiver",
      );
    });

    it("can only be changed by the owner", async () => {
      const { royalty: r, alice, dave } = await loadFixture(royalty);

      await expect(
        r.connect(alice).setDefaultRoyalty(dave.address, 500),
      ).to.be.revertedWithCustomError(r, "NotContractOwner");
      await expect(r.connect(alice).deleteDefaultRoyalty()).to.be.revertedWithCustomError(
        r,
        "NotContractOwner",
      );
    });

    it("can be deleted", async () => {
      const { royalty: r } = await loadFixture(royalty);

      await expect(r.deleteDefaultRoyalty()).to.emit(r, "DefaultRoyaltyDeleted");

      expect(await r.royaltyInfo(1, PRICE)).to.deep.equal([ZERO, 0]);
    });
  });

  describe("token royalty", () => {
    it("overrides the default for one token only", async () => {
      const { royalty: r, carol, dave } = await loadFixture(royalty);

      await expect(r.setTokenRoyalty(2, dave.address, 1000))
        .to.emit(r, "TokenRoyaltySet")
        .withArgs(2, dave.address, 1000);

      expect(await r.royaltyInfo(2, PRICE)).to.deep.equal([dave.address, PRICE / 10n]);
      expect((await r.royaltyInfo(1, PRICE))[0]).to.equal(carol.address);
    });

    it("can be reset to the default", async () => {
      const { royalty: r, carol, dave } = await loadFixture(royalty);
      await r.setTokenRoyalty(2, dave.address, 1000);

      await expect(r.resetTokenRoyalty(2)).to.emit(r, "TokenRoyaltyReset").withArgs(2);

      expect(await r.royaltyInfo(2, PRICE)).to.deep.equal([
        carol.address,
        royaltyOf(PRICE, FEE_BPS),
      ]);
    });

    it("keeps working after the default is deleted", async () => {
      const { royalty: r, dave } = await loadFixture(royalty);
      await r.setTokenRoyalty(2, dave.address, 1000);

      await r.deleteDefaultRoyalty();

      expect((await r.royaltyInfo(2, PRICE))[0]).to.equal(dave.address);
      expect((await r.royaltyInfo(1, PRICE))[0]).to.equal(ZERO);
    });

    it("rejects a token that does not exist", async () => {
      const { royalty: r, nft, dave } = await loadFixture(royalty);

      await expect(r.setTokenRoyalty(99, dave.address, 500)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken",
      );
    });

    it("rejects the zero address and more than 100%", async () => {
      const { royalty: r, dave } = await loadFixture(royalty);

      await expect(r.setTokenRoyalty(1, ZERO, 500)).to.be.revertedWithCustomError(
        r,
        "InvalidRoyaltyReceiver",
      );
      await expect(r.setTokenRoyalty(1, dave.address, 10_001)).to.be.revertedWithCustomError(
        r,
        "RoyaltyFeeTooHigh",
      );
    });

    it("can only be changed by the owner", async () => {
      const { royalty: r, alice, dave } = await loadFixture(royalty);

      await expect(
        r.connect(alice).setTokenRoyalty(1, dave.address, 500),
      ).to.be.revertedWithCustomError(r, "NotContractOwner");
      await expect(r.connect(alice).resetTokenRoyalty(1)).to.be.revertedWithCustomError(
        r,
        "NotContractOwner",
      );
    });
  });

  describe("payout on a marketplace sale", () => {
    it("splits the price between the royalty receiver and the seller", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, alice, carol, diamond } = ctx;

      await sell(ctx, diamond.target as string, 1);

      expect(await m.pendingWithdrawal(carol.address)).to.equal(royaltyOf(PRICE, FEE_BPS));
      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE - royaltyOf(PRICE, FEE_BPS));
    });

    it("emits RoyaltyPaid", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, carol, diamond } = ctx;

      await expect(sell(ctx, diamond.target as string, 1))
        .to.emit(m, "RoyaltyPaid")
        .withArgs(diamond.target, 1, carol.address, royaltyOf(PRICE, FEE_BPS));
    });

    it("lets the royalty receiver withdraw", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, carol, diamond } = ctx;
      await sell(ctx, diamond.target as string, 1);

      await expect(m.connect(carol).withdraw()).to.changeEtherBalance(
        carol,
        royaltyOf(PRICE, FEE_BPS),
      );
    });

    it("never pays out more than the buyer paid", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, alice, carol, diamond } = ctx;

      await sell(ctx, diamond.target as string, 1);

      const credited =
        (await m.pendingWithdrawal(alice.address)) + (await m.pendingWithdrawal(carol.address));
      expect(credited).to.equal(PRICE);
      expect(await ethers.provider.getBalance(diamond.target)).to.equal(PRICE);
    });

    it("uses the token override instead of the default", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, royalty: r, alice, carol, dave, diamond } = ctx;
      await r.setTokenRoyalty(2, dave.address, 1000);

      await sell(ctx, diamond.target as string, 2);

      expect(await m.pendingWithdrawal(dave.address)).to.equal(PRICE / 10n);
      expect(await m.pendingWithdrawal(carol.address)).to.equal(0);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE - PRICE / 10n);
    });

    it("applies the royalty valid at the time of the sale", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, royalty: r, alice, bob, carol, dave, diamond } = ctx;
      await m.connect(alice).list(diamond.target, 1, PRICE);

      await r.setDefaultRoyalty(dave.address, 2000);
      await m.connect(bob).buy(1, { value: PRICE });

      expect(await m.pendingWithdrawal(dave.address)).to.equal(PRICE / 5n);
      expect(await m.pendingWithdrawal(carol.address)).to.equal(0);
    });

    it("does not credit or emit anything when the royalty is zero", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, royalty: r, alice, dave, diamond } = ctx;
      await r.setTokenRoyalty(1, dave.address, 0);

      await expect(sell(ctx, diamond.target as string, 1)).to.not.emit(m, "RoyaltyPaid");

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("pays nothing to the seller when the royalty is 100%", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, royalty: r, alice, dave, diamond } = ctx;
      await r.setTokenRoyalty(1, dave.address, 10_000);

      await sell(ctx, diamond.target as string, 1);

      expect(await m.pendingWithdrawal(dave.address)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("credits both amounts to one account when seller and receiver are the same", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, royalty: r, alice, diamond } = ctx;
      await r.setDefaultRoyalty(alice.address, 500);

      await sell(ctx, diamond.target as string, 1);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("keeps the total exact for prices that do not divide evenly", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, alice, carol, diamond } = ctx;

      await sell(ctx, diamond.target as string, 1, 39n);

      expect(await m.pendingWithdrawal(carol.address)).to.equal(1);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(38);
    });

    it("pays royalties of an external ERC-2981 collection", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, alice, carol, dave, diamond } = ctx;
      const external = await (await ethers.getContractFactory("MockRoyaltyNFT")).deploy();
      await external.mint(alice.address, 1, dave.address, 250);
      await external.connect(alice).setApprovalForAll(diamond.target, true);

      await expect(sell(ctx, external.target as string, 1))
        .to.emit(m, "RoyaltyPaid")
        .withArgs(external.target, 1, dave.address, royaltyOf(PRICE, 250n));

      expect(await m.pendingWithdrawal(dave.address)).to.equal(royaltyOf(PRICE, 250n));
      // the diamond's own default (carol) does not apply to someone else's collection
      expect(await m.pendingWithdrawal(carol.address)).to.equal(0);
    });

    it("pays no royalty for a collection without ERC-2981", async () => {
      const ctx = await loadFixture(royalty);
      const { market: m, alice, carol, mockNft, diamond } = ctx;
      await mockNft.mint(alice.address, 7);
      await mockNft.connect(alice).setApprovalForAll(diamond.target, true);

      await expect(sell(ctx, mockNft.target as string, 7)).to.not.emit(m, "RoyaltyPaid");

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(carol.address)).to.equal(0);
    });
  });

  describe("hostile collections", () => {
    async function hostile() {
      const ctx = await royalty();
      const nft = await (await ethers.getContractFactory("MockHostileRoyaltyNFT")).deploy();
      await nft.mint(ctx.alice.address, 1);
      await nft.connect(ctx.alice).setApprovalForAll(ctx.diamond.target, true);
      const receiver = await nft.RECEIVER();
      return { ...ctx, hostile: nft, receiver };
    }

    async function saleWith(mode: number) {
      const ctx = await hostile();
      await ctx.hostile.setMode(mode);
      await sell(ctx, ctx.hostile.target as string, 1);
      return ctx;
    }

    // loadFixture needs a named function per scenario
    const sold = Object.fromEntries(
      Object.entries(Mode).map(([name, mode]) => [
        name,
        async function sold() {
          return saleWith(mode);
        },
      ]),
    ) as Record<keyof typeof Mode, () => ReturnType<typeof saleWith>>;

    it("pays the quoted royalty when the collection behaves", async () => {
      const { market: m, alice, receiver } = await loadFixture(sold.Normal);

      expect(await m.pendingWithdrawal(receiver)).to.equal(PRICE / 10n);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE - PRICE / 10n);
    });

    it("completes the sale when royaltyInfo reverts", async () => {
      const { market: m, alice, receiver } = await loadFixture(sold.RevertsOnRoyalty);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(receiver)).to.equal(0);
    });

    it("caps a royalty above the price at the price", async () => {
      const { market: m, alice, receiver } = await loadFixture(sold.AbovePrice);

      expect(await m.pendingWithdrawal(receiver)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(alice.address)).to.equal(0);
    });

    it("limits the gas of a collection that loops forever", async () => {
      const { market: m, alice } = await loadFixture(sold.BurnsGas);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("treats a reverting supportsInterface as no royalty", async () => {
      const { market: m, alice } = await loadFixture(sold.RevertsOnSupports);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("limits the gas of a supportsInterface that loops forever", async () => {
      const { market: m, alice } = await loadFixture(sold.BurnsGasOnSupports);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });

    it("respects a collection that says it does not support ERC-2981", async () => {
      const { market: m, alice, receiver } = await loadFixture(sold.SaysUnsupported);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
      expect(await m.pendingWithdrawal(receiver)).to.equal(0);
    });

    it("ignores a royalty for the zero address", async () => {
      const { market: m, alice } = await loadFixture(sold.ZeroReceiver);

      expect(await m.pendingWithdrawal(alice.address)).to.equal(PRICE);
    });
  });
});
