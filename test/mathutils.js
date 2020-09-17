// test module for MathUtils

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { toFixedPointBigNumber, fromFixedPointBigNumber } = require('./util/helper');

const MathUtils = contract.fromArtifact('MathUtils');


describe('testing helpers (yes, meta tests...)', function () {

  it('should encode integer to fixed point big number', function () {
    bn = toFixedPointBigNumber(42, 10, 18);
    expect(bn).to.be.bignumber.equal(new BN(42).mul((new BN(10)).pow(new BN(18))));
  });

  it('should encode decimal to fixed point big number', function () {
    bn = toFixedPointBigNumber(1.23456, 10, 18);
    expect(bn).to.be.bignumber.closeTo(new BN('1234560000000000000'), '100');
  });

  it('should decode fixed point big number to integer', function () {
    bn = new BN(42).mul((new BN(10)).pow(new BN(18)));
    x = fromFixedPointBigNumber(bn, 10, 18);
    expect(x).to.be.equal(42);
  });

  it('should decode fixed point big number to decimal', function () {
    bn = new BN('1234560000000000000');
    x = fromFixedPointBigNumber(bn, 10, 18);
    expect(x).to.be.approximately(1.23456, 0.000001);
  });
});

describe('math utils library', function () {

  it('should compute log2 properly', async function () {
    math = await MathUtils.new();
    coeff = (new BN(2)).pow(new BN(64));
    x = new BN(500);
    x = x.mul(coeff);
    ybn = await math.testlogbase2(x);
    y = fromFixedPointBigNumber(ybn, 2, 64);
    expect(y).to.be.approximately(Math.log2(500), 0.000001)
  });

  it('should compute log10 properly', async function () {
    math = await MathUtils.new();
    coeff = (new BN(2)).pow(new BN(64));
    for (var i = 0; i < 8; i++) {
      x = new BN(10 ** i + 7);
      x = x.mul(coeff);
      y = await math.testlogbase10(x);
      y = y.div(coeff);
      expect(y.toNumber()).to.be.equal(i);
    }
  });
});

