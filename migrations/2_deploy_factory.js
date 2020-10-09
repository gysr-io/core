// deploy geyser factory

const GeyserFactory = artifacts.require('GeyserFactory');

// set address of GYSR token contract
const GYSR_ADDRESS = '';

module.exports = function (deployer) {
    deployer.deploy(GeyserFactory, GYSR_ADDRESS);
}
