// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract TestERC1155 is ERC1155 {
    constructor() ERC1155("") {
        _mint(msg.sender, 0, 10**18, "");
    }
}
