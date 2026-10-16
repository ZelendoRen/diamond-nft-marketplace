// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IDiamond } from "../interfaces/IDiamond.sol";
import { IERC173 } from "../interfaces/IERC173.sol";

error NotContractOwner(address user, address owner);
error NoSelectorsInFacet(address facet);
error IncorrectFacetCutAction(uint8 action);
error CannotAddSelectorsToZeroAddress();
error NoBytecodeAtAddress(address account, string message);
error CannotAddFunctionThatAlreadyExists(bytes4 selector);
error CannotReplaceFunctionsFromZeroAddress();
error CannotReplaceImmutableFunction(bytes4 selector);
error CannotReplaceWithSameFacet(bytes4 selector);
error CannotReplaceFunctionThatDoesNotExist(bytes4 selector);
error RemoveFacetAddressMustBeZero(address facet);
error CannotRemoveFunctionThatDoesNotExist(bytes4 selector);
error CannotRemoveImmutableFunction(bytes4 selector);
error InitializationFunctionReverted(address init, bytes data);

/// @dev EIP-2535 diamond storage and cut logic.
library LibDiamond {
    bytes32 internal constant DIAMOND_STORAGE_POSITION = keccak256(
        "diamond.standard.diamond.storage"
    );

    struct FacetAddressAndPosition {
        address facetAddress;
        uint96 functionSelectorPosition; // position in facetFunctionSelectors
    }

    struct FacetFunctionSelectors {
        bytes4[] functionSelectors;
        uint256 facetAddressPosition; // position in facetAddresses
    }

    struct DiamondStorage {
        mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;
        mapping(address => FacetFunctionSelectors) facetFunctionSelectors;
        address[] facetAddresses;
        mapping(bytes4 => bool) supportedInterfaces;
        address contractOwner;
    }

    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    function setContractOwner(address newOwner) internal {
        DiamondStorage storage ds = diamondStorage();
        address previousOwner = ds.contractOwner;
        ds.contractOwner = newOwner;
        emit IERC173.OwnershipTransferred(previousOwner, newOwner);
    }

    function contractOwner() internal view returns (address) {
        return diamondStorage().contractOwner;
    }

    function enforceIsContractOwner() internal view {
        address owner = diamondStorage().contractOwner;
        if (msg.sender != owner) revert NotContractOwner(msg.sender, owner);
    }

    function diamondCut(
        IDiamond.FacetCut[] memory cuts,
        address init,
        bytes memory initCalldata
    ) internal {
        for (uint256 i; i < cuts.length; i++) {
            if (cuts[i].action == IDiamond.FacetCutAction.Add) {
                addFunctions(cuts[i].facetAddress, cuts[i].functionSelectors);
            } else if (cuts[i].action == IDiamond.FacetCutAction.Replace) {
                replaceFunctions(cuts[i].facetAddress, cuts[i].functionSelectors);
            } else if (cuts[i].action == IDiamond.FacetCutAction.Remove) {
                removeFunctions(cuts[i].facetAddress, cuts[i].functionSelectors);
            } else {
                revert IncorrectFacetCutAction(uint8(cuts[i].action));
            }
        }
        emit IDiamond.DiamondCut(cuts, init, initCalldata);
        initializeDiamondCut(init, initCalldata);
    }

    function addFunctions(address facet, bytes4[] memory selectors) internal {
        if (selectors.length == 0) revert NoSelectorsInFacet(facet);
        if (facet == address(0)) revert CannotAddSelectorsToZeroAddress();
        DiamondStorage storage ds = diamondStorage();
        uint96 position = uint96(ds.facetFunctionSelectors[facet].functionSelectors.length);
        if (position == 0) addFacet(ds, facet);
        for (uint256 i; i < selectors.length; i++) {
            bytes4 selector = selectors[i];
            if (ds.selectorToFacetAndPosition[selector].facetAddress != address(0)) {
                revert CannotAddFunctionThatAlreadyExists(selector);
            }
            addFunction(ds, selector, position, facet);
            position++;
        }
    }

    function replaceFunctions(address facet, bytes4[] memory selectors) internal {
        if (selectors.length == 0) revert NoSelectorsInFacet(facet);
        if (facet == address(0)) revert CannotReplaceFunctionsFromZeroAddress();
        DiamondStorage storage ds = diamondStorage();
        uint96 position = uint96(ds.facetFunctionSelectors[facet].functionSelectors.length);
        if (position == 0) addFacet(ds, facet);
        for (uint256 i; i < selectors.length; i++) {
            bytes4 selector = selectors[i];
            address oldFacet = ds.selectorToFacetAndPosition[selector].facetAddress;
            if (oldFacet == address(this)) revert CannotReplaceImmutableFunction(selector);
            if (oldFacet == facet) revert CannotReplaceWithSameFacet(selector);
            if (oldFacet == address(0)) revert CannotReplaceFunctionThatDoesNotExist(selector);
            removeFunction(ds, oldFacet, selector);
            addFunction(ds, selector, position, facet);
            position++;
        }
    }

    function removeFunctions(address facet, bytes4[] memory selectors) internal {
        if (selectors.length == 0) revert NoSelectorsInFacet(facet);
        if (facet != address(0)) revert RemoveFacetAddressMustBeZero(facet);
        DiamondStorage storage ds = diamondStorage();
        for (uint256 i; i < selectors.length; i++) {
            bytes4 selector = selectors[i];
            removeFunction(ds, ds.selectorToFacetAndPosition[selector].facetAddress, selector);
        }
    }

    function addFacet(DiamondStorage storage ds, address facet) internal {
        enforceHasContractCode(facet, "LibDiamond: facet has no code");
        ds.facetFunctionSelectors[facet].facetAddressPosition = ds.facetAddresses.length;
        ds.facetAddresses.push(facet);
    }

    function addFunction(
        DiamondStorage storage ds,
        bytes4 selector,
        uint96 position,
        address facet
    ) internal {
        ds.selectorToFacetAndPosition[selector] = FacetAddressAndPosition(facet, position);
        ds.facetFunctionSelectors[facet].functionSelectors.push(selector);
    }

    function removeFunction(DiamondStorage storage ds, address facet, bytes4 selector) internal {
        if (facet == address(0)) revert CannotRemoveFunctionThatDoesNotExist(selector);
        // selectors of the diamond itself are immutable
        if (facet == address(this)) revert CannotRemoveImmutableFunction(selector);

        uint256 position = ds.selectorToFacetAndPosition[selector].functionSelectorPosition;
        uint256 lastPosition = ds.facetFunctionSelectors[facet].functionSelectors.length - 1;
        // move the last selector into the freed slot
        if (position != lastPosition) {
            bytes4 lastSelector = ds.facetFunctionSelectors[facet].functionSelectors[lastPosition];
            ds.facetFunctionSelectors[facet].functionSelectors[position] = lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].functionSelectorPosition = uint96(position);
        }
        ds.facetFunctionSelectors[facet].functionSelectors.pop();
        delete ds.selectorToFacetAndPosition[selector];

        // no selectors left, drop the facet address as well
        if (lastPosition == 0) {
            uint256 lastFacetPosition = ds.facetAddresses.length - 1;
            uint256 facetPosition = ds.facetFunctionSelectors[facet].facetAddressPosition;
            if (facetPosition != lastFacetPosition) {
                address lastFacet = ds.facetAddresses[lastFacetPosition];
                ds.facetAddresses[facetPosition] = lastFacet;
                ds.facetFunctionSelectors[lastFacet].facetAddressPosition = facetPosition;
            }
            ds.facetAddresses.pop();
            delete ds.facetFunctionSelectors[facet].facetAddressPosition;
        }
    }

    function initializeDiamondCut(address init, bytes memory initCalldata) internal {
        if (init == address(0)) return;
        enforceHasContractCode(init, "LibDiamond: init has no code");
        // slither-disable-start low-level-calls
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory error) = init.delegatecall(initCalldata);
        // slither-disable-end low-level-calls
        if (!success) {
            if (error.length > 0) {
                // forward the initializer's revert data
                assembly {
                    revert(add(error, 32), mload(error))
                }
            }
            revert InitializationFunctionReverted(init, initCalldata);
        }
    }

    function enforceHasContractCode(address account, string memory message) internal view {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        if (size == 0) revert NoBytecodeAtAddress(account, message);
    }
}
