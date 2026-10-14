import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployWithERC721, NAME, SYMBOL } from "./helpers/erc721";

const ZERO = ethers.ZeroAddress;
const safe = "safeTransferFrom(address,address,uint256)";
const safeWithData = "safeTransferFrom(address,address,uint256,bytes)";

async function fresh() {
  const ctx = await deployWithERC721();
  const [, alice, bob, carol] = await ethers.getSigners();
  return { ...ctx, alice, bob, carol };
}

// token 1 and 2 belong to alice, token 3 to bob
async function minted() {
  const ctx = await fresh();
  await ctx.nft.mint(ctx.alice.address, "ipfs://one");
  await ctx.nft.mint(ctx.alice.address, "ipfs://two");
  await ctx.nft.mint(ctx.bob.address, "ipfs://three");
  return ctx;
}

describe("ERC721Facet", () => {
  describe("metadata and interfaces", () => {
    it("returns the name and symbol set by the initializer", async () => {
      const { nft } = await loadFixture(fresh);

      expect(await nft.name()).to.equal(NAME);
      expect(await nft.symbol()).to.equal(SYMBOL);
    });

    it("registers ERC-721 and ERC-721 Metadata with ERC-165", async () => {
      const { loupe } = await loadFixture(fresh);

      expect(await loupe.supportsInterface("0x80ac58cd")).to.equal(true);
      expect(await loupe.supportsInterface("0x5b5e139f")).to.equal(true);
    });

    it("returns the stored URI when there is no base URI", async () => {
      const { nft } = await loadFixture(minted);

      expect(await nft.tokenURI(1)).to.equal("ipfs://one");
    });

    it("prefixes the base URI to the stored suffix", async () => {
      const { nft, owner } = await loadFixture(fresh);
      await nft.setBaseURI("https://api.example/");
      await nft.mint(owner.address, "meta/7.json");

      expect(await nft.tokenURI(1)).to.equal("https://api.example/meta/7.json");
    });

    it("falls back to the token id when a base URI is set and the suffix is empty", async () => {
      const { nft, owner } = await loadFixture(fresh);
      await nft.setBaseURI("https://api.example/");
      await nft.mint(owner.address, "");

      expect(await nft.tokenURI(1)).to.equal("https://api.example/1");
    });

    it("applies a new base URI to tokens minted earlier", async () => {
      const { nft } = await loadFixture(minted);

      await nft.setBaseURI("ar://");

      expect(await nft.tokenURI(2)).to.equal("ar://ipfs://two");
    });

    it("reverts tokenURI for a token that does not exist", async () => {
      const { nft } = await loadFixture(minted);

      await expect(nft.tokenURI(99))
        .to.be.revertedWithCustomError(nft, "ERC721NonexistentToken")
        .withArgs(99);
    });

    it("only lets the owner set the base URI", async () => {
      const { nft, alice } = await loadFixture(minted);

      await expect(nft.connect(alice).setBaseURI("x")).to.be.revertedWithCustomError(
        nft,
        "NotContractOwner",
      );
    });
  });

  describe("mint", () => {
    it("assigns sequential ids starting at 1", async () => {
      const { nft, alice } = await loadFixture(fresh);

      await nft.mint(alice.address, "a");
      await nft.mint(alice.address, "b");

      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.ownerOf(2)).to.equal(alice.address);
      expect(await nft.totalSupply()).to.equal(2);
    });

    it("returns the new token id", async () => {
      const { nft, alice } = await loadFixture(fresh);

      expect(await nft.mint.staticCall(alice.address, "a")).to.equal(1);
    });

    it("emits Transfer from the zero address", async () => {
      const { nft, alice } = await loadFixture(fresh);

      await expect(nft.mint(alice.address, "a"))
        .to.emit(nft, "Transfer")
        .withArgs(ZERO, alice.address, 1);
    });

    it("updates the balance", async () => {
      const { nft, alice } = await loadFixture(minted);

      expect(await nft.balanceOf(alice.address)).to.equal(2);
    });

    it("can only be called by the diamond owner", async () => {
      const { nft, alice } = await loadFixture(fresh);

      await expect(nft.connect(alice).mint(alice.address, "a")).to.be.revertedWithCustomError(
        nft,
        "NotContractOwner",
      );
    });

    it("rejects the zero address", async () => {
      const { nft } = await loadFixture(fresh);

      await expect(nft.mint(ZERO, "a")).to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
    });

    it("mints to a contract that implements the receiver interface", async () => {
      const { nft, owner } = await loadFixture(fresh);
      const receiver = await (await ethers.getContractFactory("MockReceiver")).deploy();

      await expect(nft.mint(receiver.target, "a"))
        .to.emit(receiver, "Received")
        .withArgs(owner.address, ZERO, 1, "0x");
    });

    it("rejects a contract that does not implement the receiver interface", async () => {
      const { nft } = await loadFixture(fresh);
      const receiver = await (await ethers.getContractFactory("MockNonReceiver")).deploy();

      await expect(nft.mint(receiver.target, "a"))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver")
        .withArgs(receiver.target);
      expect(await nft.totalSupply()).to.equal(0);
    });
  });

  describe("views", () => {
    it("rejects balanceOf the zero address", async () => {
      const { nft } = await loadFixture(minted);

      await expect(nft.balanceOf(ZERO)).to.be.revertedWithCustomError(nft, "ERC721InvalidOwner");
    });

    it("returns zero balance for an address with no tokens", async () => {
      const { nft, carol } = await loadFixture(minted);

      expect(await nft.balanceOf(carol.address)).to.equal(0);
    });

    it("rejects ownerOf for a token that does not exist", async () => {
      const { nft } = await loadFixture(minted);

      await expect(nft.ownerOf(0)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });

    it("rejects getApproved for a token that does not exist", async () => {
      const { nft } = await loadFixture(minted);

      await expect(nft.getApproved(99)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken",
      );
    });
  });

  describe("approve", () => {
    it("lets the owner approve an address", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await expect(nft.connect(alice).approve(bob.address, 1))
        .to.emit(nft, "Approval")
        .withArgs(alice.address, bob.address, 1);

      expect(await nft.getApproved(1)).to.equal(bob.address);
    });

    it("lets an operator approve on behalf of the owner", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(bob.address, true);

      await nft.connect(bob).approve(carol.address, 1);

      expect(await nft.getApproved(1)).to.equal(carol.address);
    });

    it("rejects an approval from someone who is neither owner nor operator", async () => {
      const { nft, bob, carol } = await loadFixture(minted);

      await expect(nft.connect(carol).approve(bob.address, 1))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidApprover")
        .withArgs(carol.address);
    });

    it("rejects approving a token that does not exist", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await expect(nft.connect(alice).approve(bob.address, 99)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken",
      );
    });

    it("clears the approval when the token moves", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).approve(carol.address, 1);

      await nft.connect(alice).transferFrom(alice.address, bob.address, 1);

      expect(await nft.getApproved(1)).to.equal(ZERO);
    });

    it("can be revoked by approving the zero address", async () => {
      const { nft, alice, bob } = await loadFixture(minted);
      await nft.connect(alice).approve(bob.address, 1);

      await nft.connect(alice).approve(ZERO, 1);

      expect(await nft.getApproved(1)).to.equal(ZERO);
    });
  });

  describe("setApprovalForAll", () => {
    it("sets and emits", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await expect(nft.connect(alice).setApprovalForAll(bob.address, true))
        .to.emit(nft, "ApprovalForAll")
        .withArgs(alice.address, bob.address, true);

      expect(await nft.isApprovedForAll(alice.address, bob.address)).to.equal(true);
    });

    it("can be switched off again", async () => {
      const { nft, alice, bob } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(bob.address, true);

      await nft.connect(alice).setApprovalForAll(bob.address, false);

      expect(await nft.isApprovedForAll(alice.address, bob.address)).to.equal(false);
    });

    it("rejects the zero address as operator", async () => {
      const { nft, alice } = await loadFixture(minted);

      await expect(nft.connect(alice).setApprovalForAll(ZERO, true)).to.be.revertedWithCustomError(
        nft,
        "ERC721InvalidOperator",
      );
    });
  });

  describe("transferFrom", () => {
    it("moves the token, updates balances and emits Transfer", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await expect(nft.connect(alice).transferFrom(alice.address, bob.address, 1))
        .to.emit(nft, "Transfer")
        .withArgs(alice.address, bob.address, 1);

      expect(await nft.ownerOf(1)).to.equal(bob.address);
      expect(await nft.balanceOf(alice.address)).to.equal(1);
      expect(await nft.balanceOf(bob.address)).to.equal(2);
    });

    it("works for an approved address", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).approve(carol.address, 1);

      await nft.connect(carol).transferFrom(alice.address, bob.address, 1);

      expect(await nft.ownerOf(1)).to.equal(bob.address);
    });

    it("works for an operator and leaves the other tokens alone", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(carol.address, true);

      await nft.connect(carol).transferFrom(alice.address, bob.address, 2);

      expect(await nft.ownerOf(2)).to.equal(bob.address);
      expect(await nft.ownerOf(1)).to.equal(alice.address);
    });

    it("rejects an unauthorised caller", async () => {
      const { nft, alice, carol } = await loadFixture(minted);

      await expect(nft.connect(carol).transferFrom(alice.address, carol.address, 1))
        .to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval")
        .withArgs(carol.address, 1);
    });

    it("rejects an approval that belonged to the previous owner", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).approve(carol.address, 1);
      await nft.connect(alice).transferFrom(alice.address, bob.address, 1);

      await expect(
        nft.connect(carol).transferFrom(bob.address, carol.address, 1),
      ).to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });

    it("rejects a wrong `from` address", async () => {
      const { nft, alice, bob, carol } = await loadFixture(minted);

      await expect(nft.connect(alice).transferFrom(bob.address, carol.address, 1))
        .to.be.revertedWithCustomError(nft, "ERC721IncorrectOwner")
        .withArgs(bob.address, 1, alice.address);
    });

    it("rejects the zero address as receiver", async () => {
      const { nft, alice } = await loadFixture(minted);

      await expect(
        nft.connect(alice).transferFrom(alice.address, ZERO, 1),
      ).to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
    });

    it("rejects a token that does not exist", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await expect(
        nft.connect(alice).transferFrom(alice.address, bob.address, 99),
      ).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });

    it("allows a transfer to oneself", async () => {
      const { nft, alice } = await loadFixture(minted);

      await nft.connect(alice).transferFrom(alice.address, alice.address, 1);

      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(2);
    });
  });

  describe("safeTransferFrom", () => {
    it("transfers to an externally owned account", async () => {
      const { nft, alice, bob } = await loadFixture(minted);

      await nft.connect(alice)[safe](alice.address, bob.address, 1);

      expect(await nft.ownerOf(1)).to.equal(bob.address);
    });

    it("calls onERC721Received on a contract with the operator, owner and empty data", async () => {
      const { nft, alice } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockReceiver")).deploy();

      await expect(nft.connect(alice)[safe](alice.address, receiver.target, 1))
        .to.emit(receiver, "Received")
        .withArgs(alice.address, alice.address, 1, "0x");

      expect(await nft.ownerOf(1)).to.equal(receiver.target);
    });

    it("forwards the data argument", async () => {
      const { nft, alice } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockReceiver")).deploy();

      await expect(nft.connect(alice)[safeWithData](alice.address, receiver.target, 1, "0xabcd"))
        .to.emit(receiver, "Received")
        .withArgs(alice.address, alice.address, 1, "0xabcd");
    });

    it("reports the operator, not the owner, when an approved address transfers", async () => {
      const { nft, alice, carol } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockReceiver")).deploy();
      await nft.connect(alice).approve(carol.address, 1);

      await expect(nft.connect(carol)[safe](alice.address, receiver.target, 1))
        .to.emit(receiver, "Received")
        .withArgs(carol.address, alice.address, 1, "0x");
    });

    it("rejects a contract that returns the wrong value and keeps the token", async () => {
      const { nft, alice } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockWrongValueReceiver")).deploy();

      await expect(nft.connect(alice)[safe](alice.address, receiver.target, 1))
        .to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver")
        .withArgs(receiver.target);
      expect(await nft.ownerOf(1)).to.equal(alice.address);
    });

    it("rejects a contract without a receiver function", async () => {
      const { nft, alice } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockNonReceiver")).deploy();

      await expect(
        nft.connect(alice)[safe](alice.address, receiver.target, 1),
      ).to.be.revertedWithCustomError(nft, "ERC721InvalidReceiver");
    });

    it("bubbles up the revert reason of the receiver", async () => {
      const { nft, alice } = await loadFixture(minted);
      const receiver = await (await ethers.getContractFactory("MockRevertingReceiver")).deploy();

      await expect(nft.connect(alice)[safe](alice.address, receiver.target, 1)).to.be.revertedWith(
        "receiver says no",
      );
    });

    it("still checks authorisation", async () => {
      const { nft, alice, carol } = await loadFixture(minted);

      await expect(
        nft.connect(carol)[safe](alice.address, carol.address, 1),
      ).to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });
  });

  describe("burn", () => {
    it("lets the owner burn and emits Transfer to the zero address", async () => {
      const { nft, alice } = await loadFixture(minted);

      await expect(nft.connect(alice).burn(1))
        .to.emit(nft, "Transfer")
        .withArgs(alice.address, ZERO, 1);

      await expect(nft.ownerOf(1)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
      expect(await nft.balanceOf(alice.address)).to.equal(1);
      expect(await nft.totalSupply()).to.equal(2);
    });

    it("lets an approved address burn", async () => {
      const { nft, alice, carol } = await loadFixture(minted);
      await nft.connect(alice).approve(carol.address, 1);

      await nft.connect(carol).burn(1);

      await expect(nft.ownerOf(1)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });

    it("rejects an unauthorised caller", async () => {
      const { nft, carol } = await loadFixture(minted);

      await expect(nft.connect(carol).burn(1)).to.be.revertedWithCustomError(
        nft,
        "ERC721InsufficientApproval",
      );
    });

    it("rejects a token that does not exist", async () => {
      const { nft, alice } = await loadFixture(minted);

      await expect(nft.connect(alice).burn(99)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken",
      );
    });

    it("rejects burning twice", async () => {
      const { nft, alice } = await loadFixture(minted);
      await nft.connect(alice).burn(1);

      await expect(nft.connect(alice).burn(1)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken",
      );
    });

    it("never reuses a burned id", async () => {
      const { nft, alice } = await loadFixture(minted);
      await nft.connect(alice).burn(1);

      await nft.mint(alice.address, "new");

      expect(await nft.ownerOf(4)).to.equal(alice.address);
      await expect(nft.ownerOf(1)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });

    it("makes tokenURI revert after the burn", async () => {
      const { nft, alice } = await loadFixture(minted);
      await nft.connect(alice).burn(1);

      await expect(nft.tokenURI(1)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    });
  });
});
