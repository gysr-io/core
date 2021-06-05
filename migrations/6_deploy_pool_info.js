// deploy pool info library

const PoolInfo = artifacts.require('PoolInfo');

module.exports = async function (deployer) {
    // deploy
    await deployer.deploy(PoolInfo);
}
