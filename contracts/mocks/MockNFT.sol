// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev A plain ERC-721 outside the diamond, to show the marketplace works with any collection.
contract MockNFT is ERC721 {
    constructor() ERC721("Mock NFT", "MCK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
