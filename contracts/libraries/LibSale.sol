// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRoyaltyFacet } from "../interfaces/IRoyaltyFacet.sol";
import { LibPayments } from "./LibPayments.sol";
import { LibRoyalty } from "./LibRoyalty.sol";

/// @notice Splits the price of a sale, shared by fixed-price sales and auctions.
library LibSale {
    /// @dev Credits the royalty to its receiver and the rest to the seller.
    function settle(address seller, address nft, uint256 tokenId, uint256 price) internal {
        (address receiver, uint256 royalty) = LibRoyalty.quote(nft, tokenId, price);
        if (royalty > 0) {
            LibPayments.credit(receiver, royalty);
            emit IRoyaltyFacet.RoyaltyPaid(nft, tokenId, receiver, royalty);
        }
        LibPayments.credit(seller, price - royalty);
    }
}
