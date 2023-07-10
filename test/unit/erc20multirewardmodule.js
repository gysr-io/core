// unit tests for ERC20MultiRewardModule

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  days,
  shares,
  e18,
  now,
  bytes32,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  setupTime,
  compareAddresses,
  DECIMALS
} = require('../util/helper');

const ERC20MultiRewardModule = artifacts.require('ERC20MultiRewardModule');
const TestToken = artifacts.require('TestToken');
const TestElasticToken = artifacts.require('TestElasticToken')
const TestFeeToken = artifacts.require('TestFeeToken');
const Configuration = artifacts.require('Configuration');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const E18_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20MultiRewardModule', function () {
  let org, owner, alice, bob, charlie, other, factory;
  before(async function () {
    [org, owner, alice, bob, charlie, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.feeToken = await TestFeeToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
  });

  describe('construction', function () {

    describe('when vest start is greater than 1', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20MultiRewardModule.new(
            e18(1.1),
            days(90),
            this.config.address,
            factory,
            { from: owner }
          ),
          'mrm1'
        )
      });
    });

    describe('when initialized', function () {
      beforeEach(async function () {
        this.module = await ERC20MultiRewardModule.new(
          e18(0.5),
          days(90),
          this.config.address,
          factory,
          { from: owner }
        );
      });
      it('should create an ERC20MultiRewardModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set owner as sender', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should start with an empty token list', async function () {
        expect((await this.module.tokens()).length).to.equal(0);
      });

      it('should set factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should set vesting start', async function () {
        expect(await this.module.vestingStart()).to.be.bignumber.equal(e18(0.5));
      });

      it('should set vesting period', async function () {
        expect(await this.module.vestingPeriod()).to.be.bignumber.equal(days(90));
      });

      it('should always return a zero GYSR usage ratio', async function () {
        expect(await this.module.usage()).to.be.bignumber.equal(new BN(0));
      });
    })
  });



  describe('fund', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0.5),
        days(30),
        this.config.address,
        factory,
        { from: owner }
      );
    });

    describe('when token is zero', function () {
      it('should fail', async function () {
        await expectRevert.unspecified(
          this.module.methods['fund(address,uint256,uint256)'](
            constants.ZERO_ADDRESS, tokens(100), days(90), { from: owner }),
        )
      });
    });

    describe('when amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.methods['fund(address,uint256,uint256)'](
            this.token.address, tokens(0), days(90), { from: owner }),
          'rm1'
        )
      });
    });

    describe('when start is in the past', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.fund(this.token.address, tokens(100), days(90), days(5000), { from: owner }),
          'rm2'
        )
      });
    });

    describe('when token transfer not approved', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await expectRevert(
          this.module.methods['fund(address,uint256,uint256)'](
            this.token.address, tokens(1000), days(90), { from: owner }),
          'ERC20: insufficient allowance'
        )
      });
    });

    describe('when amount exceeds sender balance', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await expectRevert(
          this.module.methods['fund(address,uint256,uint256)'](
            this.token.address, tokens(12000), days(90), { from: owner }),
          'ERC20: transfer amount exceeds balance'
        )
      });
    });

    describe('when sender does not control module', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await expectRevert(
          this.module.methods['fund(address,uint256,uint256)'](
            this.token.address, tokens(1000), days(90), { from: alice }),
          'oc2'
        )
      });
    });


    describe('when funded', function () {

      beforeEach(async function () {
        // owner funds module
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        this.res = await this.module.methods['fund(address,uint256,uint256)'](
          this.token.address, tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should increase module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });

      it('should increase reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(1000));
      });

      it('should increase funding count', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should create funding object', async function () {
        const f = await this.module.fundings(this.token.address, 0);
        expect(f.amount).to.be.bignumber.equal(tokens(1000));
        expect(f.shares).to.be.bignumber.equal(shares(1000));
        expect(f.locked).to.be.bignumber.equal(shares(1000));
        expect(f.updated).to.be.bignumber.equal(this.t0);
        expect(f.start).to.be.bignumber.equal(this.t0);
        expect(f.duration).to.be.bignumber.equal(days(90));
      });

      it('should increase token count', async function () {
        expect(await this.module.tokenCount()).to.be.bignumber.equal(new BN(1));
      });

      it('should add new address to token list', async function () {
        const tokens = await this.module.tokens();
        expect(tokens.length).to.equal(1);
        expect(tokens[0]).to.equal(this.token.address);
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), shares: shares(1000), timestamp: this.t0 }
        );
      });

    });


    describe('when funded with multiple tokens', function () {

      beforeEach(async function () {
        // owner funds module for future
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);
        this.res0 = await this.module.fund(this.token.address, tokens(2500), days(90), this.t0.add(days(30)), { from: owner })

        // owner funds module with different token
        await this.elastic.transfer(owner, tokens(10000), { from: org });
        await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
        this.res1 = await this.module.methods['fund(address,uint256,uint256)'](
          this.elastic.address, tokens(1000), days(180),
          { from: owner }
        );
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should increase module first token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(2500));
      });

      it('should increase module second token balance', async function () {
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(7500));
      });

      it('should decrease user second token balance', async function () {
        expect(await this.elastic.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });

      it('should increase reward balances', async function () {
        const balances = await this.module.balances();
        expect(balances[0]).to.be.bignumber.equal(tokens(2500));
        expect(balances[1]).to.be.bignumber.equal(tokens(1000));
      });

      it('should increase first funding count', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase second funding count', async function () {
        expect(await this.module.fundingCount(this.elastic.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should create first funding object', async function () {
        const f = await this.module.fundings(this.token.address, 0);
        expect(f.amount).to.be.bignumber.equal(tokens(2500));
        expect(f.shares).to.be.bignumber.equal(shares(2500));
        expect(f.locked).to.be.bignumber.equal(shares(2500));
        expect(f.updated).to.be.bignumber.equal(this.t0.add(days(30))); // future
        expect(f.start).to.be.bignumber.equal(this.t0.add(days(30)));
        expect(f.duration).to.be.bignumber.equal(days(90));
      });

      it('should create second funding object', async function () {
        const f = await this.module.fundings(this.elastic.address, 0);
        expect(f.amount).to.be.bignumber.equal(tokens(1000));
        expect(f.shares).to.be.bignumber.equal(shares(1000));
        expect(f.locked).to.be.bignumber.equal(shares(1000));
        expect(f.updated).to.be.bignumber.equal(this.t1);
        expect(f.start).to.be.bignumber.equal(this.t1);
        expect(f.duration).to.be.bignumber.equal(days(180));
      });

      it('should create first reward object', async function () {
        const r = await this.module.rewards(this.token.address);
        expect(r.stakingShares).to.be.bignumber.equal(new BN(0));
        expect(r.accumulator).to.be.bignumber.equal(new BN(1));
        expect(r.dust).to.be.bignumber.equal(new BN(0));;
      });

      it('should create second reward object', async function () {
        const r = await this.module.rewards(this.elastic.address);
        expect(r.stakingShares).to.be.bignumber.equal(new BN(0));
        expect(r.accumulator).to.be.bignumber.equal(new BN(1));
        expect(r.dust).to.be.bignumber.equal(new BN(0));;
      });

      it('should increase token count', async function () {
        expect(await this.module.tokenCount()).to.be.bignumber.equal(new BN(2));
      });

      it('should add new addresses to token list', async function () {
        const tokens = await this.module.tokens();
        expect(tokens.length).to.equal(2);
        expect(tokens[0]).to.equal(this.token.address);
        expect(tokens[1]).to.equal(this.elastic.address);
      });

      it('should emit first RewardsFunded', async function () {
        expectEvent(
          this.res0,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(2500), shares: shares(2500), timestamp: this.t0.add(days(30)) }
        );
      });

      it('should emit second RewardsFunded', async function () {
        expectEvent(
          this.res1,
          'RewardsFunded',
          { token: this.elastic.address, amount: tokens(1000), shares: shares(1000), timestamp: this.t1 }
        );
      });

    });

  });


  describe('stake', function () {
    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0),
        days(90),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.elastic.address, tokens(2000), days(100), this.t0.add(days(50)), { from: owner });
    });

    describe('when data is not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x0de0b6b3a7640000"; // not a multiple of 32 bytes
        await expectRevert(
          this.module.stake(bytes32(alice), alice, shares(100), data, { from: owner }),
          'mrm2' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when reward token has not been initialized', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address'], [this.feeToken.address]);
        await expectRevert(
          this.module.stake(bytes32(alice), alice, shares(100), data, { from: owner }),
          'mrm23'
        )
      });
    });

    describe('when too many reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'address', 'address'],
          [this.token.address, this.elastic.address, this.feeToken.address]);
        await expectRevert(
          this.module.stake(bytes32(alice), alice, shares(100), data, { from: owner }),
          'mrm3'
        )
      });
    });

    describe('when duplicate reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'address'],
          [this.token.address, this.token.address]);
        await expectRevert(
          this.module.stake(bytes32(alice), alice, shares(100), data, { from: owner }),
          'mrm4'
        )
      });
    });

    describe('when one user stakes', function () {

      beforeEach(async function () {
        // alice stakes 100 tokens
        const data = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
        this.res = await this.module.stake(bytes32(alice), alice, shares(100), data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should increase stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(1));
      });

      it('should set user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
      });

      it('should set user stake timestamp', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should set user stake reward count', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should set user stake rewards accumulator start for each reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(100));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(100));
      });

    });

    describe('when multiple users stake', function () {

      beforeEach(async function () {
        // alice stakes 100 tokens
        const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // bob stakes 300 tokens
        await setupTime(this.t0, days(1));
        const data1 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
        this.res0 = await this.module.stake(bytes32(bob), bob, shares(300), data1, { from: owner });
        this.t2 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // alice stakes another 125 tokens
        await setupTime(this.t0, days(5));
        const data2 = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(125), data2, { from: owner });
        this.t3 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should increase stake count for each user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
        expect(await this.module.stakeCount(bytes32(bob))).to.be.bignumber.equal(new BN(1));
      });

      it('should create stake entry for first user', async function () {
        const stake = await this.module.stakes(bytes32(alice), 0);
        expect(stake.shares).to.be.bignumber.equal(shares(100));
        expect(stake.timestamp).to.be.bignumber.equal(this.t1);
        expect(stake.count).to.be.bignumber.equal(new BN(2));
      });

      it('should create stake entry for second user', async function () {
        const stake = await this.module.stakes(bytes32(bob), 0);
        expect(stake.shares).to.be.bignumber.equal(shares(300));
        expect(stake.timestamp).to.be.bignumber.equal(this.t2);
        expect(stake.count).to.be.bignumber.equal(new BN(2));
      });

      it('should create stake entry for first user additional stake', async function () {
        const stake = await this.module.stakes(bytes32(alice), 1);
        expect(stake.shares).to.be.bignumber.equal(shares(125));
        expect(stake.timestamp).to.be.bignumber.equal(this.t3);
        expect(stake.count).to.be.bignumber.equal(new BN(1));
      });

      it('should set rewards accumulators for first user', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should set rewards accumulators for second user', async function () {
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.token.address)).to.be.bignumber.closeTo(e18(0.05), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.elastic.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should set rewards accumulators for first user additional stake', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(e18(0.10), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.equal(new BN(0)); // not registered
      });

      it('should increase total staking shares for first reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(525));
      });

      it('should increase total staking shares for second reward token by only registered amount', async function () {
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(400));
      });

    });


    describe('when user stakes without registering for rewards', function () {

      beforeEach(async function () {
        // alice stakes 100 tokens
        const data0 = web3.eth.abi.encodeParameters([], []);
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should increase stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(1));
      });

      it('should set user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
      });

      it('should set user stake timestamp', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should set user stake reward count to zero', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(0));
      });

      it('should not register stake reward accumulators', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(new BN(0));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(new BN(0));
      });

    });

  })


  describe('claim', function () {
    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0),
        days(90),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.elastic.address, tokens(2000), days(100), this.t0.add(days(50)), { from: owner });

      // alice stakes 100 tokens on day 5
      await setupTime(this.t0, days(5));
      const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });

      // bob stakes 150 tokens on day 10
      await setupTime(this.t0, days(10));
      const data1 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(bob), bob, shares(150), data1, { from: owner });

      // alice stakes another 150 tokens on day 20 for just one reward
      await setupTime(this.t0, days(20));
      const data2 = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
      await this.module.stake(bytes32(alice), alice, shares(150), data2, { from: owner });
    });

    describe('when data is missing', function () {
      it('should revert', async function () {
        const data = "0x0";
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, new BN(0), data, { from: owner }),
          'mrm9' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when data is not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x" + "0123456789abcdef00001111122223333".repeat(8); // not a multiple of 32 bytes
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, 0, data, { from: owner }),
          'mrm10' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when reward token has not been initialized', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address'], [true, 0, 1, this.feeToken.address]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm23'
        )
      });
    });

    describe('when no reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256'],
          [true, 0, 0]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm9'
        )
      });
    });

    describe('when too many reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address', 'address'],
          [true, 0, 0, this.token.address, this.elastic.address, this.feeToken.address]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm11'
        )
      });
    });

    describe('when start index exceeds end range', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 1, 1, this.token.address, this.elastic.address]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, 0, data, { from: owner }),
          'mrm12'
        )
      });
    });

    describe('when end index exceeds max range', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 1, 3, this.token.address, this.elastic.address]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, 0, data, { from: owner }),
          'mrm13'
        )
      });
    });

    describe('when duplicate reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 2, this.token.address, this.token.address]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm14'
        )
      });
    });

    describe('when reward tokens are provided unsorted', function () {
      it('should revert', async function () {
        const tokens = [this.token.address, this.elastic.address]
        tokens.sort(compareAddresses);
        tokens.reverse();
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 2, ...tokens]);
        await expectRevert(
          this.module.claim(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm14'
        )
      });
    });

    describe('when one user claims all', function () {

      beforeEach(async function () {
        // alice claims on all tokens
        // token: 10 days @ 5 / 100 = 0.50, 10 days @ 5 / 250 = 0.2, 50 days @ 5 / 400 = 0.625
        // elastic: 20 days @ 20 / 250 = 1.6
        await setupTime(this.t0, days(70));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 2, ...tokens]);
        this.res = await this.module.claim(bytes32(alice), alice, alice, 0, data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // first stake @ 65/90 vesting, second stake @ 50/90 vesting
        this.r0 = (65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400)) + (50 / 90) * 250 * (150 / 400);

        // first stake @ 65/90 vesting, second stake not registered
        this.r1 = (65 / 90) * 400 * (100 / 250);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
      });

      it('should not affect user stake reward counts', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(2));
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(1));
      });

      it('should update accumulator for first reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.325), E18_DELTA);
      });

      it('should update accumulator for second reward token with delayed start', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
      });

      it('should not affect total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(400));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(250));
      });

      it('should update user stake rewards accumulator start for each reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.closeTo(e18(1.325), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
      });

      it('should increase user balance of first reward token', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
      });

      it('should increase user balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should decrease module balance of first reward token', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1000 - this.r0), TOKEN_DELTA);
      });

      it('should decrease module balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(2000 - this.r1), TOKEN_DELTA);
      });

      it('should rollover unvested rewards for first token into dust', async function () {
        // 1.0 - vesting
        const dust = (1 - 65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400)) + (1 - 50 / 90) * 250 * (150 / 400);
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.closeTo(shares(dust), SHARE_DELTA);
      });

      it('should rollover unvested rewards for second token into dust', async function () {
        // 1.0 - vesting
        const dust = (1 - 65 / 90) * 400 * (100 / 250);
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.closeTo(shares(dust), SHARE_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.token.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r0), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.elastic.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r1), SHARE_DELTA);
      });

    });


    describe('when multiple users claim', function () {

      beforeEach(async function () {
        // alice claims on all tokens
        // token: 10 days @ 5 / 100 = 0.50, 10 days @ 5 / 250 = 0.2, 20 days @ 5 / 400 = 0.25
        await setupTime(this.t0, days(40));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data0 = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 2, ...tokens]);
        this.res0 = await this.module.claim(bytes32(alice), alice, alice, 0, data0, { from: owner });

        // first stake @ 35/90 vesting, second stake @ 20/90 vesting
        this.r0t = (35 / 90) * (50 + 50 * (100 / 250) + 100 * (100 / 400)) + (20 / 90) * 100 * (150 / 400);
        const dust0t = (1 - 35 / 90) * (50 + 50 * (100 / 250) + 100 * (100 / 400)) + (1 - 20 / 90) * 100 * (150 / 400);

        // bob claims on all tokens
        // token: ... + 15 days @ 5 / 400 = 0.625, dust0t / 400
        // elastic: 5 days @ 20 / 250 = 0.4
        await setupTime(this.t0, days(55));
        const data1 = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 1, ...tokens]);
        this.res1 = await this.module.claim(bytes32(bob), bob, bob, 0, data1, { from: owner });

        // stake @ 45/90 vesting
        this.r1t = (45 / 90) * (50 * (150 / 250) + 175 * (150 / 400) + dust0t * (150 / 400));
        this.r1e = (45 / 90) * 100 * (150 / 250);
        this.dust1t = (1 - 45 / 90) * (50 * (150 / 250) + 175 * (150 / 400) + dust0t * (150 / 400));
        this.dust1e = (1 - 45 / 90) * 150 * (100 / 250)

        // token accumulator
        this.acc1 = 10 * 5 / 100 + 10 * 5 / 250 + 20 * 5 / 400 + 15 * 5 / 400 + dust0t / 400;
      });

      it('should not affect stake count for users', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
        expect(await this.module.stakeCount(bytes32(bob))).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
        expect((await this.module.stakes(bytes32(bob), 0)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
        expect((await this.module.stakes(bytes32(bob), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should not affect user stake reward counts', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(2));
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(1));
        expect((await this.module.stakes(bytes32(bob), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should update accumulator for first reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(this.acc1), E18_DELTA);
      });

      it('should update accumulator for second reward token with delayed start', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(0.4), E18_DELTA);
      });

      it('should not affect total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(400));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(250));
      });

      it('should update first user stake rewards accumulator start for first reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.closeTo(e18(0.95), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(e18(0.95), E18_DELTA);
      });

      it('should not affect first user stake rewards accumulator start for boiling reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.equal(new BN(1)); // init
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.equal(new BN(0)); // unregistered
      });

      it('should update second user stake rewards accumulator start for each reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.token.address)).to.be.bignumber.closeTo(e18(this.acc1), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.elastic.address)).to.be.bignumber.closeTo(e18(0.4), E18_DELTA);
      });

      it('should increase user balances of first reward token', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r0t), TOKEN_DELTA);
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(this.r1t), TOKEN_DELTA);
      });

      it('should update user balances of second reward token', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
        expect(await this.elastic.balanceOf(bob)).to.be.bignumber.closeTo(tokens(this.r1e), TOKEN_DELTA);
      });

      it('should decrease module balance of first reward token', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1000 - this.r0t - this.r1t), TOKEN_DELTA);
      });

      it('should decrease module balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(2000 - this.r1e), TOKEN_DELTA);
      });

      it('should rollover unvested rewards for first token into dust', async function () {
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.closeTo(shares(this.dust1t), SHARE_DELTA);
      });

      it('should rollover unvested rewards for second token into dust', async function () {
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.closeTo(shares(this.dust1e), SHARE_DELTA);
      });

      it('should emit one RewardsDistributed event for first user', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r0t), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r0t), SHARE_DELTA);
      });

      it('should not emit second RewardsDistributed event for first user', async function () {
        const logs = this.res0.logs.filter(l => l.event === 'RewardsDistributed');
        expect(logs.length).eq(1);
      });

      it('should emit first RewardsDistributed event for second user', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.token.address)[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r1t), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r1t), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event for second user', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.elastic.address)[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r1e), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r1e), SHARE_DELTA);
      });

    });


    describe('when one user claims on custom index and deregisters', function () {

      beforeEach(async function () {
        // alice claims on first position, fully vested
        await setupTime(this.t0, days(70));
        await setupTime(this.t0, days(100));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [false, 0, 1, ...tokens]);
        this.res = await this.module.claim(bytes32(alice), alice, alice, 0, data, { from: owner });

        // token: 10 days @ 5 / 100 = 0.50, 10 days @ 5 / 250 = 0.2, 80 days @ 5 / 400 = 1.0
        // elastic: 50 days @ 20 / 250 = 4.0
        this.r0 = 50 + 50 * (100 / 250) + 400 * (100 / 400);
        this.r1 = 1000 * (100 / 250);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
      });

      it('should zero reward count on specified user stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect reward count on other user stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(1));
      });

      it('should update accumulator for first reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.7), E18_DELTA);
      });

      it('should update accumulator for second reward token with delayed start', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should decrease total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(300));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(150));
      });

      it('should clear reward accumulator starts for specified user stake', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect reward accumulator starts for other user stake', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(e18(0.7), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.equal(new BN(0));
      });

      it('should increase user balance of first reward token', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
      });

      it('should increase user balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should decrease module balance of first reward token', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1000 - this.r0), TOKEN_DELTA);
      });

      it('should decrease module balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(2000 - this.r1), TOKEN_DELTA);
      });

      it('should have no unvested rewards dust', async function () {
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.equal(new BN(0));
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.equal(new BN(0));
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.token.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r0), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.elastic.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r1), SHARE_DELTA);
      });

    });

  })


  describe('unstake', function () {
    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0),
        days(90), // TODO change vesting config
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.elastic.address, tokens(2000), days(100), this.t0.add(days(50)), { from: owner });

      // alice stakes 100 tokens on day 5
      await setupTime(this.t0, days(5));
      const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });

      // bob stakes 150 tokens on day 10
      await setupTime(this.t0, days(10));
      const data1 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(bob), bob, shares(150), data1, { from: owner });

      // alice stakes another 150 tokens on day 20 for just one reward
      await setupTime(this.t0, days(20));
      const data2 = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
      await this.module.stake(bytes32(alice), alice, shares(150), data2, { from: owner });

      // token: 10 days @ 5 / 100 = 0.50, 10 days @ 5 / 250 = 0.2, 50 days @ 5 / 400 = 0.625
      // elastic: 20 days @ 20 / 250 = 1.6
    });

    describe('when data is not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x" + "0123456789abcdef00001111122223333"; // not a multiple of 32 bytes
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(250), data, { from: owner }),
          'mrm5' // ERC20MultiRewardModule: invalid data
        )
      });
    });
    ``
    describe('when reward token has not been initialized', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address'], [this.feeToken.address]);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(250), data, { from: owner }),
          'mrm23'
        )
      });
    });

    describe('when no reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters([], []);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm8'
        )
      });
    });

    describe('when not all registered reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(250), data, { from: owner }),
          'mrm8'
        )
      });
    });

    describe('when too many reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'address', 'address'],
          [this.token.address, this.elastic.address, this.feeToken.address]);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm6'
        )
      });
    });

    describe('when duplicate reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.token.address]);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm7'
        )
      });
    });

    describe('when unsorted reward tokens are provided', function () {
      it('should revert', async function () {
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        tokens.reverse();
        const data = web3.eth.abi.encodeParameters(['address', 'address'], tokens);
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(100), data, { from: owner }),
          'mrm7'
        )
      });
    });

    describe('when one user unstakes all', function () {

      beforeEach(async function () {
        // alice unstakes on all tokens
        await setupTime(this.t0, days(70));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data = web3.eth.abi.encodeParameters(['address', 'address'], tokens);
        this.res = await this.module.unstake(bytes32(alice), alice, alice, shares(250), data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // first stake @ 65/90 vesting, second stake @ 50/90 vesting
        this.r0 = (65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400)) + (50 / 90) * 250 * (150 / 400);

        // first stake @ 65/90 vesting, second stake not registered
        this.r1 = (65 / 90) * 400 * (100 / 250);
      });

      it('should zero stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(0));
      });

      it('should update accumulator for first reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.325), E18_DELTA);
      });

      it('should update accumulator for second reward token with delayed start', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
      });

      it('should decrease total staking shares for first reward token by combined amount', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(150));
      });

      it('should decrease total staking shares for second reward token by only registered amount', async function () {
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(150));
      });

      it('should increase user balance of first reward token', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
      });

      it('should increase user balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should decrease module balance of first reward token', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1000 - this.r0), TOKEN_DELTA);
      });

      it('should decrease module balance of second reward token', async function () {
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(2000 - this.r1), TOKEN_DELTA);
      });

      it('should rollover unvested rewards for first token into dust', async function () {
        // 1.0 - vesting
        const dust = (1 - 65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400)) + (1 - 50 / 90) * 250 * (150 / 400);
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.closeTo(shares(dust), SHARE_DELTA);
      });

      it('should rollover unvested rewards for second token into dust', async function () {
        // 1.0 - vesting
        const dust = (1 - 65 / 90) * 400 * (100 / 250);
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.closeTo(shares(dust), SHARE_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.token.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r0), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.elastic.address)[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.r1), SHARE_DELTA);
      });

    });

    // TODO unstake some, multi user, multi unstake, duplicates, none registered

  })


  describe('update', function () {
    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0),
        days(90),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.elastic.address, tokens(2000), days(100), this.t0.add(days(30)), { from: owner });

      // alice stakes 100 tokens on day 5
      await setupTime(this.t0, days(5));
      const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });

      // bob stakes 321 tokens on day 10
      await setupTime(this.t0, days(10));
      const data1 = web3.eth.abi.encodeParameters([], []);
      await this.module.stake(bytes32(bob), bob, shares(321), data1, { from: owner });

      // alice stakes another 150 tokens on day 20 for just one reward
      await setupTime(this.t0, days(20));
      const data2 = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
      await this.module.stake(bytes32(alice), alice, shares(150), data2, { from: owner });

      // day 50
      // token: 20 days @ 5 / 100 = 1.0, 30 days @ 5 / 250 = 0.6
      // elastic: 20 days @ 20 / 100 = 4.0
    });

    describe('when data is missing', function () {
      it('should revert', async function () {
        const data = "0x0";
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm15' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when data is not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x" + "0123456789abcdef00001111122223333".repeat(8); // not a multiple of 32 bytes
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm16' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when reward token has not been initialized', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address'], [true, 0, 1, this.feeToken.address]);
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm23'
        )
      });
    });

    describe('when too many reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address', 'address'],
          [true, 0, 0, this.token.address, this.elastic.address, this.feeToken.address]);
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm17'
        )
      });
    });

    describe('when start index exceeds end range', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 1, 1, this.token.address, this.elastic.address]);
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm18'
        )
      });
    });

    describe('when end index exceeds max range', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 1, 3, this.token.address, this.elastic.address]);
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm19'
        )
      });
    });

    describe('when duplicate tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 2, this.elastic.address, this.elastic.address]);
        await expectRevert(
          this.module.update(bytes32(alice), alice, data, { from: owner }),
          'mrm20'
        )
      });
    });

    describe('when empty data is provided', function () {
      it('should skip', async function () {
        const res = await this.module.update(bytes32(alice), alice, [], { from: owner });
        expect(res.logs.length).equal(0);
      });
    });

    describe('when user registers for all rewards', function () {

      beforeEach(async function () {
        // bob registers for all rewards
        await setupTime(this.t0, days(50));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 1, ...tokens]);
        this.res = await this.module.update(bytes32(bob), bob, data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(bob))).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).shares).to.be.bignumber.equal(shares(321));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should increase user stake reward counts', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should update accumulator for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should increase total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(571));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(421));
      });

      it('should set user stake rewards accumulator start for each reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.token.address)).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.elastic.address)).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should not affect user reward token balances', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(new BN(0));
        expect(await this.elastic.balanceOf(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect module reward token balances', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(1000));
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(2000));
      });

      it('should not affect reward token dust', async function () {
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.equal(new BN(0));
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.equal(new BN(0));
      });

      it('should emit RewardsUpdated event', async function () {
        expectEvent(this.res, 'RewardsUpdated', { account: bytes32(bob) });
      });

    });

    describe('when user registers for additional reward token on one stake', function () {

      beforeEach(async function () {
        // alice registers for all rewards
        await setupTime(this.t0, days(50));
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address'],
          [true, 0, 2, this.elastic.address]);
        this.res = await this.module.update(bytes32(alice), alice, data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
      });

      it('should not affect reward count for fully registered stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should increase reward count for partially registered stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should not update accumulator for unspecified reward token', async function () {
        // effective value at 1.6 now
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.0), E18_DELTA);
      });

      it('should update accumulator for each specified reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should not affect total staking shares for already registered reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(250));
      });

      it('should increase total staking shares for newly registered reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(250));
      });

      it('should not affect accumulator start for existing registered rewards', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.closeTo(new BN(1), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.closeTo(new BN(1), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(e18(1.0), E18_DELTA);
      });

      it('should set user accumulator start for newly registered reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should emit RewardsUpdated event', async function () {
        expectEvent(this.res, 'RewardsUpdated', { account: bytes32(alice) });
      });

    });

    describe('when user deregisters for one reward token on some stakes', function () {

      beforeEach(async function () {
        // alice deregisters for one reward token
        await setupTime(this.t0, days(50));
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address'],
          [false, 1, 2, this.token.address]);
        this.res = await this.module.update(bytes32(alice), alice, data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
      });

      it('should decrease reward count for specified stakes', async function () {
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect reward count for other stakes', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should update accumulator for each specified reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.6), E18_DELTA);
      });

      it('should not update accumulator for unspecified reward token', async function () {
        // effective value at 4.0 now
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.equal(new BN(1));
      });

      it('should move renounced rewards to dust for specified reward token', async function () {
        // 0.6 * 150 = 90
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.closeTo(shares(90), SHARE_DELTA);
      });

      it('should decrease total staking shares for deregistered reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(100)); // -150
      });

      it('should not affect total staking shares for other registered reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(100));
      });

      it('should not affect accumulator start for other rewards', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.closeTo(new BN(1), E18_DELTA); // start
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.closeTo(new BN(0), E18_DELTA); // unregistered
      });

      it('should clear user accumulator start for specified reward token and stake', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(new BN(0), E18_DELTA);
      });

      it('should not affect accumulator start for specified reward token and other stake', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.closeTo(new BN(1), E18_DELTA);
      });

      it('should emit RewardsUpdated event', async function () {
        expectEvent(this.res, 'RewardsUpdated', { account: bytes32(alice) });
      });

    });


    describe('when user deregisters for reward token on all stakes', function () {

      beforeEach(async function () {
        // alice deregisters for one reward token
        await setupTime(this.t0, days(50));
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address'],
          [false, 0, 2, this.elastic.address]);
        this.res = await this.module.update(bytes32(alice), alice, data, { from: owner });
        this.t1 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(alice))).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.module.stakes(bytes32(alice), 1)).shares).to.be.bignumber.equal(shares(150));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect((await this.module.stakes(bytes32(alice), 1)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(20)), new BN(1));
      });

      it('should decrease reward count for previously registered stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 0)).count).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect reward count for already unregistered stake', async function () {
        expect((await this.module.stakes(bytes32(alice), 1)).count).to.be.bignumber.equal(new BN(1));
      });

      it('should update accumulator for each specified reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(4.0), E18_DELTA);
      });

      it('should not update accumulator for unspecified reward token', async function () {
        // effective value at 1.6 now
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.0), E18_DELTA);
      });

      it('should move renounced rewards to dust for specified reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.closeTo(shares(400), SHARE_DELTA);
      });

      it('should decrease total staking shares for deregistered reward token', async function () {
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect total staking shares for other registered reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(250));
      });

      it('should not affect accumulator start for other rewards', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.token.address)).to.be.bignumber.closeTo(new BN(1), E18_DELTA); // start
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.token.address)).to.be.bignumber.closeTo(e18(1.0), E18_DELTA); // unregistered
      });

      it('should clear user accumulator start for specified reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(alice), 0, this.elastic.address)).to.be.bignumber.closeTo(new BN(0), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(alice), 1, this.elastic.address)).to.be.bignumber.closeTo(new BN(0), E18_DELTA);
      });

      it('should emit RewardsUpdated event', async function () {
        expectEvent(this.res, 'RewardsUpdated', { account: bytes32(alice) });
      });

    });


    describe('when user registers for all rewards then claims', function () {

      beforeEach(async function () {
        // bob registers for all rewards
        await setupTime(this.t0, days(50));
        const tokens = [this.token.address, this.elastic.address];
        tokens.sort(compareAddresses);
        const data = web3.eth.abi.encodeParameters(['bool', 'uint256', 'uint256', 'address', 'address'],
          [true, 0, 1, ...tokens]);
        await this.module.update(bytes32(bob), bob, data, { from: owner });
        new BN((await web3.eth.getBlock('latest')).timestamp);

        // token expands
        await setupTime(this.t0, days(70));
        await this.elastic.setCoefficient(e18(1.05)); // should only affect token amounts and balances

        // claim
        await setupTime(this.t0, days(80));
        // (same data encoding)
        this.res = await this.module.claim(bytes32(bob), bob, bob, 0, data, { from: owner });
        this.t2 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // day 80
        // token: 30 days @ 5 / 571 = 0.262697023
        // elastic: 30 days @ 20 / 421 = 1.425178147
        // vesting: 70/90 days
      });

      it('should not affect stake count for user', async function () {
        expect(await this.module.stakeCount(bytes32(bob))).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect user stake shares', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).shares).to.be.bignumber.equal(shares(321));
      });

      it('should not affect user stake timestamps', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should increase user stake reward counts', async function () {
        expect((await this.module.stakes(bytes32(bob), 0)).count).to.be.bignumber.equal(new BN(2));
      });

      it('should update accumulator for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(1.6 + 0.262697023), E18_DELTA);
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(4.0 + 1.425178147), E18_DELTA);
      });

      it('should keep increased total staking shares for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).stakingShares).to.be.bignumber.equal(shares(571));
        expect((await this.module.rewards(this.elastic.address)).stakingShares).to.be.bignumber.equal(shares(421));
      });

      it('should reset user stake rewards accumulator start for each reward token', async function () {
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.token.address)).to.be.bignumber.closeTo(e18(1.6 + 0.262697023), E18_DELTA);
        expect(await this.module.stakeRegistered(bytes32(bob), 0, this.elastic.address)).to.be.bignumber.closeTo(e18(4.0 + 1.425178147), E18_DELTA);
      });

      it('should increase user reward token balances', async function () {
        // 7/9 * 0.262697023 * 321 = 65.586690076
        // 7/9 * 1.425178147 * 321 = 355.819477368
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(65.58669), TOKEN_DELTA);
        expect(await this.elastic.balanceOf(bob)).to.be.bignumber.closeTo(tokens(1.05 * 355.81948), TOKEN_DELTA); // inflation
      });

      it('should decrease module reward token balances', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1000 - 65.58669), TOKEN_DELTA);
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(1.05 * (2000 - 355.81948)), TOKEN_DELTA); // inflation
      });

      it('should carry over some unvested reward token dust', async function () {
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.closeTo(shares(18.73905), SHARE_DELTA);
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.closeTo(shares(101.66271), SHARE_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.token.address)[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(65.58669), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(65.58669), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed' && l.args.token == this.elastic.address)[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1.05 * 355.81948), tokens(0.002)); // inflation
        expect(e.args.shares).to.be.bignumber.closeTo(shares(355.81948), shares(0.002));
      });

    });

  })


  describe('clean', function () {
    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        e18(0),
        days(90),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      // owner adds future funding for second token
      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.elastic.address, tokens(2000), days(100), this.t0.add(days(30)), { from: owner });

      // alice stakes 100 tokens on day 5
      await setupTime(this.t0, days(5));
      const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.elastic.address]);
      await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });

      // owner funds again
      await setupTime(this.t0, days(10));
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1200), days(50),
        { from: owner }
      );
      this.t1 = (await this.module.fundings(this.token.address, 1)).updated;

      // owner sets up future funding
      await this.module.fund(this.token.address, tokens(500), days(100), this.t0.add(days(180)), { from: owner });


      // day 75
      // token: 10 days @ 5 / 100 = 0.5, 50 days @ 29 / 100 = 14.5, 15 days @ 5 / 100 = 0.75
      // elastic: 45 days @ 20 / 100 = 9.0
    });

    describe('when caller does not own module', function () {
      it('should revert', async function () {
        await expectRevert(
          this.module.clean([], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when data is not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x0123456789abcdef00001111122223333"; // not a multiple of 32 bytes
        await expectRevert(
          this.module.clean(data, { from: owner }),
          'mrm21' // ERC20MultiRewardModule: invalid data
        )
      });
    });

    describe('when reward token has not been initialized', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address'], [this.feeToken.address]);
        await expectRevert(
          this.module.clean(data, { from: owner }),
          'mrm23'
        )
      });
    });

    describe('when too many reward tokens are provided', function () {
      it('should revert', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'address', 'address'],
          [this.token.address, this.elastic.address, this.feeToken.address]);
        await expectRevert(
          this.module.clean(data, { from: owner }),
          'mrm22'
        )
      });
    });

    describe('when empty data is provided', function () {
      it('should skip', async function () {
        const res = await this.module.clean([], { from: owner });
        expect(res.logs.length).equal(0);
      });
    });

    describe('when one funding schedule has expired and controller cleans all', function () {

      beforeEach(async function () {
        // owner cleans all tokens
        await setupTime(this.t0, days(75));
        const data = web3.eth.abi.encodeParameters(['address', 'address'],
          [this.token.address, this.elastic.address]);
        this.res = await this.module.clean(data, { from: owner });
      });

      it('should reduce active funding schedules on token with expiration', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect active funding schedules on other tokens', async function () {
        expect(await this.module.fundingCount(this.elastic.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should reindex fundings to remove expired', async function () {
        expect((await this.module.fundings(this.token.address, 0)).amount).to.be.bignumber.equal(tokens(1000));
        expect((await this.module.fundings(this.token.address, 1)).amount).to.be.bignumber.equal(tokens(500)); // last funding during expire
      });

      it('should update accumulator for each reward token', async function () {
        expect((await this.module.rewards(this.token.address)).accumulator).to.be.bignumber.closeTo(e18(15.75), E18_DELTA);
        expect((await this.module.rewards(this.elastic.address)).accumulator).to.be.bignumber.closeTo(e18(9.0), E18_DELTA);
      });

      it('should update locked reward balance for token with expiration', async function () {
        const locked = 125 / 200 * 1000 + 500;
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(locked), TOKEN_DELTA);
      });

      it('should update locked reward balance for other tokens', async function () {
        expect((await this.module.balances())[1]).to.be.bignumber.closeTo(tokens(55 / 100 * 2000), TOKEN_DELTA);
      });

      it('should not affect module reward token balances', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(2700));
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(2000));
      });

      it('should not affect reward token dust', async function () {
        expect((await this.module.rewards(this.token.address)).dust).to.be.bignumber.equal(new BN(0));
        expect((await this.module.rewards(this.elastic.address)).dust).to.be.bignumber.equal(new BN(0));
      });

      it('should emit RewardsExpired', async function () {
        expectEvent(
          this.res,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(1200), shares: shares(1200), timestamp: this.t1 }
        );
      });

    });

  })

});
