// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { LibERC1155 } from "../libraries/LibERC1155.sol";

/// @notice Sets the base URI and registers the ERC-1155 interfaces, delegatecalled together with
///         the diamondCut that adds `ERC1155Facet`.
contract ERC1155Init {
    bytes4 private constant ERC1155_ID = 0xd9b67a26;
    bytes4 private constant ERC1155_METADATA_URI_ID = 0x0e89341c;

    function init(string calldata baseURI) external {
        LibERC1155.layout().baseURI = baseURI;

        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[ERC1155_ID] = true;
        ds.supportedInterfaces[ERC1155_METADATA_URI_ID] = true;
    }
}
