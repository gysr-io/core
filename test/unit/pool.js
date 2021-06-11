// test module for Pool

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, singletons } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  toFixedPointBigNumber,
  reportGas,
  DECIMALS
} = require('../util/helper');

const Pool = contract.fromArtifact('Pool');
const PoolFactory = contract.fromArtifact('PoolFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const ERC20FriendlyRewardModule = contract.fromArtifact('ERC20FriendlyRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');
const TestReentrantToken = contract.fromArtifact('TestReentrantToken');
const TestReentrantProxy = contract.fromArtifact('TestReentrantProxy');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);


describe('Pool', function () {
  const [owner, org, treasury, stakingModuleFactory, rewardModuleFactory, alice, bob, ctrl, other] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
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
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.factory.address,
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
        rewardModuleFactory,
        { from: owner }
      );
      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.factory.address,
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

      it('should update staking module controller to new address', async function () {
        expect(await this.staking.controller()).to.equal(ctrl);
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
          this.pool.clean({ from: owner }),
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
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.factory.address,
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
          rewardModuleFactory,
          { from: owner }
        );
        // create pool
        this.pool = await Pool.new(
          this.staking.address,
          this.reward.address,
          this.gysr.address,
          this.factory.address,
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

        it('should emit GYSRSpent event', async function () {
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

      describe('when withdraw is successful', function () {

        beforeEach(async function () {
          // 10 GYSR vested from unstaking operation
          await this.pool.unstake(tokens(100), [], [], { from: alice });
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
        rewardModuleFactory,
        { from: owner }
      );
      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.factory.address,
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
});
