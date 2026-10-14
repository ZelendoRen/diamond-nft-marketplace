// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC173 } from "../interfaces/IERC173.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

contract OwnershipFacet is IERC173 {
    function owner() external view override returns (address) {
        return LibDiamond.contractOwner();
    }

    function transferOwnership(address newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.setContractOwner(newOwner);
    }
}
