// deploy erc721 staking module factory

const PoolFactory = artifacts.require('PoolFactory');
const ERC721StakingModuleFactory = artifacts.require('ERC721StakingModuleFactory');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC721StakingModuleFactory);
    const modulefactory = await ERC721StakingModuleFactory.deployed();

    // whitelist
    const factory = await PoolFactory.at(process.env.FACTORY_ADDRESS);
    const res = await factory.setWhitelist(modulefactory.address, 1);
    //console.log(res);
}
