/*
ERC20 Competitive Reward Module Factory

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "./interfaces/IModuleFactory.sol";
import "./ERC20CompetitiveRewardModule.sol";

contract ERC20CompetitiveRewardModuleFactory is IModuleFactory {
    /**
     * @inheritdoc IModuleFactory
     */
    function createModule(bytes calldata data)
        external
        override
        returns (address)
    {
        // validate
        require(data.length == 128, "crmf1");

        // parse constructor arguments
        address token;
        uint256 bonusMin;
        uint256 bonusMax;
        uint256 bonusPeriod;
        assembly {
            token := calldataload(68)
            bonusMin := calldataload(100)
            bonusMax := calldataload(132)
            bonusPeriod := calldataload(164)
        }

        // create module
        ERC20CompetitiveRewardModule module =
            new ERC20CompetitiveRewardModule(
                token,
                bonusMin,
                bonusMax,
                bonusPeriod,
                address(this)
            );
        module.transferOwnership(msg.sender);

        // output
        emit ModuleCreated(msg.sender, address(module));
        return address(module);
    }
}
