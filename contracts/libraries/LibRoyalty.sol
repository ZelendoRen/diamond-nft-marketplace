// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC2981 } from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import { IERC165 } from "../interfaces/IERC165.sol";
import { LibSlots } from "./LibSlots.sol";

library LibRoyalty {
    uint96 internal constant FEE_DENOMINATOR = 10_000;
    // gas given to a collection when it is asked for its royalty
    uint256 private constant QUOTE_GAS = 100_000;

    struct RoyaltyInfo {
        address receiver;
        uint96 feeBps;
    }

    struct Layout {
        RoyaltyInfo defaultRoyalty;
        mapping(uint256 tokenId => RoyaltyInfo) tokenRoyalty;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = LibSlots.ROYALTY;
        assembly {
            s.slot := slot
        }
    }

    /// @dev Royalty for a sale of `tokenId` of any ERC-2981 collection, the diamond's own included.
    ///      A collection that does not support ERC-2981, reverts, runs out of gas or reports a
    ///      royalty above the price cannot block or overcharge a sale: the amount is capped at
    ///      `price` and failures count as "no royalty".
    function quote(
        address nft,
        uint256 tokenId,
        uint256 price
    ) internal view returns (address receiver, uint256 amount) {
        try IERC165(nft).supportsInterface{ gas: QUOTE_GAS }(type(IERC2981).interfaceId) returns (
            bool supported
        ) {
            if (!supported) return (address(0), 0);
        } catch {
            return (address(0), 0);
        }
        try IERC2981(nft).royaltyInfo{ gas: QUOTE_GAS }(tokenId, price) returns (
            address royaltyReceiver,
            uint256 royaltyAmount
        ) {
            if (royaltyReceiver == address(0)) return (address(0), 0);
            return (royaltyReceiver, royaltyAmount > price ? price : royaltyAmount);
        } catch {
            return (address(0), 0);
        }
    }
}
