// deploy erc20 competitive info library

const ERC20CompetitiveRewardModuleInfo = artifacts.require('ERC20CompetitiveRewardModuleInfo');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC20CompetitiveRewardModuleInfo);
}
