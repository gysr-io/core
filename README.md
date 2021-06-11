# GYSR core

This repository contains the Solidity contracts for GYSR core, token, and Pool factory.

For more information on the project, including whitepapers, audits, and other resources,
see [gysr.io](https://www.gysr.io/)


## Setup

Both **Node.js** and **npm** are required for package management and testing. See instructions
for installation [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). This
codebase has been tested with `Node.js: v10.16.0` and `npm: 6.9.0`.

This project uses [OpenZeppelin](https://docs.openzeppelin.com/)
and [Truffle](https://www.trufflesuite.com/docs/truffle)
for development, testing, and deployment.

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
npx truffle compile && npx mocha --exit --recursive --grep ERC20CompetitiveRewardModule
```


## Deploy

Copy `.env.template` to `.env` and define the `INFURA_KEY`, `DEPLOYER_INDEX`,
and `TREASURY_ADDRESS` variables.


To deploy GYSR token to Kovan
```
npx truffle migrate --network kovan --f 1 --to 1
```

Once GYSR token is deployed, define the `GYSR_ADDRESS` variable in your `.env` file.


To deploy the factory contract to Kovan
```
npx truffle migrate --network kovan --f 2 --to 2
```

Once the factory is deployed, define the `FACTORY_ADDRESS` variable in your `.env` file.


To deploy the ERC20 staking module factory to Kovan
```
npx truffle migrate --network kovan --f 3 --to 3
```


To deploy the ERC20 competitive reward module factory to Kovan
```
npx truffle migrate --network kovan --f 4 --to 4
```

Follow the remaining migration steps to deploy all contracts and libraries.
