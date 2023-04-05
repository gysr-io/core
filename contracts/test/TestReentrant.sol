// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777Sender.sol";
import "@openzeppelin/contracts/utils/introspection/ERC1820Implementer.sol";
import "@openzeppelin/contracts/utils/introspection/IERC1820Registry.sol";
import "../interfaces/IPool.sol";

/**
 * @title Test reentrant token
 * @dev basic ERC777 token for reentrancy testing
 */
contract TestReentrantToken is ERC777 {
    uint256 _totalSupply = 10 * 10**6 * 10**18;

    constructor() ERC777("ReentrantToken", "RE", new address[](0)) {
        _mint(msg.sender, _totalSupply, "", "");
    }
}

/**
 * @title Test reentrancy proxy
 * @dev mocked up reentrancy attack
 */
contract TestReentrantProxy is IERC777Sender, ERC1820Implementer {
    address private _pool;
    uint256 private _last;
    uint256 private _amount;
    uint256 private _mode;

    constructor() {
        _pool = address(0);
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
        address pool,
        uint256 amount,
        uint256 mode
    ) external {
        _pool = pool;
        _amount = amount;
        _mode = mode;
    }

    function deposit(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        IPool pool = IPool(_pool);
        uint256 temp = _mode;
        _mode = 0;
        tkn.transferFrom(msg.sender, address(this), amount);
        _mode = temp;
        tkn.approve(pool.stakingModule(), 100000 * 10**18);
    }

    function withdraw(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        uint256 temp = _mode;
        _mode = 0;
        tkn.transfer(msg.sender, amount);
        _mode = temp;
    }

    function stake(uint256 amount) external {
        IPool pool = IPool(_pool);
        pool.stake(amount, "", "");
    }

    function unstake(uint256 amount) external {
        IPool pool = IPool(_pool);
        pool.unstake(amount, "", "");
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
        if (_pool == address(0)) {
            return;
        }
        IPool pool = IPool(_pool);
        if (_mode == 1) {
            pool.stake(_amount, "", "");
        } else if (_mode == 2) {
            pool.unstake(_amount, "", "");
        } else if (_mode == 3) {
            pool.update("", "");
        }
    }
}
