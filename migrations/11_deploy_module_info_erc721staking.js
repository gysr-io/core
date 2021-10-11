// deploy erc721 staking info library

const ERC721StakingModuleInfo = artifacts.require('ERC721StakingModuleInfo');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC721StakingModuleInfo);
}
