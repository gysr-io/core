// test module for PoolFactory

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { bonus, days, reportGas, FEE } = require('../util/helper');

const PoolFactory = contract.fromArtifact('PoolFactory');
const Pool = contract.fromArtifact('Pool');
const ERC20StakingModuleFactory = contract.fromArtifact('ERC20StakingModuleFactory');
const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20CompetitiveRewardModuleFactory = contract.fromArtifact('ERC20CompetitiveRewardModuleFactory');
const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');


describe('PoolFactory', function () {
  const [owner, org, gysr, treasury, other, subfactory] = accounts;

  beforeEach('setup', async function () {
    this.factory = await PoolFactory.new(gysr, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20CompetitiveRewardModuleFactory.new({ from: org });
    this.stakingToken = await TestLiquidityToken.new({ from: org });
    this.rewardToken = await TestToken.new({ from: org });
  });

  describe('when factory constructed', function () {

    it('should return initial treasury address', async function () {
      expect(await this.factory.treasury()).to.be.bignumber.equal(treasury);
    });

    it('should return max fee', async function () {
      expect(await this.factory.fee()).to.be.bignumber.equal(bonus(FEE));
    });

    it('should have zero Pool count', async function () {
      expect(await this.factory.count()).to.be.bignumber.equal(new BN(0));
    });
  });

  describe('fee update', function () {

    describe('when sender is not controller', function () {
      it('should fail', async function () {
        await expectRevert(
          this.factory.setFee(bonus(0.15), { from: other }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when new value is greater than max', function () {
      it('should fail', async function () {
        await expectRevert(
          this.factory.setFee(bonus(0.25), { from: org }),
          'f3' // PoolFactory: fee exceeds max
        );
      });
    });

    describe('when value is lower than max', function () {
      beforeEach(async function () {
        this.res = await this.factory.setFee(bonus(0.15), { from: org });
      });

      it('should update global GYSR fee', async function () {
        expect(await this.factory.fee()).to.be.bignumber.equal(bonus(0.15));
      });

      it('should emit FeeUpdated event', async function () {
        expectEvent(this.res, 'FeeUpdated', { previous: bonus(0.2), updated: bonus(0.15) });
      });
    });

    describe('when value is raised back to max', function () {
      beforeEach(async function () {
        await this.factory.setFee(bonus(0.15), { from: org });
        this.res = await this.factory.setFee(bonus(0.20), { from: org });
      });

      it('should set global GYSR fee to max', async function () {
        expect(await this.factory.fee()).to.be.bignumber.equal(bonus(0.20));
      });

      it('should emit FeeUpdated event', async function () {
        expectEvent(this.res, 'FeeUpdated', { previous: bonus(0.15), updated: bonus(0.20) });
      });
    });

    describe('when new value is zero', function () {
      beforeEach(async function () {
        this.res = await this.factory.setFee(new BN(0), { from: org });
      });

      it('should set global GYSR fee to zero', async function () {
        expect(await this.factory.fee()).to.be.bignumber.equal(new BN(0));
      });

      it('should emit FeeUpdated event', async function () {
        expectEvent(this.res, 'FeeUpdated', { previous: bonus(0.2), updated: bonus(0.0) });
      });
    });
  });

  describe('treasury update', function () {

    describe('when sender is not controller', function () {
      it('should fail', async function () {
        await expectRevert(
          this.factory.setTreasury(other, { from: other }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when authorized', function () {
      beforeEach(async function () {
        this.res = await this.factory.setTreasury(other, { from: org });
      });

      it('should update gysr treasury', async function () {
        expect(await this.factory.treasury()).to.equal(other);
      });

      it('should emit TreasuryUpdated event', async function () {
        expectEvent(this.res, 'TreasuryUpdated', { previous: treasury, updated: other });
      });
    });
  });

  describe('whitelist update', function () {

    describe('when sender is not controller', function () {
      it('should fail', async function () {
        await expectRevert(
          this.factory.setWhitelist(subfactory, new BN(1), { from: other }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when update value is invalid', function () {
      it('should fail', async function () {
        await expectRevert(
          this.factory.setWhitelist(subfactory, new BN(3), { from: org }),
          'f4' // PoolFactory: invalid whitelist type
        );
      });
    });

    describe('when module factory set to staking type', function () {
      beforeEach(async function () {
        this.res = await this.factory.setWhitelist(subfactory, new BN(1), { from: org });
      });

      it('should update whitelist status to staking', async function () {
        expect(await this.factory.whitelist(subfactory)).to.be.bignumber.equal(new BN(1));
      });

      it('should emit WhitelistUpdated event', async function () {
        expectEvent(this.res, 'WhitelistUpdated', { factory: subfactory, previous: new BN(0), updated: new BN(1) });
      });
    });

    describe('when module factory set to reward type', function () {
      beforeEach(async function () {
        this.res = await this.factory.setWhitelist(subfactory, new BN(2), { from: org });
      });

      it('should update whitelist status to reward', async function () {
        expect(await this.factory.whitelist(subfactory)).to.be.bignumber.equal(new BN(2));
      });

      it('should emit WhitelistUpdated event', async function () {
        expectEvent(this.res, 'WhitelistUpdated', { factory: subfactory, previous: new BN(0), updated: new BN(2) });
      });
    });

    describe('when module factory set back to unknown', function () {
      beforeEach(async function () {
        await this.factory.setWhitelist(subfactory, new BN(2), { from: org });
        this.res = await this.factory.setWhitelist(subfactory, new BN(0), { from: org });
      });

      it('should update whitelist status to unknown', async function () {
        expect(await this.factory.whitelist(subfactory)).to.be.bignumber.equal(new BN(0));
      });

      it('should emit WhitelistUpdated event', async function () {
        expectEvent(this.res, 'WhitelistUpdated', { factory: subfactory, previous: new BN(2), updated: new BN(0) });
      });
    });

  });

  describe('create', function () {

    describe('when reward module is not whitelisted', function () {

      it('should fail', async function () {
        // encode sub factory arguments
        const stakingdata = web3.eth.abi.encodeParameter('address', this.stakingToken.address);
        const rewardata = web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'uint256', 'uint256'],
          [this.rewardToken.address, bonus(0).toString(), bonus(1.0).toString(), days(30).toString()]
        );

        // whitelist sub factories
        await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(1), { from: org });

        // attempt to create pool
        await expectRevert(
          this.factory.create(
            this.stakingModuleFactory.address,
            this.rewardModuleFactory.address,
            stakingdata,
            rewardata,
            { from: owner }
          ),
          'f1' // PoolFactory: invalid staking module factory
        );
      });

    });

    describe('when reward module is not whitelisted', function () {

      it('should fail', async function () {
        // encode sub factory arguments
        const stakingdata = web3.eth.abi.encodeParameter('address', this.stakingToken.address);
        const rewardata = web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'uint256', 'uint256'],
          [this.rewardToken.address, bonus(0).toString(), bonus(1.0).toString(), days(30).toString()]
        );

        // whitelist sub factories
        await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });

        // attempt to create pool
        await expectRevert(
          this.factory.create(
            this.stakingModuleFactory.address,
            this.rewardModuleFactory.address,
            stakingdata,
            rewardata,
            { from: owner }
          ),
          'f2' // PoolFactory: invalid reward module factory
        );
      });

    });

    describe('when staking module is whitelisted as reward module', function () {

      it('should fail', async function () {
        // encode sub factory arguments
        const stakingdata = web3.eth.abi.encodeParameter('address', this.stakingToken.address);
        const rewardata = web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'uint256', 'uint256'],
          [this.rewardToken.address, bonus(0).toString(), bonus(1.0).toString(), days(30).toString()]
        );

        // whitelist sub factories
        await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(2), { from: org });
        await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

        // attempt to create pool
        await expectRevert(
          this.factory.create(
            this.stakingModuleFactory.address,
            this.rewardModuleFactory.address,
            stakingdata,
            rewardata,
            { from: owner }
          ),
          'f1' // PoolFactory: invalid staking module factory
        );
      });

    });

    describe('when a Pool is created with factory', function () {

      beforeEach('setup', async function () {
        // encode sub factory arguments
        const stakingdata = web3.eth.abi.encodeParameter('address', this.stakingToken.address);
        const rewarddata = web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'uint256', 'uint256'],
          [this.rewardToken.address, bonus(0.5).toString(), bonus(1.0).toString(), days(30).toString()]
        );

        // whitelist sub factories
        await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
        await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

        // create geyser
        this.res = await this.factory.create(
          this.stakingModuleFactory.address,
          this.rewardModuleFactory.address,
          stakingdata,
          rewarddata,
          { from: owner }
        );
        const addr = this.res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
        this.pool = await Pool.at(addr);
      });

      it('should emit PoolCreated event', async function () {
        expectEvent(this.res, 'PoolCreated', { 'user': owner, 'pool': this.pool.address });
      });

      it('should be owned by creator', async function () {
        expect(await this.pool.owner()).to.equal(owner);
      });

      it('should be controlled by creator', async function () {
        expect(await this.pool.controller()).to.equal(owner);
      });

      it('should set the staking tokens properly', async function () {
        const tokens = await this.pool.stakingTokens();
        expect(tokens.length).to.equal(1);
        expect(tokens[0]).to.equal(this.stakingToken.address)
      });

      it('should set the reward tokens properly', async function () {
        const tokens = await this.pool.rewardTokens();
        expect(tokens.length).to.equal(1);
        expect(tokens[0]).to.equal(this.rewardToken.address)
      });

      it('should own the staking module', async function () {
        const module = await ERC20StakingModule.at(await this.pool.stakingModule());
        expect(await module.owner()).to.equal(this.pool.address);
      });

      it('should own the reward module', async function () {
        const module = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());
        expect(await module.owner()).to.equal(this.pool.address);
      });

      it('should transfer control of staking module to creator', async function () {
        const module = await ERC20StakingModule.at(await this.pool.stakingModule());
        expect(await module.controller()).to.equal(owner);
      });

      it('should transfer control of reward module to creator', async function () {
        const module = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());
        expect(await module.controller()).to.equal(owner);
      });

      it('should configure staking module properly', async function () {
        const module = await ERC20StakingModule.at(await this.pool.stakingModule());
        expect((await module.tokens())[0]).to.equal(this.stakingToken.address);
        expect(await module.factory()).to.equal(this.stakingModuleFactory.address);
      });

      it('should configure reward module properly', async function () {
        const module = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());
        expect((await module.tokens())[0]).to.equal(this.rewardToken.address);
        expect(await module.bonusMin()).to.be.bignumber.equal(bonus(0.5));
        expect(await module.bonusMax()).to.be.bignumber.equal(bonus(1.0));
        expect(await module.bonusPeriod()).to.be.bignumber.equal(days(30));
      });

      it('should be present in factory Geyser set', async function () {
        expect(await this.factory.map(this.pool.address)).to.be.true;
      });

      it('should be present in factory Geyser list', async function () {
        expect(await this.factory.list(0)).to.be.equal(this.pool.address);
      });

      it('should increase Geyser count', async function () {
        expect(await this.factory.count()).to.be.bignumber.equal(new BN(1));
      });

      it('report gas', async function () {
        reportGas('PoolFactory', 'create', '', this.res)
      });

    });

    describe('when many Pools are created with factory', function () {

      beforeEach('setup', async function () {
        // encode sub factory arguments
        const stakingdata = web3.eth.abi.encodeParameter('address', this.stakingToken.address);
        const rewarddata = web3.eth.abi.encodeParameters(
          ['address', 'uint256', 'uint256', 'uint256'],
          [this.rewardToken.address, bonus(0.5).toString(), bonus(1.0).toString(), days(30).toString()]
        );

        // whitelist sub factories
        await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
        await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

        // create 16 pools
        this.pools = []
        for (var i = 0; i < 16; i++) {
          const res = await this.factory.create(
            this.stakingModuleFactory.address,
            this.rewardModuleFactory.address,
            stakingdata,
            rewarddata,
            { from: owner }
          );
          const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
          this.pools.push(addr);
        }
      });

      it('should contain all Pools in map', async function () {
        for (const p of this.pools) {
          expect(await this.factory.map(p)).to.be.true;
        }
      });

      it('should contain all Pools in list', async function () {
        for (var i = 0; i < 16; i++) {
          expect(await this.factory.list(new BN(i))).to.be.equal(this.pools[i]);
        }
      });

      it('should increase Pool count', async function () {
        expect(await this.factory.count()).to.be.bignumber.equal(new BN(16));
      });

      it('should be able to iterate over all Pools', async function () {
        const count = (await this.factory.count()).toNumber();
        for (var i = 0; i < count; i++) {
          const p = await this.factory.list(new BN(i));
          expect(p).to.be.equal(this.pools[i]);
        }
      });
    });

  });

});
