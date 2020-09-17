# GYSR core

This repository contains the Solidity contracts for Geyser core, Geyser factory, and GYSR token.

For more information on the project and access to the whitepaper:  
[gysr.io](https://www.gysr.io/)


## Setup

Both **Node.js** and **npm** are required for package management and testing. See instructions
for installation [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). This
codebase has been tested with `Node.js: v10.16.0` and `npm: 6.9.0`.

This project uses [OpenZeppelin](https://docs.openzeppelin.com/cli/2.8/) libraries and tools.
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
npx mocha --exit --grep withdraw
```
