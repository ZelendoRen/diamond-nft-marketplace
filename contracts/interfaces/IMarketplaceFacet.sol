// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceFacet {
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        uint256 price
    );
    event ListingCancelled(uint256 indexed listingId);
    event Sale(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        address nft,
        uint256 tokenId,
        uint256 price
    );
    // solhint-disable-next-line gas-indexed-events
    event Withdrawal(address indexed account, uint256 amount);

    error PriceZero();
    error NotTokenOwner(address caller, address owner);
    error MarketplaceNotApproved(address nft, uint256 tokenId);
    error AlreadyListed(uint256 listingId);
    error ListingNotActive(uint256 listingId);
    error NotSeller(address caller, address seller);
    error CannotBuyOwnListing();
    error IncorrectPayment(uint256 expected, uint256 sent);
    error NothingToWithdraw();
    error WithdrawFailed();
}
