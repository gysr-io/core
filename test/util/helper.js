const { BN } = require('@openzeppelin/test-helpers');
const { promisify } = require('util');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');

// same const used for GYSR, test token, and bonus value returns
const DECIMALS = 18;

function tokens(x) {
  return toFixedPointBigNumber(x, 10, DECIMALS);
}

function bonus(x) {
  return toFixedPointBigNumber(x, 10, DECIMALS);
}

function days(x) {
  return new BN(60 * 60 * 24 * x);
}

function shares(x) {
  return new BN(10 ** 6).mul(toFixedPointBigNumber(x, 10, DECIMALS));
}

function toFixedPointBigNumber(x, base, decimal) {
  x_ = x;
  bn = new BN(0);
  for (i = 0; i < decimal; i++) {
    // shift next decimal chunk to integer
    v = x_;
    for (j = 0; j < i; j++) {
      v *= base;
    }
    v = Math.floor(v);

    // add to big number
    bn = bn.add((new BN(v)).mul((new BN(base)).pow(new BN(decimal - i))));

    // shift back to decimal and remove
    for (j = 0; j < i; j++) {
      v /= base;
    }
    x_ -= v;
  }
  return bn;
}

function fromFixedPointBigNumber(x, base, decimal) {
  x_ = new BN(x);
  value = 0.0;
  for (i = 0; i < decimal; i++) {
    // get next chunk from big number
    c = (new BN(base)).pow(new BN(decimal - i))
    v = x_.div(c);
    x_ = x_.sub(v.mul(c));

    // shift bn chunk to decimal and add
    v_ = v.toNumber();
    for (j = 0; j < i; j++) {
      v_ /= base;
    }
    value += v_;
  }
  return value;
}

module.exports = {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  DECIMALS
};
