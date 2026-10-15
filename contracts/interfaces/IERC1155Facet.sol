// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ERC-1155 and its metadata extension, minus `setApprovalForAll`/`isApprovedForAll`:
///         those two selectors are shared with ERC-721 and are served by `ERC721Facet`, which
///         keeps one operator approval for both standards.
interface IERC1155Facet {
    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 value
    );
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );
    event URI(string value, uint256 indexed id);

    error ERC1155InsufficientBalance(
        address sender,
        uint256 balance,
        uint256 needed,
        uint256 tokenId
    );
    error ERC1155InvalidSender(address sender);
    error ERC1155InvalidReceiver(address receiver);
    error ERC1155MissingApprovalForAll(address operator, address owner);
    error ERC1155InvalidArrayLength(uint256 idsLength, uint256 valuesLength);

    function balanceOf(address account, uint256 id) external view returns (uint256);

    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory);

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external;

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external;

    function uri(uint256 id) external view returns (string memory);
}
