// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IDiamond } from "./IDiamond.sol";

interface IDiamondCut is IDiamond {
    /// @notice Add, replace or remove facet functions, then optionally run `init`
    function diamondCut(
        FacetCut[] calldata cuts,
        address init,
        bytes calldata initCalldata
    ) external;
}
