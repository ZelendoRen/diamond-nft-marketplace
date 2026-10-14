// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibReentrancyGuard } from "../libraries/LibReentrancyGuard.sol";

/// @notice `nonReentrant` modifier backed by the diamond-wide guard.
abstract contract NonReentrant {
    modifier nonReentrant() {
        LibReentrancyGuard.enter();
        _;
        LibReentrancyGuard.exit();
    }
}
