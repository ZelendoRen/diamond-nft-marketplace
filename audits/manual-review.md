# Manual review

Notes from reading the whole contract code before publishing, in addition to [Slither](slither-report.md) and the tests.

## Fixed

**A token that cannot be delivered locked the winning bid** (`AuctionFacet.settle`).
Auctions accept any ERC-721. A seller could use a collection whose `transferFrom` reverts or does not move the token. Bidders could still bid, but `settle` reverted every time, the auction could not be cancelled once it had a bid, so the highest bid was stuck in the diamond.
Now `settle` hands the token over with a gas limit and checks with `ownerOf` that it arrived. If it did not, the seller and the royalty receiver get nothing, the winner's bid is credited back for `withdraw` and `AuctionDeliveryFailed` is emitted. Tests: `a token that cannot be delivered` in `test/auction.test.ts` (reverting, gas-burning, pretending and lying-about-the-owner collections).

## Accepted, documented in the README

- A collection that lies everywhere (transfers nothing and reports the winner as owner) is simply a fake token. Nothing on-chain can tell it from a real one; bidders have to check the collection.
- `MarketplaceFacet.withdraw` pays out balances of both the marketplace and the auction. Removing that facet from a live diamond would block withdrawals until it is added back.
- ETH sent directly to the diamond is accepted (`receive`, as in the EIP-2535 reference) and cannot be recovered. Balances credited through sales and refunds are tracked separately and are not affected.
- The diamond owner can replace any facet, including the ones that hold funds. That is the point of the pattern; use a multisig as the owner on a real deployment.
- There is no anti-sniping extension of auctions and no platform fee.
