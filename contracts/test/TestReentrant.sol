// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777Sender.sol";
import "@openzeppelin/contracts/introspection/ERC1820Implementer.sol";
import "@openzeppelin/contracts/introspection/IERC1820Registry.sol";
import "../IGeyser.sol";

contract TestReentrantToken is ERC777 {
    uint256 _totalSupply = 10 * 10**6 * 10**18;

    constructor() public ERC777("ReentrantToken", "RE", new address[](0)) {
        _mint(msg.sender, _totalSupply, "", "");
    }
}

contract TestReentrantProxy is IERC777Sender, ERC1820Implementer {
    address private _geyser;
    uint256 private _last;
    uint256 private _amount;
    uint256 private _mode;

    constructor() public {
        _geyser = address(0);
        _last = 0;
        _amount = 0;
        _mode = 0;
    }

    function register(
        bytes32 interfaceHash,
        address addr,
        address registry
    ) external {
        _registerInterfaceForAddress(interfaceHash, addr);
        IERC1820Registry reg = IERC1820Registry(registry);
        reg.setInterfaceImplementer(
            address(this),
            interfaceHash,
            address(this)
        );
    }

    function target(
        address geyser,
        uint256 amount,
        uint256 mode
    ) external {
        _geyser = geyser;
        _amount = amount;
        _mode = mode;
    }

    function deposit(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        uint256 temp = _mode;
        _mode = 0;
        tkn.transferFrom(msg.sender, address(this), amount);
        _mode = temp;
        tkn.approve(_geyser, 100000 * 10**18);
    }

    function withdraw(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        uint256 temp = _mode;
        _mode = 0;
        tkn.transfer(msg.sender, amount);
        _mode = temp;
    }

    function stake(uint256 amount) external {
        IGeyser geyser = IGeyser(_geyser);
        geyser.stake(amount, "");
    }

    function unstake(uint256 amount) external {
        IGeyser geyser = IGeyser(_geyser);
        geyser.unstake(amount, "");
    }

    function tokensToSend(
        address,
        address,
        address,
        uint256,
        bytes calldata,
        bytes calldata
    ) external override {
        if (block.timestamp == _last) {
            return;
        }
        _last = block.timestamp;
        _exploit();
    }

    function _exploit() private {
        if (_geyser == address(0)) {
            return;
        }
        IGeyser geyser = IGeyser(_geyser);
        if (_mode == 1) {
            geyser.stake(_amount, "");
        } else if (_mode == 2) {
            geyser.unstake(_amount, "");
        } else if (_mode == 3) {
            geyser.update();
        }
    }
}
