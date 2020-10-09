// configuration for truffle project
// defines deployment and compilation settings

require('regenerator-runtime/runtime')
const LedgerWalletProvider = require('truffle-ledger-provider');

const INFURA_KEY = "";

module.exports = {
  networks: {

    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
      gas: 10000000,
      gasPrice: 0
    },

    ropsten: {
      provider: new LedgerWalletProvider(
        {
          networkId: 3,
          path: "44'/60'/0'/0/0",
          askConfirm: false,
          accountsLength: 1,
          accountsOffset: 0
        },
        `https://ropsten.infura.io/v3/${INFURA_KEY}`
      ),
      network_id: 3,
      gas: 5250000,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      //from: ''
    },

    mainnet: {
      provider: new LedgerWalletProvider(
        {
          networkId: 1,
          path: "44'/60'/0'/0/0",
          askConfirm: true,
          accountsLength: 1,
          accountsOffset: 0
        },
        `https://mainnet.infura.io/v3/${INFURA_KEY}`
      ),
      network_id: 1
    },
  },

  compilers: {
    solc: {
      version: "0.6.12",
      settings: {
        optimizer: {
          enabled: true,
          runs: 10000
        }
      }
    },
  },

  mocha: {
    timeout: 5000
  },

  plugins: ["truffle-contract-size"]
};
