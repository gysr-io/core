/*
ERC20 Staking Module Factory

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "./interfaces/IModuleFactory.sol";
import "./ERC20StakingModule.sol";

contract ERC20StakingModuleFactory is IModuleFactory {
    /**
     * @inheritdoc IModuleFactory
     */
    function createModule(bytes calldata data)
        external
        override
        returns (address)
    {
        // validate
        require(data.length == 32, "smf1");

        // parse staking token
        address token;
        assembly {
            token := calldataload(68)
        }

        // create module
        ERC20StakingModule module =
            new ERC20StakingModule(token, address(this));
        module.transferOwnership(msg.sender);

        // output
        emit ModuleCreated(msg.sender, address(module));
        return address(module);
    }
}
