// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// solhint-disable gas-custom-errors, reason-string

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev A collection whose `transferFrom` first calls back into the diamond, the way a malicious
///      token would while the diamond is moving it.
contract MockReentrantNFT is ERC721 {
    address public target;
    bytes public payload;
    bool public bubble; // revert with the diamond's answer instead of swallowing it
    uint256 public attempts;
    bytes public lastError;

    constructor() ERC721("Reentrant NFT", "RNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function configure(address target_, bytes calldata payload_, bool bubble_) external {
        target = target_;
        payload = payload_;
        bubble = bubble_;
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        if (target != address(0)) {
            attempts++;
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                lastError = ret;
                if (bubble) {
                    assembly {
                        revert(add(ret, 32), mload(ret))
                    }
                }
            }
        }
        super.transferFrom(from, to, tokenId);
    }
}
