// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// solhint-disable gas-custom-errors, reason-string

interface IAuction {
    function bid(uint256 auctionId) external payable;

    function withdraw() external;
}

/// @dev A bidder that is a contract. It has no `onERC721Received`, so it can only get a token
///      with a plain `transferFrom`, and it can refuse ether to test refunds.
contract MockAuctionBidder {
    address public immutable diamond; // solhint-disable-line immutable-vars-naming
    bool public rejectEther;

    constructor(address diamond_) {
        diamond = diamond_;
    }

    function setRejectEther(bool value) external {
        rejectEther = value;
    }

    function bid(uint256 auctionId) external payable {
        IAuction(diamond).bid{ value: msg.value }(auctionId);
    }

    function withdraw() external {
        IAuction(diamond).withdraw();
    }

    receive() external payable {
        require(!rejectEther, "ether rejected");
    }
}
