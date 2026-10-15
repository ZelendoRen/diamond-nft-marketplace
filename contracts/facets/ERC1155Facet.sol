// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC1155Facet } from "../interfaces/IERC1155Facet.sol";
import { LibERC1155 } from "../libraries/LibERC1155.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

/// @notice Multi-token collection living in the diamond. Only the diamond owner can mint.
/// @dev Operator approvals are the ones of `ERC721Facet` (`setApprovalForAll`, `isApprovedForAll`).
contract ERC1155Facet is IERC1155Facet {
    function balanceOf(address account, uint256 id) external view override returns (uint256) {
        return LibERC1155.layout().balances[id][account];
    }

    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view override returns (uint256[] memory balances) {
        if (accounts.length != ids.length) {
            revert ERC1155InvalidArrayLength(ids.length, accounts.length);
        }
        LibERC1155.Layout storage s = LibERC1155.layout();
        balances = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            balances[i] = s.balances[ids[i]][accounts[i]];
        }
    }

    function totalSupply(uint256 id) external view returns (uint256) {
        return LibERC1155.layout().totalSupply[id];
    }

    function exists(uint256 id) external view returns (bool) {
        return LibERC1155.layout().totalSupply[id] > 0;
    }

    /// @notice The URI of a token type: its own URI if set, otherwise the shared base URI.
    function uri(uint256 id) external view override returns (string memory) {
        LibERC1155.Layout storage s = LibERC1155.layout();
        string memory tokenUri = s.tokenURIs[id];
        return bytes(tokenUri).length > 0 ? tokenUri : s.baseURI;
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external override {
        _authorize(from);
        _move(from, to, _single(id), _single(value), data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external override {
        _authorize(from);
        _move(from, to, ids, values, data);
    }

    /// @notice Mints `value` of token type `id` to `to`.
    function mint(address to, uint256 id, uint256 value, bytes calldata data) external {
        LibDiamond.enforceIsContractOwner();
        _mint(to, _single(id), _single(value), data);
    }

    function mintBatch(
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external {
        LibDiamond.enforceIsContractOwner();
        _mint(to, ids, values, data);
    }

    /// @notice Burns tokens of `from`. Callable by the holder or an approved operator.
    function burn(address from, uint256 id, uint256 value) external {
        _authorize(from);
        _burn(from, _single(id), _single(value));
    }

    function burnBatch(address from, uint256[] calldata ids, uint256[] calldata values) external {
        _authorize(from);
        _burn(from, ids, values);
    }

    function setURI(string calldata newBaseURI) external {
        LibDiamond.enforceIsContractOwner();
        LibERC1155.layout().baseURI = newBaseURI;
    }

    function setTokenURI(uint256 id, string calldata newUri) external {
        LibDiamond.enforceIsContractOwner();
        LibERC1155.layout().tokenURIs[id] = newUri;
        emit URI(newUri, id);
    }

    function _authorize(address from) private view {
        if (from != msg.sender && !LibERC1155.isApprovedForAll(from, msg.sender)) {
            revert ERC1155MissingApprovalForAll(msg.sender, from);
        }
    }

    function _move(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) private {
        if (to == address(0)) revert ERC1155InvalidReceiver(address(0));
        if (from == address(0)) revert ERC1155InvalidSender(address(0));
        LibERC1155.update(from, to, ids, values);
        _emitTransfer(from, to, ids, values);
        LibERC1155.checkOnReceived(msg.sender, from, to, ids, values, data);
    }

    function _mint(
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) private {
        if (to == address(0)) revert ERC1155InvalidReceiver(address(0));
        LibERC1155.update(address(0), to, ids, values);
        _emitTransfer(address(0), to, ids, values);
        LibERC1155.checkOnReceived(msg.sender, address(0), to, ids, values, data);
    }

    function _burn(address from, uint256[] memory ids, uint256[] memory values) private {
        if (from == address(0)) revert ERC1155InvalidSender(address(0));
        LibERC1155.update(from, address(0), ids, values);
        _emitTransfer(from, address(0), ids, values);
    }

    function _emitTransfer(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) private {
        if (ids.length == 1) {
            emit TransferSingle(msg.sender, from, to, ids[0], values[0]);
        } else {
            emit TransferBatch(msg.sender, from, to, ids, values);
        }
    }

    function _single(uint256 element) private pure returns (uint256[] memory array) {
        array = new uint256[](1);
        array[0] = element;
    }
}
