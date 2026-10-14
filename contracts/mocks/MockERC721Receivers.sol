// SPDX-License-Identifier: MIT
// solhint-disable gas-custom-errors, reason-string, one-contract-per-file, gas-indexed-events
pragma solidity ^0.8.24;

/// @dev Accepts tokens and records what it was called with.
contract MockReceiver {
    event Received(address operator, address from, uint256 tokenId, bytes data);

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
        emit Received(operator, from, tokenId, data);
        return this.onERC721Received.selector;
    }
}

/// @dev Returns the wrong magic value.
contract MockWrongValueReceiver {
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

/// @dev Reverts with a reason.
contract MockRevertingReceiver {
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("receiver says no");
    }
}

/// @dev Has no `onERC721Received` at all.
contract MockNonReceiver {}
