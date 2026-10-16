import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BASE_URI, deployWithERC1155 } from "./helpers/erc1155";

const ZERO = ethers.ZeroAddress;
const NO_DATA = "0x";

// alice holds 10 of token 1, 20 of token 2 and 30 of token 3
async function minted() {
  const ctx = await deployWithERC1155();
  await ctx.multi.mintBatch(ctx.alice.address, [1, 2, 3], [10, 20, 30], NO_DATA);
  return ctx;
}

async function deploy(name: string) {
  return (await ethers.getContractFactory(name)).deploy();
}

describe("ERC1155Facet", () => {
  describe("metadata and interfaces", () => {
    it("registers ERC-1155 and its metadata extension with ERC-165", async () => {
      const { loupe } = await loadFixture(deployWithERC1155);

      expect(await loupe.supportsInterface("0xd9b67a26")).to.equal(true);
      expect(await loupe.supportsInterface("0x0e89341c")).to.equal(true);
    });

    it("leaves the ERC-721 interfaces registered", async () => {
      const { loupe } = await loadFixture(deployWithERC1155);

      expect(await loupe.supportsInterface("0x80ac58cd")).to.equal(true);
    });

    it("returns the base URI for tokens without their own", async () => {
      const { multi } = await loadFixture(deployWithERC1155);

      expect(await multi.uri(7)).to.equal(BASE_URI);
    });

    it("returns a token's own URI once set and emits URI", async () => {
      const { multi } = await loadFixture(deployWithERC1155);

      await expect(multi.setTokenURI(7, "ipfs://seven"))
        .to.emit(multi, "URI")
        .withArgs("ipfs://seven", 7);

      expect(await multi.uri(7)).to.equal("ipfs://seven");
      expect(await multi.uri(8)).to.equal(BASE_URI);
    });

    it("lets the owner change the base URI", async () => {
      const { multi } = await loadFixture(deployWithERC1155);

      await multi.setURI("ar://{id}");

      expect(await multi.uri(1)).to.equal("ar://{id}");
    });

    it("only lets the owner set URIs", async () => {
      const { multi, alice } = await loadFixture(deployWithERC1155);

      await expect(multi.connect(alice).setURI("x")).to.be.revertedWithCustomError(
        multi,
        "NotContractOwner",
      );
      await expect(multi.connect(alice).setTokenURI(1, "x")).to.be.revertedWithCustomError(
        multi,
        "NotContractOwner",
      );
    });

    it("keeps the ERC-721 collection working next to it", async () => {
      const { nft, owner } = await loadFixture(deployWithERC1155);

      await nft.mint(owner.address, "one");

      expect(await nft.ownerOf(1)).to.equal(owner.address);
      expect(await nft.name()).to.equal("Diamonds");
    });
  });

  describe("mint", () => {
    it("credits the balance and the supply", async () => {
      const { multi, alice } = await loadFixture(minted);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(10);
      expect(await multi.totalSupply(1)).to.equal(10);
      expect(await multi.exists(1)).to.equal(true);
    });

    it("emits TransferSingle from the zero address", async () => {
      const { multi, alice, owner } = await loadFixture(deployWithERC1155);

      await expect(multi.mint(alice.address, 5, 3, NO_DATA))
        .to.emit(multi, "TransferSingle")
        .withArgs(owner.address, ZERO, alice.address, 5, 3);
    });

    it("adds to an existing balance", async () => {
      const { multi, alice } = await loadFixture(minted);

      await multi.mint(alice.address, 1, 5, NO_DATA);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(15);
      expect(await multi.totalSupply(1)).to.equal(15);
    });

    it("reports a token type that was never minted as nonexistent", async () => {
      const { multi, alice } = await loadFixture(minted);

      expect(await multi.exists(99)).to.equal(false);
      expect(await multi.totalSupply(99)).to.equal(0);
      expect(await multi.balanceOf(alice.address, 99)).to.equal(0);
    });

    it("can only be called by the diamond owner", async () => {
      const { multi, alice } = await loadFixture(deployWithERC1155);

      await expect(
        multi.connect(alice).mint(alice.address, 1, 1, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "NotContractOwner");
    });

    it("rejects the zero address", async () => {
      const { multi } = await loadFixture(deployWithERC1155);

      await expect(multi.mint(ZERO, 1, 1, NO_DATA)).to.be.revertedWithCustomError(
        multi,
        "ERC1155InvalidReceiver",
      );
    });

    it("passes the data to a receiving contract", async () => {
      const { multi, owner } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockERC1155Receiver");

      await expect(multi.mint(receiver.target, 1, 4, "0xabcd"))
        .to.emit(receiver, "Received")
        .withArgs(owner.address, ZERO, 1, 4, "0xabcd");
    });

    it("rejects a contract that returns the wrong value", async () => {
      const { multi } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockERC1155WrongValueReceiver");

      await expect(multi.mint(receiver.target, 1, 1, NO_DATA))
        .to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver")
        .withArgs(receiver.target);
    });

    it("rejects a contract without a receiver function", async () => {
      const { multi } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockNonReceiver");

      await expect(multi.mint(receiver.target, 1, 1, NO_DATA)).to.be.revertedWithCustomError(
        multi,
        "ERC1155InvalidReceiver",
      );
      expect(await multi.totalSupply(1)).to.equal(0);
    });

    it("bubbles up the revert reason of the receiver", async () => {
      const { multi } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockERC1155RevertingReceiver");

      await expect(multi.mint(receiver.target, 1, 1, NO_DATA)).to.be.revertedWith(
        "receiver says no",
      );
    });
  });

  describe("mintBatch", () => {
    it("credits every token type", async () => {
      const { multi, alice } = await loadFixture(minted);

      expect(await multi.balanceOfBatch([alice.address, alice.address], [2, 3])).to.deep.equal([
        20n,
        30n,
      ]);
      expect(await multi.totalSupply(3)).to.equal(30);
    });

    it("emits TransferBatch", async () => {
      const { multi, alice, owner } = await loadFixture(deployWithERC1155);

      await expect(multi.mintBatch(alice.address, [1, 2], [3, 4], NO_DATA))
        .to.emit(multi, "TransferBatch")
        .withArgs(owner.address, ZERO, alice.address, [1, 2], [3, 4]);
    });

    it("adds up a token type that appears twice", async () => {
      const { multi, alice } = await loadFixture(deployWithERC1155);

      await multi.mintBatch(alice.address, [1, 1], [3, 4], NO_DATA);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(7);
      expect(await multi.totalSupply(1)).to.equal(7);
    });

    it("rejects arrays of different length", async () => {
      const { multi, alice } = await loadFixture(deployWithERC1155);

      await expect(multi.mintBatch(alice.address, [1, 2], [3], NO_DATA))
        .to.be.revertedWithCustomError(multi, "ERC1155InvalidArrayLength")
        .withArgs(2, 1);
    });

    it("can only be called by the diamond owner", async () => {
      const { multi, alice } = await loadFixture(deployWithERC1155);

      await expect(
        multi.connect(alice).mintBatch(alice.address, [1], [1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "NotContractOwner");
    });

    it("rejects the zero address", async () => {
      const { multi } = await loadFixture(deployWithERC1155);

      await expect(multi.mintBatch(ZERO, [1], [1], NO_DATA)).to.be.revertedWithCustomError(
        multi,
        "ERC1155InvalidReceiver",
      );
    });

    it("calls the batch hook of a receiving contract", async () => {
      const { multi, owner } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockERC1155Receiver");

      await expect(multi.mintBatch(receiver.target, [1, 2], [3, 4], "0x01"))
        .to.emit(receiver, "BatchReceived")
        .withArgs(owner.address, ZERO, [1, 2], [3, 4], "0x01");
    });

    it("rejects a contract that returns the wrong value or has no hook", async () => {
      const { multi } = await loadFixture(deployWithERC1155);
      const wrong = await deploy("MockERC1155WrongValueReceiver");
      const none = await deploy("MockNonReceiver");

      await expect(
        multi.mintBatch(wrong.target, [1, 2], [1, 1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
      await expect(
        multi.mintBatch(none.target, [1, 2], [1, 1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
    });

    it("bubbles up the revert reason of the batch hook", async () => {
      const { multi } = await loadFixture(deployWithERC1155);
      const receiver = await deploy("MockERC1155RevertingReceiver");

      await expect(multi.mintBatch(receiver.target, [1, 2], [1, 1], NO_DATA)).to.be.revertedWith(
        "receiver says no",
      );
    });
  });

  describe("balanceOfBatch", () => {
    it("returns the balances in order", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      expect(
        await multi.balanceOfBatch([alice.address, bob.address, alice.address], [3, 3, 1]),
      ).to.deep.equal([30n, 0n, 10n]);
    });

    it("returns an empty list for empty input", async () => {
      const { multi } = await loadFixture(minted);

      expect(await multi.balanceOfBatch([], [])).to.deep.equal([]);
    });

    it("rejects arrays of different length", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(multi.balanceOfBatch([alice.address], [1, 2])).to.be.revertedWithCustomError(
        multi,
        "ERC1155InvalidArrayLength",
      );
    });
  });

  describe("safeTransferFrom", () => {
    it("moves the balance and keeps the supply", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 4, NO_DATA);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(6);
      expect(await multi.balanceOf(bob.address, 1)).to.equal(4);
      expect(await multi.totalSupply(1)).to.equal(10);
    });

    it("emits TransferSingle", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 4, NO_DATA))
        .to.emit(multi, "TransferSingle")
        .withArgs(alice.address, alice.address, bob.address, 1, 4);
    });

    it("can move the whole balance", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 10, NO_DATA);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(0);
    });

    it("allows a zero-value transfer", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 0, NO_DATA),
      ).to.emit(multi, "TransferSingle");
    });

    it("allows a transfer to oneself", async () => {
      const { multi, alice } = await loadFixture(minted);

      await multi.connect(alice).safeTransferFrom(alice.address, alice.address, 1, 3, NO_DATA);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(10);
    });

    it("rejects more than the balance", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 11, NO_DATA),
      )
        .to.be.revertedWithCustomError(multi, "ERC1155InsufficientBalance")
        .withArgs(alice.address, 10, 11, 1);
    });

    it("rejects the zero address as receiver", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, ZERO, 1, 1, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
    });

    it("rejects a caller who is neither the holder nor an operator", async () => {
      const { multi, alice, bob, carol } = await loadFixture(minted);

      await expect(multi.connect(carol).safeTransferFrom(alice.address, bob.address, 1, 1, NO_DATA))
        .to.be.revertedWithCustomError(multi, "ERC1155MissingApprovalForAll")
        .withArgs(carol.address, alice.address);
    });

    it("works for an operator approved through the ERC-721 facet", async () => {
      const { multi, nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(carol.address, true);

      await expect(multi.connect(carol).safeTransferFrom(alice.address, bob.address, 2, 5, NO_DATA))
        .to.emit(multi, "TransferSingle")
        .withArgs(carol.address, alice.address, bob.address, 2, 5);
    });

    it("stops working once the operator is revoked", async () => {
      const { multi, nft, alice, bob, carol } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(carol.address, true);
      await nft.connect(alice).setApprovalForAll(carol.address, false);

      await expect(
        multi.connect(carol).safeTransferFrom(alice.address, bob.address, 2, 5, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155MissingApprovalForAll");
    });

    it("does not let an operator of one holder move another holder's tokens", async () => {
      const { multi, nft, alice, bob, carol } = await loadFixture(minted);
      await multi.mint(bob.address, 1, 5, NO_DATA);
      await nft.connect(alice).setApprovalForAll(carol.address, true);

      await expect(
        multi.connect(carol).safeTransferFrom(bob.address, carol.address, 1, 5, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155MissingApprovalForAll");
    });

    it("calls the hook of a receiving contract with operator, sender and data", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155Receiver");

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, receiver.target, 1, 4, "0xbeef"),
      )
        .to.emit(receiver, "Received")
        .withArgs(alice.address, alice.address, 1, 4, "0xbeef");
    });

    it("reports the operator, not the holder, when an operator transfers", async () => {
      const { multi, nft, alice, carol } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155Receiver");
      await nft.connect(alice).setApprovalForAll(carol.address, true);

      await expect(
        multi.connect(carol).safeTransferFrom(alice.address, receiver.target, 1, 4, NO_DATA),
      )
        .to.emit(receiver, "Received")
        .withArgs(carol.address, alice.address, 1, 4, NO_DATA);
    });

    it("rejects a contract that returns the wrong value and keeps the balance", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155WrongValueReceiver");

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, receiver.target, 1, 4, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
      expect(await multi.balanceOf(alice.address, 1)).to.equal(10);
    });

    it("rejects a contract without a receiver function", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockNonReceiver");

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, receiver.target, 1, 4, NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
    });

    it("bubbles up the revert reason of the receiver", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155RevertingReceiver");

      await expect(
        multi.connect(alice).safeTransferFrom(alice.address, receiver.target, 1, 4, NO_DATA),
      ).to.be.revertedWith("receiver says no");
    });
  });

  describe("safeBatchTransferFrom", () => {
    it("moves several token types at once", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await multi
        .connect(alice)
        .safeBatchTransferFrom(alice.address, bob.address, [1, 3], [10, 5], NO_DATA);

      expect(await multi.balanceOfBatch([alice.address, bob.address], [1, 1])).to.deep.equal([
        0n,
        10n,
      ]);
      expect(await multi.balanceOfBatch([alice.address, bob.address], [3, 3])).to.deep.equal([
        25n,
        5n,
      ]);
    });

    it("emits TransferBatch", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, bob.address, [1, 2], [1, 2], NO_DATA),
      )
        .to.emit(multi, "TransferBatch")
        .withArgs(alice.address, alice.address, bob.address, [1, 2], [1, 2]);
    });

    it("emits TransferSingle for a batch of one", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi.connect(alice).safeBatchTransferFrom(alice.address, bob.address, [1], [1], NO_DATA),
      ).to.emit(multi, "TransferSingle");
    });

    it("is all or nothing when one entry exceeds the balance", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, bob.address, [1, 2], [5, 21], NO_DATA),
      )
        .to.be.revertedWithCustomError(multi, "ERC1155InsufficientBalance")
        .withArgs(alice.address, 20, 21, 2);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(10);
      expect(await multi.balanceOf(bob.address, 1)).to.equal(0);
    });

    it("checks the sum when a token type appears twice", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, bob.address, [1, 1], [6, 6], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InsufficientBalance");
    });

    it("rejects arrays of different length", async () => {
      const { multi, alice, bob } = await loadFixture(minted);

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, bob.address, [1, 2], [1], NO_DATA),
      )
        .to.be.revertedWithCustomError(multi, "ERC1155InvalidArrayLength")
        .withArgs(2, 1);
    });

    it("rejects the zero address as receiver", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(
        multi.connect(alice).safeBatchTransferFrom(alice.address, ZERO, [1], [1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
    });

    it("rejects an unauthorised caller and accepts an operator", async () => {
      const { multi, nft, alice, bob, carol } = await loadFixture(minted);

      await expect(
        multi.connect(carol).safeBatchTransferFrom(alice.address, bob.address, [1], [1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155MissingApprovalForAll");

      await nft.connect(alice).setApprovalForAll(carol.address, true);
      await multi
        .connect(carol)
        .safeBatchTransferFrom(alice.address, bob.address, [1, 2], [1, 1], NO_DATA);

      expect(await multi.balanceOf(bob.address, 2)).to.equal(1);
    });

    it("calls the batch hook of a receiving contract", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155Receiver");

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, receiver.target, [1, 2], [3, 4], "0x01"),
      )
        .to.emit(receiver, "BatchReceived")
        .withArgs(alice.address, alice.address, [1, 2], [3, 4], "0x01");
    });

    it("rejects a contract that returns the wrong value or has no hook", async () => {
      const { multi, alice } = await loadFixture(minted);
      const wrong = await deploy("MockERC1155WrongValueReceiver");
      const none = await deploy("MockNonReceiver");

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, wrong.target, [1, 2], [1, 1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, none.target, [1, 2], [1, 1], NO_DATA),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidReceiver");
    });

    it("bubbles up the revert reason of the batch hook", async () => {
      const { multi, alice } = await loadFixture(minted);
      const receiver = await deploy("MockERC1155RevertingReceiver");

      await expect(
        multi
          .connect(alice)
          .safeBatchTransferFrom(alice.address, receiver.target, [1, 2], [1, 1], NO_DATA),
      ).to.be.revertedWith("receiver says no");
    });
  });

  describe("burn", () => {
    it("lets the holder burn and lowers the supply", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(multi.connect(alice).burn(alice.address, 1, 6))
        .to.emit(multi, "TransferSingle")
        .withArgs(alice.address, alice.address, ZERO, 1, 6);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(4);
      expect(await multi.totalSupply(1)).to.equal(4);
    });

    it("turns a fully burned token type back into a nonexistent one", async () => {
      const { multi, alice } = await loadFixture(minted);

      await multi.connect(alice).burn(alice.address, 1, 10);

      expect(await multi.exists(1)).to.equal(false);
    });

    it("lets an operator burn on behalf of the holder", async () => {
      const { multi, nft, alice, carol } = await loadFixture(minted);
      await nft.connect(alice).setApprovalForAll(carol.address, true);

      await multi.connect(carol).burn(alice.address, 1, 2);

      expect(await multi.balanceOf(alice.address, 1)).to.equal(8);
    });

    it("rejects an unauthorised caller", async () => {
      const { multi, alice, carol } = await loadFixture(minted);

      await expect(multi.connect(carol).burn(alice.address, 1, 1)).to.be.revertedWithCustomError(
        multi,
        "ERC1155MissingApprovalForAll",
      );
    });

    it("rejects more than the balance", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(multi.connect(alice).burn(alice.address, 1, 11))
        .to.be.revertedWithCustomError(multi, "ERC1155InsufficientBalance")
        .withArgs(alice.address, 10, 11, 1);
    });

    it("burns several token types at once", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(multi.connect(alice).burnBatch(alice.address, [1, 2], [10, 5]))
        .to.emit(multi, "TransferBatch")
        .withArgs(alice.address, alice.address, ZERO, [1, 2], [10, 5]);

      expect(await multi.totalSupply(1)).to.equal(0);
      expect(await multi.totalSupply(2)).to.equal(15);
    });

    it("rejects a batch with arrays of different length", async () => {
      const { multi, alice } = await loadFixture(minted);

      await expect(
        multi.connect(alice).burnBatch(alice.address, [1, 2], [1]),
      ).to.be.revertedWithCustomError(multi, "ERC1155InvalidArrayLength");
    });

    it("rejects an unauthorised batch burn", async () => {
      const { multi, alice, carol } = await loadFixture(minted);

      await expect(
        multi.connect(carol).burnBatch(alice.address, [1], [1]),
      ).to.be.revertedWithCustomError(multi, "ERC1155MissingApprovalForAll");
    });
  });
});
