const GeyserToken = artifacts.require('GeyserToken');
const GeyserFactory = artifacts.require('GeyserFactory');

module.exports = function (deployer) {
    address = deployer.deploy(GeyserToken);
    deployer.deploy(
        GeyserFactory,
        address
    );
}
