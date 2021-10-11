// unit tests for ERC20StakingModuleInfo library

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  days,
  toFixedPointBigNumber,
  DECIMALS
} = require('../util/helper');

const ERC721StakingModule = contract.fromArtifact('ERC721StakingModule');
const TestERC721 = contract.fromArtifact('TestERC721');
const ERC721StakingModuleInfo = contract.fromArtifact('ERC721StakingModuleInfo');



describe('ERC721StakingModuleInfo', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.token = await TestERC721.new({ from: org });
    this.info = await ERC721StakingModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC721StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );
    });

    describe('when getting token info', function () {

      beforeEach(async function () {
        this.res = await this.info.token(this.module.address);
      });

      it('should return staking token address as first argument', async function () {
        expect(this.res[0]).to.equal(this.token.address);
      });

      it('should return staking token name as second argument', async function () {
        expect(this.res[1]).to.equal("TestERC721");
      });

      it('should return staking token symbol as third argument', async function () {
        expect(this.res[2]).to.equal("NFT");
      });

      it('should return staking token decimals as fourth argument', async function () {
        expect(this.res[3]).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when user gets all shares', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, 0);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });

    });


    describe('when getting shares per token', function () {

      beforeEach(async function () {
        this.res = await this.info.sharesPerToken(this.module.address);
      });

      it('should return 1e18', async function () {
        expect(this.res).to.be.bignumber.equal(
          toFixedPointBigNumber(1, 10, 18).mul(toFixedPointBigNumber(1, 10, 18))
        );
      });

    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {

      // owner creates staking module with erc721 token
      this.module = await ERC721StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // claim tokens and do approval
      await this.token.mint(10, { from: alice });
      await this.token.mint(5, { from: bob });
      await this.token.setApprovalForAll(this.module.address, true, { from: alice });
      await this.token.setApprovalForAll(this.module.address, true, { from: bob });

      // alice stakes 2 nfts
      const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [1, 2, 8]);
      this.res0 = await this.module.stake(alice, 3, data0, { from: owner });

      // bob stakes 3 nfts
      const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [11, 14]);
      this.res1 = await this.module.stake(bob, 2, data1, { from: owner });

      // advance time
      await time.increase(days(30));
    });

    describe('when user gets all shares', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, 0);
      });

      it('should return full share balance', async function () {
        expect(this.res).to.be.bignumber.equal(toFixedPointBigNumber(3, 10, 18));
      });

    });

    describe('when user gets share value on some tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, new BN(2));
      });

      it('should return expected number of shares', async function () {
        expect(this.res).to.be.bignumber.equal(toFixedPointBigNumber(2, 10, 18));
      });

    });

    describe('when getting shares per token', function () {

      beforeEach(async function () {
        this.res = await this.info.sharesPerToken(this.module.address);
      });

      it('should return 1e18', async function () {
        expect(this.res).to.be.bignumber.equal(
          toFixedPointBigNumber(1, 10, 18).mul(toFixedPointBigNumber(1, 10, 18))
        );
      });

    });

    describe('when user gets all staked token ids', function () {

      beforeEach(async function () {
        this.res = await this.info.tokenIds(this.module.address, alice, new BN(0), new BN(0));
      });

      it('should return array of size equal to full balance', async function () {
        expect(this.res.length).to.be.equal(3);
      });

      it('should return array containing all staked token ids', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(1));
        expect(this.res[1]).to.be.bignumber.equal(new BN(2));
        expect(this.res[2]).to.be.bignumber.equal(new BN(8));
      });

    });

    describe('when user gets some staked token ids', function () {

      beforeEach(async function () {
        this.res = await this.info.tokenIds(this.module.address, alice, new BN(2), new BN(0));
      });

      it('should return array of specified size', async function () {
        expect(this.res.length).to.be.equal(2);
      });

      it('should return array containing first two staked token ids', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(1));
        expect(this.res[1]).to.be.bignumber.equal(new BN(2));
      });

    });

    describe('when user gets offset subset of staked token ids', function () {

      beforeEach(async function () {
        this.res = await this.info.tokenIds(this.module.address, alice, new BN(0), new BN(1));
      });

      it('should return array of expected size', async function () {
        expect(this.res.length).to.be.equal(2);
      });

      it('should return array containing last two staked token ids', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(2));
        expect(this.res[1]).to.be.bignumber.equal(new BN(8));
      });

    });

  });

});
