// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRoyaltyFacet } from "../interfaces/IRoyaltyFacet.sol";
import { LibRoyalty } from "../libraries/LibRoyalty.sol";
import { LibERC721 } from "../libraries/LibERC721.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

/// @notice ERC-2981 royalties for the diamond's own collection: one default for the whole
///         collection plus optional per-token overrides, set by the diamond owner.
contract RoyaltyFacet is IRoyaltyFacet {
    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) external view override returns (address receiver, uint256 royaltyAmount) {
        LibRoyalty.Layout storage s = LibRoyalty.layout();
        LibRoyalty.RoyaltyInfo memory info = s.tokenRoyalty[tokenId];
        if (info.receiver == address(0)) info = s.defaultRoyalty;
        if (info.receiver == address(0)) return (address(0), 0);
        return (info.receiver, (salePrice * info.feeBps) / LibRoyalty.FEE_DENOMINATOR);
    }

    function setDefaultRoyalty(address receiver, uint96 feeBps) external override {
        LibDiamond.enforceIsContractOwner();
        _validate(receiver, feeBps);
        LibRoyalty.layout().defaultRoyalty = LibRoyalty.RoyaltyInfo(receiver, feeBps);
        emit DefaultRoyaltySet(receiver, feeBps);
    }

    function deleteDefaultRoyalty() external override {
        LibDiamond.enforceIsContractOwner();
        delete LibRoyalty.layout().defaultRoyalty;
        emit DefaultRoyaltyDeleted();
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeBps) external override {
        LibDiamond.enforceIsContractOwner();
        LibERC721.ownerOf(tokenId); // reverts for a token that does not exist
        _validate(receiver, feeBps);
        LibRoyalty.layout().tokenRoyalty[tokenId] = LibRoyalty.RoyaltyInfo(receiver, feeBps);
        emit TokenRoyaltySet(tokenId, receiver, feeBps);
    }

    function resetTokenRoyalty(uint256 tokenId) external override {
        LibDiamond.enforceIsContractOwner();
        delete LibRoyalty.layout().tokenRoyalty[tokenId];
        emit TokenRoyaltyReset(tokenId);
    }

    function _validate(address receiver, uint96 feeBps) private pure {
        if (receiver == address(0)) revert InvalidRoyaltyReceiver();
        if (feeBps > LibRoyalty.FEE_DENOMINATOR) revert RoyaltyFeeTooHigh(feeBps);
    }
}
