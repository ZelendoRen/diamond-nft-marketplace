// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRoyaltyFacet {
    event DefaultRoyaltySet(address indexed receiver, uint96 feeBps);
    event DefaultRoyaltyDeleted();
    event TokenRoyaltySet(uint256 indexed tokenId, address indexed receiver, uint96 feeBps);
    event TokenRoyaltyReset(uint256 indexed tokenId);
    /// @dev Emitted by the marketplace and the auction when a royalty is credited.
    event RoyaltyPaid(
        address indexed nft,
        uint256 indexed tokenId,
        address indexed receiver,
        uint256 amount
    );

    error InvalidRoyaltyReceiver();
    error RoyaltyFeeTooHigh(uint96 feeBps);

    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) external view returns (address receiver, uint256 royaltyAmount);

    function setDefaultRoyalty(address receiver, uint96 feeBps) external;

    function deleteDefaultRoyalty() external;

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeBps) external;

    function resetTokenRoyalty(uint256 tokenId) external;
}
