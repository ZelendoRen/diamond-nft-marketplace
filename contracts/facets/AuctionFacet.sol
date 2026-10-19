// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IAuctionFacet } from "../interfaces/IAuctionFacet.sol";
import { LibAuction } from "../libraries/LibAuction.sol";
import { LibPayments } from "../libraries/LibPayments.sol";
import { LibSale } from "../libraries/LibSale.sol";
import { NonReentrant } from "../utils/NonReentrant.sol";

// ETH from bids stays in the diamond and is paid out by `MarketplaceFacet.withdraw`
// slither-disable-start locked-ether
/// @notice English auctions for any ERC-721, paid in ETH.
/// @dev The diamond holds the token while the auction runs. An outbid bid is credited back and
///      collected with `MarketplaceFacet.withdraw`, so `bid` never sends ETH. Tokens leave with
///      `transferFrom` (no receiver callback), so a contract winner cannot block `settle`. If the
///      token cannot be delivered to the winner, the winner gets the bid back.
contract AuctionFacet is IAuctionFacet, NonReentrant {
    // gas given to the collection to hand the token to the winner
    uint256 private constant DELIVERY_GAS = 500_000;

    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 startingPrice,
        uint64 duration
    ) external nonReentrant returns (uint256 auctionId) {
        if (startingPrice == 0) revert StartingPriceZero();
        if (duration < LibAuction.MIN_DURATION || duration > LibAuction.MAX_DURATION) {
            revert InvalidDuration(duration);
        }
        address owner = IERC721(nft).ownerOf(tokenId);
        if (owner != msg.sender) revert NotTokenOwner(msg.sender, owner);

        LibAuction.Layout storage s = LibAuction.layout();
        auctionId = ++s.lastAuctionId;
        uint64 endTime = uint64(block.timestamp) + duration;
        s.auctions[auctionId] = LibAuction.Auction({
            seller: msg.sender,
            endTime: endTime,
            finished: false,
            nft: nft,
            tokenId: tokenId,
            startingPrice: startingPrice,
            highestBidder: address(0),
            highestBid: 0
        });
        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, startingPrice, endTime);

        // the seller has to approve the diamond first
        IERC721(nft).transferFrom(msg.sender, address(this), tokenId);
    }

    function bid(uint256 auctionId) external payable nonReentrant {
        LibAuction.Auction storage auction = _auction(auctionId);
        // auctions last at least an hour, so a few seconds of miner drift do not matter
        // slither-disable-next-line timestamp
        if (auction.finished || block.timestamp >= auction.endTime) revert AuctionClosed(auctionId);
        if (msg.sender == auction.seller) revert SellerCannotBid();
        uint256 minimum = LibAuction.minimumBid(auction);
        if (msg.value < minimum) revert BidTooLow(minimum, msg.value);

        // the previous leader gets their bid back as a withdrawable balance
        if (auction.highestBidder != address(0)) {
            LibPayments.credit(auction.highestBidder, auction.highestBid);
        }
        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;
        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    /// @notice Ends an auction after its time is up. Anyone can call it.
    function settle(uint256 auctionId) external nonReentrant {
        LibAuction.Auction storage auction = _auction(auctionId);
        if (auction.finished) revert AuctionAlreadyFinished(auctionId);
        // slither-disable-next-line timestamp
        if (block.timestamp < auction.endTime) revert AuctionNotEnded(auctionId);
        auction.finished = true;

        if (auction.highestBidder == address(0)) {
            IERC721(auction.nft).transferFrom(address(this), auction.seller, auction.tokenId);
            emit AuctionUnsold(auctionId);
        } else {
            // The seller is paid only if the token really reaches the winner. A collection that
            // refuses the transfer, or does not move the token, must not lock the winning bid, so
            // the bid is refunded instead.
            if (_deliver(auction.nft, auction.highestBidder, auction.tokenId)) {
                LibSale.settle(auction.seller, auction.nft, auction.tokenId, auction.highestBid);
                emit AuctionSettled(auctionId, auction.highestBidder, auction.highestBid);
            } else {
                LibPayments.credit(auction.highestBidder, auction.highestBid);
                emit AuctionDeliveryFailed(auctionId, auction.highestBidder, auction.highestBid);
            }
        }
    }
    /// @notice Cancels an auction that has no bids and returns the token to the seller.
    function cancelAuction(uint256 auctionId) external nonReentrant {
        LibAuction.Auction storage auction = _auction(auctionId);
        if (auction.finished) revert AuctionAlreadyFinished(auctionId);
        if (auction.seller != msg.sender) revert NotAuctionSeller(msg.sender, auction.seller);
        if (auction.highestBidder != address(0)) revert AuctionHasBids(auctionId);
        auction.finished = true;

        IERC721(auction.nft).transferFrom(address(this), auction.seller, auction.tokenId);
        emit AuctionCancelled(auctionId);
    }

    function getAuction(uint256 auctionId) external view returns (LibAuction.Auction memory) {
        return LibAuction.layout().auctions[auctionId];
    }

    /// @notice Lowest amount the next bid may have.
    function minimumBid(uint256 auctionId) external view returns (uint256) {
        return LibAuction.minimumBid(_auction(auctionId));
    }

    /// @dev Hands the token to `to` and checks that it arrived. Never reverts.
    function _deliver(address nft, address to, uint256 tokenId) private returns (bool) {
        try IERC721(nft).transferFrom{ gas: DELIVERY_GAS }(address(this), to, tokenId) {
            try IERC721(nft).ownerOf{ gas: DELIVERY_GAS }(tokenId) returns (address owner) {
                return owner == to;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
    function _auction(uint256 auctionId) private view returns (LibAuction.Auction storage auction) {
        auction = LibAuction.layout().auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
    }
}
// slither-disable-end locked-ether
