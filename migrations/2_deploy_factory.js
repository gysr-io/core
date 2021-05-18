// deploy pool factory

const PoolFactory = artifacts.require('PoolFactory');

// set address of GYSR token contract
const GYSR_ADDRESS = '';

// set initial address of treasury
const TREASURY_ADDRESS = '';

module.exports = function (deployer) {
    deployer.deploy(PoolFactory, GYSR_ADDRESS, TREASURY_ADDRESS);
}
