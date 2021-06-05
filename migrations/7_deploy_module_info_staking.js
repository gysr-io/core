// deploy erc20 staking info library

const ERC20StakingModuleInfo = artifacts.require('ERC20StakingModuleInfo');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC20StakingModuleInfo);
}
