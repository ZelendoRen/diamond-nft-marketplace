// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockStorage } from "./MockStorage.sol";

/// @dev Test facet. `MockFacetB` shares `value()` to exercise replacement.
contract MockFacetA {
    function setValue(uint256 newValue) external {
        MockStorage.layout().value = newValue;
    }

    function value() external view returns (uint256) {
        return MockStorage.layout().value;
    }

    function ping() external pure returns (string memory) {
        return "A";
    }
}
