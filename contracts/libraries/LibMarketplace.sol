// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibSlots } from "./LibSlots.sol";

library LibMarketplace {
    struct Listing {
        address seller;
        bool active; // packs into the seller slot
        address nft;
        uint256 tokenId;
        uint256 price;
    }

    struct Layout {
        uint256 lastListingId;
        mapping(uint256 listingId => Listing) listings;
        // the listing currently open for a token, 0 if none
        mapping(address nft => mapping(uint256 tokenId => uint256 listingId)) activeListing;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.MARKETPLACE;
        assembly {
            s.slot := slot
        }
    }
}
