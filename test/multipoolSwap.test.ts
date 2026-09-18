import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import { prepareBuyTokens, prepareSellTokens } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';
import { expectFeeRate } from './utils.js';

const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"

const tokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea";

const testPool1: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
  owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
  sats: 587793838,
  token_id: tokenId,
  tokens: 4363102,
  tx_pos: 0,
  txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
}

const testPool2: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6",
  owner_pkh: "0000000000000000000000000000000000000001",
  sats: 300_000_000,
  token_id: tokenId,
  tokens: 3_000_000,
  tx_pos: 0,
  txid: "bb283eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4cc"
}

const testPool3: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6",
  owner_pkh: "0000000000000000000000000000000000000002",
  sats: 200_000_000,
  token_id: tokenId,
  tokens: 2_000_000,
  tx_pos: 0,
  txid: "cc383eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4dd"
}

function setupMultiPoolProvider(pools: CauldronActivePool[], userInputs: Utxo[]) {
  const provider = new MockNetworkProvider();
  provider.network = 'mainnet';
  const options = { provider, contractType:'p2sh32' as const };

  for (const pool of pools) {
    const cauldronContract = new Contract(cauldronArtifactWithPkh(pool.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(pool));
  }

  for (const utxo of userInputs) {
    provider.addUtxo(testUserTokenAddress, utxo);
  }

  return provider;
}

describe('multi-pool buy', () => {
  test('should build valid tx with 2 pools', async () => {
    const pools = [testPool1, testPool2];
    const userInputs = [randomUtxo({ satoshis: 500_000_000n })];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareBuyTokens(
      pools, 1000n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();
    
    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('should build valid tx with 3 pools', async () => {
    const pools = [testPool1, testPool2, testPool3];
    const userInputs = [randomUtxo({ satoshis: 500_000_000n })];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareBuyTokens(
      pools, 500n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();

    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('single pool in array still works', async () => {
    const pools = [testPool1];
    const userInputs = [randomUtxo({ satoshis: 100_000_000n })];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareBuyTokens(
      pools, 100n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();

    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('should fail with insufficient BCH for multi-pool trade', async () => {
    const pools = [testPool1, testPool2];
    const userInputs = [randomUtxo({ satoshis: 1000n })];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const promise = prepareBuyTokens(
      pools, 1000n, testUserTokenAddress, testUserWif, provider
    );
    await expect(promise).rejects.toThrow(/Insufficient BCH/);
  });
});

describe('multi-pool sell', () => {
  test('should build valid tx with 2 pools', async () => {
    const pools = [testPool1, testPool2];
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: tokenId, amount: 1000n } }),
      randomUtxo({ satoshis: 100_000n }),
    ];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareSellTokens(
      pools, 500n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();
    
    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('should build valid tx with 3 pools', async () => {
    const pools = [testPool1, testPool2, testPool3];
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: tokenId, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareSellTokens(
      pools, 300n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();

    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('single pool in array still works', async () => {
    const pools = [testPool1];
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: tokenId, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareSellTokens(
      pools, 100n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();
    
    transactionBuilder.build();
    expectFeeRate(transactionBuilder)
  });

  test('should pay the fee from the sale proceeds without a separate bch input', async () => {
    const pools = [testPool1, testPool2];
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: tokenId, amount: 1000n } }),
    ];
    const provider = setupMultiPoolProvider(pools, userInputs);

    const { transactionBuilder } = await prepareSellTokens(
      pools, 500n, testUserTokenAddress, testUserWif, provider
    );
    expect(() => transactionBuilder.debug()).not.toThrow();

    // every input is a pool or the user's token utxo, no separate bch fee input was needed
    expect(transactionBuilder.inputs.every(input => input.token !== undefined)).toBe(true);
    expectFeeRate(transactionBuilder);
  });
});
