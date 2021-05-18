// configuration for test environment

module.exports = {
    accounts: {
        ether: 1000,
    },

    contracts: {
        type: 'truffle',
        defaultGas: 10e6,
    },

    node: {
        gasLimit: 12.5e6,
    }
};
