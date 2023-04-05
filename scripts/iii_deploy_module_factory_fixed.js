// deploy erc20 fixed reward module factory

const dotenv = require('dotenv');
dotenv.config();

const { ethers } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX, FACTORY_ADDRESS } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  // deploy
  const ERC20FixedRewardModuleFactory = await ethers.getContractFactory('ERC20FixedRewardModuleFactory');
  const modulefactory = await ERC20FixedRewardModuleFactory.connect(ledger).deploy();
  await modulefactory.deployed();
  console.log('ERC20FixedRewardModuleFactory deployed to:', modulefactory.address);

  // whitelist
  const PoolFactory = await ethers.getContractFactory('PoolFactory');
  const factory = await PoolFactory.attach(FACTORY_ADDRESS);
  const res = await factory.connect(ledger).setWhitelist(modulefactory.address, 2);
  //console.log(res);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});