// integrations tests for "Fountain" Pool
// made up of ERC20StakingModule and ERC20FriendlyRewardModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants, singletons } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  reportGas,
  DECIMALS
} = require('../util/helper');

const Pool = contract.fromArtifact('Pool');
const PoolFactory = contract.fromArtifact('PoolFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const ERC20StakingModuleFactory = contract.fromArtifact('ERC20StakingModuleFactory');
const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20FriendlyRewardModuleFactory = contract.fromArtifact('ERC20FriendlyRewardModuleFactory');
const ERC20FriendlyRewardModule = contract.fromArtifact('ERC20FriendlyRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('Fountain integration', function () {
  const [owner, org, treasury, alice, bob, other] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20FriendlyRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.0).toString(), days(80).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20FriendlyRewardModule.at(await this.pool.rewardModule());

    // owner funds pool
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(200), { from: owner });
    this.t0 = await this.reward.lastUpdated()
  });

  describe('stake', function () {

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await expectRevert(
          this.pool.stake(tokens(1), [], [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token transfer allowance is insufficient', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(101), [], [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token balance is insufficient', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(1001), [], [], { from: alice }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(0), [], [], { from: alice }),
          'sm1' // ERC20StakingModule: stake amount is zero
        );
      });
    });

    describe('when the stake is successful', function () {
      beforeEach('alice stakes', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        this.res = await this.pool.stake(tokens(100), [], [], { from: alice });
      });

      it('should decrease staking token balance of user', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(100));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should update staking balances for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should record that 0 GYSR was spent', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(0))
      })

      it('should emit Staked event', async function () {
        expectEvent(
          this.res,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'stake', 'fountain', this.res)
      });
    });


    describe('when two users have staked', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.transfer(bob, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(600));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should record that 0 GYSR was spent', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(0))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(0))
      })

      it('should not change the pool\'s GYSR balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      })

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: tokens(500), shares: shares(500) }
        );
      });
    });

    describe('when GYSR is spent by two users during stake', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.transfer(bob, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.transfer(bob, tokens(10), { from: org });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
        this.res0 = await this.pool.stake(tokens(100), [], data, { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], data, { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(600));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: tokens(500), shares: shares(500) }
        );
      });

      it('should record that 1 GYSR was spent each', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(1))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(1))
      })

      it('should decrease each users GYSR balance', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9));
        expect(await this.gysr.balanceOf(bob)).to.be.bignumber.equal(tokens(9));
      })

      it('should not change the pool\'s GYSR balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      })

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
        expectEvent(
          this.res1,
          'GysrSpent',
          { user: bob, amount: tokens(1) }
        );
      })
    });

    describe('when GYSR is spent by one user during stake', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.transfer(bob, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.transfer(bob, tokens(10), { from: org });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
        this.res0 = await this.pool.stake(tokens(100), [], data, { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(600));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should record that the correct amount of GYSR was spent', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(1))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(0))
      })

      it('should not change the pool\'s GYSR balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      })

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: tokens(500), shares: shares(500) }
        );
      });

      it('should decrease one users GYSR balance', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9));
        expect(await this.gysr.balanceOf(bob)).to.be.bignumber.equal(tokens(10));
      })

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      })
    });
  });


  describe('unstake', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
      await this.gysr.transfer(alice, tokens(10), { from: org });
      await this.gysr.transfer(bob, tokens(10), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

      this.t0 = await this.reward.lastUpdated();

      const gysr = 0.01 // reduced because of proportion to total staked
      const r = 0.01 // ratio is 0
      const x = 1 + gysr / r
      this.mult = 1 + Math.log10(x) // 1.3010299956639813

      // alice stakes 100 tokens at 10 days with a 1.3x multiplier
      await time.increaseTo(this.t0.add(days(10)));
      const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
      await this.pool.stake(tokens(100), [], data, { from: alice });
      this.t1 = await this.reward.lastUpdated();

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.pool.stake(tokens(100), [], [], { from: bob });

      // alice stakes another 100 tokens at 80 days
      await time.increaseTo(this.t0.add(days(80)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance last 20 days
      await time.increaseTo(this.t0.add(days(100)));
    });

    describe('when unstake amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.unstake(tokens(0), [], [], { from: alice }),
          'sm3' // ERC20StakingModule: unstake amount is zero
        );
      });
    });

    describe('when unstake amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.unstake(tokens(300), [], [], { from: alice }),
          'sm6' // ERC20StakingModule: unstake amount exceeds balance
        );
      });
    });

    describe('when one user unstakes all shares', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 // 1/5th of time elapsed

        // DAYS 40 - 80
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult) / (100 * this.mult + 100)
        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRewardUnpenalized = 1000 / 5 * 100 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty
        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRewardUnpenalized += 1000 / 10 * 100 / (100 * this.mult + 200)

        this.res = await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(this.bobRewardUnpenalized + this.aliceRedistributed), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'unstake', 'fountain', this.res)
      });
    });

    describe('when one user unstakes some shares', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        this.aliceRewardUntouched = 1000 / 5 * .5

        // DAYS 40 - 80
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100)
        this.aliceRewardUntouched += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100)
        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRewardUnpenalized = 1000 / 5 * 100 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardUntouched += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200)
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty
        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRewardUnpenalized += 1000 / 10 * 100 / (100 * this.mult + 200)

        this.res = await this.pool.unstake(tokens(150), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(this.bobRewardUnpenalized + this.aliceRedistributed + this.aliceRewardUntouched), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.reward.stakes(alice, 0);
        expect(stake.timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceRedistributed), SHARE_DELTA);
      })
    });

    describe('when one user unstakes multiple times', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.rewardsPerStakedShare1 = 200 / (100 * this.mult)
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        // DAYS 40 - 80
        this.rewardsPerStakedShare2 = this.rewardsPerStakedShare1 + 200 / (100 * this.mult + 100)
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100) // 1/5th of time elapsed

        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRewardUnpenalized = 1000 / 5 * 100 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.rewardsPerStakedShare3 = this.rewardsPerStakedShare2 + 100 / (100 * this.mult + 200)
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty

        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRewardUnpenalized += 1000 / 10 * 100 / (100 * this.mult + 200)

        this.aliceFirstReward = this.aliceRewardTotal

        // Alice unstakes 150
        this.rewardsPerStakedShare4 = this.rewardsPerStakedShare3 + this.aliceRedistributed / (50 * this.mult + 100)

        this.aliceSecondReward = this.rewardsPerStakedShare4 * 50 * this.mult
        this.bobRewardUnpenalized += this.rewardsPerStakedShare4 * 100

        this.aliceRewardTotal += this.aliceSecondReward
        // do first unstake
        this.res0 = await this.pool.unstake(tokens(150), [], [], { from: alice });

        // do second unstake
        this.res1 = await this.pool.unstake(tokens(50), [], [], { from: alice });
      });

      it('should have the correct rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(this.rewardsPerStakedShare4), SHARE_DELTA)
      })

      it('should return remaining staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(50), shares: shares(50) }
        );
      });

      it('first unstake should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceFirstReward), TOKEN_DELTA);
      });

      it('second unstake should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceSecondReward), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res0,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
        expectEvent(
          this.res1,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });
    });

    describe('when alice unstakes first', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.rewardsPerStakedShare1 = 200 / (100 * this.mult)
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        // DAYS 40 - 80
        this.rewardsPerStakedShare2 = this.rewardsPerStakedShare1 + 200 / (100 * this.mult + 100)
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100) // 1/5th of time elapsed

        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested

        // DAYS 80 - 100
        this.rewardsPerStakedShare3 = this.rewardsPerStakedShare2 + 100 / (100 * this.mult + 200)
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty

        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested

        // Alice unstakes 150
        this.rewardsPerStakedShare4 = this.rewardsPerStakedShare3 + this.aliceRedistributed / (50 * this.mult + 100)

        this.bobRewardTotal += this.aliceRedistributed * 100 / (50 * this.mult + 100) * .75
        this.bobRedistributed = this.bobRewardTotal / 3

        // do first unstake
        this.res0 = await this.pool.unstake(tokens(150), [], [], { from: alice });

        // do second unstake
        this.res1 = await this.pool.unstake(tokens(100), [], [], { from: bob });
      });

      it('should have the correct rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(this.rewardsPerStakedShare4), SHARE_DELTA)
      })

      it('should return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should update the total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal - this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
        expectEvent(
          this.res1,
          'Unstaked',
          { user: bob, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('first unstake should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('second unstake should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.bobRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.bobRewardTotal), SHARE_DELTA);
      });

      it('should have no remaining stakes for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.bobRedistributed), SHARE_DELTA);
      })

      it('should vest half of GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.4));
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res0,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });
    });

    describe('when bob unstakes first', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.rewardsPerStakedShare1 = 200 / (100 * this.mult)
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        // DAYS 40 - 80
        this.rewardsPerStakedShare2 = this.rewardsPerStakedShare1 + 200 / (100 * this.mult + 100)
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100) // 1/5th of time elapsed

        this.bobRewardTotal = 1000 / 5 * 75 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRedistributed = 1000 / 5 * 75 * .25 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.rewardsPerStakedShare3 = this.rewardsPerStakedShare2 + 100 / (100 * this.mult + 200)
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200)

        this.bobRewardTotal += 1000 / 10 * (75 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRedistributed += 1000 / 10 * (75 * .25) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty

        this.rewardsPerStakedShare4 = this.rewardsPerStakedShare3 + this.bobRedistributed / (100 * this.mult + 125)

        this.aliceRewardTotal += this.bobRedistributed * 100 * .25 / (100 * this.mult + 125)
        this.aliceRewardTotal += this.bobRedistributed * 50 * this.mult / (100 * this.mult + 125)
        this.aliceRedistributed += this.bobRedistributed * 100 * .75 / (100 * this.mult + 125)


        // do first unstake
        this.res0 = await this.pool.unstake(tokens(75), [], [], { from: bob });

        // do second unstake
        this.res1 = await this.pool.unstake(tokens(150), [], [], { from: alice });
      });

      it('should have the correct rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(this.rewardsPerStakedShare4), SHARE_DELTA)
      })

      it('should return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(975));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for first user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(25));
      });

      it('should update the total staked for second user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal - this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: bob, token: this.stk.address, amount: tokens(75), shares: shares(75) }
        );
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('first unstake should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.bobRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.bobRewardTotal), SHARE_DELTA);
      });

      it('second unstake should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('should have one remaining stake for first user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should have one remaining stake for second user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceRedistributed), SHARE_DELTA);
      })

      it('should vest half GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.4));
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res1,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });

    });


    describe('when fee is lowered', function () {
      beforeEach(async function () {
        // update fee
        await this.factory.setFee(bonus(0.1), { from: org });

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should transfer higher portion of GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.9));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.9));
      });

      it('should transfer lowered GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.1));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });

    describe('when fee is set to zero', function () {
      beforeEach(async function () {
        // update fee
        await this.factory.setFee(bonus(0.0), { from: org });

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should transfer all GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(1.0));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(1.0));
      });

      it('should not transfer any GYSR to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.0));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });

    describe('when treasury address is changed', function () {
      beforeEach(async function () {
        // update treasury
        await this.factory.setTreasury(other, { from: org });

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should transfer GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.8));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should not transfer any GYSR to original treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.0));
      });

      it('should transfer GYSR fee to new treasury address', async function () {
        expect(await this.gysr.balanceOf(other)).to.be.bignumber.equal(tokens(0.2));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });
  });

  describe('claim', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
      await this.gysr.transfer(alice, tokens(10), { from: org });
      await this.gysr.transfer(bob, tokens(10), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

      this.t0 = await this.reward.lastUpdated();

      const gysr = 0.01 // reduced because of proportion to total staked
      const r = 0.01 // ratio is 0
      const x = 1 + gysr / r
      this.mult = 1 + Math.log10(x) // 1.3010299956639813

      // alice stakes 100 tokens at 10 days with a 1.3x multiplier
      await time.increaseTo(this.t0.add(days(10)));
      const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
      await this.pool.stake(tokens(100), [], data, { from: alice });
      this.t1 = await this.reward.lastUpdated();

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.pool.stake(tokens(100), [], [], { from: bob });

      // alice stakes another 100 tokens at 80 days
      await time.increaseTo(this.t0.add(days(80)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance last 20 days
      await time.increaseTo(this.t0.add(days(100)));
    });

    describe('when claim amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(tokens(0), [], [], { from: alice }),
          'sm3' // ERC20StakingModule: claim amount is zero
        );
      });
    });

    describe('when claim amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(tokens(300), [], [], { from: alice }),
          'sm6' // ERC20StakingModule: claim amount exceeds balance
        );
      });
    });

    describe('when one user claims against all shares', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 // 1/5th of time elapsed

        // DAYS 40 - 80
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult) / (100 * this.mult + 100)
        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRewardUnpenalized = 1000 / 5 * 100 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty
        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRewardUnpenalized += 1000 / 10 * 100 / (100 * this.mult + 200)

        this.res = await this.pool.claim(tokens(200), [], [], { from: alice });
      });

      it('should not return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not affect the staking balance for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should still have one stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.2));
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'claim', 'fountain', this.res)
      });
    });

    describe('when alice claims first', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        // DAYS 40 - 80
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100) // 1/5th of time elapsed

        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested

        // DAYS 80 - 100
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty

        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested

        this.bobRewardTotal += this.aliceRedistributed * 100 / (50 * this.mult + 250) * .75

        // do first unstake
        this.res0 = await this.pool.claim(tokens(150), [], [], { from: alice });

        // do second unstake
        this.res1 = await this.pool.claim(tokens(100), [], [], { from: bob });
      });

      it('should not return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(900));
      });

      it('should not affect total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should not affect total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should have two stakes for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should have one stake for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal - this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.4));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.1));
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res0,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );

        expectEvent(
          this.res1,
          'Claimed',
          { user: bob, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('first claim should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
      });

      it('second claim should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.bobRewardTotal), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res0,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });

    });

    describe('when bob claims first', function () {
      beforeEach(async function () {
        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 * .5 // 1/5th of time elapsed
        // DAYS 40 - 80
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult * .5) / (100 * this.mult + 100) // 1/5th of time elapsed

        this.bobRewardTotal = 1000 / 5 * 75 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRedistributed = 1000 / 5 * 75 * .25 / (100 * this.mult + 100)

        // DAYS 80 - 100
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult * .5) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested

        this.bobRewardTotal += 1000 / 10 * (75 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRedistributed += 1000 / 10 * (75 * .25) / (100 * this.mult + 200) // 1/10th of the time elapsed, 75% penalty

        this.aliceRewardTotal += this.bobRedistributed * 100 * .25 / (100 * this.mult + 200)
        this.aliceRewardTotal += this.bobRedistributed * 50 * this.mult / (100 * this.mult + 200)

        // do first unstake
        this.res0 = await this.pool.claim(tokens(75), [], [], { from: bob });

        // do second unstake
        this.res1 = await this.pool.claim(tokens(150), [], [], { from: alice });
      });

      it('should not return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(900));
      });

      it('should not affect total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should not affect total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should have two stakes for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should have two stakes for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 2 - this.aliceRewardTotal - this.bobRewardTotal), TOKEN_DELTA
        );
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.4));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.1));
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res0,
          'Claimed',
          { user: bob, token: this.stk.address, amount: tokens(75), shares: shares(75) }
        );
        expectEvent(
          this.res1,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('first claim should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.bobRewardTotal), TOKEN_DELTA);
      });

      it('second claim should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res1,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });

    });

  });


  describe('unstake with single user', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.gysr.transfer(alice, tokens(10), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });

      this.t0 = await this.reward.lastUpdated();

      const gysr = 0.01 // reduced because of proportion to total staked
      const r = 0.01 // ratio is 0
      const x = 1 + gysr / r
      this.mult = 1 + Math.log10(x) // 1.3010299956639813

      // alice stakes 100 tokens at 10 days with a 1.3x multiplier
      await time.increaseTo(this.t0.add(days(10)));
      const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
      await this.pool.stake(tokens(100), [], data, { from: alice });
      this.t1 = await this.reward.lastUpdated();

      // alice stakes another 100 tokens at 80 days
      await time.increaseTo(this.t0.add(days(80)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance last 20 days
      await time.increaseTo(this.t0.add(days(100)));
    });

    describe('when user unstakes all shares', function () {
      beforeEach(async function () {
        // --- UNSTAKE 1
        // DAYS 0 - 80
        this.rewardsPerStakedShare1 = 200 / (100 * this.mult)
        this.aliceRewardTotal = 1000 * 2 / 5 // 2/5 of time elapsed

        // DAYS 80 - 100
        this.rewardsPerStakedShare2 = this.rewardsPerStakedShare1 + 100 / (100 * this.mult + 100)
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult) / (100 * this.mult + 100) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 100) // 1/10th of time elapsed, 25% vested

        this.res = await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should have the correct rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(this.rewardsPerStakedShare2), SHARE_DELTA)
      })

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

    });

    describe('when user unstakes multiple times, one large, one very small', function () {
      beforeEach(async function () {

        // DAYS 0 - 80
        this.rewardsPerStakedShare1 = 400 / (100 * this.mult)
        this.aliceRewardTotal = 1000 * 2 / 5 // 2/5 of time elapsed

        // DAYS 80 - 100
        this.rewardsPerStakedShare2 = this.rewardsPerStakedShare1 + 100 / (100 * this.mult + 100)
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult) / (100 * this.mult + 100) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 100) // 1/10th of time elapsed, 25% vested
        this.aliceRedistributed = 1000 / 10 * (100 * .75) / (100 * this.mult + 100) // 75% unvested

        // Alice unstakes 
        this.rewardsPerStakedShare3 = this.rewardsPerStakedShare2 + this.aliceRedistributed / (1 / 10 ** 18 * this.mult)

        this.aliceSecondReward = this.aliceRedistributed

        this.res0 = await this.pool.unstake(tokens(200).sub(new BN(1)), [], [], { from: alice });
        this.res1 = await this.pool.unstake(new BN(1), [], [], { from: alice });
      });

      it('should have the correct rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(this.rewardsPerStakedShare3), shares(1).mul(tokens(1)))
      })

      it('large unstake should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          {
            user: alice,
            token: this.stk.address,
            amount: tokens(200).sub(new BN(1)),
            shares: tokens(200).sub(new BN(1)).mul(new BN(10 ** 6))
          }
        );
      });

      it('large unstake should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
      });

      it('small unstake should emit Unstaked event', async function () {
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(1), shares: new BN(10 ** 6) }
        );
      });

      it('small unstake should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceSecondReward), TOKEN_DELTA);
      });

      it('should return all staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

    });

  });

});

