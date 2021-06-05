// test module for PoolInfo contract

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
    tokens,
    bonus,
    days,
    shares,
    toFixedPointBigNumber,
    fromFixedPointBigNumber,
    DECIMALS
} = require('../util/helper');

const Pool = contract.fromArtifact('Pool');
const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const PoolFactory = contract.fromArtifact('PoolFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const PoolInfo = contract.fromArtifact('PoolInfo');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);


describe('PoolInfo', function () {
    const [owner, org, treasury, stakingModuleFactory, rewardModuleFactory, alice, bob, other] = accounts;

    beforeEach('setup', async function () {
        // base setup
        this.gysr = await GeyserToken.new({ from: org });
        this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
        this.rew = await TestToken.new({ from: org });
        this.stk = await TestLiquidityToken.new({ from: org });
        this.info = await PoolInfo.new({ from: org });

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

    describe('when getting module info', function () {
        beforeEach(async function () {
            this.res = await this.info.modules(this.pool.address);
        });

        it('should return staking module address as first argument', async function () {
            expect(this.res[0]).to.equal(this.staking.address);
        });

        it('should return reward module address as second argument', async function () {
            expect(this.res[1]).to.equal(this.reward.address);
        });

        it('should return staking module factory address (i.e. module type) as third argument', async function () {
            expect(this.res[2]).to.equal(stakingModuleFactory);
        });

        it('should return reward module factory address (i.e. module type) as fourth argument', async function () {
            expect(this.res[3]).to.equal(rewardModuleFactory);
        });
    });

});
