// deploy erc20 multi reward module factory

const dotenv = require('dotenv');
dotenv.config();

const { ethers, network } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX, FACTORY_ADDRESS } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  // deploy
  const ERC20MultiRewardModuleFactory = await ethers.getContractFactory('ERC20MultiRewardModuleFactory');
  const modulefactory = await ERC20MultiRewardModuleFactory.connect(ledger).deploy({ maxFeePerGas: network.config.gas, maxPriorityFeePerGas: network.config.priority });
  await modulefactory.deployed();
  console.log('ERC20MultiModuleFactory deployed to:', modulefactory.address);

  // whitelist
  const PoolFactory = await ethers.getContractFactory('PoolFactory');
  const factory = await PoolFactory.attach(FACTORY_ADDRESS);
  const res = await factory.connect(ledger).setWhitelist(modulefactory.address, 2, { maxFeePerGas: network.config.gas, maxPriorityFeePerGas: network.config.priority, gasLimit: 50000 });
  //console.log(res);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
