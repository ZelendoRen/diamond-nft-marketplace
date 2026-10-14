// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibSlots } from "./LibSlots.sol";

error ReentrantCall();

/// @notice One guard for the whole diamond, so a call from one facet into another is caught too.
library LibReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    struct Layout {
        uint256 status; // 0 counts as not entered
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.REENTRANCY;
        assembly {
            s.slot := slot
        }
    }

    function enter() internal {
        Layout storage s = layout();
        if (s.status == ENTERED) revert ReentrantCall();
        s.status = ENTERED;
    }

    function exit() internal {
        layout().status = NOT_ENTERED;
    }
}
