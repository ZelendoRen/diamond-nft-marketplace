// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC1155Facet } from "../interfaces/IERC1155Facet.sol";
import { LibERC721 } from "./LibERC721.sol";
import { LibSlots } from "./LibSlots.sol";

/// @notice ERC-1155 storage and the logic behind `ERC1155Facet`.
library LibERC1155 {
    struct Layout {
        string baseURI;
        mapping(uint256 id => string) tokenURIs;
        mapping(uint256 id => mapping(address account => uint256)) balances;
        mapping(uint256 id => uint256) totalSupply;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.ERC1155;
        assembly {
            s.slot := slot
        }
    }

    /// @dev Operator approval is shared with ERC-721, see `IERC1155Facet`.
    function isApprovedForAll(address account, address operator) internal view returns (bool) {
        return LibERC721.layout().operatorApprovals[account][operator];
    }

    /// @dev `from == address(0)` mints, `to == address(0)` burns, anything else moves balances.
    function update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal {
        if (ids.length != values.length) {
            revert IERC1155Facet.ERC1155InvalidArrayLength(ids.length, values.length);
        }
        Layout storage s = layout();
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            uint256 value = values[i];
            if (from == address(0)) {
                s.totalSupply[id] += value;
            } else {
                uint256 balance = s.balances[id][from];
                if (balance < value) {
                    revert IERC1155Facet.ERC1155InsufficientBalance(from, balance, value, id);
                }
                unchecked {
                    s.balances[id][from] = balance - value;
                }
            }
            if (to == address(0)) {
                unchecked {
                    s.totalSupply[id] -= value;
                }
            } else {
                s.balances[id][to] += value;
            }
        }
    }

    /// @dev Calls the receiver hook when `to` is a contract.
    function checkOnReceived(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        bool single = ids.length == 1;
        bytes4 expected =
            single
                ? IERC1155Receiver.onERC1155Received.selector
                : IERC1155Receiver.onERC1155BatchReceived.selector;
        bytes4 answer =
            single
                ? _callSingle(operator, from, to, ids[0], values[0], data)
                : _callBatch(operator, from, to, ids, values, data);
        if (answer != expected) revert IERC1155Facet.ERC1155InvalidReceiver(to);
    }

    function _callSingle(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) private returns (bytes4) {
        try IERC1155Receiver(to).onERC1155Received(operator, from, id, value, data) returns (
            bytes4 answer
        ) {
            return answer;
        } catch (bytes memory reason) {
            _bubble(reason, to);
        }
    }

    function _callBatch(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) private returns (bytes4) {
        try IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, values, data) returns (
            bytes4 answer
        ) {
            return answer;
        } catch (bytes memory reason) {
            _bubble(reason, to);
        }
    }
    function _bubble(bytes memory reason, address receiver) private pure {
        if (reason.length == 0) revert IERC1155Facet.ERC1155InvalidReceiver(receiver);
        assembly {
            revert(add(reason, 32), mload(reason))
        }
    }
}
