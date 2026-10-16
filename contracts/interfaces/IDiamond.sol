// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDiamond {
    enum FacetCutAction {
        Add,
        Replace,
        Remove
    }

    struct FacetCut {
        address facetAddress;
        FacetCutAction action;
        bytes4[] functionSelectors;
    }

    // slither-disable-next-line unindexed-event-address
    event DiamondCut(FacetCut[] diamondCut, address init, bytes initCalldata);
}
