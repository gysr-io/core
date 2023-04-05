// deploy GYSR token

const dotenv = require('dotenv');
dotenv.config();

const { ethers } = require('hardhat');
const { LedgerSigner } = require('@anders-t/ethers-ledger');

const { DEPLOYER_INDEX } = process.env;


async function main() {
  const ledger = new LedgerSigner(ethers.provider, `m/44'/60'/${DEPLOYER_INDEX}'/0/0`);
  console.log('Deploying from address:', await ledger.getAddress())

  const GeyserToken = await ethers.getContractFactory('GeyserToken');
  const token = await GeyserToken.connect(ledger).deploy();
  await token.deployed();
  console.log('GeyserToken deployed to:', token.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
