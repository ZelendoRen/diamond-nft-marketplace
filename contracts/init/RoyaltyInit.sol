// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC2981 } from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";
import { LibRoyalty } from "../libraries/LibRoyalty.sol";

/// @notice Registers ERC-2981 and optionally sets the default royalty, delegatecalled
///         together with the diamondCut that adds `RoyaltyFacet`.
contract RoyaltyInit {
    function init(address receiver, uint96 feeBps) external {
        LibDiamond.diamondStorage().supportedInterfaces[type(IERC2981).interfaceId] = true;
        if (receiver != address(0)) {
            LibRoyalty.layout().defaultRoyalty = LibRoyalty.RoyaltyInfo(receiver, feeBps);
        }
    }
}
