// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAuctionFacet {
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        uint256 startingPrice,
        uint64 endTime
    );
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 amount);
    event AuctionUnsold(uint256 indexed auctionId);
    event AuctionCancelled(uint256 indexed auctionId);

    error StartingPriceZero();
    error InvalidDuration(uint64 duration);
    error NotTokenOwner(address caller, address owner);
    error AuctionNotFound(uint256 auctionId);
    error AuctionClosed(uint256 auctionId);
    error AuctionNotEnded(uint256 auctionId);
    error AuctionAlreadyFinished(uint256 auctionId);
    error BidTooLow(uint256 minimum, uint256 sent);
    error SellerCannotBid();
    error NotAuctionSeller(address caller, address seller);
    error AuctionHasBids(uint256 auctionId);
}
