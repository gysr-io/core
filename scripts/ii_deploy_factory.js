// deploy pool factory

const dotenv = require('dotenv');
dotenv.config();

const { ethers, network } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX, GYSR_ADDRESS, CONFIG_ADDRESS } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  let PoolFactory = await ethers.getContractFactory('PoolFactory');
  const factory = await PoolFactory.connect(ledger).deploy(
    GYSR_ADDRESS, CONFIG_ADDRESS,
    { maxFeePerGas: network.config.gas, maxPriorityFeePerGas: network.config.priority }
  );
  await factory.deployed();
  console.log('PoolFactory deployed to:', factory.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
