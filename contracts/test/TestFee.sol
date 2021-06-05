// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Test fee token
 * @dev mocked up transfer fee token
 */
contract TestFeeToken is ERC20 {
    uint256 _totalSupply = 10 * 10**6 * 10**18;
    address _feeAddress = 0x0000000000000000000000000000000000000FEE;
    uint256 _feeAmount = 5; // 5%

    constructor() ERC20("TestFeeToken", "FEE") {
        _mint(msg.sender, _totalSupply);
    }

    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _transfer(_msgSender(), recipient, (amount * (100 - _feeAmount)) / 100);
        _transfer(_msgSender(), _feeAddress, (amount * _feeAmount) / 100);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        super.transferFrom(
            sender,
            recipient,
            (amount * (100 - _feeAmount)) / 100
        );
        super.transferFrom(sender, _feeAddress, (amount * _feeAmount) / 100);
        return true;
    }
}