describe('staking when unfunded', function () {
  const [owner, org, treasury, alice, bob] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20FriendlyRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.5).toString(), days(90).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20FriendlyRewardModule.at(await this.pool.rewardModule());

    // (no funding)

    // acquire staking tokens and approval
    await this.stk.transfer(alice, tokens(1000), { from: org });
    await this.stk.transfer(bob, tokens(1000), { from: org });
    await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
    await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), shares: shares(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(500), [], [], { from: bob });
        this.t0 = await this.reward.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // update
        await this.pool.update({ from: alice });
        this.t1 = await this.reward.lastUpdated();
        this.rewardsPerStakedShare = 0
      });

      it('should should correctly calculate the vesting multiplier', async function () {
        const stake0 = await this.reward.stakes(alice, 0);
        expect(await this.reward.timeVestingCoefficient(stake0.timestamp)).to.be.bignumber.closeTo(
          tokens(2 / 3),
          tokens(.000001)
        )

        const stake1 = await this.reward.stakes(bob, 0);
        expect(await this.reward.timeVestingCoefficient(stake1.timestamp)).to.be.bignumber.closeTo(
          tokens(2 / 3),
          tokens(.000001)
        )
      });

      it('should not have any rewards per staked share with no funding', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.equal(new BN(0))
      })
    });
  });


  describe('unstake', function () {

    describe('when one user unstakes all shares', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });
        this.t0 = await this.reward.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // do unstake
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});

