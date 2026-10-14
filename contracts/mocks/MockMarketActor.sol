// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// solhint-disable gas-custom-errors, reason-string, immutable-vars-naming, no-complex-fallback

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IMarket {
    function list(address nft, uint256 tokenId, uint256 price) external returns (uint256);

    function buy(uint256 listingId) external payable;

    function withdraw() external;
}

/// @dev A marketplace user that is a contract. It can try to re-enter the diamond while it is
///      being paid (`receive`) or while it receives a token (`onERC721Received`), and it
///      records what the diamond answered.
contract MockMarketActor {
    enum Mode {
        None,
        WithdrawOnReceive,
        BuyOnTokenReceived,
        WithdrawOnTokenReceived
    }

    address public immutable diamond;
    Mode public mode;
    uint256 public targetListing;
    bool public bubble; // revert with the diamond's error instead of swallowing it
    uint256 public attempts;
    bytes public lastError;
    bool public rejectEther;

    constructor(address diamond_) {
        diamond = diamond_;
    }

    function configure(Mode mode_, uint256 targetListing_, bool bubble_) external {
        mode = mode_;
        targetListing = targetListing_;
        bubble = bubble_;
    }

    function setRejectEther(bool value) external {
        rejectEther = value;
    }

    function approveAll(address nft) external {
        IERC721(nft).setApprovalForAll(diamond, true);
    }

    function list(address nft, uint256 tokenId, uint256 price) external returns (uint256) {
        return IMarket(diamond).list(nft, tokenId, price);
    }

    function buy(uint256 listingId, uint256 price) external payable {
        IMarket(diamond).buy{ value: price }(listingId);
    }

    function withdraw() external {
        IMarket(diamond).withdraw();
    }

    receive() external payable {
        require(!rejectEther, "ether rejected");
        if (mode == Mode.WithdrawOnReceive) {
            _attempt(abi.encodeCall(IMarket.withdraw, ()), 0);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (mode == Mode.BuyOnTokenReceived) {
            _attempt(abi.encodeCall(IMarket.buy, (targetListing)), address(this).balance);
        } else if (mode == Mode.WithdrawOnTokenReceived) {
            _attempt(abi.encodeCall(IMarket.withdraw, ()), 0);
        }
        return this.onERC721Received.selector;
    }

    function _attempt(bytes memory data, uint256 value) private {
        attempts++;
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory ret) = diamond.call{ value: value }(data);
        if (!ok) {
            lastError = ret;
            if (bubble) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
