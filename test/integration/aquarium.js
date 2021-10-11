// integrations tests for "Aquarium" Pool
// made up of ERC721StakingModule and ERC20FriendlyRewardModule

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
const ERC721StakingModuleFactory = contract.fromArtifact('ERC721StakingModuleFactory');
const ERC721StakingModule = contract.fromArtifact('ERC721StakingModule');
const ERC20FriendlyRewardModuleFactory = contract.fromArtifact('ERC20FriendlyRewardModuleFactory');
const ERC20FriendlyRewardModule = contract.fromArtifact('ERC20FriendlyRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestERC721 = contract.fromArtifact('TestERC721');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('Aquarium integration', function () {
  const [owner, org, treasury, alice, bob, other] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC721StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20FriendlyRewardModuleFactory.new({ from: org });
    this.stk = await TestERC721.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.5).toString(), days(180).toString()]
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
    this.staking = await ERC721StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20FriendlyRewardModule.at(await this.pool.rewardModule());

    // owner funds pool
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    await this.reward.methods['fund(uint256,uint256)'](tokens(3650), days(365), { from: owner });
    this.t0 = await this.reward.lastUpdated()
  });

  describe('stake', function () {

    describe('when token balance is insufficient', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        await expectRevert(
          this.pool.stake(11, [], [], { from: alice }),
          'smn3' // exceeds balance
        );
      });
    });

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        const data = web3.eth.abi.encodeParameters(['uint256'], [3]);
        await expectRevert(
          this.pool.stake(1, data, [], { from: alice }),
          'ERC721: transfer caller is not owner nor approved'
        );
      });
    });

    describe('when invalid data is passed for token id', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        const data = web3.eth.abi.encodeParameters(['uint256'], [11]);
        await expectRevert(
          this.pool.stake(3, data, [], { from: alice }),
          'smn4'  // bad data
        );
      });
    });

    describe('when user does not own specified token id', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.mint(10, { from: bob });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });

        const data = web3.eth.abi.encodeParameters(['uint256'], [8]);
        await expectRevert(
          this.pool.stake(1, data, [], { from: bob }),
          'ERC721: transfer of token that is not own'
        );
      });
    });

    describe('when user does not own all specified token ids', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.mint(10, { from: bob });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });

        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [12, 8]);
        await expectRevert(
          this.pool.stake(2, data, [], { from: bob }),
          'ERC721: transfer of token that is not own'
        );
      });
    });

    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await expectRevert(
          this.pool.stake(new BN(0), [], [], { from: alice }),
          'smn2' // ERC721StakingModule: stake amount is zero
        );
      });
    });


    describe('when the stake is successful', function () {
      beforeEach('alice stakes', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [2, 8, 5]);
        this.res = await this.pool.stake(3, data, [], { from: alice });
      });

      it('should decrease staking token balance of user', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(new BN(3));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should update staking balances for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should record that 0 GYSR was spent', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(0))
      });

      it('should emit Staked event', async function () {
        expectEvent(
          this.res,
          'Staked',
          { user: alice, token: this.stk.address, amount: new BN(3), shares: tokens(3) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'stake', 'aquarium', this.res)
      });
    });


    describe('when two users have staked', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.mint(10, { from: bob });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });
        const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [2, 8, 5]);
        const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
        this.res0 = await this.pool.stake(3, data0, [], { from: alice });
        this.res1 = await this.pool.stake(5, data1, [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(new BN(8));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(new BN(8));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(3));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should update the total staking count for each user', async function () {
        expect(await this.staking.counts(alice)).to.be.bignumber.equal(new BN(3));
        expect(await this.staking.counts(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should transfer each token to the module', async function () {
        expect(await this.stk.ownerOf(2)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(8)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(5)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(11)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(12)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(20)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(17)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(18)).to.be.equal(this.staking.address);
      });

      it('should set the owner for each staked token', async function () {
        expect(await this.staking.owners(2)).to.be.equal(alice);
        expect(await this.staking.owners(8)).to.be.equal(alice);
        expect(await this.staking.owners(5)).to.be.equal(alice);
        expect(await this.staking.owners(11)).to.be.equal(bob);
        expect(await this.staking.owners(12)).to.be.equal(bob);
        expect(await this.staking.owners(20)).to.be.equal(bob);
        expect(await this.staking.owners(17)).to.be.equal(bob);
        expect(await this.staking.owners(18)).to.be.equal(bob);
      });

      it('should set the owner token mappings', async function () {
        expect(await this.staking.tokenByOwner(alice, 0)).to.be.bignumber.equal(new BN(2));
        expect(await this.staking.tokenByOwner(alice, 1)).to.be.bignumber.equal(new BN(8));
        expect(await this.staking.tokenByOwner(alice, 2)).to.be.bignumber.equal(new BN(5));
        expect(await this.staking.tokenByOwner(bob, 0)).to.be.bignumber.equal(new BN(11));
        expect(await this.staking.tokenByOwner(bob, 1)).to.be.bignumber.equal(new BN(12));
        expect(await this.staking.tokenByOwner(bob, 2)).to.be.bignumber.equal(new BN(20));
        expect(await this.staking.tokenByOwner(bob, 3)).to.be.bignumber.equal(new BN(17));
        expect(await this.staking.tokenByOwner(bob, 4)).to.be.bignumber.equal(new BN(18));
      });

      it('should set the token index mappings', async function () {
        expect(await this.staking.tokenIndex(2)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(8)).to.be.bignumber.equal(new BN(1));
        expect(await this.staking.tokenIndex(5)).to.be.bignumber.equal(new BN(2));
        expect(await this.staking.tokenIndex(11)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(12)).to.be.bignumber.equal(new BN(1));
        expect(await this.staking.tokenIndex(20)).to.be.bignumber.equal(new BN(2));
        expect(await this.staking.tokenIndex(17)).to.be.bignumber.equal(new BN(3));
        expect(await this.staking.tokenIndex(18)).to.be.bignumber.equal(new BN(4));
      });

      it('should record that 0 GYSR was spent', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(0))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(0))
      });

      it('should not change vested GYSR balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      });

      it('should have 0 GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.equal(new BN(0));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: new BN(3), shares: tokens(3) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
      });
    });

    describe('when GYSR is spent by two users during stake', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.mint(10, { from: bob });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });

        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.transfer(bob, tokens(100), { from: org });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

        const data0s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [2, 8, 5]);
        const data1s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
        const data0r = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
        const data1r = web3.eth.abi.encodeParameter('uint256', tokens(5).toString());
        this.res0 = await this.pool.stake(3, data0s, data0r, { from: alice });
        this.res1 = await this.pool.stake(5, data1s, data1r, { from: bob });

        this.mult0 = 1 + Math.log10(1 + (0.1 / 0.01));
        const usage0 = (this.mult0 - 1.0) / this.mult0;
        this.mult1 = 1 + Math.log10(1 + ((5.0 * (0.01 * 8 / 5)) / (0.01 + usage0)));
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(new BN(8));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(new BN(8));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(3));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should update the total staking count for each user', async function () {
        expect(await this.staking.counts(alice)).to.be.bignumber.equal(new BN(3));
        expect(await this.staking.counts(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should record the GYSR spent for each user', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(10))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(5))
      });

      it('should record the GYSR multiplier for each user', async function () {
        expect((await this.reward.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(bonus(this.mult0), BONUS_DELTA);
        expect((await this.reward.stakes(bob, 0)).bonus).to.be.bignumber.closeTo(bonus(this.mult1), BONUS_DELTA);
      });

      it('should decrease GYSR balance of each user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        expect(await this.gysr.balanceOf(bob)).to.be.bignumber.equal(tokens(95));
      });

      it('should increase GYSR balance of pool', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(15));
      });

      it('should not change vested GYSR balance of pool', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      });

      it('should increase GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(
          bonus((this.mult0 * 3 + this.mult1 * 5 - 8) / (this.mult0 * 3 + this.mult1 * 5)),
          BONUS_DELTA
        );
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: new BN(3), shares: tokens(3) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(10) }
        );
        expectEvent(
          this.res1,
          'GysrSpent',
          { user: bob, amount: tokens(5) }
        );
      })
    });

    describe('when GYSR is spent by one user during stake', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.mint(10, { from: alice });
        await this.stk.mint(10, { from: bob });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
        await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });

        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.transfer(bob, tokens(100), { from: org });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

        const data0s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [2, 8, 5]);
        const data1s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
        const data0r = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
        this.res0 = await this.pool.stake(3, data0s, data0r, { from: alice });
        this.res1 = await this.pool.stake(5, data1s, [], { from: bob });

        this.mult0 = 1 + Math.log10(1 + (0.1 / 0.01));
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(new BN(8));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(new BN(8));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(3));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.counts(alice)).to.be.bignumber.equal(new BN(3));
        expect(await this.staking.counts(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should record GYSR spent for one user', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(10))
        expect((await this.reward.stakes(bob, 0)).gysr).to.be.bignumber.equal(tokens(0))
      });

      it('should record the GYSR multiplier for one user', async function () {
        expect((await this.reward.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(bonus(this.mult0), BONUS_DELTA);
        expect((await this.reward.stakes(bob, 0)).bonus).to.be.bignumber.equal(bonus(1));
      });

      it('should decrease GYSR balance for one user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(90));
        expect(await this.gysr.balanceOf(bob)).to.be.bignumber.equal(tokens(100));
      });

      it('should increase GYSR balance of pool', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(10));
      });

      it('should not change vested GYSR balance of pool', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0))
      });

      it('should increase GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(
          bonus((this.mult0 * 3 + 5 - 8) / (this.mult0 * 3 + 5)),
          BONUS_DELTA
        );
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: new BN(3), shares: tokens(3) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(10) }
        );
      })
    });
  });


  describe('unstake', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.mint(10, { from: alice });
      await this.stk.mint(10, { from: bob });
      await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
      await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });
      await this.gysr.transfer(alice, tokens(100), { from: org });
      await this.gysr.transfer(bob, tokens(100), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

      this.t0 = await this.reward.lastUpdated();

      // alice stakes 3 tokens at 45 days with a 2.04x multiplier
      await time.increaseTo(this.t0.add(days(45)));
      const data0s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [2, 8, 5]);
      const data0r = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
      await this.pool.stake(new BN(3), data0s, data0r, { from: alice });
      this.t1 = await this.reward.lastUpdated();

      const gysr0 = 10 * 0.01; // reduced wrt staked portion
      const r0 = 0.01; // usage is 0
      this.mult0 = 1 + Math.log10(1 + gysr0 / r0); // ~2.04
      const usage0 = (this.mult0 - 1.0) / this.mult0;

      // bob stakes 5 tokens at 90 days with a 1.4x multiplier
      await time.increaseTo(this.t0.add(days(90)));
      const data1s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
      const data1r = web3.eth.abi.encodeParameter('uint256', tokens(50).toString());
      await this.pool.stake(new BN(5), data1s, data1r, { from: bob });

      const gysr1 = 50 * 0.01 * 8 / 5; // reduced wrt staked portion
      const r1 = 0.01 + usage0;
      this.mult1 = 1 + Math.log10(1 + gysr1 / r1); // ~1.4x

      // alice stakes another 2 tokens at 135 days
      await time.increaseTo(this.t0.add(days(135)));
      const data2s = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [3, 4]);
      await this.pool.stake(new BN(2), data2s, [], { from: alice });

      // advance to 180 days
      await time.increaseTo(this.t0.add(days(180)));
    });

    describe('when unstake amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.unstake(tokens(0), [], [], { from: alice }),
          'smn5' // ERC721StakingModule: unstake amount is zero
        );
      });
    });

    describe('when unstake amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.unstake(tokens(300), [], [], { from: alice }),
          'smn6' // ERC721StakingModule: unstake amount exceeds balance
        );
      });
    });

    describe('when one user unstakes all tokens', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward = 900 * 0.875  // 3 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1) // 3 tokens, 87.5% vested
        this.aliceUnvested += 450 * 0.125 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)  // 3 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.aliceUnvested += 450 * 0.125 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2)

        // unstake
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [2, 3, 4, 5, 8]);
        this.res = await this.pool.unstake(new BN(5), data, [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(10));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward), TOKEN_DELTA
        );
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested), SHARE_DELTA);
      });

      it('should increase vested GYSR balance of pool', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(8));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(2));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceReward), SHARE_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(10) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'unstake', 'aquarium', this.res)
      });
    });

    describe('when one user unstakes some tokens', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward = 900 * 0.875 * (2 / 3) // 2 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125 * (2 / 3)

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1) // 2 tokens, 87.5% vested
        this.aliceUnvested += 450 * 0.125 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)  // 2 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.aliceUnvested += 450 * 0.125 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2)

        // unstake
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256'], [2, 3, 5, 8]);
        this.res = await this.pool.unstake(new BN(4), data, [], { from: alice });
      });

      it('should return some staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(9));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward), TOKEN_DELTA
        );
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.reward.stakes(alice, 0);
        expect(stake.timestamp).to.be.bignumber.closeTo(this.t0.add(days(45)), new BN(1));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested), SHARE_DELTA);
      });

      it('should transfer unstaked tokens back to the user', async function () {
        expect(await this.stk.ownerOf(2)).to.be.equal(alice);
        expect(await this.stk.ownerOf(8)).to.be.equal(alice);
        expect(await this.stk.ownerOf(5)).to.be.equal(alice);
        expect(await this.stk.ownerOf(3)).to.be.equal(alice);
      });

      it('should leave other tokens owned by module', async function () {
        expect(await this.stk.ownerOf(4)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(11)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(12)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(20)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(17)).to.be.equal(this.staking.address);
        expect(await this.stk.ownerOf(18)).to.be.equal(this.staking.address);
      });

      it('should update the owner for each unstaked token', async function () {
        expect(await this.staking.owners(2)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(8)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(5)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(3)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(4)).to.be.equal(alice);
        expect(await this.staking.owners(11)).to.be.equal(bob);
        expect(await this.staking.owners(12)).to.be.equal(bob);
        expect(await this.staking.owners(20)).to.be.equal(bob);
        expect(await this.staking.owners(17)).to.be.equal(bob);
        expect(await this.staking.owners(18)).to.be.equal(bob);
      });

      it('should update the owner token mappings', async function () {
        expect(await this.staking.tokenByOwner(alice, 0)).to.be.bignumber.equal(new BN(4));
        expect(await this.staking.tokenByOwner(bob, 0)).to.be.bignumber.equal(new BN(11));
        expect(await this.staking.tokenByOwner(bob, 1)).to.be.bignumber.equal(new BN(12));
        expect(await this.staking.tokenByOwner(bob, 2)).to.be.bignumber.equal(new BN(20));
        expect(await this.staking.tokenByOwner(bob, 3)).to.be.bignumber.equal(new BN(17));
        expect(await this.staking.tokenByOwner(bob, 4)).to.be.bignumber.equal(new BN(18));
      });

      it('should update the token index mappings', async function () {
        expect(await this.staking.tokenIndex(2)).to.be.bignumber.equal(new BN(0));  // nulls
        expect(await this.staking.tokenIndex(8)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(5)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(3)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(4)).to.be.bignumber.equal(new BN(0));  // actual zero index
        expect(await this.staking.tokenIndex(11)).to.be.bignumber.equal(new BN(0));
        expect(await this.staking.tokenIndex(12)).to.be.bignumber.equal(new BN(1));
        expect(await this.staking.tokenIndex(20)).to.be.bignumber.equal(new BN(2));
        expect(await this.staking.tokenIndex(17)).to.be.bignumber.equal(new BN(3));
        expect(await this.staking.tokenIndex(18)).to.be.bignumber.equal(new BN(4));
      });

      it('should increase vested GYSR balance of pool', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.closeTo(tokens(8 * 2 / 3), TOKEN_DELTA);
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.closeTo(tokens(2 * 2 / 3), TOKEN_DELTA);
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(4), shares: tokens(4) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceReward), SHARE_DELTA);
      });

      it('should emit GysrVested event', async function () {
        const e = this.res.logs.filter(l => l.event === 'GysrVested')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(10 * 2 / 3), TOKEN_DELTA);
      });

    });

    describe('when one user unstakes multiple times', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward0 = 900 * 0.875 * (2 / 3) // 2 tokens, 87.5% vested
        this.aliceReward1 = 900 * 0.875 * (1 / 3) // 1 tokens, 87.5% vested
        this.aliceUnvested0 = 900 * 0.125 * (2 / 3)
        this.aliceUnvested1 = 900 * 0.125 * (1 / 3)

        // days 90 - 135
        this.aliceReward0 += 450 * 0.875 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1) // 2 tokens, 87.5% vested
        this.aliceReward1 += 450 * 0.875 * (1 * this.mult0) / (3 * this.mult0 + 5 * this.mult1) // 1 tokens, 87.5% vested
        this.bobReward = 450 * 0.75 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1) // 5 tokens, 75% vested
        this.aliceUnvested0 += 450 * 0.125 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1)
        this.aliceUnvested1 += 450 * 0.125 * (1 * this.mult0) / (3 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward0 += 450 * 0.875 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)  // 2 tokens, 87.5% vested
        this.aliceReward1 += 450 * 0.875 * (1 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)  // 1 tokens, 87.5% vested
        this.aliceReward0 += 450 * 0.625 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.bobReward += 450 * 0.75 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1 + 2) // 5 tokens, 75% vested
        this.aliceUnvested0 += 450 * 0.125 * (2 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested1 += 450 * 0.125 * (1 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested0 += 450 * 0.375 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2)

        // dust after first unstake
        this.aliceReward1 += this.aliceUnvested0 * 0.875 * (1 * this.mult0) / (1 * this.mult0 + 5 * this.mult1)  // 1 tokens, 87.5% vested
        this.bobReward += this.aliceUnvested0 * 0.75 * (5 * this.mult1) / (1 * this.mult0 + 5 * this.mult1) // 5 tokens, 75% vested
        this.aliceUnvested1 += this.aliceUnvested0 * 0.125 * (1 * this.mult0) / (1 * this.mult0 + 5 * this.mult1)

        // do first unstake
        const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256'], [2, 3, 5, 8]);
        this.res0 = await this.pool.unstake(new BN(4), data0, [], { from: alice });

        // do second unstake
        const data1 = web3.eth.abi.encodeParameters(['uint256'], [4]);
        this.res1 = await this.pool.unstake(new BN(1), data1, [], { from: alice });
      });


      it('should return remaining staking tokens to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(10));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward0 + this.aliceReward1), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward0 - this.aliceReward1), TOKEN_DELTA
        );
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested1), SHARE_DELTA);
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.closeTo(tokens(8), TOKEN_DELTA);
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.closeTo(tokens(2), TOKEN_DELTA);
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(4), shares: tokens(4) }
        );
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(1), shares: tokens(1) }
        );
      });

      it('should emit each RewardsDistributed event', async function () {
        const e0 = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e0.args.user).eq(alice);
        expect(e0.args.token).eq(this.rew.address);
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward0), TOKEN_DELTA);

        const e1 = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e1.args.user).eq(alice);
        expect(e1.args.token).eq(this.rew.address);
        expect(e1.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward1), TOKEN_DELTA);
      });

      it('should emit each GysrVested event', async function () {
        const e0 = this.res0.logs.filter(l => l.event === 'GysrVested')[0];
        expect(e0.args.user).eq(alice);
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(10 * 2 / 3), TOKEN_DELTA);

        const e1 = this.res1.logs.filter(l => l.event === 'GysrVested')[0];
        expect(e1.args.user).eq(alice);
        expect(e1.args.amount).to.be.bignumber.closeTo(tokens(10 / 3), TOKEN_DELTA);
      });
    });


    describe('when multiple users unstake', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward = 900 * 0.875 // 3 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1) // 3 tokens, 87.5% vested
        this.bobReward = 450 * 0.75 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1)
        this.bobUnvested = 450 * 0.25 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)  // 3 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.bobReward += 450 * 0.75 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1 + 2) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (3 * this.mult0) / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (3 * this.mult0 + 5 * this.mult1 + 2)
        this.bobUnvested += 450 * 0.25 * (5 * this.mult1) / (3 * this.mult0 + 5 * this.mult1 + 2)

        // dust after first unstake
        this.bobReward += this.aliceUnvested * 0.75 // all tokens, 75% vested
        this.bobUnvested += this.aliceUnvested * 0.25

        // alice unstakes
        const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [2, 3, 4, 5, 8]);
        this.res0 = await this.pool.unstake(new BN(5), data0, [], { from: alice });

        // bob unstakes
        const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
        this.res1 = await this.pool.unstake(new BN(5), data1, [], { from: bob });
      });

      it('should return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(10));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(new BN(10));
      });

      it('should update the total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should update the total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward - this.bobReward), TOKEN_DELTA
        );
      });

      it('should have no remaining stakes for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should have no remaining stakes for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.bobUnvested), SHARE_DELTA);
      });

      it('should transfer all tokens back to the users', async function () {
        expect(await this.stk.ownerOf(2)).to.be.equal(alice);
        expect(await this.stk.ownerOf(8)).to.be.equal(alice);
        expect(await this.stk.ownerOf(5)).to.be.equal(alice);
        expect(await this.stk.ownerOf(3)).to.be.equal(alice);
        expect(await this.stk.ownerOf(4)).to.be.equal(alice);
        expect(await this.stk.ownerOf(11)).to.be.equal(bob);
        expect(await this.stk.ownerOf(12)).to.be.equal(bob);
        expect(await this.stk.ownerOf(20)).to.be.equal(bob);
        expect(await this.stk.ownerOf(17)).to.be.equal(bob);
        expect(await this.stk.ownerOf(18)).to.be.equal(bob);
      });

      it('should clear the owner for all unstaked tokens', async function () {
        expect(await this.staking.owners(2)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(8)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(5)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(3)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(4)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(11)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(12)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(20)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(17)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.staking.owners(18)).to.be.equal(constants.ZERO_ADDRESS);
      });

      it('should increase vested GYSR balance of pool', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.closeTo(tokens(48), TOKEN_DELTA);
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.closeTo(tokens(12), TOKEN_DELTA);
      });

      it('should emit each Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
        expectEvent(
          this.res1,
          'Unstaked',
          { user: bob, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );
      });

      it('should emit each RewardsDistributed event', async function () {
        const e0 = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e0.args.user).eq(alice);
        expect(e0.args.token).eq(this.rew.address);
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
        expect(e0.args.shares).to.be.bignumber.closeTo(shares(this.aliceReward), SHARE_DELTA);

        const e1 = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e1.args.user).eq(bob);
        expect(e1.args.token).eq(this.rew.address);
        expect(e1.args.amount).to.be.bignumber.closeTo(tokens(this.bobReward), TOKEN_DELTA);
        expect(e1.args.shares).to.be.bignumber.closeTo(shares(this.bobReward), SHARE_DELTA);
      });

      it('should emit each GysrVested event', async function () {
        expectEvent(
          this.res0,
          'GysrVested',
          { user: alice, amount: tokens(10) }
        );
        expectEvent(
          this.res1,
          'GysrVested',
          { user: bob, amount: tokens(50) }
        );
      });
    });

  });

  describe('claim', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.mint(10, { from: alice });
      await this.stk.mint(10, { from: bob });
      await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });
      await this.stk.setApprovalForAll(this.staking.address, true, { from: bob });
      await this.gysr.transfer(alice, tokens(100), { from: org });
      await this.gysr.transfer(bob, tokens(100), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

      this.t0 = await this.reward.lastUpdated();

      // alice stakes 4 tokens at 45 days with a 2.04x multiplier
      await time.increaseTo(this.t0.add(days(45)));
      const data0s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256'], [2, 8, 5, 9]);
      const data0r = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
      await this.pool.stake(new BN(4), data0s, data0r, { from: alice });
      this.t1 = await this.reward.lastUpdated();

      const gysr0 = 10 * 0.01; // reduced wrt staked portion
      const r0 = 0.01; // usage is 0
      this.mult0 = 1 + Math.log10(1 + gysr0 / r0); // ~2.04
      const usage0 = (this.mult0 - 1.0) / this.mult0;

      // bob stakes 5 tokens at 90 days with a 1.4x multiplier
      await time.increaseTo(this.t0.add(days(90)));
      const data1s = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [11, 12, 20, 17, 18]);
      const data1r = web3.eth.abi.encodeParameter('uint256', tokens(50).toString());
      await this.pool.stake(new BN(5), data1s, data1r, { from: bob });

      const gysr1 = 50 * 0.01 * 9 / 5; // reduced wrt staked portion
      const r1 = 0.01 + usage0;
      this.mult1 = 1 + Math.log10(1 + gysr1 / r1); // ~1.4x

      // alice stakes another 2 tokens at 135 days
      await time.increaseTo(this.t0.add(days(135)));
      const data2s = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [3, 4]);
      await this.pool.stake(new BN(2), data2s, [], { from: alice });

      // advance to 180 days
      await time.increaseTo(this.t0.add(days(180)));
    });

    describe('when claim amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(tokens(0), [], [], { from: alice }),
          'smn9' // ERC721StakingModule: claim amount is zero
        );
      });
    });

    describe('when claim amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(new BN(7), [], [], { from: alice }),
          'smn10' // ERC721StakingModule: claim amount exceeds balance
        );
      });
    });

    describe('when one user claims against all tokens', function () {
      beforeEach(async function () {
        // days 0 - 90
        this.aliceReward = 900 * 0.875  // 4 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1) // 4 tokens, 87.5% vested
        this.aliceUnvested += 450 * 0.125 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)  // 3 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.aliceUnvested += 450 * 0.125 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2)

        // claim
        this.res = await this.pool.claim(new BN(6), [], [], { from: alice });
      });

      it('should not return staking tokens to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(4));
      });

      it('should not affect the staking balance for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(6));
      });

      it('should still have one stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward), TOKEN_DELTA
        );
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested), SHARE_DELTA);
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(8));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(2));
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: new BN(6), shares: tokens(6) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceReward), SHARE_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(10) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'claim', 'aquarium', this.res)
      });
    });

    describe('when multiple users claim', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward = 900 * 0.875 // 4 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1) // 4 tokens, 87.5% vested
        this.bobReward = 450 * 0.75 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1)
        this.bobUnvested = 450 * 0.25 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)  // 4 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.bobReward += 450 * 0.75 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1 + 2) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (4 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2)
        this.bobUnvested += 450 * 0.25 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1 + 2)

        // dust after first unstake
        // (note: bob didn't refresh multiplier)
        this.aliceReward += this.bobUnvested * 0.875 * (4 * this.mult0) / (4 * this.mult0 + 5 + 2) // 3 tokens, 87.5% vested
        this.aliceReward += this.bobUnvested * 0.625 * 2 / (4 * this.mult0 + 5 + 2) // 2 tokens, 62.5% vested
        this.aliceUnvested += this.bobUnvested * 0.125 * (4 * this.mult0) / (4 * this.mult0 + 5 + 2)
        this.aliceUnvested += this.bobUnvested * 0.375 * 2 / (4 * this.mult0 + 5 + 2)

        // bob claims
        this.res0 = await this.pool.claim(new BN(5), [], [], { from: bob });

        // alice claims
        this.res1 = await this.pool.claim(new BN(6), [], [], { from: alice });
      });

      it('should not return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(4));
      });

      it('should not return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(new BN(5));
      });

      it('should not affect total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(6));
      });

      it('should not affect total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should have one stake for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should have one stake for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.bobReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward - this.bobReward), TOKEN_DELTA
        );
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested), SHARE_DELTA);
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(48));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(12));
      });

      it('should emit each Claimed event', async function () {
        expectEvent(
          this.res0,
          'Claimed',
          { user: bob, token: this.stk.address, amount: new BN(5), shares: tokens(5) }
        );

        expectEvent(
          this.res1,
          'Claimed',
          { user: alice, token: this.stk.address, amount: new BN(6), shares: tokens(6) }
        );
      });

      it('should emit each RewardsDistributed event', async function () {
        const e0 = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e0.args.user).eq(bob);
        expect(e0.args.token).eq(this.rew.address);
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(this.bobReward), TOKEN_DELTA);

        const e1 = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e1.args.user).eq(alice);
        expect(e1.args.token).eq(this.rew.address);
        expect(e1.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
      });

      it('should emit each GysrVested event', async function () {
        expectEvent(
          this.res0,
          'GysrVested',
          { user: bob, amount: tokens(50) }
        );

        expectEvent(
          this.res1,
          'GysrVested',
          { user: alice, amount: tokens(10) }
        );
      });

    });

    describe('when user claims against some tokens and spends GYSR', function () {
      beforeEach(async function () {
        // releasing 10 tokens per day
        // vesting 0.5 -> 1.0 over 180 days

        // days 0 - 90
        this.aliceReward = 900 * 0.875 * (2 / 4) // 2 tokens, 87.5% vested
        this.aliceUnvested = 900 * 0.125 * (2 / 4)

        // days 90 - 135
        this.aliceReward += 450 * 0.875 * (2 * this.mult0) / (4 * this.mult0 + 5 * this.mult1) // 2 tokens, 87.5% vested
        this.bobReward = 450 * 0.75 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (2 * this.mult0) / (4 * this.mult0 + 5 * this.mult1)
        this.bobUnvested = 450 * 0.25 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1)

        // days 135 - 180
        this.aliceReward += 450 * 0.875 * (2 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)  // 2 tokens, 87.5% vested
        this.aliceReward += 450 * 0.625 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2) // 2 tokens, 62.5% vested
        this.bobReward += 450 * 0.75 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1 + 2) // 5 tokens, 75% vested
        this.aliceUnvested += 450 * 0.125 * (2 * this.mult0) / (4 * this.mult0 + 5 * this.mult1 + 2)
        this.aliceUnvested += 450 * 0.375 * 2 / (4 * this.mult0 + 5 * this.mult1 + 2)
        this.bobUnvested += 450 * 0.25 * (5 * this.mult1) / (4 * this.mult0 + 5 * this.mult1 + 2)

        // alice claims some
        const data = web3.eth.abi.encodeParameter('uint256', tokens(20).toString());
        this.res = await this.pool.claim(new BN(4), [], data, { from: alice });
      });

      it('should not return staking tokens to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(new BN(4));
      });

      it('should not affect total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(new BN(6));
      });

      it('should have two stakes for user in reward module', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should return half the initial GYSR spent for first stake', async function () {
        expect((await this.reward.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(5))
      });

      it('should return new GYSR spent during claim for second stake', async function () {
        expect((await this.reward.stakes(alice, 1)).gysr).to.be.bignumber.equal(tokens(20))
      });

      it('should return the initial GYSR multiplier for first stake', async function () {
        expect((await this.reward.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(bonus(this.mult0), BONUS_DELTA);
      });

      it('should return the new GYSR multiplier for second stake', async function () {
        const usage = (this.mult0 * 2 + this.mult1 * 5 - 7) / (this.mult0 * 2 + this.mult1 * 5); // transient usage during claim
        const mult = 1 + Math.log10(1 + ((20.0 * (0.01 * 11 / 4)) / (0.01 + usage)));
        expect((await this.reward.stakes(alice, 1)).bonus).to.be.bignumber.closeTo(bonus(mult), BONUS_DELTA);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceReward), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(1800 - this.aliceReward), TOKEN_DELTA
        );
      });

      it('should leave dust', async function () {
        expect(await this.reward.rewardDust()).to.be.bignumber.closeTo(shares(this.aliceUnvested), SHARE_DELTA);
      });

      it('should vest some spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(4)); // 80% of half of first stake
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(1)); // 20% of half of first stake
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: new BN(4), shares: tokens(4) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e0 = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e0.args.user).eq(alice);
        expect(e0.args.token).eq(this.rew.address);
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(this.aliceReward), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(5) }  // half of first stake
        );
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(20) }
        );
      });

    });

  });

});
