// integration tests for "Reservoir" Pool
// made up of ERC20BondStakingModule and ERC20FixedRewardModule

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants, singletons } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  e18,
  e6,
  bytes32,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  reportGas,
  setupTime,
  DECIMALS,
} = require('../util/helper');

const Pool = artifacts.require('Pool');
const Configuration = artifacts.require('Configuration');
const PoolFactory = artifacts.require('PoolFactory');
const GeyserToken = artifacts.require('GeyserToken');
const ERC20BondStakingModuleFactory = artifacts.require('ERC20BondStakingModuleFactory');
const ERC20BondStakingModule = artifacts.require('ERC20BondStakingModule');
const ERC20BondStakingModuleInfo = artifacts.require('ERC20BondStakingModuleInfo');
const ERC20FixedRewardModuleFactory = artifacts.require('ERC20FixedRewardModuleFactory');
const ERC20FixedRewardModule = artifacts.require('ERC20FixedRewardModule');
const TestToken = artifacts.require('TestToken');
const TestLiquidityToken = artifacts.require('TestLiquidityToken');
const TestIndivisibleToken = artifacts.require('TestIndivisibleToken');
const TestFeeToken = artifacts.require('TestFeeToken');
const TestElasticToken = artifacts.require('TestElasticToken');
const TestTemplateToken = artifacts.require('TestTemplateToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const DEBT_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const E6_DELTA = toFixedPointBigNumber(0.001, 10, 6);
const E6_SHARE_DELTA = toFixedPointBigNumber(0.001, 10, 12);


describe('Reservoir integration', function () {
  let org, owner, treasury, alice, bob, other;
  before(async function () {
    [org, owner, treasury, alice, bob, other] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, this.config.address, { from: org });
    this.stakingModuleFactory = await ERC20BondStakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20FixedRewardModuleFactory.new({ from: org });
    this.stk0 = await TestLiquidityToken.new({ from: org });
    this.stk1 = await TestTemplateToken.new("Other decimal token", "OTH", e6(1000000), 6, { from: org });
    this.stk2 = await TestElasticToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // configure fees
    await this.config.setAddressUint96(
      web3.utils.soliditySha3('gysr.core.pool.spend.fee'),
      treasury,
      e18(0.25),
      { from: org }
    );
    await this.config.setAddressUint96(
      web3.utils.soliditySha3('gysr.core.bond.stake.fee'),
      treasury,
      e18(0.005),
      { from: org }
    );
    await this.config.setAddressUint96(
      web3.utils.soliditySha3('gysr.core.fixed.fund.fee'),
      treasury,
      e18(0.01),
      { from: org }
    );

    // configure bond metadata
    this.info = await ERC20BondStakingModuleInfo.new({ from: org });
    await this.config.setAddress(
      web3.utils.soliditySha3('gysr.core.bond.metadata'),
      this.info.address,
      { from: org }
    );

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameters(
      ['uint256', 'bool'],
      [days(10).toString(), true]
    );
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256'],
      [this.rew.address, days(10).toString(), e18(1).toString()]
    );

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
    this.staking = await ERC20BondStakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20FixedRewardModule.at(await this.pool.rewardModule());

    // owner funds pool
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    await this.reward.fund(tokens(1000), { from: owner });

    // owner opens bond markets
    await this.staking.open(
      this.stk0.address,
      e18(20.0),
      e18(10.0 / 1000), // (30.0 - 20.0) / 1000e6 debt as e24
      shares(1000),
      shares(10000),
      { from: owner }
    );
    await this.staking.open(
      this.stk1.address,
      e6(0.04), // adjust for 12 decimal diff
      e6(0.02 / 1000), // (0.06 - 0.04) / 1000e6 debt as e24
      shares(1000),
      shares(10000),
      { from: owner }
    );
  });

  describe('stake', function () {

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        const data = web3.eth.abi.encodeParameter('address', this.stk0.address);
        await expectRevert(
          this.pool.stake(tokens(1), data, [], { from: alice }),
          'ERC20: insufficient allowance'
        );
      });
    });

    describe('when token transfer allowance is insufficient', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100), { from: alice });
        const data = web3.eth.abi.encodeParameter('address', this.stk0.address);
        await expectRevert(
          this.pool.stake(tokens(101), data, [], { from: alice }),
          'ERC20: insufficient allowance'
        );
      });
    });

    describe('when token balance is insufficient', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        const data = web3.eth.abi.encodeParameter('address', this.stk0.address);
        await expectRevert(
          this.pool.stake(tokens(1001), data, [], { from: alice }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        const data = web3.eth.abi.encodeParameter('address', this.stk0.address);
        await expectRevert(
          this.pool.stake(tokens(0), data, [], { from: alice }),
          'bsm2'
        );
      });
    });

    describe('when the encoded token market data is missing', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(100), [], [], { from: alice }),
          'bsm3'
        );
      });
    });

    describe('when the market has not been opened yet', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        const data = web3.eth.abi.encodeParameter('address', this.stk2.address);
        await expectRevert(
          this.pool.stake(tokens(100), data, [], { from: alice }),
          'bsm4'
        );
      });
    });

    describe('when the debt amount rounds to zero', function () {
      it('should fail', async function () {
        await this.stk2.transfer(alice, tokens(1000), { from: org });
        await this.stk2.approve(this.staking.address, tokens(100000), { from: alice });
        await this.staking.open(this.stk2.address, e18(1000000000), 0, shares(1000), shares(10000), { from: owner });
        const data = web3.eth.abi.encodeParameter('address', this.stk2.address);
        await expectRevert(
          this.pool.stake(5, data, [], { from: alice }),
          'bsm7'
        );
      });
    });

    describe('when the debt amount is below expected threshold', function () {
      it('should fail', async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        const data = web3.eth.abi.encodeParameters(
          ['address', 'uint256'],
          [this.stk0.address, shares(15)]
        );
        await expectRevert(
          this.pool.stake(tokens(300), data, [], { from: alice }), // fee should push this under thresh
          'bsm7'
        );
      });
    });

    describe('when user purchases a bond', function () {
      beforeEach(async function () {
        await this.stk0.transfer(alice, tokens(1000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        const data = web3.eth.abi.encodeParameter('address', this.stk0.address);
        this.res = await this.pool.stake(tokens(100), data, [], { from: alice });
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);
      });

      it('should decrease staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(99.5));
      });

      it('should increase token balance of treasury by fee amount', async function () {
        expect(await this.stk0.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.5));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(99.5));
      });

      it('should update staking balances for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.closeTo(tokens(99.5), TOKEN_DELTA);
      });

      it('should increase bond count for user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should set user as owner of new bond', async function () {
        expect(await this.staking.ownerOf(new BN(1))).to.equal(alice);
      });

      it('should return token metadata for new bond', async function () {
        const res = await this.staking.tokenURI(new BN(1));
        let data = res.split(';base64,')[1];
        const metadata = JSON.parse(Buffer.from(data, 'base64').toString());
        expect(metadata['name']).equals('TKN Bond Position: 1');
        expect(metadata).to.have.property('description');
        expect(metadata).to.have.property('image');
        expect(metadata).to.have.property('attributes');
      })

      it('should increment bond nonce', async function () {
        expect(await this.staking.nonce()).to.be.bignumber.equal(new BN(2));
      });

      it('should decrease available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.equal(tokens(990 - 4.975));
      });

      it('should not affect reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.equal(shares(990)); // after 1% fee
      });

      it('should increase reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.equal(shares(4.975));
      });

      it('should create staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(99.5));
        expect(b.debt).to.be.bignumber.equal(shares(4.975));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      })

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.debt).to.be.bignumber.equal(shares(4.975));
        expect(m.capacity).to.be.bignumber.equal(shares(9995.025));
        expect(m.principal).to.be.bignumber.equal(shares(99.5));
        expect(m.vested).to.be.bignumber.equal(new BN(0));
        expect(m.start).to.be.bignumber.equal(this.t0);
        expect(m.updated).to.be.bignumber.equal(this.t0);
      });

      it('should create reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(shares(4.975));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0);
      })

      it('should emit Staked event', async function () {
        expectEvent(
          this.res,
          'Staked',
          { account: bytes32(1), user: alice, token: this.stk0.address, amount: tokens(100), shares: shares(4.975) }
        );
      });

      it('should emit mint Transfer event', async function () {
        const e = this.res.receipt.rawLogs.filter(l => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')[2]; // ERC721 Transfer
        expect(e.topics[1]).to.equal(constants.ZERO_BYTES32)
        expect(e.topics[2]).to.equal(bytes32(alice))
        expect(web3.utils.toBN(e.topics[3])).to.be.bignumber.equal(new BN(1))
      });

      it('should emit Fee event', async function () {
        expectEvent(
          this.res,
          'Fee',
          { receiver: treasury, token: this.stk0.address, amount: tokens(0.5) }
        );
      });
    });


    describe('when users purchase multiple bonds across different markets', function () {

      beforeEach(async function () {
        // funding and approvals
        await this.stk0.transfer(alice, tokens(10000), { from: org });
        await this.stk0.transfer(bob, tokens(10000), { from: org });
        await this.stk1.transfer(alice, e6(100), { from: org });
        await this.stk1.transfer(bob, e6(100), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: bob });
        await this.stk1.approve(this.staking.address, e6(1000), { from: alice });
        await this.stk1.approve(this.staking.address, e6(1000), { from: bob });

        // purchase bonds
        const data0 = web3.eth.abi.encodeParameter('address', this.stk0.address);
        this.res0 = await this.pool.stake(tokens(2000), data0, [], { from: alice }); // price @ 20, 0.5% fee, +99.5e6 debt
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

        await setupTime(this.t0, days(2)); // -19.9e6 debt
        this.res1 = await this.pool.stake(tokens(1039.8), data0, [], { from: bob }); // price @ 20.796, 0.5% fee, +49.75e6 debt

        const data1 = web3.eth.abi.encodeParameter('address', this.stk1.address);
        await setupTime(this.t0, days(5));
        this.res2 = await this.pool.stake(e6(8), data1, [], { from: bob }); // price @ 0.04, +199e6 debt
      });

      it('should decrease staking token balance of first user', async function () {
        expect(await this.stk0.balanceOf(alice)).to.be.bignumber.equal(tokens(8000));
      });

      it('should decrease multiple staking token balances of second user', async function () {
        expect(await this.stk0.balanceOf(bob)).to.be.bignumber.equal(tokens(10000 - 1039.8));
        expect(await this.stk1.balanceOf(bob)).to.be.bignumber.equal(e6(92));
      });

      it('should increase token balances of staking module by combined stake amounts minus fees', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(3039.8 * 0.995));
        expect(await this.stk1.balanceOf(this.staking.address)).to.be.bignumber.equal(e6(7.96));
      });

      it('should increase token balances of treasury by combined fee amounts', async function () {
        expect(await this.stk0.balanceOf(treasury)).to.be.bignumber.equal(tokens(15.199));
        expect(await this.stk1.balanceOf(treasury)).to.be.bignumber.equal(e6(0.04));
      });

      it('should increase total staking balances', async function () {
        const totals = await this.pool.stakingTotals();
        expect(totals[0]).to.be.bignumber.equal(tokens(3039.8 * 0.995));
        expect(totals[1]).to.be.bignumber.equal(e6(7.96));
      });

      it('should update staking balances for first user and start to burn down', async function () {
        const balances = await this.pool.stakingBalances(alice);
        expect(balances[0]).to.be.bignumber.closeTo(tokens(1990 * 0.5), tokens(0.01)); // 5 days vesting
        expect(balances[1]).to.be.bignumber.equal(new BN(0));
      });

      it('should update staking balances for second user and start to burn down', async function () {
        const balances = await this.pool.stakingBalances(bob);
        expect(balances[0]).to.be.bignumber.closeTo(tokens(1039.8 * 0.995 * 0.7), tokens(0.01)); // 3 days vesting
        expect(balances[1]).to.be.bignumber.closeTo(e6(7.96), E6_DELTA);
      });

      it('should increase bond count for first user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase bond count for second user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should set appropriate user as owner of each new bond', async function () {
        expect(await this.staking.ownerOf(new BN(1))).to.equal(alice);
        expect(await this.staking.ownerOf(new BN(2))).to.equal(bob);
        expect(await this.staking.ownerOf(new BN(3))).to.equal(bob);
      });

      it('should increment bond nonce', async function () {
        expect(await this.staking.nonce()).to.be.bignumber.equal(new BN(4));
      });

      it('should decrease available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 99.5 - 49.75 - 199), TOKEN_DELTA);
      });

      it('should not affect reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.equal(shares(990)); // after 1% fee
      });

      it('should increase reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(99.5 + 49.75 + 199), DEBT_DELTA);
      });

      it('should create staking position for first bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(1990));
        expect(b.debt).to.be.bignumber.equal(shares(99.5));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should create staking position for second bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(1034.601));
        expect(b.debt).to.be.bignumber.closeTo(shares(49.75), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
      });

      it('should create staking position for third bond id', async function () {
        const b = await this.staking.bonds(new BN(3));
        expect(b.market).to.equal(this.stk1.address);
        expect(b.principal).to.be.bignumber.equal(e6(7.96).mul(e6(1)));
        expect(b.debt).to.be.bignumber.equal(shares(199));
        expect(b.timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
      });

      it('should update first bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.debt).to.be.bignumber.closeTo(shares(99.5 - 19.9 + 49.75), DEBT_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 99.5 - 49.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(3039.8 * 0.995));
        expect(m.vested).to.be.bignumber.closeTo(shares(1990 * 0.2), shares(0.01));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1)); // resets vesting start on stake
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
      });

      it('should update second bond market', async function () {
        const m = await this.staking.markets(this.stk1.address);
        expect(m.debt).to.be.bignumber.equal(shares(199));
        expect(m.capacity).to.be.bignumber.equal(shares(10000 - 199));
        expect(m.principal).to.be.bignumber.equal(e6(7.96).mul(e6(1)));
        expect(m.vested).to.be.bignumber.equal(new BN(0));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
      });

      it('should create reward position for first bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(shares(99.5));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0);
      });

      it('should create reward position for second bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.closeTo(shares(49.75), DEBT_DELTA);
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
      });

      it('should create reward position for third bond id', async function () {
        const pos = await this.reward.positions(bytes32(3));
        expect(pos.debt).to.be.bignumber.equal(shares(199));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { account: bytes32(1), user: alice, token: this.stk0.address, amount: tokens(2000), shares: shares(99.5) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { account: bytes32(2), user: bob, token: this.stk0.address, amount: tokens(1039.8) }
        );
        expectEvent(
          this.res2,
          'Staked',
          { account: bytes32(3), user: bob, token: this.stk1.address, amount: e6(8), shares: shares(199) }
        );
      });

      it('should emit each Fee event', async function () {
        expectEvent(
          this.res0,
          'Fee',
          { receiver: treasury, token: this.stk0.address, amount: tokens(10) }
        );
        expectEvent(
          this.res1,
          'Fee',
          { receiver: treasury, token: this.stk0.address, amount: tokens(5.199) }
        );
        expectEvent(
          this.res2,
          'Fee',
          { receiver: treasury, token: this.stk1.address, amount: e6(0.04) }
        );
      });

    });

    describe('when user stakes during adjustment', function () {

      beforeEach(async function () {
        // funding and approvals
        await this.stk0.transfer(alice, tokens(10000), { from: org });
        await this.stk0.transfer(bob, tokens(10000), { from: org });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk0.approve(this.staking.address, tokens(100000), { from: bob });

        // purchase bonds
        const data0 = web3.eth.abi.encodeParameter('address', this.stk0.address);
        await this.pool.stake(tokens(5000), data0, [], { from: alice }); // price @ 20, 0.5% fee, +248.75e6 debt
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // controller makes adjustment
        await setupTime(this.t0, days(6));
        this.res = await this.staking.adjust(
          this.stk0.address,
          e18(10), // 20 -> 10
          e18(40.0 / 1000), // 10 -> 40 / 1000e6
          shares(1000),
          shares(10000),
          { from: owner }
        );

        // user purchases another bond with debt fully decayed and midway through adjustment
        await setupTime(this.t0, days(11));
        this.res = await this.pool.stake(tokens(3000), data0, [], { from: bob }); // price @ 15, 0.5% fee, +199e6 debt
      });

      it('should decrease staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(bob)).to.be.bignumber.equal(tokens(7000));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(7960));
      });

      it('should increase token balance of treasury by fee amount', async function () {
        expect(await this.stk0.balanceOf(treasury)).to.be.bignumber.equal(tokens(40));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(7960));
      });

      it('should update staking balances for user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.closeTo(tokens(2985), TOKEN_DELTA);
      });

      it('should burn down staking balance from earlier user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should increase bond count for user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should set user as owner of new bond', async function () {
        expect(await this.staking.ownerOf(new BN(2))).to.equal(bob);
      });

      it('should increment bond nonce', async function () {
        expect(await this.staking.nonce()).to.be.bignumber.equal(new BN(3));
      });

      it('should decrease available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 248.75 - 199), TOKEN_DELTA);
      });

      it('should not affect reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.equal(shares(990)); // after 1% fee
      });

      it('should increase reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(248.75 + 199), DEBT_DELTA);
      });

      it('should create reward position for bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(2985));
        expect(b.debt).to.be.bignumber.closeTo(shares(199), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
      })

      it('should update bond market usage', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.debt).to.be.bignumber.closeTo(shares(199), DEBT_DELTA); // prev debt burned down
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 199), DEBT_DELTA); // capacity reset
        expect(m.principal).to.be.bignumber.equal(shares(7960));
        expect(m.vested).to.be.bignumber.equal(shares(4975));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
      });

      it('should interpolate bond market pricing adjustment', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.price).to.be.bignumber.closeTo(e18(15), BONUS_DELTA); // half way through
        expect(m.coeff).to.be.bignumber.closeTo(e18(25 / 1000), BONUS_DELTA);
      });

      it('should create reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.closeTo(shares(199), DEBT_DELTA);
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
      })

      it('should emit Staked event', async function () {
        const e = this.res.logs.filter(l => l.event === 'Staked')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(3000));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(199), SHARE_DELTA);
      });

      it('should emit Fee event', async function () {
        expectEvent(
          this.res,
          'Fee',
          { receiver: treasury, token: this.stk0.address, amount: tokens(15) }
        );
      });

    });

    describe('when users stake with elastic token', function () {

      beforeEach(async function () {
        // funding and approvals
        await this.stk2.transfer(alice, tokens(1000), { from: org });
        await this.stk2.transfer(bob, tokens(1000), { from: org });
        await this.stk2.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk2.approve(this.staking.address, tokens(100000), { from: bob });

        // open new market for elastic tokens
        await this.staking.open(
          this.stk2.address,
          e18(0.85),
          e18(0.25 / 200), // (1.10 - 0.85) / 200e6 debt as e24
          shares(1000),
          shares(10000),
          { from: owner }
        );

        // purchase elastic bonds
        const data1 = web3.eth.abi.encodeParameter('address', this.stk2.address);
        this.res0 = await this.pool.stake(tokens(255), data1, [], { from: alice }); // price @ 0.85, 0.5% fee, +298.5e6 debt
        this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

        // expand token
        await this.stk2.setCoefficient(e18(1.2));

        // purchase another bond
        await setupTime(this.t0, days(1)); // -29.85e6 debt
        this.res1 = await this.pool.stake(tokens(113.838), data1, [], { from: bob });
        // price @ 1.1858125, 120% inflation, 0.5% fee -> +79.6e6 debt
      });

      it('should decrease staking token balance of first user before expansion', async function () {
        expect(await this.stk2.balanceOf(alice)).to.be.bignumber.equal(tokens(1.2 * (1000 - 255)));
      });

      it('should decrease staking token balance of second user after expansion', async function () {
        expect(await this.stk2.balanceOf(bob)).to.be.bignumber.equal(tokens(1.2 * 1000 - 113.838));
      });

      it('should increase token balance of staking module', async function () {
        // 1.2 * 0.995 * 255 + 0.995 * 113.838 = 417.73881
        expect(await this.stk2.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(417.73881));
      });

      it('should increase token balance of treasury by fee amount', async function () {
        expect(await this.stk2.balanceOf(treasury)).to.be.bignumber.equal(tokens(1.2 * 0.005 * 255 + 0.005 * 113.838));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[2]).to.be.bignumber.equal(tokens(417.73881));
      });

      it('should expand and decay staking balance from first user', async function () {
        expect((await this.pool.stakingBalances(alice))[2]).to.be.bignumber.closeTo(tokens(0.9 * 1.2 * 0.995 * 255), TOKEN_DELTA);
      });

      it('should update staking balance for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[2]).to.be.bignumber.closeTo(tokens(0.995 * 113.838), TOKEN_DELTA);
      });

      it('should increase bond count for each user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should set owners of new bonds', async function () {
        expect(await this.staking.ownerOf(new BN(1))).to.equal(alice);
        expect(await this.staking.ownerOf(new BN(2))).to.equal(bob);
      });

      it('should increment bond nonce', async function () {
        expect(await this.staking.nonce()).to.be.bignumber.equal(new BN(3));
      });

      it('should decrease available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 298.5 - 79.6), TOKEN_DELTA);
      });

      it('should not affect reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.equal(shares(990)); // after 1% fee
      });

      it('should increase reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(298.5 + 79.6), DEBT_DELTA);
      });

      it('should create staking position for first bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(this.stk2.address);
        expect(b.principal).to.be.bignumber.equal(shares(253.725));
        expect(b.debt).to.be.bignumber.closeTo(shares(298.5), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should create staking position for second bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(this.stk2.address);
        expect(b.principal).to.be.bignumber.equal(shares(113.26881 / 1.2)); // shares after expand
        expect(b.debt).to.be.bignumber.closeTo(shares(79.6), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
      });

      it('should update bond market usage', async function () {
        const m = await this.staking.markets(this.stk2.address);
        expect(m.debt).to.be.bignumber.closeTo(shares(0.9 * 298.5 + 79.6), DEBT_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 298.5 - 79.6), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(253.725 + 113.26881 / 1.2)); // shares
        expect(m.vested).to.be.bignumber.closeTo(shares(0.1 * 253.725), SHARE_DELTA);
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
      });

      it('should create reward position for first bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(shares(298.5));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0);
      });

      it('should create reward position for second bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.closeTo(shares(79.6), DEBT_DELTA);
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
      });

      it('should emit first Staked event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'Staked')[0];
        expect(e.args.account).eq(bytes32(1));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk2.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(255));
        expect(e.args.shares).to.be.bignumber.equal(shares(298.5)); // exact
      });

      it('should emit second Staked event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Staked')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk2.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(113.838));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(79.6), SHARE_DELTA);
      });

      it('should emit first Fee event', async function () {
        expectEvent(
          this.res0,
          'Fee',
          { receiver: treasury, token: this.stk2.address, amount: tokens(1.275) }
        );
      });

      it('should emit second Fee event', async function () {
        expectEvent(
          this.res1,
          'Fee',
          { receiver: treasury, token: this.stk2.address, amount: tokens(0.005 * 113.838) }
        );
      });

    });

  });


  describe('unstake', function () {

    beforeEach(async function () {
      // funding and approval
      await this.stk0.transfer(alice, tokens(10000), { from: org });
      await this.stk0.transfer(bob, tokens(10000), { from: org });
      await this.stk1.transfer(alice, e6(10), { from: org });
      await this.stk1.transfer(bob, e6(10), { from: org });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: bob });
      await this.stk1.approve(this.staking.address, e6(100), { from: alice });
      await this.stk1.approve(this.staking.address, e6(100), { from: bob });

      // purchase bonds
      const data0 = web3.eth.abi.encodeParameter('address', this.stk0.address);
      await this.pool.stake(tokens(2500), data0, [], { from: alice }); // price @ 20, 0.5% fee, +124.375e6 debt
      this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

      await setupTime(this.t0, days(1)); // -12.4375e6 debt
      await this.pool.stake(tokens(1689.55), data0, [], { from: bob }); // price @ 21.119375, 0.5% fee, +79.6e6 debt

      await setupTime(this.t0, days(4));
      const data1 = web3.eth.abi.encodeParameter('address', this.stk1.address);
      await this.pool.stake(e6(8), data1, [], { from: bob }); // +199e6 debt

      await setupTime(this.t0, days(7)); // -59.7e6 debt
      await this.pool.stake(e6(2.1393), data1, [], { from: alice }); // price @ 0.042786, 0.5% fee, +49.75e6 debt
    });

    describe('when data is encoded incorrectly', function () {
      it('should fail', async function () {
        const data = '0x999999999999';
        await expectRevert(
          this.pool.unstake(tokens(300), data, [], { from: alice }),
          'bsm8'
        );
      });
    });

    describe('when bond does not exist', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('uint256', new BN(42));
        await expectRevert(
          this.pool.unstake(tokens(0), data, [], { from: alice }),
          'bsm9'
        );
      });
    });

    describe('when user does not own bond', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('uint256', new BN(3));
        await expectRevert(
          this.pool.unstake(tokens(300), data, [], { from: alice }),
          'bsm9'
        );
      });
    });

    describe('when amount is nonzero and period has elapsed', function () {
      it('should fail', async function () {
        await setupTime(this.t0, days(11));
        const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
        await expectRevert(
          this.pool.unstake(tokens(1), data, [], { from: alice }),
          'bsm12'
        );
      });
    });

    describe('when amount exceeds remaining principal', function () {
      it('should fail', async function () {
        await setupTime(this.t0, days(8));
        const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
        await expectRevert(
          this.pool.unstake(tokens(600), data, [], { from: alice }),
          'bsm14'
        );
      });
    });


    describe('when user unstakes a fully vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(12));
        const data0 = web3.eth.abi.encodeParameter('uint256', new BN(1));
        this.res = await this.pool.unstake(tokens(0), data0, [], { from: alice });
      });

      it('should not affect token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(4168.60225));
      });

      it('should not affect staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(alice)).to.be.bignumber.equal(tokens(7500));
      });

      it('should increase reward token balance of user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.equal(tokens(0.995 * 125));
      });

      it('should not affect total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(4168.60225));
      });

      it('should have zero user staking balances', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 124.375 - 79.6 - 199 - 49.75), tokens(0.01));
      });

      it('should decrease bond count for user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect bond count for other user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should revert on owner query for unstaked bond', async function () {
        await expectRevert(this.staking.ownerOf(new BN(1)), 'ERC721: invalid token ID');
      });

      it('should revert on token metadata query for unstaked bond', async function () {
        await expectRevert(this.staking.tokenURI(new BN(1)), 'ERC721: invalid token ID');
      })

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.equal(shares(990 - 124.375));
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(79.6 + 199 + 49.75), shares(0.002));
      });

      it('should clear staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(constants.ZERO_ADDRESS);
        expect(b.principal).to.be.bignumber.equal(new BN(0));
        expect(b.debt).to.be.bignumber.equal(new BN(0));
        expect(b.timestamp).to.be.bignumber.equal(new BN(0));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.debt).to.be.bignumber.equal(new BN(0));
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 124.375 - 79.6), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(4168.60225));
        expect(m.vested).to.be.bignumber.equal(shares(4168.60225));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(12)), new BN(1));
      });

      it('should clear reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { account: bytes32(1), user: alice, token: this.stk0.address, amount: new BN(0), shares: shares(0.995 * 125) }
        );
      });

      it('should emit burn Transfer event', async function () {
        const e = this.res.receipt.rawLogs.filter(l => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')[0]; // ERC721 Transfer
        expect(e.topics[1]).to.equal(bytes32(alice))
        expect(e.topics[2]).to.equal(constants.ZERO_BYTES32)
        expect(web3.utils.toBN(e.topics[3])).to.be.bignumber.equal(new BN(1))
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(0.995 * 125));
        expect(e.args.shares).to.be.bignumber.equal(shares(0.995 * 125));
      });
    });


    describe('when user unstakes all from partially vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(10)); // 60% vested
        const data0 = web3.eth.abi.encodeParameter('uint256', new BN(3));
        this.res = await this.pool.unstake(tokens(0), data0, [], { from: bob });
      });

      it('should reduce token balance of staking module', async function () {
        // 10.1393 * 0.995 - 0.40 * 7.96 = 6.9046035
        expect(await this.stk1.balanceOf(this.staking.address)).to.be.bignumber.closeTo(e6(6.9046), E6_DELTA);
      });

      it('should increase staking token balance of user', async function () {
        expect(await this.stk1.balanceOf(bob)).to.be.bignumber.closeTo(e6(2 + 3.184), E6_DELTA);
      });

      it('should increase reward token balance of user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(tokens(0.6 * 199), TOKEN_DELTA);
      });

      it('should decrease total staking balance', async function () {
        expect((await this.pool.stakingTotals())[1]).to.be.bignumber.closeTo(e6(6.9046), E6_DELTA);
      });

      it('should have zero user staking balance on unstaked market', async function () {
        expect((await this.pool.stakingBalances(bob))[1]).to.be.bignumber.equal(new BN(0));
      });

      it('should have some decayed staking balance on remaining market', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.closeTo(tokens(1689.55 * 0.995 * 0.1), tokens(0.01));
      });

      it('should increase available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 124.375 - 79.6 - 199 - 49.75 + 0.4 * 199), tokens(0.002));
      });

      it('should decrease bond count for user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect bond count for other user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should clear owner of unstaked bond', async function () {
        await expectRevert(this.staking.ownerOf(new BN(3)), 'ERC721: invalid token ID');
      });

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.closeTo(shares(990 - 0.6 * 199), shares(0.00025)); // ~1 sec error
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(124.375 + 79.6 + 49.75), shares(0.002));
      });

      it('should clear staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(3));
        expect(b.market).to.equal(constants.ZERO_ADDRESS);
        expect(b.principal).to.be.bignumber.equal(new BN(0));
        expect(b.debt).to.be.bignumber.equal(new BN(0));
        expect(b.timestamp).to.be.bignumber.equal(new BN(0));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk1.address);
        // decay + forfeit: 199 - 0.3 * 199 + 49.75 - 0.3 * 189.05 - 0.4 * 199
        expect(m.debt).to.be.bignumber.closeTo(shares(52.735), DEBT_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 199 - 49.75 + 0.4 * 199), shares(0.002));
        expect(m.principal).to.be.bignumber.closeTo(toFixedPointBigNumber(6.904604, 10, 12), E6_SHARE_DELTA);
        // 0.3 * 7.96 + 0.3 * (5.572 + 2.1286035)
        expect(m.vested).to.be.bignumber.closeTo(toFixedPointBigNumber(4.69818105, 10, 12), E6_SHARE_DELTA);
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should clear reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(3));
        expect(pos.debt).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should emit Unstaked event', async function () {
        const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
        expect(e.args.account).eq(bytes32(3));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk1.address);
        expect(e.args.amount).to.be.bignumber.closeTo(e6(0.4 * 7.96), E6_DELTA);
        expect(e.args.shares).to.be.bignumber.equal(shares(199));
      });

      it('should emit burn Transfer event', async function () {
        const e = this.res.receipt.rawLogs.filter(l => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')[0]; // ERC721 Transfer
        expect(e.topics[1]).to.equal(bytes32(bob))
        expect(e.topics[2]).to.equal(constants.ZERO_BYTES32)
        expect(web3.utils.toBN(e.topics[3])).to.be.bignumber.equal(new BN(3))
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.6 * 199), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.6 * 199), SHARE_DELTA);
      });
    });


    describe('when user unstakes multiple times on same bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(8)); // 70% vested
        const data0 = web3.eth.abi.encodeParameter('uint256', new BN(2));
        this.res0 = await this.pool.unstake(tokens(200), data0, [], { from: bob });
        // debt unvested: 200 / (1689.55 * 0.995 * 0.3) * 79.6 * 0.3 = 9.46998

        await setupTime(this.t0, days(12)); // fully vested
        this.res1 = await this.pool.unstake(tokens(0), data0, [], { from: bob });
      });

      it('should reduce token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(4168.60225 - 200));
      });

      it('should increase staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(bob)).to.be.bignumber.closeTo(tokens(8310.45 + 200), TOKEN_DELTA);
      });

      it('should increase reward token balance of user by combined amount minus unvested', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(tokens(79.6 - 9.46998), TOKEN_DELTA);
      });

      it('should decrease total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.closeTo(tokens(4168.60225 - 200), TOKEN_DELTA);
      });

      it('should have zero user staking balance on unstaked market', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have some decayed staking balance on remaining market', async function () {
        expect((await this.pool.stakingBalances(bob))[1]).to.be.bignumber.closeTo(e6(7.96 * 0.2), E6_DELTA);
      });

      it('should increase available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 124.375 - 79.6 - 199 - 49.75 + 9.46988), tokens(0.002));
      });

      it('should decrease bond count for user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect bond count for other user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should clear owner of unstaked bond', async function () {
        await expectRevert(this.staking.ownerOf(new BN(2)), 'ERC721: invalid token ID');
      });

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.closeTo(shares(990 - 79.6 + 9.46988), SHARE_DELTA);
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(124.375 + /*79.6*/ + 199 + 49.75), shares(0.002));
      });

      it('should clear staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(constants.ZERO_ADDRESS);
        expect(b.principal).to.be.bignumber.equal(new BN(0));
        expect(b.debt).to.be.bignumber.equal(new BN(0));
        expect(b.timestamp).to.be.bignumber.equal(new BN(0));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        expect(m.debt).to.be.bignumber.equal(new BN(0)); // decay should not be interrupted by unstake
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 124.375 - 79.6 + 9.46998), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(4168.60225 - 200));
        expect(m.vested).to.be.bignumber.equal(shares(4168.60225 - 200)); // fully vested, should not be interrupted by unstake
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(1)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(12)), new BN(1));
      });

      it('should clear reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should emit first Unstaked event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'Unstaked')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(200));
        // first unstake shares: 200 / (1689.55 * 0.995 * 0.3) * 79.6 = 31.56659
        expect(e.args.shares).to.be.bignumber.closeTo(shares(31.56659), SHARE_DELTA);
      });

      it('should emit second Unstaked event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Unstaked')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(79.6 - 31.56659), SHARE_DELTA);
      });

      it('should emit burn Transfer event on second unstake', async function () {
        const e = this.res1.receipt.rawLogs.filter(l => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')[0]; // ERC721 Transfer
        expect(e.topics[1]).to.equal(bytes32(bob))
        expect(e.topics[2]).to.equal(constants.ZERO_BYTES32)
        expect(web3.utils.toBN(e.topics[3])).to.be.bignumber.equal(new BN(2))
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.7 * 79.6), TOKEN_DELTA); // everything vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.7 * 79.6), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.3 * 79.6 - 9.46998), TOKEN_DELTA); // remainder minus lost unvested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.3 * 79.6 - 9.46998), SHARE_DELTA);
      });
    });

  });

  describe('claim', function () {

    beforeEach(async function () {
      // funding and approval
      await this.stk0.transfer(alice, tokens(10000), { from: org });
      await this.stk0.transfer(bob, tokens(10000), { from: org });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: bob });

      // purchase bonds
      const data0 = web3.eth.abi.encodeParameter('address', this.stk0.address);
      await this.pool.stake(tokens(8000), data0, [], { from: alice }); // price @ 20, 0.5% fee, +398e6 debt
      this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

      await setupTime(this.t0, days(2)); // -79.6e6 debt
      await this.pool.stake(tokens(5796), data0, [], { from: bob }); // price @ 23.184, 0.5% fee, +248.75e6 debt
    });

    describe('when user claims multiple times on same bond', function () {

      beforeEach(async function () {
        // multiple claims
        await setupTime(this.t0, days(3)); // 30% vested
        const data0 = web3.eth.abi.encodeParameter('uint256', new BN(1));
        this.res0 = await this.pool.claim(new BN(0), data0, [], { from: alice });

        await setupTime(this.t0, days(8)); // 80% vested
        this.res1 = await this.pool.claim(new BN(0), data0, [], { from: alice });

        await setupTime(this.t0, days(10.1)); // fully vested
        this.res2 = await this.pool.claim(tokens(0), data0, [], { from: alice });
      });

      it('should not affect token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(13796 * 0.995));
      });

      it('should not affect staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(alice)).to.be.bignumber.equal(tokens(2000));
      });

      it('should increase reward token balance of user by entire combined amount', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(tokens(398), new BN(1)); // rounding error
      });

      it('should not affect total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(13796 * 0.995));
      });

      it('should have zero user staking balance ', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 398 - 248.75), TOKEN_DELTA);
      });

      it('should not affect bond count for users', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect owner of claimed bond', async function () {
        expect(await this.staking.ownerOf(new BN(1))).to.equal(alice);
      });

      it('should not affect token metadata for bond', async function () {
        const res = await this.staking.tokenURI(new BN(1));
        let data = res.split(';base64,')[1];
        const metadata = JSON.parse(Buffer.from(data, 'base64').toString());
        expect(metadata['name']).equals('TKN Bond Position: 1');
        expect(metadata).to.have.property('description');
        expect(metadata).to.have.property('image');
        expect(metadata).to.have.property('attributes');
      })

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.closeTo(shares(990 - 398), SHARE_DELTA);
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(248.75), DEBT_DELTA);
      });

      it('should not affect staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(7960));
        expect(b.debt).to.be.bignumber.equal(shares(398));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        // decay/vesting should not be interrupted by claim
        // 398 - 0.2 * 398 + 248.75 - 0.81 * 567.15
        expect(m.debt).to.be.bignumber.closeTo(shares(107.7585), DEBT_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 398 - 248.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(13796 * 0.995));
        // 0.2 * 7960 + 0.81 * (6368 + 5767.02)
        expect(m.vested).to.be.bignumber.closeTo(shares(11421.3662), shares(0.02));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(10.1)), new BN(1));
      });

      it('should update reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(new BN(0)); // all debt paid out
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0.add(days(10))); // limit at vesting end
      });

      it('should emit first Claimed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'Claimed')[0];
        expect(e.args.account).eq(bytes32(1));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(398), SHARE_DELTA);
      });

      it('should emit second Claimed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Claimed')[0];
        expect(e.args.account).eq(bytes32(1));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(398), SHARE_DELTA);
      });

      it('should emit third Claimed event', async function () {
        const e = this.res2.logs.filter(l => l.event === 'Claimed')[0];
        expect(e.args.account).eq(bytes32(1));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(398), SHARE_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.3 * 398), TOKEN_DELTA); // 30% vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.3 * 398), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.5 * 398), TOKEN_DELTA); // 80% vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.5 * 398), SHARE_DELTA);
      });

      it('should emit third RewardsDistributed event', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.2 * 398), TOKEN_DELTA); // remainder vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.2 * 398), SHARE_DELTA);
      });
    });


    describe('when user claims on multiple bonds', function () {

      beforeEach(async function () {
        // transfer bond
        await setupTime(this.t0, days(3));
        await this.staking.transferFrom(bob, alice, new BN(2), { from: bob });

        // claim multiple bonds
        const data = [
          this.pool.contract.methods.claim(new BN(0), web3.eth.abi.encodeParameter('uint256', new BN(1)), []).encodeABI(),
          this.pool.contract.methods.claim(new BN(0), web3.eth.abi.encodeParameter('uint256', new BN(2)), []).encodeABI()
        ]
        await setupTime(this.t0, days(10)); // bond 1 fully vested, bond 2 80% vested
        this.res = await this.pool.multicall(data, { from: alice });
      });

      it('should not affect token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(13796 * 0.995));
      });

      it('should not affect staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(alice)).to.be.bignumber.equal(tokens(2000));
      });

      it('should increase reward token balance of user by combined bond amounts', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(tokens(398 + 0.8 * 248.75), TOKEN_DELTA);
      });

      it('should not affect total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(13796 * 0.995));
      });

      it('should increase user staking balance by unvested portion of received bond', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.closeTo(tokens(0.2 * 0.995 * 5796), tokens(0.01));
      });

      it('should have zero user staking balance for other user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 398 - 248.75), TOKEN_DELTA);
      });

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.closeTo(shares(990 - 398 - 0.8 * 248.75), SHARE_DELTA);
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.closeTo(shares(0.2 * 248.75), DEBT_DELTA);
      });

      it('should not affect staking position for first bond id', async function () {
        const b = await this.staking.bonds(new BN(1));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(7960));
        expect(b.debt).to.be.bignumber.equal(shares(398));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should not affect staking position for second bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(this.stk0.address);
        expect(b.principal).to.be.bignumber.equal(shares(5767.02));
        expect(b.debt).to.be.bignumber.closeTo(shares(248.75), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        // decay/vesting should not be interrupted by claim
        // 398 - 0.2 * 398 + 248.75 - 0.8 * 567.15
        expect(m.debt).to.be.bignumber.closeTo(shares(113.43), SHARE_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 398 - 248.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(13796 * 0.995));
        // 0.2 * 7960 + 0.8 * (6368 + 5767.02)
        expect(m.vested).to.be.bignumber.closeTo(shares(11300.016), shares(0.05));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should update reward position for first bond id', async function () {
        const pos = await this.reward.positions(bytes32(1));
        expect(pos.debt).to.be.bignumber.equal(new BN(0)); // all debt paid out
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0.add(days(10))); // limit at vesting end
      });

      it('should update reward position for second bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.closeTo(shares(0.2 * 248.75), SHARE_DELTA); // 80% debt paid out
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should emit first Claimed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'Claimed')[0];
        expect(e.args.account).eq(bytes32(1));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.equal(shares(398));
      });

      it('should emit second Claimed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'Claimed')[1];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(248.75), SHARE_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(398)); // fully vested
        expect(e.args.shares).to.be.bignumber.equal(shares(398));
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[1];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.8 * 248.75), TOKEN_DELTA); // 80% vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.8 * 248.75), SHARE_DELTA);
      });

    });


    describe('when user claims then unstakes', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(4)); // 20% vested
        const data0 = web3.eth.abi.encodeParameter('uint256', new BN(2));
        this.res0 = await this.pool.claim(tokens(0), data0, [], { from: bob });
        // debt unvested: 200 / (1689.55 * 0.995 * 0.3) * 79.6 * 0.3 = 9.46998

        await setupTime(this.t0, days(10)); // 80% vested
        this.res1 = await this.pool.unstake(tokens(0), data0, [], { from: bob });
        // should return 0.2 * 0.995 * 5796 = 1153.404 principal
        // should distribute 0.8 * 248.75 = 199 reward
      });

      it('should reduce token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.closeTo(tokens(13727.02 - 1153.404), tokens(0.01));
      });

      it('should increase staking token balance of user', async function () {
        expect(await this.stk0.balanceOf(bob)).to.be.bignumber.closeTo(tokens(4204 + 1153.404), tokens(0.01));
      });

      it('should increase reward token balance of user by vested amount', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(tokens(199), TOKEN_DELTA);
      });

      it('should decrease total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.closeTo(tokens(13727.02 - 1153.404), tokens(0.01));
      });

      it('should have zero user staking balance', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should increase available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(990 - 398 - 0.8 * 248.75), tokens(0.002));
      });

      it('should decrease bond count for user', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect bond count for other user', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should clear owner of unstaked bond', async function () {
        await expectRevert(this.staking.ownerOf(new BN(2)), 'ERC721: invalid token ID');
      });

      it('should decrease reward module total shares', async function () {
        expect(await this.reward.rewards()).to.be.bignumber.closeTo(shares(990 - 199), SHARE_DELTA);
      });

      it('should decrease reward module debt', async function () {
        expect(await this.reward.debt()).to.be.bignumber.equal(shares(398));
      });

      it('should clear staking position for bond id', async function () {
        const b = await this.staking.bonds(new BN(2));
        expect(b.market).to.equal(constants.ZERO_ADDRESS);
        expect(b.principal).to.be.bignumber.equal(new BN(0));
        expect(b.debt).to.be.bignumber.equal(new BN(0));
        expect(b.timestamp).to.be.bignumber.equal(new BN(0));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        // decay/vesting should not be interrupted by claim or unstake
        expect(m.debt).to.be.bignumber.closeTo(shares(398 * 0.8 * 0.2), DEBT_DELTA); // 398 - 0.2 * 398 - 0.8 * 318.4
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 398 - 0.8 * 248.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.closeTo(shares(13727.02 - 1153.404), shares(0.01));
        expect(m.vested).to.be.bignumber.closeTo(shares(0.2 * 7960 + 0.8 * 12135.02), shares(0.02)); // 0.2 * 7960 + 0.8 * 12135.02
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should clear reward position for bond id', async function () {
        const pos = await this.reward.positions(bytes32(2));
        expect(pos.debt).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should emit first Claimed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'Claimed')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(new BN(0));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(248.75), SHARE_DELTA);
      });

      it('should emit second Unstaked event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Unstaked')[0];
        expect(e.args.account).eq(bytes32(2));
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1153.404), tokens(0.01));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(248.75), SHARE_DELTA);
      });

      it('should emit burn Transfer event on unstake', async function () {
        const e = this.res1.receipt.rawLogs.filter(l => l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')[0]; // ERC721 Transfer
        expect(e.topics[1]).to.equal(bytes32(bob))
        expect(e.topics[2]).to.equal(constants.ZERO_BYTES32)
        expect(web3.utils.toBN(e.topics[3])).to.be.bignumber.equal(new BN(2))
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.2 * 248.75), TOKEN_DELTA); // everything vested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.2 * 248.75), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.6 * 248.75), TOKEN_DELTA); // remainder minus lost unvested
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.6 * 248.75), SHARE_DELTA);
      });
    });

  });


  describe('withdraw', function () {

    beforeEach(async function () {
      // funding and approval
      await this.stk0.transfer(alice, tokens(10000), { from: org });
      await this.stk0.transfer(bob, tokens(10000), { from: org });
      await this.stk2.transfer(alice, tokens(1000), { from: org });
      await this.stk2.transfer(bob, tokens(1000), { from: org });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk0.approve(this.staking.address, tokens(100000), { from: bob });
      await this.stk2.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk2.approve(this.staking.address, tokens(100000), { from: bob });

      // purchase bonds
      const data0 = web3.eth.abi.encodeParameter('address', this.stk0.address);
      await this.pool.stake(tokens(8000), data0, [], { from: alice }); // price @ 20, 0.5% fee, +398e6 debt
      this.t0 = new BN((await web3.eth.getBlock('latest')).timestamp);

      await setupTime(this.t0, days(2)); // -79.6e6 debt
      await this.pool.stake(tokens(5796), data0, [], { from: bob }); // price @ 23.184, 0.5% fee, +248.75e6 debt

      // open new market for elastic tokens
      await this.staking.open(
        this.stk2.address,
        e18(0.85),
        e18(0.25 / 200), // (1.10 - 0.85) / 200e6 debt as e24
        shares(1000),
        shares(10000),
        { from: owner }
      );
      await this.reward.fund(tokens(500), { from: owner }); // re-up

      // purchase elastic bonds
      const data1 = web3.eth.abi.encodeParameter('address', this.stk2.address);
      await setupTime(this.t0, days(5));
      await this.pool.stake(tokens(255), data1, [], { from: alice }); // price @ 0.85, 0.5% fee, +298.5e6 debt

      // expand token
      await this.stk2.setCoefficient(e18(1.2));

      await setupTime(this.t0, days(6)); // -29.85e6 debt
      await this.pool.stake(tokens(113.838), data1, [], { from: bob });
      // price @ 1.1858125, 120% inflation, 0.5% fee -> +79.6e6 debt

      // one user unstakes
      await setupTime(this.t0, days(7));
      const data2 = web3.eth.abi.encodeParameter('uint256', new BN(1));
      await this.pool.unstake(tokens(0), data2, [], { from: alice }); // 70% vested
    });

    describe('when non owner tries to withdraw', function () {
      it('should fail', async function () {
        await expectRevert(
          this.staking.withdraw(this.stk0.address, tokens(10), { from: alice }),
          'oc2'
        );
      });
    });

    describe('when owner tries to withdraw more than has vested', function () {
      it('should fail', async function () {
        await setupTime(this.t0, days(8));
        await expectRevert(
          this.staking.withdraw(this.stk0.address, tokens(8400), { from: owner }),
          'bsm31'
        );
      });
    });

    describe('when owner tries to withdraw from an empty market', function () {
      it('should fail', async function () {
        await expectRevert.unspecified(
          this.staking.withdraw(this.stk1.address, tokens(100), { from: owner })
        );
      });
    });


    describe('when owner withdraws during vesting', function () {

      beforeEach(async function () {
        // vesting amounts
        // phase 1: 7960 for 2 days
        // phase 2: 0.8 * 7960 + 5767.02 = 12135.02 for 5 days
        // phase 3: 13727.02 - 0.3 * 7960 -(0.2*7960 + 0.5*12135.02) = 3679.51 for 1 / 5 days
        // total
        // 0.2 * 7960 + 0.5 * 12135.02 + 0.1 / 0.5 * 3679.51 = 8395.412
        await setupTime(this.t0, days(8));
        this.res = await this.staking.withdraw(this.stk0.address, tokens(8395), { from: owner });
      });

      it('should reduce token balance of staking module by unstake and withdraw amounts', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.closeTo(tokens(13727.02 - 0.3 * 7960 - 8395), tokens(0.01));
      });

      it('should increase staking token balance of owner', async function () {
        expect(await this.stk0.balanceOf(owner)).to.be.bignumber.equal(tokens(8395));
      });

      it('should decrease total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.closeTo(tokens(13727.02 - 0.3 * 7960 - 8395), tokens(0.01));
      });

      it('should not affect user staking balances', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.closeTo(tokens(0.4 * 0.995 * 5796), tokens(0.01));
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(1485 - 0.7 * 398 - 248.75 - 298.5 - 79.6), tokens(0.002));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        // decay/vesting should not be interrupted by unstake or withdraw
        // 398 - 0.2 * 398 + 248.75 - 0.5 * 567.14 - 0.3 * 398 - 1/5 * 164.18
        expect(m.debt).to.be.bignumber.closeTo(shares(131.344), shares(0.01));
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 0.7 * 398 - 248.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.closeTo(shares(13727.02 - 0.3 * 7960 - 8395), shares(0.01));
        expect(m.vested).to.be.bignumber.closeTo(shares(0.412), shares(0.01)); // dust after withdraw
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(8)), new BN(1));
      });

      it('should emit MarketBalanceWithdrawn event', async function () {
        const e = this.res.logs.filter(l => l.event === 'MarketBalanceWithdrawn')[0];
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(8395));
      });

    });

    describe('when owner withdraws all after fully vested', function () {

      beforeEach(async function () {
        // 0.7 * 7960 + 5767.02 = 11339.02
        await setupTime(this.t0, days(13));
        const p = (await this.staking.markets(this.stk0.address)).principal.div(e6(1));
        this.res = await this.staking.withdraw(this.stk0.address, p, { from: owner });
      });

      it('should zero token balance of staking module', async function () {
        expect(await this.stk0.balanceOf(this.staking.address)).to.be.bignumber.equal(new BN(0));
      });

      it('should increase staking token balance of owner', async function () {
        expect(await this.stk0.balanceOf(owner)).to.be.bignumber.closeTo(tokens(11339.02), tokens(0.01));
      });

      it('should zero total staking balance', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.closeTo(new BN(0), new BN(1)); // rounding error
      });

      it('should have fully decayed user staking balances', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(1485 - 0.7 * 398 - 248.75 - 298.5 - 79.6), tokens(0.002));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk0.address);
        // decay/vesting should not be interrupted by unstake or withdraw
        // 398 - 0.2 * 398 + 248.75 - 0.5 * 567.14 - 0.3 * 398 - 1/5 * 164.18
        expect(m.debt).to.be.bignumber.equal(new BN(0));
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 0.7 * 398 - 248.75), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(new BN(0));
        expect(m.vested).to.be.bignumber.equal(new BN(0));
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(2)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(13)), new BN(1));
      });

      it('should emit MarketBalanceWithdrawn event', async function () {
        const e = this.res.logs.filter(l => l.event === 'MarketBalanceWithdrawn')[0];
        expect(e.args.token).eq(this.stk0.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(11339.02), tokens(0.01));
      });

    });


    describe('when owner withdraws some from elastic token market', function () {

      beforeEach(async function () {
        // total: 1.2 * 0.995 * 255 + 0.995 * 113.838 = 417.73881
        // vested: 1.2 * 0.1 * 253.725 + 0.4 * (1.2*0.9*253.725 + 113.26881) = 185.363724
        await setupTime(this.t0, days(10));
        this.res = await this.staking.withdraw(this.stk2.address, tokens(60), { from: owner }); // 50 shares
      });

      it('should reduce token balance of staking module', async function () {
        expect(await this.stk2.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(417.73881 - 60));
      });

      it('should increase staking token balance of owner', async function () {
        expect(await this.stk2.balanceOf(owner)).to.be.bignumber.equal(tokens(60));
      });

      it('should reduce total staking balance', async function () {
        expect((await this.pool.stakingTotals())[2]).to.be.bignumber.equal(tokens(417.73881 - 60));
      });

      it('should have affect decay of user staking balances', async function () {
        expect((await this.pool.stakingBalances(alice))[2]).to.be.bignumber.closeTo(tokens(1.2 * 0.5 * 253.725), TOKEN_DELTA);
        expect((await this.pool.stakingBalances(bob))[2]).to.be.bignumber.closeTo(tokens(0.6 * 113.26881), TOKEN_DELTA);
      });

      it('should not affect available rewards balance', async function () {
        expect((await this.pool.rewardBalances())[0]).to.be.bignumber.closeTo(tokens(1485 - 0.7 * 398 - 248.75 - 298.5 - 79.6), tokens(0.002));
      });

      it('should update bond market', async function () {
        const m = await this.staking.markets(this.stk2.address);
        // decay/vesting should not be interrupted by unstake or withdraw
        // 298.5 - 0.1 * 298.5 + 79.6 - 0.4 * 348.25
        expect(m.debt).to.be.bignumber.closeTo(shares(208.95), DEBT_DELTA);
        expect(m.capacity).to.be.bignumber.closeTo(shares(10000 - 298.5 - 79.6), DEBT_DELTA);
        expect(m.principal).to.be.bignumber.equal(shares(253.725 + 113.26881 / 1.2 - 50)); // in shares
        expect(m.vested).to.be.bignumber.closeTo(shares(185.363724 / 1.2 - 50), SHARE_DELTA); // in shares
        expect(m.start).to.be.bignumber.closeTo(this.t0.add(days(6)), new BN(1));
        expect(m.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should emit MarketBalanceWithdrawn event', async function () {
        const e = this.res.logs.filter(l => l.event === 'MarketBalanceWithdrawn')[0];
        expect(e.args.token).eq(this.stk2.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(60));
      });

    });

  });

});
