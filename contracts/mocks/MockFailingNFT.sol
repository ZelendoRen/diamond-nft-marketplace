// SPDX-License-Identifier: MIT
// solhint-disable gas-custom-errors, reason-string
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev A collection that can stop moving tokens after an auction has started, the way a
///      fake or malicious collection would.
contract MockFailingNFT is ERC721 {
    enum Mode {
        Works,
        Reverts,
        BurnsGas,
        PretendsToTransfer, // returns without moving anything
        BurnsGasOnOwnerOf // moves the token, then loops forever when asked who owns it
    }

    Mode public mode;

    constructor() ERC721("Failing NFT", "FNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function ownerOf(uint256 tokenId) public view override returns (address) {
        if (mode == Mode.BurnsGasOnOwnerOf) {
            while (true) {}
        }
        return super.ownerOf(tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        if (mode == Mode.Reverts) revert("transfers are blocked");
        if (mode == Mode.BurnsGas) {
            while (true) {}
        }
        if (mode == Mode.PretendsToTransfer) return;
        super.transferFrom(from, to, tokenId);
    }
}
