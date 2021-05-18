// test module for GeyserInfo contract

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
const PoolFactory = contract.fromArtifact('PoolFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const PoolInfo = contract.fromArtifact('PoolInfo');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);


describe('PoolInfo', function () {
    const [owner, org, treasury, alice, bob, other] = accounts;

    // TODO

});
