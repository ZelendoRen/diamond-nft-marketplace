// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IMarketplaceFacet } from "../interfaces/IMarketplaceFacet.sol";
import { LibMarketplace } from "../libraries/LibMarketplace.sol";
import { LibPayments } from "../libraries/LibPayments.sol";
import { LibSale } from "../libraries/LibSale.sol";
import { NonReentrant } from "../utils/NonReentrant.sol";

/// @notice Fixed-price sales of any ERC-721, paid in ETH.
/// @dev Non-custodial: the seller keeps the token and approves the diamond. Proceeds are credited
///      to the seller and collected with `withdraw`, so `buy` never sends ETH to anyone.
contract MarketplaceFacet is IMarketplaceFacet, NonReentrant {
    function list(
        address nft,
        uint256 tokenId,
        uint256 price
    ) external returns (uint256 listingId) {
        if (price == 0) revert PriceZero();
        address owner = IERC721(nft).ownerOf(tokenId);
        if (owner != msg.sender) revert NotTokenOwner(msg.sender, owner);
        if (!_isApproved(nft, tokenId, owner)) revert MarketplaceNotApproved(nft, tokenId);

        LibMarketplace.Layout storage s = LibMarketplace.layout();
        uint256 existing = s.activeListing[nft][tokenId];
        if (existing != 0) {
            // a listing by the current owner blocks a new one, one by an earlier owner is stale
            if (s.listings[existing].seller == owner) revert AlreadyListed(existing);
            s.listings[existing].active = false;
            emit ListingCancelled(existing);
        }

        listingId = ++s.lastListingId;
        s.listings[listingId] = LibMarketplace.Listing({
            seller: owner,
            active: true,
            nft: nft,
            tokenId: tokenId,
            price: price
        });
        s.activeListing[nft][tokenId] = listingId;
        emit Listed(listingId, owner, nft, tokenId, price);
    }

    function cancel(uint256 listingId) external {
        LibMarketplace.Layout storage s = LibMarketplace.layout();
        LibMarketplace.Listing storage listing = s.listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);
        if (listing.seller != msg.sender) revert NotSeller(msg.sender, listing.seller);

        listing.active = false;
        delete s.activeListing[listing.nft][listing.tokenId];
        emit ListingCancelled(listingId);
    }

    function buy(uint256 listingId) external payable nonReentrant {
        LibMarketplace.Layout storage s = LibMarketplace.layout();
        LibMarketplace.Listing memory listing = s.listings[listingId];
        if (!listing.active) revert ListingNotActive(listingId);
        if (msg.value != listing.price) revert IncorrectPayment(listing.price, msg.value);
        if (msg.sender == listing.seller) revert CannotBuyOwnListing();

        // effects before the external call
        s.listings[listingId].active = false;
        delete s.activeListing[listing.nft][listing.tokenId];
        LibSale.settle(listing.seller, listing.nft, listing.tokenId, listing.price);

        IERC721(listing.nft).safeTransferFrom(listing.seller, msg.sender, listing.tokenId);
        emit Sale(
            listingId,
            msg.sender,
            listing.seller,
            listing.nft,
            listing.tokenId,
            listing.price
        );
    }

    /// @notice Pays out everything credited to the caller (sales, auction refunds).
    function withdraw() external nonReentrant {
        uint256 amount = LibPayments.take(msg.sender);
        if (amount == 0) revert NothingToWithdraw();
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{ value: amount }("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawal(msg.sender, amount);
    }

    function pendingWithdrawal(address account) external view returns (uint256) {
        return LibPayments.layout().pending[account];
    }

    function getListing(uint256 listingId) external view returns (LibMarketplace.Listing memory) {
        return LibMarketplace.layout().listings[listingId];
    }

    /// @notice The open listing of a token, 0 if there is none.
    function activeListingOf(address nft, uint256 tokenId) external view returns (uint256) {
        return LibMarketplace.layout().activeListing[nft][tokenId];
    }

    function _isApproved(address nft, uint256 tokenId, address owner) private view returns (bool) {
        return
            IERC721(nft).getApproved(tokenId) == address(this) ||
            IERC721(nft).isApprovedForAll(owner, address(this));
    }
}
