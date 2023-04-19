// test module for Pool

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, singletons, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  shares,
  bonus,
  days,
  e18,
  e6,
  toFixedPointBigNumber,
  bytes32,
  reportGas,
  DECIMALS
} = require('../util/helper');

const Pool = artifacts.require('Pool');
const Configuration = artifacts.require('Configuration');
const GeyserToken = artifacts.require('GeyserToken');
const ERC20StakingModule = artifacts.require('ERC20StakingModule');
const AssignmentStakingModule = artifacts.require('AssignmentStakingModule');
const ERC20CompetitiveRewardModule = artifacts.require('ERC20CompetitiveRewardModule');
const ERC20FriendlyRewardModule = artifacts.require('ERC20FriendlyRewardModule');
const ERC20LinearRewardModule = artifacts.require('ERC20LinearRewardModule');
const TestToken = artifacts.require('TestToken');
const TestLiquidityToken = artifacts.require('TestLiquidityToken');
const TestReentrantToken = artifacts.require('TestReentrantToken');
const TestReentrantProxy = artifacts.require('TestReentrantProxy');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);


describe('Pool', function () {
  let org, owner, treasury, other, stakingModuleFactory, rewardModuleFactory, alice, bob, charlie, ctrl;
  before(async function () {
    [org, owner, treasury, other, stakingModuleFactory, rewardModuleFactory, alice, bob, charlie, ctrl] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
    this.rew = await TestToken.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when initialized', function () {
      beforeEach(async function () {
        // staking module
        this.staking = await ERC20StakingModule.new(
          this.stk.address,
          stakingModuleFactory,
          { from: owner }
        );
        // reward module
        this.reward = await ERC20CompetitiveRewardModule.new(
          this.rew.address,
          bonus(0.5),
          bonus(2.0),
          days(90),
          this.config.address,
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.config.address,
          { from: owner }
        );
        await this.staking.transferOwnership(this.pool.address, { from: owner });
        await this.reward.transferOwnership(this.pool.address, { from: owner });
      });
      it('should create a Pool object', async function () {
        expect(this.pool).to.be.an('object');
      });
      it('should return the correct addresses for owner and controller', async function () {
        expect(await this.pool.owner()).to.equal(owner);
        expect(await this.pool.controller()).to.equal(owner);
      });

      it('should return the correct address for staking token', async function () {
        expect((await this.pool.stakingTokens())[0]).to.equal(this.stk.address);
      });

      it('should return the correct address for reward token', async function () {
        expect((await this.pool.rewardTokens())[0]).to.equal(this.rew.address);
      });

      it('should return the correct address for staking module', async function () {
        expect(await this.pool.stakingModule()).to.equal(this.staking.address);
      });

      it('should return the correct address for reward module', async function () {
        expect(await this.pool.rewardModule()).to.equal(this.reward.address);
      });

      it('should have zero staking balances', async function () {
        const balances = await this.pool.stakingBalances(bob);
        expect(balances.length).to.equal(1);
        expect(balances[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero staking totals', async function () {
        const totals = await this.pool.stakingTotals();
        expect(totals.length).to.equal(1);
        expect(totals[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero reward balances', async function () {
        const balances = await this.pool.rewardBalances();
        expect(balances.length).to.equal(1);
        expect(balances[0]).to.be.bignumber.equal(new BN(0));
      });
    })
  });

  describe('ownership', function () {

    beforeEach(async function () {
      // staking module
      this.staking = await ERC20StakingModule.new(
        this.stk.address,
        stakingModuleFactory,
        { from: owner }
      );
      // reward module
      this.reward = await ERC20CompetitiveRewardModule.new(
        this.rew.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        this.config.address,
        rewardModuleFactory,
        { from: owner }
      );
      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.config.address,
        { from: owner }
      );
      await this.staking.transferOwnership(this.pool.address, { from: owner });
      await this.reward.transferOwnership(this.pool.address, { from: owner });
    });

    describe('when owner transfers control', function () {
      beforeEach(async function () {
        this.res = await this.pool.transferControl(ctrl, { from: owner });
      });

      it('should update pool controller to new address', async function () {
        expect(await this.pool.controller()).to.equal(ctrl);
      });

      it('should not change staking module controller', async function () {
        expect(await this.staking.controller()).to.equal(owner);
      });

      it('should not change reward module controller', async function () {
        expect(await this.reward.controller()).to.equal(owner);
      });

      it('should not change pool owner', async function () {
        expect(await this.pool.owner()).to.equal(owner);
      });

      it('should not change staking module owner', async function () {
        expect(await this.staking.owner()).to.equal(this.pool.address);
      });

      it('should not change reward module owner', async function () {
        expect(await this.reward.owner()).to.equal(this.pool.address);
      });

    });

    describe('when owner transfers control of staking module', function () {
      beforeEach(async function () {
        this.res = await this.pool.transferControlStakingModule(ctrl, { from: owner });
      });

      it('should not change pool controller', async function () {
        expect(await this.pool.controller()).to.equal(owner);
      });

      it('should update staking module controller to new address', async function () {
        expect(await this.staking.controller()).to.equal(ctrl);
      });

      it('should not change reward module controller', async function () {
        expect(await this.reward.controller()).to.equal(owner);
      });

      it('should not change pool owner', async function () {
        expect(await this.pool.owner()).to.equal(owner);
      });

      it('should not change staking module owner', async function () {
        expect(await this.staking.owner()).to.equal(this.pool.address);
      });

      it('should not change reward module owner', async function () {
        expect(await this.reward.owner()).to.equal(this.pool.address);
      });

    });

    describe('when owner transfers control of reward module', function () {
      beforeEach(async function () {
        this.res = await this.pool.transferControlRewardModule(ctrl, { from: owner });
      });

      it('should not change pool controller', async function () {
        expect(await this.pool.controller()).to.equal(owner);
      });

      it('should not change staking module controller', async function () {
        expect(await this.staking.controller()).to.equal(owner);
      });

      it('should update reward module controller to new address', async function () {
        expect(await this.reward.controller()).to.equal(ctrl);
      });

      it('should not change pool owner', async function () {
        expect(await this.pool.owner()).to.equal(owner);
      });

      it('should not change staking module owner', async function () {
        expect(await this.staking.owner()).to.equal(this.pool.address);
      });

      it('should not change reward module owner', async function () {
        expect(await this.reward.owner()).to.equal(this.pool.address);
      });

    });

    describe('when owner transfers ownership', function () {
      beforeEach(async function () {
        this.res = await this.pool.transferOwnership(other, { from: owner });
      });

      it('should update pool owner to new address', async function () {
        expect(await this.pool.owner()).to.equal(other);
      });

      it('should not change staking module owner', async function () {
        expect(await this.staking.owner()).to.equal(this.pool.address);
      });

      it('should not change reward module owner', async function () {
        expect(await this.reward.owner()).to.equal(this.pool.address);
      });

      it('should not change pool controller', async function () {
        expect(await this.pool.controller()).to.equal(owner);
      });

      it('should not change staking module controller', async function () {
        expect(await this.staking.controller()).to.equal(owner);
      });

      it('should update reward module controller', async function () {
        expect(await this.reward.controller()).to.equal(owner);
      });

    });

    describe('when non-owner tries to transfer control', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.transferControl(bob, { from: alice }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when non-owner tries to transfer control of staking module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.transferControlStakingModule(bob, { from: alice }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when non-owner tries to transfer control of reward module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.transferControlRewardModule(bob, { from: alice }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when owner (non-controller) tries to call withdraw', function () {
      it('should fail', async function () {
        this.res = await this.pool.transferControl(ctrl, { from: owner });
        await expectRevert(
          this.pool.withdraw(tokens(10), { from: owner }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when owner (non-controller) tries to call clean', function () {
      it('should fail', async function () {
        this.res = await this.pool.transferControl(ctrl, { from: owner });
        await expectRevert(
          this.pool.clean([], [], { from: owner }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when controller (non-owner) tries to transfer ownership', function () {
      it('should fail', async function () {
        this.res = await this.pool.transferControl(ctrl, { from: owner });
        await expectRevert(
          this.pool.transferOwnership(other, { from: ctrl }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });
  });


  describe('withdraw', function () {

    describe('when GYSR is spent during unstake', function () {

      beforeEach(async function () {
        // configure fee
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
          treasury,
          e18(0.20),
          { from: org }
        );
        // staking module
        this.staking = await ERC20StakingModule.new(
          this.stk.address,
          stakingModuleFactory,
          { from: owner }
        );
        // reward module
        this.reward = await ERC20CompetitiveRewardModule.new(
          this.rew.address,
          bonus(0.5),
          bonus(2.0),
          days(90),
          this.config.address,
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.config.address,
          { from: owner }
        );
        await this.staking.transferOwnership(this.pool.address, { from: owner });
        await this.reward.transferOwnership(this.pool.address, { from: owner });

        // owner funds pool
        await this.rew.transfer(owner, tokens(10000), { from: org });
        await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
        await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });

        // alice stakes 100 tokens
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(10000), { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: alice });

        // alice acquires GYSR
        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.approve(this.pool.address, tokens(10000), { from: alice });

        // time elapsed
        await time.increase(days(30));
      });

      describe('when GYSR balance is zero', function () {
        it('should fail', async function () {
          await expectRevert(
            this.pool.withdraw(tokens(10), { from: owner }),
            'p2' // Pool: withdraw amount exceeds vested balance
          );
        });
      });

      describe('when withdraw amount is zero', function () {
        it('should fail', async function () {
          await expectRevert(
            this.pool.withdraw(tokens(0), { from: owner }),
            'p1' //Pool: withdraw amount is zero
          );
        });
      });

      describe('when amount is greater than GYSR balance', function () {
        it('should fail', async function () {
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          await this.pool.unstake(tokens(100), [], data, { from: alice });
          // only 8 GYSR available for withdraw after fee
          await expectRevert(
            this.pool.withdraw(tokens(9), { from: owner }),
            'p2' // Pool: withdraw amount exceeds vested balance
          );
        });
      });

      describe('when sender is not controller', function () {
        it('should fail', async function () {
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          await this.pool.unstake(tokens(100), [], data, { from: alice });
          await expectRevert(
            this.pool.withdraw(tokens(8), { from: alice }),
            'oc2' // OwnerController: caller is not the controller
          );
        });
      });

      describe('when user unstakes with GYSR', function () {

        beforeEach(async function () {
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          this.res = await this.pool.unstake(tokens(100), [], data, { from: alice });
        });

        it('should decrease GYSR token balance for user', async function () {
          expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        });

        it('should not affect GYSR token balance for owner', async function () {
          expect(await this.gysr.balanceOf(owner)).to.be.bignumber.equal(tokens(0));
        });

        it('should increase GYSR token balance for Pool contract minus fee amount', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(8));
        });

        it('should increase vested GYSR balance', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(8));
        });

        it('should transfer GYSR fee to treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(2));
        });

        it('should emit Fee event', async function () {
          expectEvent(this.res, 'Fee', { receiver: treasury, token: this.gysr.address, amount: tokens(2) });
        });

      });

      describe('when user unstakes with GYSR and fee is zero', function () {

        beforeEach(async function () {
          // zero out fee
          await this.config.setAddressUint96(
            web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
            treasury,
            new BN(0),
            { from: org }
          );
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          this.res = await this.pool.unstake(tokens(100), [], data, { from: alice });
        });

        it('should decrease GYSR token balance for user', async function () {
          expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        });

        it('should increase GYSR token balance for Pool contract by full amount', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(10));
        });

        it('should increase vested GYSR balance by full amount', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(10));
        });

        it('should not transfer GYSR fee to treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0));
        });

        it('should not emit Fee event', async function () {
          expect(this.res.logs.filter(l => l.event === 'Fee').length).to.be.equal(0);
        });
      });

      describe('when user unstakes with GYSR and fee is invalid', function () {

        beforeEach(async function () {
          // set invalid fee
          await this.config.setAddressUint96(
            web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
            treasury,
            e18(1.05),
            { from: org }
          );
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          this.res = await this.pool.unstake(tokens(100), [], data, { from: alice });
        });

        it('should decrease GYSR token balance for user', async function () {
          expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        });

        it('should increase GYSR token balance for Pool contract by full amount', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(10));
        });

        it('should increase vested GYSR balance by full amount', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(10));
        });

        it('should not transfer GYSR fee to treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0));
        });

        it('should not emit Fee event', async function () {
          expect(this.res.logs.filter(l => l.event === 'Fee').length).to.be.equal(0);
        });
      });

      describe('when user unstakes with GYSR and receiver is zero', function () {

        beforeEach(async function () {
          // set invalid fee receiver
          await this.config.setAddressUint96(
            web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
            constants.ZERO_ADDRESS,
            e18(0.20),
            { from: org }
          );
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          this.res = await this.pool.unstake(tokens(100), [], data, { from: alice });
        });

        it('should decrease GYSR token balance for user', async function () {
          expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        });

        it('should increase GYSR token balance for Pool contract by full amount', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(10));
        });

        it('should increase vested GYSR balance by full amount', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(10));
        });

        it('should not transfer GYSR fee to treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0));
        });
      });

      describe('when withdraw is successful', function () {

        beforeEach(async function () {
          // alice spends 10 GYSR on unstaking operation
          const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
          await this.pool.unstake(tokens(100), [], data, { from: alice });
          // 8 GYSR available for withdraw after treasury fee
          this.res = await this.pool.withdraw(tokens(8), { from: owner });
        });

        it('should increase GYSR token balance for owner', async function () {
          expect(await this.gysr.balanceOf(owner)).to.be.bignumber.equal(tokens(8));
        });

        it('should decrease GYSR token balance for Pool contract', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0));
        });

        it('should decrease vested GYSR balance', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0));
        });

        it('should leave GYSR fee in treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(2));
        });

        it('should emit GYSR withdrawn event', async function () {
          expectEvent(this.res, 'GysrWithdrawn', { amount: tokens(8) });
        });

        it('report gas', async function () {
          reportGas('Pool', 'withdraw', '', this.res)
        });
      });
    });


    describe('when GYSR is spent during stake', function () {

      beforeEach(async function () {
        // configure fee at 42%
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
          treasury,
          e18(0.42),
          { from: org }
        );
        // staking module
        this.staking = await ERC20StakingModule.new(
          this.stk.address,
          stakingModuleFactory,
          { from: owner }
        );
        // reward module
        this.reward = await ERC20FriendlyRewardModule.new(
          this.rew.address,
          bonus(0.0),
          days(60),
          this.config.address,
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.config.address,
          { from: owner }
        );
        await this.staking.transferOwnership(this.pool.address, { from: owner });
        await this.reward.transferOwnership(this.pool.address, { from: owner });

        // owner funds pool
        await this.rew.transfer(owner, tokens(10000), { from: org });
        await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
        await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });

        // alice acquires staking tokens and GYSR token
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(10000), { from: alice });
        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.approve(this.pool.address, tokens(10000), { from: alice });

        // alice stakes 100 tokens w/ 10 GYSR
        const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
        this.res = await this.pool.stake(tokens(100), [], data, { from: alice });

        // time elapsed
        await time.increase(days(30));
      });

      describe('when user has staked with GYSR', function () {

        it('should decrease GYSR token balance for user', async function () {
          expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        });

        it('should increase GYSR token balance for Pool contract', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(10));
        });

        it('should still have zero vested GYSR balance', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(new BN(0));
        });

        it('should not send GYSR fee to treasury yet', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(new BN(0));
        });

        it('should emit GysrSpent event', async function () {
          expectEvent(this.res, 'GysrSpent', { amount: tokens(10) });
        });

      });

      describe('when withdraw amount is zero', function () {
        it('should fail', async function () {
          await expectRevert(
            this.pool.withdraw(tokens(0), { from: owner }),
            'p1' //Pool: withdraw amount is zero
          );
        });
      });

      describe('when GYSR balance has not vested', function () {
        it('should fail', async function () {
          await expectRevert(
            this.pool.withdraw(tokens(8), { from: owner }),
            'p2' // Pool: withdraw amount exceeds vested balance
          );
        });
      });

      describe('when amount is greater than GYSR balance', function () {
        it('should fail', async function () {
          await this.pool.unstake(tokens(100), [], [], { from: alice });
          // only 8 GYSR available for withdraw after fee
          await expectRevert(
            this.pool.withdraw(tokens(9), { from: owner }),
            'p2' // Pool: withdraw amount exceeds vested balance
          );
        });
      });

      describe('when sender is not controller', function () {
        it('should fail', async function () {
          await this.pool.unstake(tokens(100), [], [], { from: alice });
          await expectRevert(
            this.pool.withdraw(tokens(8), { from: alice }),
            'oc2' // OwnerController: caller is not the controller
          );
        });
      });

      describe('when user has unstaked and GYSR is vested', function () {

        beforeEach(async function () {
          // 10 GYSR vested from unstaking operation
          this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
        });

        it('should not affect GYSR token balance for owner', async function () {
          expect(await this.gysr.balanceOf(owner)).to.be.bignumber.equal(tokens(0));
        });

        it('should decrease GYSR token balance for Pool contract by fee amount', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(5.8));
        });

        it('should increase vested GYSR balance', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(5.8));
        });

        it('should transfer GYSR fee to treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(4.2));
        });

        it('should emit Fee event', async function () {
          expectEvent(this.res, 'Fee', { receiver: treasury, token: this.gysr.address, amount: tokens(4.2) });
        });

      });

      describe('when withdraw is successful', function () {

        beforeEach(async function () {
          // 10 GYSR vested from unstaking operation
          await this.pool.unstake(tokens(100), [], [], { from: alice });
          // 8 GYSR available for withdraw after treasury fee
          this.res = await this.pool.withdraw(tokens(5.8), { from: owner });
        });

        it('should increase GYSR token balance for owner', async function () {
          expect(await this.gysr.balanceOf(owner)).to.be.bignumber.equal(tokens(5.8));
        });

        it('should decrease GYSR token balance for Pool contract', async function () {
          expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0));
        });

        it('should decrease vested GYSR balance', async function () {
          expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0));
        });

        it('should leave GYSR fee in treasury', async function () {
          expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(4.2));
        });

        it('should emit GYSR withdrawn event', async function () {
          expectEvent(this.res, 'GysrWithdrawn', { amount: tokens(5.8) });
        });

      });
    });

  });


  describe('reentrancy', function () {

    beforeEach('setup', async function () {
      // base setup
      this.registry = await singletons.ERC1820Registry(org);
      this.stk = await TestReentrantToken.new({ from: org });

      // alice registers ERC777 pre-transfer hooks
      const senderHash = await this.registry.interfaceHash('ERC777TokensSender');
      const recipientHash = await this.registry.interfaceHash('ERC777TokensRecipient');
      this.proxy = await TestReentrantProxy.new({ from: alice });
      await this.proxy.register(senderHash, this.proxy.address, this.registry.address);

      // staking module with reentrant token
      this.staking = await ERC20StakingModule.new(
        this.stk.address,
        stakingModuleFactory,
        { from: owner }
      );
      // reward module
      this.reward = await ERC20CompetitiveRewardModule.new(
        this.rew.address,
        bonus(0.0),
        bonus(0.0),
        days(0),
        this.config.address,
        rewardModuleFactory,
        { from: owner }
      );
      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.config.address,
        { from: owner }
      );
      await this.staking.transferOwnership(this.pool.address, { from: owner });
      await this.reward.transferOwnership(this.pool.address, { from: owner });

      // owner funds pool
      await this.rew.transfer(owner, tokens(10000), { from: org });
      await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
      await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(400), { from: owner });

      // acquire staking tokens and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.proxy.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
    });

    describe('stake', function () {

      describe('when sender makes a reentrant call to stake', function () {

        beforeEach(async function () {
          await this.pool.stake(tokens(100), [], [], { from: bob });

          // target pool with stake 50 -> stake 50 reentrancy attack
          await this.proxy.target(this.pool.address, tokens(50), new BN(1));
          await this.proxy.deposit(this.stk.address, tokens(1000), { from: alice });
        });

        it('should guard function and revert', async function () {
          await expectRevert(
            this.proxy.stake(tokens(50), { from: alice }),
            'ReentrancyGuard: reentrant call'
          );
        });
      });

      describe('when sender makes a reentrant call to unstake', function () {

        beforeEach(async function () {
          await this.pool.stake(tokens(100), [], [], { from: bob });

          await this.proxy.target(this.pool.address, tokens(0), new BN(0));
          await this.proxy.deposit(this.stk.address, tokens(1000), { from: alice });
          this.res = await this.proxy.stake(tokens(100), { from: alice });

          await time.increase(days(30));

          // target pool with stake 50 -> unstake 50 reentrancy attack
          await this.proxy.target(this.pool.address, tokens(50), new BN(2));
        });

        it('should guard function and revert', async function () {
          await expectRevert(
            this.proxy.stake(tokens(50), { from: alice }),
            'ReentrancyGuard: reentrant call'
          );
        });
      });

      describe('when sender makes a reentrant call to update', function () {

        beforeEach(async function () {
          await this.pool.stake(tokens(100), [], [], { from: bob });

          // target pool with stake 100 -> update reentrancy attack
          await this.proxy.target(this.pool.address, tokens(0), new BN(3));
          await this.proxy.deposit(this.stk.address, tokens(1000), { from: alice });
        });

        it('should guard function and revert', async function () {
          await expectRevert(
            this.proxy.stake(tokens(100), { from: alice }),
            'ReentrancyGuard: reentrant call'
          );
        });
      });

    });
  });


  describe('multicall', function () {

    describe('assignment', function () {

      beforeEach(async function () {
        // staking module
        this.staking = await AssignmentStakingModule.new(
          stakingModuleFactory,
          { from: owner }
        );
        // reward module
        this.reward = await ERC20LinearRewardModule.new(
          this.rew.address,
          days(14),
          e18(1),
          this.config.address,
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.config.address,
          { from: owner }
        );
        await this.staking.transferOwnership(this.pool.address, { from: owner });
        await this.reward.transferOwnership(this.pool.address, { from: owner });

        // owner funds pool
        await this.rew.transfer(owner, tokens(10000), { from: org });
        await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
        await this.reward.fund(tokens(1000), { from: owner });
      });

      describe('when sender is not controller', function () {
        it('should fail', async function () {
          const data = [
            this.pool.contract.methods.stake(new BN(50), web3.eth.abi.encodeParameter('address', alice), []).encodeABI()
          ]
          await expectRevert(
            this.pool.multicall(data, { from: alice }),
            'asm2' // AssignmentStakingModule: caller is not the controller
          );
        });
      });

      describe('when controller assigns two rates in a single transaction', function () {

        beforeEach(async function () {
          // encode each operation
          const data = [
            this.pool.contract.methods.stake(new BN(50), web3.eth.abi.encodeParameter('address', alice), []).encodeABI(),
            this.pool.contract.methods.stake(new BN(25), web3.eth.abi.encodeParameter('address', bob), []).encodeABI()
          ]
          // do multicall
          this.res = await this.pool.multicall(data, { from: owner });
        });

        it('should update staking balance for first user', async function () {
          expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(50));
        });

        it('should update staking balance for second user', async function () {
          expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(25));
        });

        it('should set rate for first user', async function () {
          expect(await this.staking.rates(alice)).to.be.bignumber.equal(new BN(50));
        });

        it('should set rate for second user', async function () {
          expect(await this.staking.rates(bob)).to.be.bignumber.equal(new BN(25));
        });

        it('should increase total rate', async function () {
          expect(await this.staking.totalRate()).to.be.bignumber.equal(new BN(75));
        });

        it('should emit first Staked event', async function () {
          expectEvent(
            this.res,
            'Staked',
            { account: bytes32(alice), user: owner, token: constants.ZERO_ADDRESS, amount: new BN(50), shares: e6(50) }
          );
        });

        it('should emit second Staked event', async function () {
          expectEvent(
            this.res,
            'Staked',
            { account: bytes32(bob), user: owner, token: constants.ZERO_ADDRESS, amount: new BN(25), shares: e6(25) }
          );
        });
      });

      describe('when controller updates multiple rates in a single transaction', function () {

        beforeEach(async function () {
          // setup initial rates
          await this.pool.stake(new BN(100), web3.eth.abi.encodeParameter('address', alice), [], { from: owner });
          await this.pool.stake(new BN(50), web3.eth.abi.encodeParameter('address', bob), [], { from: owner });
          await this.pool.stake(new BN(75), web3.eth.abi.encodeParameter('address', charlie), [], { from: owner });

          // encode each update operation
          const data = [
            this.pool.contract.methods.stake(new BN(25), web3.eth.abi.encodeParameter('address', alice), []).encodeABI(), // increase
            this.pool.contract.methods.unstake(new BN(50), web3.eth.abi.encodeParameter('address', bob), []).encodeABI(),  // remove
            this.pool.contract.methods.unstake(new BN(10), web3.eth.abi.encodeParameter('address', charlie), []).encodeABI() // decrease
          ]
          // do multicall
          this.res = await this.pool.multicall(data, { from: owner });
        });

        it('should increase staking balance for first user', async function () {
          expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(125));
        });

        it('should remove stake for second user', async function () {
          expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease staking balance for third user', async function () {
          expect((await this.pool.stakingBalances(charlie))[0]).to.be.bignumber.equal(new BN(65));
        });

        it('should increase rate for first user', async function () {
          expect(await this.staking.rates(alice)).to.be.bignumber.equal(new BN(125));
        });

        it('should zero rate for second user', async function () {
          expect(await this.staking.rates(bob)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease rate for third user', async function () {
          expect(await this.staking.rates(charlie)).to.be.bignumber.equal(new BN(65));
        });

        it('should update total rate', async function () {
          expect(await this.staking.totalRate()).to.be.bignumber.equal(new BN(190));
        });

        it('should emit Staked event for first user', async function () {
          expectEvent(
            this.res,
            'Staked',
            { account: bytes32(alice), user: owner, token: constants.ZERO_ADDRESS, amount: new BN(25), shares: e6(25) }
          );
        });

        it('should emit Unstaked event for second user', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { account: bytes32(bob), user: owner, token: constants.ZERO_ADDRESS, amount: new BN(50), shares: e6(50) }
          );
        });

        it('should emit Unstaked event for third user', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { account: bytes32(charlie), user: owner, token: constants.ZERO_ADDRESS, amount: new BN(10), shares: e6(10) }
          );
        });
      });

    });

    describe('staking', function () {

      beforeEach(async function () {
        // configure fee at 15%
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
          treasury,
          e18(0.15),
          { from: org }
        );
        // staking module
        this.staking = await ERC20StakingModule.new(
          this.stk.address,
          stakingModuleFactory,
          { from: owner }
        );
        // reward module
        this.reward = await ERC20FriendlyRewardModule.new(
          this.rew.address,
          bonus(0.0),
          days(60),
          this.config.address,
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.config.address,
          { from: owner }
        );
        await this.staking.transferOwnership(this.pool.address, { from: owner });
        await this.reward.transferOwnership(this.pool.address, { from: owner });

        // owner funds pool
        await this.rew.transfer(owner, tokens(10000), { from: org });
        await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
        await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });

        // alice acquires staking tokens and GYSR token
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(10000), { from: alice });
        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.approve(this.pool.address, tokens(10000), { from: alice });

        // alice stakes w/ gysr
        const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
        await this.pool.stake(tokens(100), [], data, { from: alice });

        // time elapsed
        await time.increase(days(30));
      });

      describe('when sender has insufficient balance', function () {
        it('should fail', async function () {
          const data = [
            this.pool.contract.methods.unstake(new BN(50), [], []).encodeABI()
          ]
          await expectRevert(
            this.pool.multicall(data, { from: bob }),
            'sm6' // ERC20StakingModule: insufficient user balance
          );
        });
      });

      describe('when user does multiple unstakes in a single transaction', function () {

        beforeEach(async function () {
          // encode each operation
          const data = [
            this.pool.contract.methods.unstake(tokens(30), [], []).encodeABI(),
            this.pool.contract.methods.unstake(tokens(70), [], []).encodeABI()
          ]
          // do multicall
          this.res = await this.pool.multicall(data, { from: alice });
        });

        it('should zero user staking balance', async function () {
          expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
        });

        it('should zero staking total', async function () {
          expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(0));
        });

        it('should zero token balance of staking module', async function () {
          expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(0));
        });

        it('should emit first Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.stk.address, amount: tokens(30), shares: shares(30) }
          );
        });

        it('should emit second Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.stk.address, amount: tokens(70), shares: shares(70) }
          );
        });

        it('should emit first GysrVested event', async function () {
          expectEvent(
            this.res,
            'GysrVested',
            { user: alice, amount: tokens(3) }
          );
        });

        it('should emit second GysrVested event', async function () {
          expectEvent(
            this.res,
            'GysrVested',
            { user: alice, amount: tokens(7) }
          );
        });
      });

    });
  });
});
