// deploy erc20 staking info library

const dotenv = require('dotenv');
dotenv.config();

const { ethers, network } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  const ERC20StakingModuleInfo = await ethers.getContractFactory('ERC20StakingModuleInfo');
  const moduleinfo = await ERC20StakingModuleInfo.connect(ledger).deploy({ maxFeePerGas: network.config.gas, maxPriorityFeePerGas: network.config.priority });
  await moduleinfo.deployed();
  console.log('ERC20StakingModuleInfo deployed to:', moduleinfo.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
