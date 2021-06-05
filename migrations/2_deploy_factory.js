// deploy pool factory

const dotenv = require('dotenv');
dotenv.config();

const PoolFactory = artifacts.require('PoolFactory');

module.exports = function (deployer) {
    deployer.deploy(PoolFactory, process.env.GYSR_ADDRESS, process.env.TREASURY_ADDRESS);
}
