// deploy erc20 friendly info library

const ERC20FriendlyRewardModuleInfo = artifacts.require('ERC20FriendlyRewardModuleInfo');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC20FriendlyRewardModuleInfo);
}
