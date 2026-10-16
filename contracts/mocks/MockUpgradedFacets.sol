// SPDX-License-Identifier: MIT
// solhint-disable one-contract-per-file
pragma solidity ^0.8.24;

import { IAuctionFacet } from "../interfaces/IAuctionFacet.sol";
import { LibAuction } from "../libraries/LibAuction.sol";
import { LibERC721 } from "../libraries/LibERC721.sol";
import { LibPayments } from "../libraries/LibPayments.sol";
import { NonReentrant } from "../utils/NonReentrant.sol";

/// @dev A new version of `ERC721Facet.tokenURI` plus a new function, on the same storage.
contract MockERC721FacetV2 {
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        LibERC721.ownerOf(tokenId);
        return string.concat(LibERC721.layout().tokenURIs[tokenId], "?v=2");
    }

    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @dev A new `AuctionFacet.bid` that asks for a 10% increment, on the same storage, plus a
///      new view. Auctions that are already running continue under the new rule.
contract MockAuctionFacetV2 is IAuctionFacet, NonReentrant {
    uint256 internal constant INCREMENT_BPS = 1000;

    function bid(uint256 auctionId) external payable nonReentrant {
        LibAuction.Auction storage auction = LibAuction.layout().auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        if (auction.finished || block.timestamp >= auction.endTime) revert AuctionClosed(auctionId);
        if (msg.sender == auction.seller) revert SellerCannotBid();

        uint256 minimum =
            auction.highestBidder == address(0)
                ? auction.startingPrice
                : auction.highestBid + (auction.highestBid * INCREMENT_BPS) / 10_000;
        if (msg.value < minimum) revert BidTooLow(minimum, msg.value);

        if (auction.highestBidder != address(0)) {
            LibPayments.credit(auction.highestBidder, auction.highestBid);
        }
        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;
        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    function auctionCount() external view returns (uint256) {
        return LibAuction.layout().lastAuctionId;
    }
}
