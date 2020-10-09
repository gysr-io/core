// deploy GYSR token

const GeyserToken = artifacts.require('GeyserToken');

module.exports = function (deployer) {
    deployer.deploy(GeyserToken);
}
