// configuration for truffle project
// defines deployment and compilation settings

const dotenv = require('dotenv');
dotenv.config();

const LedgerWalletProvider = require('@umaprotocol/truffle-ledger-provider');

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
          path: `44'/60'/${process.env.DEPLOYER_INDEX || 0}'/0/0`,
          askConfirm: false,
          accountsLength: 1,
          accountsOffset: 0
        },
        `https://ropsten.infura.io/v3/${process.env.INFURA_KEY}`
      ),
      network_id: 3,
      gas: 5250000,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      //from: ''
    },

    kovan: {
      provider: new LedgerWalletProvider(
        {
          networkId: 42,
          path: `44'/60'/${process.env.DEPLOYER_INDEX || 0}'/0/0`,
          askConfirm: false,
          accountsLength: 1,
          accountsOffset: 0
        },
        `https://kovan.infura.io/v3/${process.env.INFURA_KEY}`
      ),
      network_id: 42,
      skipDryRun: true
    },

    mainnet: {
      provider: new LedgerWalletProvider(
        {
          networkId: 1,
          path: `44'/60'/${process.env.DEPLOYER_INDEX || 0}'/0/0`,
          askConfirm: true,
          accountsLength: 1,
          accountsOffset: 0
        },
        `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`
      ),
      network_id: 1
    },
  },

  compilers: {
    solc: {
      version: "0.8.4",
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
