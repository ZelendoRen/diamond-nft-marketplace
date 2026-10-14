// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { LibERC721 } from "../libraries/LibERC721.sol";

/// @notice Sets the collection metadata and registers the ERC-721 interfaces, delegatecalled
///         together with the diamondCut that adds `ERC721Facet`.
contract ERC721Init {
    bytes4 private constant ERC721_ID = 0x80ac58cd;
    bytes4 private constant ERC721_METADATA_ID = 0x5b5e139f;

    function init(string calldata name, string calldata symbol, string calldata baseURI) external {
        LibERC721.Layout storage s = LibERC721.layout();
        s.name = name;
        s.symbol = symbol;
        s.baseURI = baseURI;

        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[ERC721_ID] = true;
        ds.supportedInterfaces[ERC721_METADATA_ID] = true;
    }
}
