// deploy GYSR protocol config

const dotenv = require('dotenv');
dotenv.config();

const { ethers, network } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  const Configuration = await ethers.getContractFactory('Configuration');
  const config = await Configuration.connect(ledger).deploy({ maxFeePerGas: network.config.gas, maxPriorityFeePerGas: network.config.priority });
  await config.deployed();
  console.log('Configuration deployed to:', config.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
