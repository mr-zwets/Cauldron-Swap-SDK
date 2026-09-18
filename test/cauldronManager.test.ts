import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import { CauldronManager, DEFAULT_FEE_RATE_SATS_PER_BYTE } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';
import { expectFeeRate } from './utils.js';

const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"
// pkh of testUserTokenAddress, so the same signer owns the pool in the withdraw test
const testUserPkh = "6052f3329f33cab60c7b5aad9785e08d35a35a99"

const testFuruPool: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
  owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
  sats: 587793838,
  token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
  tokens: 4363102,
  tx_pos: 0,
  txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
}

function setupProvider(pools: CauldronActivePool[], userInputs: Utxo[], network: 'mainnet' | 'chipnet' = 'mainnet') {
  const provider = new MockNetworkProvider();
  provider.network = network;
  const options = { provider, contractType: 'p2sh32' as const };
  for (const pool of pools) {
    const cauldronContract = new Contract(cauldronArtifactWithPkh(pool.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(pool));
  }
  for (const utxo of userInputs) {
    provider.addUtxo(testUserTokenAddress, utxo);
  }
  return provider;
}

describe('CauldronManager configuration', () => {
  test('takes its network from the provider', () => {
    expect(new CauldronManager({ provider: setupProvider([], []) }).network).toBe('mainnet')
    expect(new CauldronManager({ provider: setupProvider([], [], 'chipnet') }).network).toBe('chipnet')
  })

  test('rejects a network Cauldron has no indexer for', () => {
    const provider = setupProvider([], [])
    provider.network = 'regtest'

    expect(() => new CauldronManager({ provider })).toThrow(/Unsupported network 'regtest'/)
  })

  test('defaults the fee rate and accepts an override', () => {
    const provider = setupProvider([], [])

    expect(new CauldronManager({ provider }).feeRateSatsPerByte).toBe(DEFAULT_FEE_RATE_SATS_PER_BYTE)
    expect(new CauldronManager({ provider, feeRateSatsPerByte: 3 }).feeRateSatsPerByte).toBe(3)
  })

  test('rejects an invalid fee rate up front', () => {
    const provider = setupProvider([], [])

    expect(() => new CauldronManager({ provider, feeRateSatsPerByte: 0.5 })).toThrow(/at least 1/)
    expect(() => new CauldronManager({ provider, feeRateSatsPerByte: 20 })).toThrow(/below the builder's cap/)
  })
})

describe('CauldronManager transactions', () => {
  test('applies its provider and fee rate to a buy', async () => {
    const provider = setupProvider([testFuruPool], [randomUtxo({ satoshis: 100_000_000n })])
    const cauldron = new CauldronManager({ provider, feeRateSatsPerByte: 2 })

    const { transactionBuilder } = await cauldron.prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, 2)
  })

  test('applies its provider and fee rate to a sell', async () => {
    const provider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ])
    const cauldron = new CauldronManager({ provider, feeRateSatsPerByte: 2 })

    const { transactionBuilder } = await cauldron.prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, 2)
  })

  test('applies its provider and fee rate to a withdrawal', async () => {
    const ownedPool: CauldronActivePool = { ...testFuruPool, owner_pkh: testUserPkh }
    const provider = setupProvider([ownedPool], [])
    const cauldron = new CauldronManager({ provider, feeRateSatsPerByte: 2 })

    const { transactionBuilder } = await cauldron.prepareWithdrawAll(
      ownedPool, testUserTokenAddress, testUserWif
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, 2)
  })

  test('passes its network to pool creation, not the mainnet default', async () => {
    // the standalone prepareCreatePool defaults its network parameter to mainnet regardless of the
    // provider, so a chipnet contract address proves the manager passed its own network through
    const provider = setupProvider([], [], 'chipnet')
    const userUtxos = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
    ]
    const cauldron = new CauldronManager({ provider })

    const { transactionBuilder, poolContractAddress } = await cauldron.prepareCreatePool(
      testFuruPool.token_id, 100_000n, 100n, testUserWif, userUtxos
    )
    expect(poolContractAddress.startsWith('bchtest:')).toBe(true)
    expectFeeRate(transactionBuilder)
  })
})
