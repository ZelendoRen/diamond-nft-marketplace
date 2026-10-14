// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MockStorage {
    bytes32 internal constant POSITION = keccak256("mock.facet.storage");

    struct Layout {
        uint256 value;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 position = POSITION;
        assembly {
            s.slot := position
        }
    }
}
