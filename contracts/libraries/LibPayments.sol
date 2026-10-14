// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibSlots } from "./LibSlots.sol";

/// @notice Pull-payment balances shared by the marketplace and the auction.
///         Sales and refunds are credited here and paid out by `withdraw`.
library LibPayments {
    struct Layout {
        mapping(address account => uint256) pending;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.PAYMENTS;
        assembly {
            s.slot := slot
        }
    }

    function credit(address account, uint256 amount) internal {
        layout().pending[account] += amount;
    }

    /// @dev Zeroes the balance and returns what it was.
    function take(address account) internal returns (uint256 amount) {
        Layout storage s = layout();
        amount = s.pending[account];
        s.pending[account] = 0;
    }
}
