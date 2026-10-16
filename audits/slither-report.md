# Slither report

Tool: [Slither](https://github.com/crytic/slither) 0.11.6, run with `slither .` (config in [slither.config.json](../slither.config.json): `node_modules` and `contracts/mocks` are skipped, the `assembly` detector is switched off, see the last row).

|                                                              | Results |
| ------------------------------------------------------------ | ------- |
| First run (commit 37c2590, 102 detectors)                    | 25      |
| After the changes below (101 detectors, `assembly` excluded) | 0       |

The raw output of the first run is in [slither-initial-output.txt](slither-initial-output.txt). Line numbers there refer to that commit. All 319 tests pass before and after. CI runs Slither on every push and fails on any new result.

## Findings

| Detector                    | Severity      | Where                                                                             | Verdict                                                                                                                                                                 |
| --------------------------- | ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| arbitrary-send-eth          | High          | `MarketplaceFacet.withdraw`                                                       | False positive. It sends ETH only to `msg.sender`, only the balance credited to them, which is zeroed first, and the function is `nonReentrant`. Annotated in the code. |
| locked-ether                | Medium        | `AuctionFacet`                                                                    | False positive. `bid` is payable, but the ETH lives in the diamond and is paid out by `MarketplaceFacet.withdraw`, which all facets share. Annotated.                   |
| uninitialized-local         | Medium        | `LibERC1155.checkOnReceived`                                                      | Fixed. The receiver call was split into two helpers, so no local is left unassigned.                                                                                    |
| unused-return (3)           | Medium        | `ERC721Facet.getApproved`, `ERC721Facet.tokenURI`, `RoyaltyFacet.setTokenRoyalty` | Fixed. `ownerOf` was called only to make it revert for a missing token. There is now `LibERC721.requireExists`, which returns nothing.                                  |
| timestamp (2)               | Low           | `AuctionFacet.bid`, `AuctionFacet.settle`                                         | Accepted. Auction end is compared with `block.timestamp`; auctions last at least one hour, so the few seconds a block producer can move it do not matter. Annotated.    |
| low-level-calls (2)         | Informational | `LibDiamond.initializeDiamondCut`, `MarketplaceFacet.withdraw`                    | By design: the initializer is a `delegatecall` and the payout is a plain `call` whose result is checked. Annotated.                                                     |
| unindexed-event-address (2) | Informational | `DiamondCut` in `IDiamond` and `LibDiamond`                                       | The event is defined by EIP-2535 without indexed fields. Annotated. The copy in `LibDiamond` was later removed, the library emits the interface event.                  |
| assembly (13)               | Informational | storage slot access in every `Lib*`, `Diamond.fallback`, revert forwarding        | Detector excluded. A diamond cannot work without a `delegatecall` fallback and namespaced storage slots, and every one of these places is exercised by the tests.       |

## Reproduce

```bash
pip install slither-analyzer==0.11.6
npm ci
slither .
```
