// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IERC721Facet } from "../interfaces/IERC721Facet.sol";
import { LibERC721 } from "../libraries/LibERC721.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

/// @notice ERC-721 collection living in the diamond. Minting is restricted to the diamond owner.
/// @dev Not `nonReentrant`: the marketplace and auction facets call it while holding the guard.
contract ERC721Facet is IERC721Facet {
    function balanceOf(address owner) external view override returns (uint256) {
        if (owner == address(0)) revert ERC721InvalidOwner(address(0));
        return LibERC721.layout().balances[owner];
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        return LibERC721.ownerOf(tokenId);
    }

    function getApproved(uint256 tokenId) external view override returns (address) {
        LibERC721.requireExists(tokenId);
        return LibERC721.layout().tokenApprovals[tokenId];
    }

    function isApprovedForAll(
        address owner,
        address operator
    ) external view override returns (bool) {
        return LibERC721.layout().operatorApprovals[owner][operator];
    }

    function totalSupply() external view returns (uint256) {
        return LibERC721.layout().totalSupply;
    }

    function name() external view override returns (string memory) {
        return LibERC721.layout().name;
    }

    function symbol() external view override returns (string memory) {
        return LibERC721.layout().symbol;
    }

    function tokenURI(uint256 tokenId) external view override returns (string memory) {
        LibERC721.requireExists(tokenId);
        LibERC721.Layout storage s = LibERC721.layout();
        string memory uri = s.tokenURIs[tokenId];
        if (bytes(s.baseURI).length == 0) return uri;
        // with a base URI the stored value is a suffix, empty means the token id
        return string.concat(s.baseURI, bytes(uri).length > 0 ? uri : Strings.toString(tokenId));
    }

    function approve(address to, uint256 tokenId) external override {
        address owner = LibERC721.ownerOf(tokenId);
        if (msg.sender != owner && !LibERC721.layout().operatorApprovals[owner][msg.sender]) {
            revert ERC721InvalidApprover(msg.sender);
        }
        LibERC721.layout().tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external override {
        if (operator == address(0)) revert ERC721InvalidOperator(address(0));
        LibERC721.layout().operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        if (to == address(0)) revert ERC721InvalidReceiver(address(0));
        address previousOwner = LibERC721.update(to, tokenId, msg.sender);
        if (previousOwner != from) revert ERC721IncorrectOwner(from, tokenId, previousOwner);
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external override {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public override {
        transferFrom(from, to, tokenId);
        LibERC721.checkOnReceived(from, to, tokenId, data);
    }

    /// @notice Mints to `to`. `uri` is the full token URI, or a suffix when a base URI is set.
    function mint(address to, string calldata uri) external returns (uint256 tokenId) {
        LibDiamond.enforceIsContractOwner();
        tokenId = LibERC721.mint(to, uri);
        emit Transfer(address(0), to, tokenId);
        LibERC721.checkOnReceived(address(0), to, tokenId, "");
    }

    /// @notice Burns a token. Callable by its owner or an approved operator.
    function burn(uint256 tokenId) external {
        address owner = LibERC721.burn(tokenId, msg.sender);
        emit Transfer(owner, address(0), tokenId);
    }

    function setBaseURI(string calldata newBaseURI) external {
        LibDiamond.enforceIsContractOwner();
        LibERC721.layout().baseURI = newBaseURI;
    }
}
