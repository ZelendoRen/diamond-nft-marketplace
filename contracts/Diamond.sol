// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibDiamond } from "./libraries/LibDiamond.sol";
import { IDiamond } from "./interfaces/IDiamond.sol";

error FunctionNotFound(bytes4 selector);

/// @notice EIP-2535 proxy, delegates each call to the facet registered for its selector.
contract Diamond {
    struct DiamondArgs {
        address owner;
        address init;
        bytes initCalldata;
    }

    /// @param cuts facets to install, must include one with `diamondCut`
    /// @param args owner and an optional initializer run after the cuts
    constructor(IDiamond.FacetCut[] memory cuts, DiamondArgs memory args) payable {
        LibDiamond.setContractOwner(args.owner);
        LibDiamond.diamondCut(cuts, args.init, args.initCalldata);
    }
    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        address facet = LibDiamond
            .diamondStorage()
            .selectorToFacetAndPosition[msg.sig]
            .facetAddress;
        if (facet == address(0)) revert FunctionNotFound(msg.sig);
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {}
}
