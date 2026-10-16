// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC721Facet } from "../interfaces/IERC721Facet.sol";
import { LibSlots } from "./LibSlots.sol";

/// @notice ERC-721 storage and the logic behind `ERC721Facet`.
library LibERC721 {
    struct Layout {
        string name;
        string symbol;
        string baseURI;
        uint256 lastTokenId;
        uint256 totalSupply;
        mapping(uint256 tokenId => address) owners;
        mapping(address owner => uint256) balances;
        mapping(uint256 tokenId => address) tokenApprovals;
        mapping(address owner => mapping(address operator => bool)) operatorApprovals;
        mapping(uint256 tokenId => string) tokenURIs;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.ERC721;
        assembly {
            s.slot := slot
        }
    }

    function ownerOf(uint256 tokenId) internal view returns (address owner) {
        owner = layout().owners[tokenId];
        if (owner == address(0)) revert IERC721Facet.ERC721NonexistentToken(tokenId);
    }

    /// @dev Reverts unless the token exists.
    function requireExists(uint256 tokenId) internal view {
        if (layout().owners[tokenId] == address(0)) {
            revert IERC721Facet.ERC721NonexistentToken(tokenId);
        }
    }

    function isApprovedOrOwner(
        address owner,
        address spender,
        uint256 tokenId
    ) internal view returns (bool) {
        if (spender == address(0)) return false;
        Layout storage s = layout();
        return
            spender == owner ||
            s.operatorApprovals[owner][spender] ||
            s.tokenApprovals[tokenId] == spender;
    }

    /// @dev Reverts unless `spender` owns the token or is approved for it.
    function checkAuthorized(address owner, address spender, uint256 tokenId) internal view {
        if (!isApprovedOrOwner(owner, spender, tokenId)) {
            if (owner == address(0)) revert IERC721Facet.ERC721NonexistentToken(tokenId);
            revert IERC721Facet.ERC721InsufficientApproval(spender, tokenId);
        }
    }

    /// @dev Moves the token to `to` (address(0) burns it) and returns the previous owner.
    ///      `auth` is checked against the owner unless it is address(0).
    function update(address to, uint256 tokenId, address auth) internal returns (address from) {
        Layout storage s = layout();
        from = s.owners[tokenId];
        if (auth != address(0)) checkAuthorized(from, auth, tokenId);
        if (from != address(0)) {
            delete s.tokenApprovals[tokenId];
            unchecked {
                s.balances[from] -= 1;
            }
        }
        if (to != address(0)) {
            unchecked {
                s.balances[to] += 1;
            }
        }
        s.owners[tokenId] = to;
    }

    function mint(address to, string memory uri) internal returns (uint256 tokenId) {
        if (to == address(0)) revert IERC721Facet.ERC721InvalidReceiver(address(0));
        Layout storage s = layout();
        tokenId = ++s.lastTokenId;
        update(to, tokenId, address(0));
        s.totalSupply += 1;
        s.tokenURIs[tokenId] = uri;
    }

    function burn(uint256 tokenId, address auth) internal returns (address from) {
        Layout storage s = layout();
        from = update(address(0), tokenId, auth);
        if (from == address(0)) revert IERC721Facet.ERC721NonexistentToken(tokenId);
        s.totalSupply -= 1;
        delete s.tokenURIs[tokenId];
    }

    /// @dev Calls `onERC721Received` when `to` is a contract.
    function checkOnReceived(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (
            bytes4 retval
        ) {
            if (retval != IERC721Receiver.onERC721Received.selector) {
                revert IERC721Facet.ERC721InvalidReceiver(to);
            }
        } catch (bytes memory reason) {
            if (reason.length == 0) revert IERC721Facet.ERC721InvalidReceiver(to);
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
    }
}
