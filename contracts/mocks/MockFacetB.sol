// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockStorage } from "./MockStorage.sol";

/// @dev Replacement for `MockFacetA.value`, reads the same storage and adds 1000.
contract MockFacetB {
    function value() external view returns (uint256) {
        return MockStorage.layout().value + 1000;
    }

    function pong() external pure returns (string memory) {
        return "B";
    }
}
