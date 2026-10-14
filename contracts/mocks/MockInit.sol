// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// the string and empty reverts are the point of these mocks
// solhint-disable gas-custom-errors, reason-string

import { MockStorage } from "./MockStorage.sol";

/// @dev Initializers used to test the delegatecall after a diamond cut.
contract MockInit {
    function initValue(uint256 newValue) external {
        MockStorage.layout().value = newValue;
    }

    function failWithReason() external pure {
        revert("init failed");
    }

    function failSilently() external pure {
        revert();
    }
}
