// SPDX-License-Identifier: MIT
// solhint-disable one-contract-per-file, gas-custom-errors, reason-string
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721Royalty } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";

/// @dev An external collection with its own ERC-2981 royalties.
contract MockRoyaltyNFT is ERC721Royalty {
    constructor() ERC721("Royalty NFT", "RNFT") {}

    function mint(address to, uint256 tokenId, address receiver, uint96 feeBps) external {
        _mint(to, tokenId);
        _setTokenRoyalty(tokenId, receiver, feeBps);
    }
}

/// @dev A collection that misreports its royalty in different ways. A sale must still go through.
contract MockHostileRoyaltyNFT is ERC721 {
    enum Mode {
        Normal, // 10% to RECEIVER
        RevertsOnRoyalty,
        AbovePrice, // claims five times the price
        BurnsGas, // loops forever
        RevertsOnSupports, // supportsInterface reverts
        SaysUnsupported, // supportsInterface says no to ERC-2981
        ZeroReceiver,
        BurnsGasOnSupports // supportsInterface loops forever
    }

    address public constant RECEIVER = address(0xdEaD);
    Mode public mode;

    constructor() ERC721("Hostile NFT", "HNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        if (interfaceId == 0x2a55205a) {
            if (mode == Mode.RevertsOnSupports) revert("supports reverts");
            if (mode == Mode.BurnsGasOnSupports) {
                while (true) {}
            }
            return mode != Mode.SaysUnsupported;
        }
        return super.supportsInterface(interfaceId);
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        if (mode == Mode.RevertsOnRoyalty) revert("royaltyInfo reverts");
        if (mode == Mode.AbovePrice) return (RECEIVER, salePrice * 5);
        if (mode == Mode.BurnsGas) {
            while (true) {}
        }
        if (mode == Mode.ZeroReceiver) return (address(0), salePrice / 10);
        return (RECEIVER, salePrice / 10);
    }
}