describe('staking against Boiler', function () {
  const [owner, org, treasury, alice, bob] = accounts;

  beforeEach('setup', async function () {

    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20FriendlyRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256'],
      [this.rew.address, bonus(0).toString(), days(90).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20FriendlyRewardModule.at(await this.pool.rewardModule());

    // fund for future start to configure as "Boiler"
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    this.t0 = await time.latest();
    await this.reward.methods['fund(uint256,uint256,uint256)'](
      tokens(1000), days(90), this.t0.add(days(40)),
      { from: owner }
    );

    // acquire staking tokens and approval
    await this.stk.transfer(alice, tokens(1000), { from: org });
    await this.stk.transfer(bob, tokens(1000), { from: org });
    await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
    await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), shares: shares(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(500), [], [], { from: bob });

        // advance 30 days
        await time.increaseTo(this.t0.add(days(70)));

        // update
        await this.pool.update({ from: alice });
        this.t1 = await this.reward.lastUpdated();
      });

      it('should should correctly calculate the vesting multiplier', async function () {
        const stake0 = await this.reward.stakes(alice, 0);
        expect(await this.reward.timeVestingCoefficient(stake0.timestamp)).to.be.bignumber.closeTo(
          tokens(2 / 3),
          tokens(.000001)
        )

        const stake1 = await this.reward.stakes(bob, 0);
        expect(await this.reward.timeVestingCoefficient(stake1.timestamp)).to.be.bignumber.closeTo(
          tokens(2 / 3),
          tokens(.000001)
        )
      });

      it('should increase rewards per staked share', async function () {
        expect(await this.reward.rewardsPerStakedShare()).to.be.bignumber.closeTo(tokens(1000 / 3 / 600), TOKEN_DELTA)
      })
    });
  });


  describe('unstake', function () {

    describe('when one user unstakes all shares before funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });

        // advance 15 days
        await time.increaseTo(this.t0.add(days(25)));

        // do unstake
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when one user unstakes all shares 30 days into funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });

        this.aliceRewardTotal = 1000 / 3 * 100 * 2 / 3 / 200

        // advance 60 days
        await time.increaseTo(this.t0.add(days(70)));

        // do unstake
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });

      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1000 / 3 - this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});
