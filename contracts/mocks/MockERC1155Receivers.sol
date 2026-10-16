// SPDX-License-Identifier: MIT
// solhint-disable gas-custom-errors, reason-string, one-contract-per-file
pragma solidity ^0.8.24;

/// @dev Accepts tokens and records what it was called with.
contract MockERC1155Receiver {
    event Received(address operator, address from, uint256 id, uint256 value, bytes data);
    event BatchReceived(
        address operator,
        address from,
        uint256[] ids,
        uint256[] values,
        bytes data
    );

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4) {
        emit Received(operator, from, id, value, data);
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4) {
        emit BatchReceived(operator, from, ids, values, data);
        return this.onERC1155BatchReceived.selector;
    }
}

/// @dev Returns the wrong magic value from both hooks.
contract MockERC1155WrongValueReceiver {
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return 0xdeadbeef;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

/// @dev Reverts with a reason from both hooks.
contract MockERC1155RevertingReceiver {
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("receiver says no");
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("receiver says no");
    }
}
