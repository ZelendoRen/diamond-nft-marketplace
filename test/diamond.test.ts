import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployDiamond, FacetCutAction, getSelectors, selectorOf } from "./helpers/diamond";

const ERC165_ID = "0x01ffc9a7";

async function withMockFacet() {
  const base = await deployDiamond();
  const facetA = await (await ethers.getContractFactory("MockFacetA")).deploy();
  const facetB = await (await ethers.getContractFactory("MockFacetB")).deploy();
  const mockInit = await (await ethers.getContractFactory("MockInit")).deploy();

  await base.cut.diamondCut(
    [
      {
        facetAddress: facetA.target,
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(facetA),
      },
    ],
    ethers.ZeroAddress,
    "0x",
  );
  const mock = await ethers.getContractAt("MockFacetA", base.diamond.target);

  return { ...base, facetA, facetB, mockInit, mock };
}

describe("Diamond core", () => {
  describe("deployment", () => {
    it("installs the three standard facets", async () => {
      const { loupe, cutFacet, loupeFacet, ownershipFacet } = await loadFixture(deployDiamond);

      expect(await loupe.facetAddresses()).to.deep.equal([
        cutFacet.target,
        loupeFacet.target,
        ownershipFacet.target,
      ]);
    });

    it("sets the owner", async () => {
      const { ownership, owner } = await loadFixture(deployDiamond);

      expect(await ownership.owner()).to.equal(owner.address);
    });

    it("registers the ERC-165 interfaces through the initializer", async () => {
      const { loupe } = await loadFixture(deployDiamond);

      expect(await loupe.supportsInterface(ERC165_ID)).to.equal(true);
      expect(await loupe.supportsInterface("0x1f931c1c")).to.equal(true); // IDiamondCut
      expect(await loupe.supportsInterface("0x48e2b093")).to.equal(true); // IDiamondLoupe
      expect(await loupe.supportsInterface("0x7f5828d0")).to.equal(true); // IERC173
      expect(await loupe.supportsInterface("0xdeadbeef")).to.equal(false);
    });

    it("rejects a facet address that has no code", async () => {
      const { other } = await loadFixture(deployDiamond);
      const factory = await ethers.getContractFactory("Diamond");

      await expect(
        factory.deploy(
          [
            {
              facetAddress: other.address,
              action: FacetCutAction.Add,
              functionSelectors: ["0x11223344"],
            },
          ],
          { owner: other.address, init: ethers.ZeroAddress, initCalldata: "0x" },
        ),
      ).to.be.revertedWithCustomError(factory, "NoBytecodeAtAddress");
    });

    it("reverts on a selector that is not installed", async () => {
      const { diamond, owner } = await loadFixture(deployDiamond);

      await expect(owner.sendTransaction({ to: diamond.target, data: "0x12345678" }))
        .to.be.revertedWithCustomError(diamond, "FunctionNotFound")
        .withArgs("0x12345678");
    });

    it("accepts plain ether transfers", async () => {
      const { diamond, owner } = await loadFixture(deployDiamond);

      await owner.sendTransaction({ to: diamond.target, value: 1n });

      expect(await ethers.provider.getBalance(diamond.target)).to.equal(1n);
    });
  });

  describe("loupe", () => {
    it("lists every facet with its selectors", async () => {
      const { loupe, cutFacet, loupeFacet, ownershipFacet } = await loadFixture(deployDiamond);

      const facets = await loupe.facets();

      expect(facets.map((f) => f.facetAddress)).to.deep.equal([
        cutFacet.target,
        loupeFacet.target,
        ownershipFacet.target,
      ]);
      expect([...facets[0].functionSelectors]).to.deep.equal(getSelectors(cutFacet));
      expect([...facets[1].functionSelectors]).to.have.members(getSelectors(loupeFacet));
      expect([...facets[2].functionSelectors]).to.have.members(getSelectors(ownershipFacet));
    });

    it("returns the selectors of one facet", async () => {
      const { loupe, ownershipFacet } = await loadFixture(deployDiamond);

      const selectors = await loupe.facetFunctionSelectors(ownershipFacet.target);

      expect([...selectors]).to.have.members(getSelectors(ownershipFacet));
    });

    it("returns no selectors for an unknown facet", async () => {
      const { loupe, other } = await loadFixture(deployDiamond);

      expect(await loupe.facetFunctionSelectors(other.address)).to.deep.equal([]);
    });

    it("resolves a selector to its facet", async () => {
      const { loupe, ownership, ownershipFacet } = await loadFixture(deployDiamond);

      expect(await loupe.facetAddress(selectorOf(ownership, "owner"))).to.equal(
        ownershipFacet.target,
      );
    });

    it("returns the zero address for an unknown selector", async () => {
      const { loupe } = await loadFixture(deployDiamond);

      expect(await loupe.facetAddress("0x12345678")).to.equal(ethers.ZeroAddress);
    });
  });

  describe("diamondCut", () => {
    it("can only be called by the owner", async () => {
      const { cut, other, owner } = await loadFixture(deployDiamond);

      await expect(cut.connect(other).diamondCut([], ethers.ZeroAddress, "0x"))
        .to.be.revertedWithCustomError(cut, "NotContractOwner")
        .withArgs(other.address, owner.address);
    });

    describe("add", () => {
      it("makes the new functions callable", async () => {
        const { mock } = await loadFixture(withMockFacet);

        await mock.setValue(42);

        expect(await mock.value()).to.equal(42);
        expect(await mock.ping()).to.equal("A");
      });

      it("shows the new facet in the loupe", async () => {
        const { loupe, facetA } = await loadFixture(withMockFacet);

        expect(await loupe.facetAddresses()).to.include(facetA.target);
        expect([...(await loupe.facetFunctionSelectors(facetA.target))]).to.have.members(
          getSelectors(facetA),
        );
      });

      it("emits DiamondCut", async () => {
        const { cut, diamond } = await loadFixture(deployDiamond);
        const facetA = await (await ethers.getContractFactory("MockFacetA")).deploy();
        const selectors = getSelectors(facetA);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: facetA.target,
                action: FacetCutAction.Add,
                functionSelectors: selectors,
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        )
          .to.emit(diamond, "DiamondCut")
          .withArgs([[facetA.target, FacetCutAction.Add, selectors]], ethers.ZeroAddress, "0x");
      });

      it("rejects a selector that already exists", async () => {
        const { cut, facetA } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: facetA.target,
                action: FacetCutAction.Add,
                functionSelectors: [selectorOf(facetA, "value")],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "CannotAddFunctionThatAlreadyExists");
      });

      it("rejects an empty selector list", async () => {
        const { cut, facetB } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [{ facetAddress: facetB.target, action: FacetCutAction.Add, functionSelectors: [] }],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "NoSelectorsInFacet");
      });

      it("rejects the zero address", async () => {
        const { cut } = await loadFixture(deployDiamond);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: ethers.ZeroAddress,
                action: FacetCutAction.Add,
                functionSelectors: ["0x11223344"],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "CannotAddSelectorsToZeroAddress");
      });

      it("rejects an address without code", async () => {
        const { cut, other } = await loadFixture(deployDiamond);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: other.address,
                action: FacetCutAction.Add,
                functionSelectors: ["0x11223344"],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "NoBytecodeAtAddress");
      });
    });

    describe("replace", () => {
      async function replaceValue() {
        const ctx = await withMockFacet();
        await ctx.mock.setValue(7);
        await ctx.cut.diamondCut(
          [
            {
              facetAddress: ctx.facetB.target,
              action: FacetCutAction.Replace,
              functionSelectors: [selectorOf(ctx.facetB, "value")],
            },
          ],
          ethers.ZeroAddress,
          "0x",
        );
        return ctx;
      }

      it("routes the selector to the new facet", async () => {
        const { loupe, facetB, mock } = await loadFixture(replaceValue);

        expect(await loupe.facetAddress(selectorOf(mock, "value"))).to.equal(facetB.target);
        expect(await mock.value()).to.equal(1007);
      });

      it("keeps the state written through the old facet", async () => {
        const { mock } = await loadFixture(replaceValue);

        // facet B reads the same diamond storage, so the 7 is still there
        expect(await mock.value()).to.equal(1000n + 7n);
      });

      it("leaves the other selectors of the old facet in place", async () => {
        const { loupe, facetA, mock } = await loadFixture(replaceValue);

        expect(await mock.ping()).to.equal("A");
        expect([...(await loupe.facetFunctionSelectors(facetA.target))]).to.have.members([
          selectorOf(facetA, "setValue"),
          selectorOf(facetA, "ping"),
        ]);
      });

      it("rejects replacing a function with the same facet", async () => {
        const { cut, facetA } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: facetA.target,
                action: FacetCutAction.Replace,
                functionSelectors: [selectorOf(facetA, "value")],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "CannotReplaceWithSameFacet");
      });

      it("rejects replacing a function that does not exist", async () => {
        const { cut, facetB } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: facetB.target,
                action: FacetCutAction.Replace,
                functionSelectors: [selectorOf(facetB, "pong")],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "CannotReplaceFunctionThatDoesNotExist");
      });

      it("rejects the zero address", async () => {
        const { cut, facetA } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: ethers.ZeroAddress,
                action: FacetCutAction.Replace,
                functionSelectors: [selectorOf(facetA, "value")],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "CannotReplaceFunctionsFromZeroAddress");
      });

      it("rejects an empty selector list", async () => {
        const { cut, facetB } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [
              {
                facetAddress: facetB.target,
                action: FacetCutAction.Replace,
                functionSelectors: [],
              },
            ],
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "NoSelectorsInFacet");
      });
    });

    describe("remove", () => {
      const remove = (selectors: string[], facetAddress: string = ethers.ZeroAddress) => [
        { facetAddress, action: FacetCutAction.Remove, functionSelectors: selectors },
      ];

      it("makes the selector unreachable", async () => {
        const { cut, diamond, mock, facetA } = await loadFixture(withMockFacet);

        await cut.diamondCut(remove([selectorOf(facetA, "ping")]), ethers.ZeroAddress, "0x");

        await expect(mock.ping()).to.be.revertedWithCustomError(diamond, "FunctionNotFound");
        expect(await mock.value()).to.equal(0);
      });

      it("keeps the remaining selectors consistent when a middle one is removed", async () => {
        const { cut, loupe, mock, facetA } = await loadFixture(withMockFacet);

        // facet A is [setValue, value, ping]: removing the first moves the last into its slot
        await cut.diamondCut(remove([selectorOf(facetA, "setValue")]), ethers.ZeroAddress, "0x");

        expect([...(await loupe.facetFunctionSelectors(facetA.target))]).to.have.members([
          selectorOf(facetA, "value"),
          selectorOf(facetA, "ping"),
        ]);
        expect(await mock.ping()).to.equal("A");
        expect(await mock.value()).to.equal(0);
      });

      it("drops the facet address once its last selector is gone", async () => {
        const { cut, loupe, facetA } = await loadFixture(withMockFacet);

        await cut.diamondCut(remove(getSelectors(facetA)), ethers.ZeroAddress, "0x");

        expect(await loupe.facetAddresses()).to.not.include(facetA.target);
        expect(await loupe.facetFunctionSelectors(facetA.target)).to.deep.equal([]);
      });

      it("keeps the other facets when one in the middle is removed", async () => {
        const { cut, loupe, cutFacet, loupeFacet, ownershipFacet, facetA } =
          await loadFixture(withMockFacet);

        // installed order: cut, loupe, ownership, A; ownership leaves from the middle
        await cut.diamondCut(remove(getSelectors(ownershipFacet)), ethers.ZeroAddress, "0x");

        const remaining = await loupe.facetAddresses();
        expect([...remaining]).to.have.members([cutFacet.target, loupeFacet.target, facetA.target]);
        expect(await loupe.facetFunctionSelectors(facetA.target)).to.have.length(3);
      });

      it("handles removing two facets one after another", async () => {
        const { cut, loupe, cutFacet, loupeFacet, ownershipFacet, facetA } =
          await loadFixture(withMockFacet);

        // removing the ownership facet moves facet A into its slot; removing A next
        // only works if that move was recorded
        await cut.diamondCut(remove(getSelectors(ownershipFacet)), ethers.ZeroAddress, "0x");
        await cut.diamondCut(remove(getSelectors(facetA)), ethers.ZeroAddress, "0x");

        expect(await loupe.facetAddresses()).to.deep.equal([cutFacet.target, loupeFacet.target]);
      });
      it("rejects a non-zero facet address", async () => {
        const { cut, facetA } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            remove([selectorOf(facetA, "ping")], facetA.target as string),
            ethers.ZeroAddress,
            "0x",
          ),
        ).to.be.revertedWithCustomError(cut, "RemoveFacetAddressMustBeZero");
      });

      it("rejects a selector that does not exist", async () => {
        const { cut } = await loadFixture(deployDiamond);

        await expect(
          cut.diamondCut(remove(["0x12345678"]), ethers.ZeroAddress, "0x"),
        ).to.be.revertedWithCustomError(cut, "CannotRemoveFunctionThatDoesNotExist");
      });

      it("rejects an empty selector list", async () => {
        const { cut } = await loadFixture(deployDiamond);

        await expect(
          cut.diamondCut(remove([]), ethers.ZeroAddress, "0x"),
        ).to.be.revertedWithCustomError(cut, "NoSelectorsInFacet");
      });
    });

    describe("initializer", () => {
      it("runs in the context of the diamond", async () => {
        const { cut, mock, mockInit } = await loadFixture(withMockFacet);

        await cut.diamondCut(
          [],
          mockInit.target,
          mockInit.interface.encodeFunctionData("initValue", [99]),
        );

        expect(await mock.value()).to.equal(99);
      });

      it("forwards the revert reason", async () => {
        const { cut, mockInit } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [],
            mockInit.target,
            mockInit.interface.encodeFunctionData("failWithReason"),
          ),
        ).to.be.revertedWith("init failed");
      });

      it("reverts with InitializationFunctionReverted when there is no reason", async () => {
        const { cut, mockInit } = await loadFixture(withMockFacet);

        await expect(
          cut.diamondCut(
            [],
            mockInit.target,
            mockInit.interface.encodeFunctionData("failSilently"),
          ),
        ).to.be.revertedWithCustomError(cut, "InitializationFunctionReverted");
      });

      it("rejects an initializer without code", async () => {
        const { cut, other } = await loadFixture(withMockFacet);

        await expect(cut.diamondCut([], other.address, "0x12345678")).to.be.revertedWithCustomError(
          cut,
          "NoBytecodeAtAddress",
        );
      });
    });
  });

  describe("ownership", () => {
    it("lets the owner transfer ownership", async () => {
      const { ownership, owner, other } = await loadFixture(deployDiamond);

      await expect(ownership.transferOwnership(other.address))
        .to.emit(ownership, "OwnershipTransferred")
        .withArgs(owner.address, other.address);

      expect(await ownership.owner()).to.equal(other.address);
    });

    it("hands diamondCut rights to the new owner", async () => {
      const { ownership, cut, other } = await loadFixture(deployDiamond);
      await ownership.transferOwnership(other.address);

      await expect(cut.diamondCut([], ethers.ZeroAddress, "0x")).to.be.revertedWithCustomError(
        cut,
        "NotContractOwner",
      );
      await expect(cut.connect(other).diamondCut([], ethers.ZeroAddress, "0x")).to.not.be.reverted;
    });

    it("rejects a transfer from anyone else", async () => {
      const { ownership, other, owner } = await loadFixture(deployDiamond);

      await expect(ownership.connect(other).transferOwnership(other.address))
        .to.be.revertedWithCustomError(ownership, "NotContractOwner")
        .withArgs(other.address, owner.address);
    });
  });
});
