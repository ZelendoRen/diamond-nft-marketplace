# Diamond NFT Marketplace

[![CI](https://github.com/ZelendoRen/diamond-nft-marketplace/actions/workflows/ci.yml/badge.svg)](https://github.com/ZelendoRen/diamond-nft-marketplace/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Demo project, not client code.

An NFT marketplace on the Diamond standard ([EIP-2535](https://eips.ethereum.org/EIPS/eip-2535)): ERC-721 and ERC-1155 collections, fixed-price sales, English auctions and ERC-2981 royalties behind **one contract address** that can be upgraded facet by facet without moving any state. Solidity 0.8.24, Hardhat, TypeScript.

Why a diamond: the logic is split into small facets, so one part (say the auction rules) can be replaced while NFTs, bids, listings and balances stay where they are, and no single contract has to fit the 24 KB size limit.

## Architecture

```
                      caller
                        |
                        v
              +-------------------+
              |      Diamond      |  one address, no logic of its own
              |  fallback(): selector -> facet -> delegatecall
              +---------+---------+
                        |
   +--------------------+---------------------------------------------+
   |  DiamondCut   DiamondLoupe   Ownership      (EIP-2535, EIP-173)  |
   |  ERC721       ERC1155        Royalty        (assets, ERC-2981)   |
   |  Marketplace  Auction                       (trading)            |
   +--------------------+---------------------------------------------+
                        | read and write
                        v
   +--------------------------------------------------------------+
   | diamond storage, one namespaced slot per facet (ERC-7201)    |
   | erc721 | erc1155 | royalty | marketplace | auction            |
   | payments (balances shared by sales and auctions)             |
   | reentrancy (one guard for the whole diamond)                 |
   +--------------------------------------------------------------+
```

| Facet               | What it does                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `DiamondCutFacet`   | `diamondCut`: add, replace or remove functions, optionally run an initializer. Owner only. |
| `DiamondLoupeFacet` | Introspection (`facets`, `facetAddress`, ...) and ERC-165 `supportsInterface`.             |
| `OwnershipFacet`    | ERC-173 owner and `transferOwnership`.                                                     |
| `ERC721Facet`       | ERC-721 with metadata, `mint` (owner), `burn`, base URI.                                   |
| `ERC1155Facet`      | ERC-1155 with metadata, batch mint, transfers and burns, per-token URIs.                   |
| `RoyaltyFacet`      | ERC-2981: a default royalty for the collection and overrides per token.                    |
| `MarketplaceFacet`  | `list`, `buy`, `cancel` for any ERC-721, and `withdraw` for all balances.                  |
| `AuctionFacet`      | `createAuction`, `bid`, `settle`, `cancelAuction` for any ERC-721.                         |

Shared code lives in `contracts/libraries` (`LibDiamond`, one storage library per facet, `LibSlots` with every slot in one file, `LibPayments`, `LibReentrancyGuard`, `LibSale`). The diamond core follows the [reference implementation](https://github.com/mudgen/diamond) of EIP-2535 by Nick Mudge.

## How it works

- **Fixed-price sale.** The seller approves the diamond and lists a token; the token stays in the seller's wallet. `buy` takes the exact price, closes the listing and moves the token.
- **Auction.** The token is held by the diamond while the auction runs. A bid has to beat the leader by 5%. The outbid bidder is credited their bid back. `settle` can be called by anyone after the end time.
- **Royalties.** On every sale the marketplace asks the collection for its ERC-2981 royalty (any collection, not only the diamond's own), pays it to the receiver and the rest to the seller. A collection that reverts, burns gas or claims more than the price can neither block a sale nor overcharge it.
- **Payments.** Nothing is pushed. Sale proceeds, royalties and refunds are credited to a balance and collected with `withdraw`, so a buyer, bidder or royalty receiver that is a contract cannot block anyone else.
- **ERC-721 and ERC-1155 together.** Both standards define `setApprovalForAll` and `isApprovedForAll` with the same signature, and a diamond can hold a selector only once. They are served by `ERC721Facet`, and `ERC1155Facet` uses the same operator approvals.

## Quick start

Needs Node.js 20 or newer.

```bash
npm ci && npm test
```

| Command                  | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `npm test`               | All tests.                                                               |
| `npm run coverage`       | Coverage report, then `npm run coverage:check` fails below 90%.          |
| `npm run gas`            | Gas report for one ordinary run of every function.                       |
| `npm run lint`           | solhint, eslint and prettier. `npm run typecheck` checks the TypeScript. |
| `npm run slither`        | Static analysis, needs `pip install slither-analyzer==0.11.6`.           |
| `npm run deploy:local`   | Deploys everything to the in-process network.                            |
| `npm run deploy:sepolia` | Deploys to Sepolia, see below.                                           |

## What is tested

- **363 tests** in 9 files: every facet, the core `diamondCut` rules, the sale and auction flows, the deploy and upgrade scripts.
- **Coverage** (mocks excluded): statements 99.7%, branches 95.5%, functions 100%, lines 100%. CI fails below 90%.
- **Reentrancy.** Attacker contracts try to re-enter `withdraw`, `buy`, `bid` and `settle` from payout callbacks, `onERC721Received` and a token's `transferFrom`; every attempt is rejected and the state stays consistent.
- **Upgrades.** Facets are replaced, removed and added back with NFTs, listings and a running auction in place, and the state survives. Failed upgrades roll back completely.
- **The tests themselves** were checked by breaking the contracts on purpose, about 90 one-line changes (a removed access check, a skipped balance update, a missing guard, a changed boundary). The suite caught each of them, and the cases that slipped through at first got new tests.

## Security

- [Slither](audits/slither-report.md): 25 results on the first run, 0 after the changes. Each one was fixed or explained in a line.
- [Manual review](audits/manual-review.md): reading the code found one real problem that neither Slither nor the tests had shown. A seller could auction a token from a collection that refuses to transfer it, and the winning bid would stay locked. Now the winner gets the bid back and the seller gets nothing.
- Checks, effects, then external calls; one reentrancy guard shared by all facets; pull payments. Calls to a collection the project does not control are either gas-limited and survivable (the royalty quote, the delivery of an auction token) or made after the state is updated, so they can only revert the caller's own transaction.

## Gas

Execution gas of the calls, measured by `npm run gas` (Hardhat, optimizer 200 runs, EVM cancun). It leaves out the 21,000 base cost and calldata. A range is shown where a function was called with different arguments (for example `settle` with and without a winner).

| Facet            | Function                | Gas (typical) | Range             |
| ---------------- | ----------------------- | ------------: | ----------------- |
| ERC721Facet      | `approve`               |        53,335 |                   |
| ERC721Facet      | `burn`                  |        42,410 |                   |
| ERC721Facet      | `mint`                  |       105,354 | 95,094 - 146,394  |
| ERC721Facet      | `safeTransferFrom`      |        45,667 |                   |
| ERC721Facet      | `setApprovalForAll`     |        51,108 |                   |
| ERC721Facet      | `setBaseURI`            |        34,676 |                   |
| ERC721Facet      | `transferFrom`          |        62,743 |                   |
| ERC1155Facet     | `burn`                  |        41,225 |                   |
| ERC1155Facet     | `burnBatch`             |        55,223 |                   |
| ERC1155Facet     | `mint`                  |        80,782 |                   |
| ERC1155Facet     | `mintBatch`             |       174,950 |                   |
| ERC1155Facet     | `safeBatchTransferFrom` |        93,673 |                   |
| ERC1155Facet     | `safeTransferFrom`      |        62,340 |                   |
| ERC1155Facet     | `setTokenURI`           |        54,069 |                   |
| MarketplaceFacet | `buy`                   |       175,255 |                   |
| MarketplaceFacet | `cancel`                |        37,497 |                   |
| MarketplaceFacet | `list`                  |       174,497 | 165,947 - 183,047 |
| MarketplaceFacet | `withdraw`              |        37,215 |                   |
| AuctionFacet     | `bid`                   |        73,287 | 66,573 - 80,001   |
| AuctionFacet     | `cancelAuction`         |        85,248 |                   |
| AuctionFacet     | `createAuction`         |       173,910 | 159,310 - 198,310 |
| AuctionFacet     | `settle`                |       110,695 | 63,439 - 157,950  |
| RoyaltyFacet     | `resetTokenRoyalty`     |        29,982 |                   |
| RoyaltyFacet     | `setDefaultRoyalty`     |        35,746 |                   |
| RoyaltyFacet     | `setTokenRoyalty`       |        55,762 |                   |
| OwnershipFacet   | `transferOwnership`     |        33,426 |                   |
| DiamondCutFacet  | `diamondCut`            |       512,051 | 303,239 - 662,424 |

Deployment:

| Contract          | Deployment gas |
| ----------------- | -------------: |
| ERC1155Facet      |      1,375,445 |
| ERC721Facet       |      1,329,965 |
| DiamondCutFacet   |      1,028,301 |
| AuctionFacet      |      1,021,105 |
| MarketplaceFacet  |        924,470 |
| Diamond           |        773,903 |
| RoyaltyFacet      |        404,388 |
| DiamondLoupeFacet |        397,947 |
| ERC721Init        |        247,534 |
| ERC1155Init       |        215,960 |
| OwnershipFacet    |        168,767 |
| RoyaltyInit       |        140,091 |
| DiamondInit       |        123,707 |

## Upgrading a facet

```bash
# preview what would change
FACET=ERC721Facet DRY_RUN=true npm run upgrade:sepolia
# deploy the new facet and replace the functions
FACET=ERC721Facet npm run upgrade:sepolia
```

The script deploys the facet, compares its functions with what the diamond serves and sends one `diamondCut`: functions the diamond already has are replaced, new ones are added and the functions of the old facet that the new one no longer has are removed (`REPLACES=none` skips the removal; `REPLACES` names a different old facet from the deployment record). The address of the new facet is recorded in `deployments/<network>.json`.

## Sepolia

Deployed from `0x05c76e4afe58dd8905C5d90ab38DdE89e30FD2f4` at block 11949551 (chain id 11155111). The deployer is also the owner of the diamond. The default royalty is 5% to the deployer. All 13 contracts are verified on Etherscan (solc 0.8.24, optimizer 200 runs), the links open the source code.

| Contract                   | Address                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Diamond (use this one)** | [0xE0085d0DcE07230Bf04575E9FB39912Ae4D6AF27](https://sepolia.etherscan.io/address/0xE0085d0DcE07230Bf04575E9FB39912Ae4D6AF27#code) |
| DiamondCutFacet            | [0x238aEFcA7E7027D75FC106db874Ff3762Fb2C79E](https://sepolia.etherscan.io/address/0x238aEFcA7E7027D75FC106db874Ff3762Fb2C79E#code) |
| DiamondLoupeFacet          | [0x1E70789c2B88E7A81e0942bCEC45dB8f85483f17](https://sepolia.etherscan.io/address/0x1E70789c2B88E7A81e0942bCEC45dB8f85483f17#code) |
| OwnershipFacet             | [0x7A744b45739ddee5a5250A934FEF38A3181A6b55](https://sepolia.etherscan.io/address/0x7A744b45739ddee5a5250A934FEF38A3181A6b55#code) |
| ERC721Facet                | [0x7651B191317b0cC80fc2940565Aa8Fef62E282F9](https://sepolia.etherscan.io/address/0x7651B191317b0cC80fc2940565Aa8Fef62E282F9#code) |
| RoyaltyFacet               | [0xf9ba4FE975761a5858a3F0cf689b341f5F11A59a](https://sepolia.etherscan.io/address/0xf9ba4FE975761a5858a3F0cf689b341f5F11A59a#code) |
| ERC1155Facet               | [0xD8449978881E21d1EC7351bAAa6D7f75725c4944](https://sepolia.etherscan.io/address/0xD8449978881E21d1EC7351bAAa6D7f75725c4944#code) |
| MarketplaceFacet           | [0xD32D97cdA5A65d0F6586775B91645f3B075A51BC](https://sepolia.etherscan.io/address/0xD32D97cdA5A65d0F6586775B91645f3B075A51BC#code) |
| AuctionFacet               | [0x6638E2c1D7152F6283240667edD55f0f9368b701](https://sepolia.etherscan.io/address/0x6638E2c1D7152F6283240667edD55f0f9368b701#code) |
| DiamondInit                | [0xbF13DB180249953A72B3e7b6d5138b736BF8A83C](https://sepolia.etherscan.io/address/0xbF13DB180249953A72B3e7b6d5138b736BF8A83C#code) |
| ERC721Init                 | [0x034C24e2d738Caa9e51C1aE0F2d5339b6c5E17F8](https://sepolia.etherscan.io/address/0x034C24e2d738Caa9e51C1aE0F2d5339b6c5E17F8#code) |
| RoyaltyInit                | [0xE7bd5939ea14994C7D4b0b08a382D4A410315969](https://sepolia.etherscan.io/address/0xE7bd5939ea14994C7D4b0b08a382D4A410315969#code) |
| ERC1155Init                | [0xC343cBE31E5643C32F1f3a0C7A890373B00c088B](https://sepolia.etherscan.io/address/0xC343cBE31E5643C32F1f3a0C7A890373B00c088B#code) |

To deploy again, copy `.env.example` to `.env`, fill in `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY` and `ETHERSCAN_API_KEY` (a throwaway testnet key), then run `npm run deploy:sepolia` and `npm run verify:sepolia`. The addresses and the constructor arguments are saved in [deployments/sepolia.json](deployments/sepolia.json).

## Limitations

- Sales and auctions work with ERC-721 only. ERC-1155 tokens are not tradable here, and `RoyaltyFacet` keeps royalties for the diamond's ERC-721 collection.
- Approval of an operator is shared by ERC-721 and ERC-1155.
- ETH only. No platform fee, and no extension of an auction when a bid arrives in its last minutes.
- Anyone can list or auction a token of any collection. A collection that lies about everything, including who owns a token, is simply a fake and nothing on-chain can tell it from a real one; bidders and buyers have to check what they buy.
- `MarketplaceFacet.withdraw` pays out the balances of both the marketplace and the auction. Removing that facet from a live diamond blocks withdrawals until it is added back.
- The owner can replace any facet, including the ones that hold funds. On a real deployment the owner should be a multisig with a timelock.
- ETH sent straight to the diamond is accepted, as in the EIP-2535 reference, and cannot be recovered.

## Credits

The diamond core is based on [mudgen/diamond](https://github.com/mudgen/diamond) by Nick Mudge. Interfaces and a few utilities come from [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts); the ERC-721 and ERC-1155 logic is written for diamond storage because the OpenZeppelin bases keep their state in ordinary slots.

## License

[MIT](LICENSE)
