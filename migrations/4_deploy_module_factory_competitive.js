// deploy erc20 competitive reward module factory

const PoolFactory = artifacts.require('PoolFactory');
const ERC20CompetitiveRewardModuleFactory = artifacts.require('ERC20CompetitiveRewardModuleFactory');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(ERC20CompetitiveRewardModuleFactory);
    const modulefactory = await ERC20CompetitiveRewardModuleFactory.deployed();

    // whitelist
    const factory = await PoolFactory.at(process.env.FACTORY_ADDRESS);
    const res = await factory.setWhitelist(modulefactory.address, 2);
    //console.log(res);
}
