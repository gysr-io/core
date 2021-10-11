// unit tests for ERC20StakingModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  days,
  reportGas
} = require('../util/helper');

const ERC721StakingModule = contract.fromArtifact('ERC721StakingModule');
const TestERC721 = contract.fromArtifact('TestERC721');
const TestERC1155 = contract.fromArtifact('TestERC1155');



describe('ERC721StakingModule', function () {
  const [org, owner, controller, bob, alice, factory, other] = accounts;

  beforeEach('setup', async function () {
    this.token = await TestERC721.new({ from: org });
  });

  describe('construction', function () {

    describe('when initialized with non ERC721 token', function () {
      it('should fail', async function () {
        const erc1155 = await TestERC1155.new({ from: org });
        await expectRevert(
          ERC721StakingModule.new(erc1155.address, factory, { from: owner }),
          'smn1'  // doesn't implement erc721 interface
        );
      });
    });

    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await ERC721StakingModule.new(
          this.token.address,
          factory,
          { from: owner }
        );
      });
      it('should create an ERC721StakingModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set the owner to the sender address', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should return the correct token address', async function () {
        expect((await this.module.tokens())[0]).to.equal(this.token.address);
      });

      it('should return the correct factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should have zero user balances', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero total balances', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(new BN(0));
      });
    })
  });


  describe('stake', function () {

    beforeEach('setup', async function () {
      // owner creates staking module with erc721 token
      this.module = await ERC721StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // claim tokens and do approval
      await this.token.mint(10, { from: alice });
      await this.token.mint(5, { from: bob });
      await this.token.setApprovalForAll(this.module.address, true, { from: alice });
      await this.token.setApprovalForAll(this.module.address, true, { from: bob });
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(bob, 1, [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when user tries to stake more than their balance', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(bob, 6, [], { from: owner }),
          'smn3'  // exceeds balance
        );
      });
    });

    describe('when invalid data is passed for token id', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256'], [11]);
        await expectRevert(
          this.module.stake(bob, 3, data, { from: owner }),
          'smn4'  // bad data
        );
      });
    });

    describe('when user does not own specified token id', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256'], [8]);
        await expectRevert(
          this.module.stake(bob, 1, data, { from: owner }),
          'ERC721: transfer of token that is not own'
        );
      });
    });

    describe('when user does not own all specified token ids', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [12, 8]);
        await expectRevert(
          this.module.stake(bob, 2, data, { from: owner }),
          'ERC721: transfer of token that is not own'
        );
      });
    });


    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        // alice stakes 2 nfts
        const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [1, 8]);
        this.res0 = await this.module.stake(alice, 2, data0, { from: owner });

        // bob stakes 3 nfts
        const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [11, 12, 14]);
        this.res1 = await this.module.stake(bob, 3, data1, { from: owner });
      });

      it('should decrease each user token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(8));
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(2));
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should update the total staking count for each user', async function () {
        expect(await this.module.counts(alice)).to.be.bignumber.equal(new BN(2));
        expect(await this.module.counts(bob)).to.be.bignumber.equal(new BN(3));
      });

      it('should combine to increase the total token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(new BN(5));
      });

      it('should transfer each token to the module', async function () {
        expect(await this.token.ownerOf(1)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(8)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(11)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(12)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(14)).to.be.equal(this.module.address);
      });

      it('should set the owner for each staked token', async function () {
        expect(await this.module.owners(1)).to.be.equal(alice);
        expect(await this.module.owners(8)).to.be.equal(alice);
        expect(await this.module.owners(11)).to.be.equal(bob);
        expect(await this.module.owners(12)).to.be.equal(bob);
        expect(await this.module.owners(14)).to.be.equal(bob);
      });

      it('should set the owner token mappings', async function () {
        expect(await this.module.tokenByOwner(alice, 0)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.tokenByOwner(alice, 1)).to.be.bignumber.equal(new BN(8));
        expect(await this.module.tokenByOwner(bob, 0)).to.be.bignumber.equal(new BN(11));
        expect(await this.module.tokenByOwner(bob, 1)).to.be.bignumber.equal(new BN(12));
        expect(await this.module.tokenByOwner(bob, 2)).to.be.bignumber.equal(new BN(14));
      });

      it('should set the token index mappings', async function () {
        expect(await this.module.tokenIndex(1)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(8)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.tokenIndex(11)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(12)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.tokenIndex(14)).to.be.bignumber.equal(new BN(2));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: new BN(2), shares: tokens(2) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.token.address, amount: new BN(3), shares: tokens(3) }
        );
      });

      it('gas cost', async function () {
        reportGas('ERC721StakingModule', 'stake', 'stake 3 nfts', this.res1);
      });

    });

  });


  describe('unstake', function () {

    beforeEach('setup', async function () {
      // owner creates staking module with erc721 token
      this.module = await ERC721StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // claim tokens and do approval
      await this.token.mint(10, { from: alice });
      await this.token.mint(5, { from: bob });
      await this.token.setApprovalForAll(this.module.address, true, { from: alice });
      await this.token.setApprovalForAll(this.module.address, true, { from: bob });

      // alice stakes 3 nfts
      const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [1, 2, 8]);
      this.res0 = await this.module.stake(alice, 3, data0, { from: owner });
      // bob stakes 2 nfts
      const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [11, 12]);
      this.res1 = await this.module.stake(bob, 2, data1, { from: owner });

      // advance time
      await time.increase(days(30));
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.unstake(alice, 1, [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when user tries to unstake more than their balance', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [11, 12, 13]);
        await expectRevert(
          this.module.unstake(bob, 3, data, { from: owner }),
          'smn6'  // exceeds balance
        );
      });
    });

    describe('when invalid data is passed for token id', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256'], [11]);
        await expectRevert(
          this.module.unstake(bob, 2, data, { from: owner }),
          'smn7'  // bad data
        );
      });
    });

    describe('when user does not own specified staked token id', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256'], [8]);
        await expectRevert(
          this.module.unstake(bob, 1, data, { from: owner }),
          'smn8'
        );
      });
    });

    describe('when user does not own all specified staked token ids', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [12, 8]);
        await expectRevert(
          this.module.unstake(bob, 2, data, { from: owner }),
          'smn8'
        );
      });
    });


    describe('when one user unstakes all shares', function () {

      beforeEach(async function () {
        // unstake
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [1, 2, 8]);
        this.res = await this.module.unstake(alice, 3, data, { from: owner });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(10));
      });

      it('should update staking balance for user to zero', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(2));
      });

      it('should update the total staking count for user to zero', async function () {
        expect(await this.module.counts(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should update the module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(new BN(2));
      });

      it('should transfer each unstaked token back to the user', async function () {
        expect(await this.token.ownerOf(1)).to.be.equal(alice);
        expect(await this.token.ownerOf(2)).to.be.equal(alice);
        expect(await this.token.ownerOf(8)).to.be.equal(alice);
      });

      it('should leave other tokens in the module', async function () {
        expect(await this.token.ownerOf(11)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(12)).to.be.equal(this.module.address);
      });

      it('should clear the owners for each unstaked token', async function () {
        expect(await this.module.owners(1)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.module.owners(2)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.module.owners(8)).to.be.equal(constants.ZERO_ADDRESS);
      });

      it('should not affect the owners for other tokens', async function () {
        expect(await this.module.owners(11)).to.be.equal(bob);
        expect(await this.module.owners(12)).to.be.equal(bob);
      });

      it('should clear unstaked owner token mappings', async function () {
        expect(await this.module.tokenByOwner(alice, 0)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenByOwner(alice, 1)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenByOwner(alice, 2)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect other owner token mappings', async function () {
        expect(await this.module.tokenByOwner(bob, 0)).to.be.bignumber.equal(new BN(11));
        expect(await this.module.tokenByOwner(bob, 1)).to.be.bignumber.equal(new BN(12));
      });

      it('should clear unstaked token index mappings', async function () {
        expect(await this.module.tokenIndex(1)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(2)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(8)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect other token index mappings', async function () {
        expect(await this.module.tokenIndex(11)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(12)).to.be.bignumber.equal(new BN(1));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.token.address, amount: new BN(3), shares: tokens(3) }
        );
      });

      it('gas cost', async function () {
        reportGas('ERC721StakingModule', 'unstake', 'unstake 3 nfts', this.res);
      });

    });

    describe('when one user unstakes some shares', function () {

      beforeEach(async function () {
        // unstake some
        const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [1, 8]);
        this.res = await this.module.unstake(alice, 2, data, { from: owner });
      });

      it('should return some staking token to user balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(9));
      });

      it('should update staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(1));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(2));
      });

      it('should update the total staking count for user', async function () {
        expect(await this.module.counts(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should update the module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(new BN(3));
      });

      it('should transfer each unstaked token back to the user', async function () {
        expect(await this.token.ownerOf(1)).to.be.equal(alice);
        expect(await this.token.ownerOf(8)).to.be.equal(alice);
      });

      it('should leave remaining tokens in the module', async function () {
        expect(await this.token.ownerOf(2)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(11)).to.be.equal(this.module.address);
        expect(await this.token.ownerOf(12)).to.be.equal(this.module.address);
      });

      it('should clear the owners for each unstaked token', async function () {
        expect(await this.module.owners(1)).to.be.equal(constants.ZERO_ADDRESS);
        expect(await this.module.owners(8)).to.be.equal(constants.ZERO_ADDRESS);
      });

      it('should not affect the owners for other tokens', async function () {
        expect(await this.module.owners(2)).to.be.equal(alice);
        expect(await this.module.owners(11)).to.be.equal(bob);
        expect(await this.module.owners(12)).to.be.equal(bob);
      });

      it('should reindex remaining owner token mappings', async function () {
        expect(await this.module.tokenByOwner(alice, 0)).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect other owner token mappings', async function () {
        expect(await this.module.tokenByOwner(bob, 0)).to.be.bignumber.equal(new BN(11));
        expect(await this.module.tokenByOwner(bob, 1)).to.be.bignumber.equal(new BN(12));
      });

      it('should clear unstaked token index mappings', async function () {
        expect(await this.module.tokenIndex(1)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(8)).to.be.bignumber.equal(new BN(0));
      });

      it('should update remaining token index mappings', async function () {
        expect(await this.module.tokenIndex(2)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect other token index mappings', async function () {
        expect(await this.module.tokenIndex(11)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.tokenIndex(12)).to.be.bignumber.equal(new BN(1));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.token.address, amount: new BN(2), shares: tokens(2) }
        );
      });

    });
  });


  describe('claim', function () {

    beforeEach('alice and bob stake', async function () {
      // owner creates staking module with erc721 token
      this.module = await ERC721StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // claim tokens and do approval
      await this.token.mint(10, { from: alice });
      await this.token.mint(5, { from: bob });
      await this.token.setApprovalForAll(this.module.address, true, { from: alice });
      await this.token.setApprovalForAll(this.module.address, true, { from: bob });

      // alice stakes 3 nfts
      const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [1, 2, 8]);
      this.res0 = await this.module.stake(alice, 3, data0, { from: owner });
      // bob stakes 2 nfts
      const data1 = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [11, 12]);
      this.res1 = await this.module.stake(bob, 2, data1, { from: owner });

      // advance time
      await time.increase(days(30));
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.claim(alice, new BN(1), [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when user tries to claim more than their balance', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.claim(alice, new BN(4), [], { from: owner }),
          'smn10'  // exceeds balance
        );
      });
    });

    describe('when one user claims with all shares', function () {

      beforeEach(async function () {
        // claim
        this.res = await this.module.claim(alice, 3, [], { from: owner });
      });

      it('should not return staking token to user balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
      });

      it('should not affect staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect the total staking count for user', async function () {
        expect(await this.module.counts(alice)).to.be.bignumber.equal(new BN(3));
      });

      it('should not affect the module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(new BN(5));
      });

      it('should emit Claimed event with all shares', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.token.address, amount: new BN(3), shares: tokens(3) }
        );
      });

    });

    describe('when one user claims with some shares', function () {

      beforeEach(async function () {
        // claim
        this.res = await this.module.claim(alice, 1, [], { from: owner });
      });

      it('should not return staking token to user balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
      });

      it('should not affect staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(3));
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(5));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(2));
      });

      it('should not affect the total staking count for user', async function () {
        expect(await this.module.counts(alice)).to.be.bignumber.equal(new BN(3));
      });

      it('should emit Claimed event with some shares', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.token.address, amount: new BN(1), shares: tokens(1) }
        );
      });

    });
  });

});
