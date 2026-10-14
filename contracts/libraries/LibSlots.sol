// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Storage slot of every facet, kept together to spot collisions.
/// @dev ERC-7201: keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff)),
///      the id is in the comment above each constant. `LibDiamond` keeps its EIP-2535 slot.
library LibSlots {
    // dnm.reentrancy
    bytes32 internal constant REENTRANCY =
        0x318e05e24333a7c820fa64907e53bb5ff7e1b877c5e103c093ac27d044774b00;
    // dnm.payments
    bytes32 internal constant PAYMENTS =
        0xebac239808fedb6a314309f5d8162e37204df54c3985818df8c80ef098ff7a00;
    // dnm.erc721
    bytes32 internal constant ERC721 =
        0x8b3f4d3ffc5057ebed21a4e65b7e7ce82c734b8311d91f986ffcdb92f8cb6200;
    // dnm.erc1155
    bytes32 internal constant ERC1155 =
        0x8050d17e10eb7e102349efbcf507a31440c8d60df023fe7276fa99a587302c00;
    // dnm.royalty
    bytes32 internal constant ROYALTY =
        0x039eab4829cbf14982d3667d6326ec5bba0684afa9d06807bb1c115c3808d500;
    // dnm.marketplace
    bytes32 internal constant MARKETPLACE =
        0x119cf2481fbaa20a62157043d34e29febe19034447e17a857793ef81c3cf5900;
    // dnm.auction
    bytes32 internal constant AUCTION =
        0x892ee7a626079e36a91ae7b95d7601c5183f5545c8a44b902b23ec4726d06b00;
}
