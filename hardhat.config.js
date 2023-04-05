// configuration for hardhat project

const dotenv = require('dotenv');
dotenv.config();

require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-waffle'); // for deployment
require("@nomiclabs/hardhat-etherscan");
require('hardhat-gas-reporter');
require('hardhat-contract-sizer');
require('solidity-coverage');

const { INFURA_KEY, ETHERSCAN_KEY, POLYGONSCAN_KEY, OPTIMISTIC_ETHERSCAN_KEY } = process.env;

module.exports = {
  solidity: {
    version: '0.8.18',
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000
      }
    }
  },
  networks: {
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_KEY}`,
      chainId: 5,
      gasPrice: 1000000000, // 1 gwei
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
      chainId: 1,
      gasPrice: 20000000000,  // 20 gwei
    },
    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
      chainId: 137,
      gasPrice: 50000000000,  // 50 gwei
    },
    optimism: {
      url: `https://optimism-mainnet.infura.io/v3/${INFURA_KEY}`,
      chainId: 10,
      gasPrice: 1000000,  // 0.001 gwei
    }
  },
  gasReporter: {
    enabled: true,
    outputFile: 'gas_report.txt',
    forceConsoleOutput: true,
    excludeContracts: [
      'TestToken',
      'TestLiquidityToken',
      'TestIndivisibleToken',
      'TestReentrantToken',
      'TestReentrantProxy',
      'TestERC721',
      'TestERC1155',
      'TestFeeToken',
      'TestElasticToken',
      'TestStakeUnstake'
    ]
  },
  etherscan: {
    apiKey: {
      mainnet: ETHERSCAN_KEY,
      goerli: ETHERSCAN_KEY,
      polygon: POLYGONSCAN_KEY,
      optimisticEthereum: OPTIMISTIC_ETHERSCAN_KEY
    }
  },
};
