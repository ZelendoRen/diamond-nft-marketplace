// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibSlots } from "./LibSlots.sol";

library LibAuction {
    uint64 internal constant MIN_DURATION = 1 hours;
    uint64 internal constant MAX_DURATION = 30 days;
    // a new bid has to beat the highest one by at least this much
    uint256 internal constant MIN_INCREMENT_BPS = 500;

    struct Auction {
        address seller;
        uint64 endTime;
        bool finished; // settled or cancelled
        address nft;
        uint256 tokenId;
        uint256 startingPrice;
        address highestBidder;
        uint256 highestBid;
    }

    struct Layout {
        uint256 lastAuctionId;
        mapping(uint256 auctionId => Auction) auctions;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.AUCTION;
        assembly {
            s.slot := slot
        }
    }

    /// @dev Lowest amount the next bid may have.
    function minimumBid(Auction storage auction) internal view returns (uint256) {
        if (auction.highestBidder == address(0)) return auction.startingPrice;
        uint256 highest = auction.highestBid;
        // rounded up, so the new bid is always strictly higher
        return highest + (highest * MIN_INCREMENT_BPS + 9_999) / 10_000;
    }
}
