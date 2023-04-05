# GYSR core

This repository contains the Solidity contracts for the GYSR core procotol, including modular pools, factory system, and token.

For more information on the project, whitepapers, audits, and other resources,
see [gysr.io](https://www.gysr.io/)


## Install

To use the core contracts, interfaces, libraries, or ABIs in your own project

```
npm install @gysr/core
```

See the [documentation](https://docs.gysr.io/developers) to learn more about interacting with the GYSR protocol.


## Development

Both **Node.js** and **npm** are required for package management and testing. See instructions
for installation [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).

This project uses [Hardhat](https://hardhat.org/docs) for development, testing, and deployment.

To install these packages along with other dependencies:
```
npm install
```


## Test

To run all unit tests
```
npm test
```

To run some subset of tests
```
npx hardhat compile && npx hardhat test --grep ERC20CompetitiveRewardModule
```


## Deploy

Copy `.env.template` to `.env` and define the `INFURA_KEY`, `DEPLOYER_INDEX`,
and `TREASURY_ADDRESS` variables.


To deploy GYSR token to Goerli
```
npx hardhat run --network goerli scripts/i_deploy_token.js
```

Once GYSR token is deployed, define the `GYSR_ADDRESS` variable in your `.env` file.


To deploy the factory contract to Goerli
```
npx hardhat run --network goerli scripts/ii_deploy_factory.js
```

Once the factory is deployed, define the `FACTORY_ADDRESS` variable in your `.env` file.


To deploy the ERC20 staking module factory to Goerli
```
npx hardhat run --network goerli scripts/iii_deploy_module_factory_staking.js
```


To deploy the ERC20 competitive reward module factory to Goerli
```
npx hardhat run --network goerli scripts/iii_deploy_module_factory_competitive.js
```

Follow the remaining migration steps to deploy all contracts and libraries.


To verify a contract on Goerli
```
npx hardhat verify --network goerli --contract contracts/PoolFactory.sol:PoolFactory 0xpoolfactory 0xgysrtoken 0xtreasury
```
