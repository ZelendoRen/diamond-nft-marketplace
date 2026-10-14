// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IDiamondLoupe } from "../interfaces/IDiamondLoupe.sol";
import { IERC165 } from "../interfaces/IERC165.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";

contract DiamondLoupeFacet is IDiamondLoupe, IERC165 {
    function facets() external view override returns (Facet[] memory result) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        uint256 count = ds.facetAddresses.length;
        result = new Facet[](count);
        for (uint256 i; i < count; i++) {
            address facet = ds.facetAddresses[i];
            result[i].facetAddress = facet;
            result[i].functionSelectors = ds.facetFunctionSelectors[facet].functionSelectors;
        }
    }

    function facetFunctionSelectors(
        address facet
    ) external view override returns (bytes4[] memory) {
        return LibDiamond.diamondStorage().facetFunctionSelectors[facet].functionSelectors;
    }

    function facetAddresses() external view override returns (address[] memory) {
        return LibDiamond.diamondStorage().facetAddresses;
    }

    function facetAddress(bytes4 functionSelector) external view override returns (address) {
        return
            LibDiamond.diamondStorage().selectorToFacetAndPosition[functionSelector].facetAddress;
    }

    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {
        return LibDiamond.diamondStorage().supportedInterfaces[interfaceId];
    }
}
