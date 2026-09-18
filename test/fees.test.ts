import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import {
  prepareBuyTokens,
  prepareCreatePool,
  prepareSellTokens,
  prepareWithdrawAll,
} from '../src/index.js';
import {
  assertValidFeeRate,
  BUILDER_MAX_FEE_SATS_PER_BYTE,
  calculateFeeForSize,
  calculateFeePerUserInput,
  calculateSelectionFeeReserve,
  DEFAULT_FEE_RATE_SATS_PER_BYTE,
} from '../src/fees.js';
import { InsufficientFundsError, InsufficientTokensError } from '../src/errors.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';
import { expectFeeRate } from './utils.js';

// cashscript drops change below this into the fee, there is no other way to spend it
const DUST_LIMIT_SATS = 546

const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"
// pkh of testUserTokenAddress, so the same signer owns the pool in the withdraw tests
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

function setupProvider(pools: CauldronActivePool[], userInputs: Utxo[]) {
  const provider = new MockNetworkProvider();
  provider.network = 'mainnet';
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

describe('fee rate helpers', () => {
  test('the default fee rate is 1.2 sats per byte', () => {
    expect(DEFAULT_FEE_RATE_SATS_PER_BYTE).toBe(1.2)
  })

  test('calculateFeeForSize rounds the fee up to a whole satoshi', () => {
    expect(calculateFeeForSize(100n, 1.2)).toBe(120n)
    expect(calculateFeeForSize(101n, 1.2)).toBe(122n) // 121.2 rounded up
    expect(calculateFeeForSize(250n)).toBe(300n)
  })

  test('calculateFeePerUserInput prices a signed P2PKH input at 141 bytes', () => {
    expect(calculateFeePerUserInput(1)).toBe(141n)
    expect(calculateFeePerUserInput(1.2)).toBe(170n) // ceil(141 * 1.2)
  })

  test('calculateSelectionFeeReserve grows with pools and extra user inputs', () => {
    const noPools = calculateSelectionFeeReserve(0, 1)
    const onePool = calculateSelectionFeeReserve(1, 1)
    const twoPools = calculateSelectionFeeReserve(2, 1)
    // each extra pool adds its input and output bytes
    expect(onePool - noPools).toBe(twoPools - onePool)
    expect(onePool).toBeGreaterThan(noPools)
    // each token input the caller adds itself is surcharged separately
    expect(calculateSelectionFeeReserve(1, 1, 2) - onePool).toBe(2n * calculateFeePerUserInput(1))
  })

  test('assertValidFeeRate rejects rates below the relay floor', () => {
    expect(() => assertValidFeeRate(0.9)).toThrow(/at least 1/)
    expect(() => assertValidFeeRate(0)).toThrow(/at least 1/)
    expect(() => assertValidFeeRate(NaN)).toThrow(/at least 1/)
  })

  test('assertValidFeeRate rejects rates at or above the builder cap', () => {
    expect(() => assertValidFeeRate(BUILDER_MAX_FEE_SATS_PER_BYTE)).toThrow(/below the builder's cap/)
    expect(() => assertValidFeeRate(BUILDER_MAX_FEE_SATS_PER_BYTE + 1)).toThrow(/below the builder's cap/)
  })

  test('assertValidFeeRate accepts the default and the bounds in between', () => {
    expect(() => assertValidFeeRate(DEFAULT_FEE_RATE_SATS_PER_BYTE)).not.toThrow()
    expect(() => assertValidFeeRate(1)).not.toThrow()
    expect(() => assertValidFeeRate(9.99)).not.toThrow()
  })
})

describe('prepare functions target the configured fee rate', () => {
  test.each([1, 1.2, 2.5, 5])('prepareBuyTokens pays %s sats per byte', async (feeRate) => {
    const provider = setupProvider([testFuruPool], [randomUtxo({ satoshis: 100_000_000n })])

    const { transactionBuilder } = await prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider, undefined, feeRate
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, feeRate)
  })

  test.each([1, 1.2, 2.5, 5])('prepareSellTokens pays %s sats per byte', async (feeRate) => {
    const provider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ])

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider, undefined, feeRate
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, feeRate)
  })

  test.each([1, 1.2, 2.5, 5])('prepareWithdrawAll pays %s sats per byte', async (feeRate) => {
    const ownedPool: CauldronActivePool = { ...testFuruPool, owner_pkh: testUserPkh }
    const provider = setupProvider([ownedPool], [])

    const { transactionBuilder } = await prepareWithdrawAll(
      ownedPool, testUserTokenAddress, testUserWif, provider, feeRate
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    expectFeeRate(transactionBuilder, feeRate)
  })

  test.each([1, 1.2, 2.5, 5])('prepareCreatePool pays %s sats per byte', async (feeRate) => {
    const provider = setupProvider([], [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
    ])

    const { transactionBuilder } = await prepareCreatePool(
      testFuruPool.token_id, 100_000n, 100n, testUserWif, 'mainnet', provider, undefined, feeRate
    )
    expectFeeRate(transactionBuilder, feeRate)
  })

  test('a sell without a spare bch utxo is funded from the proceeds', async () => {
    const provider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
    ])

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 10n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    // the fee reserve is only an over-estimate, so coming up short of it must not block selection
    expect(transactionBuilder.inputs.every(input => input.token !== undefined)).toBe(true)
    expectFeeRate(transactionBuilder)
  })

  test('a sell too small to leave more than dust pays the remainder to the miner', async () => {
    // selling 5 tokens nets ~670 sats, which covers the ~540 sat fee but leaves less than the 546 sat
    // dust limit, so no change output can be created and the remainder goes to the miner
    const provider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
    ])

    const { transactionBuilder, totalSatsReceived } = await prepareSellTokens(
      [testFuruPool], 5n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()

    // the tokens still come back, but there is no BCH output for the proceeds
    expect(transactionBuilder.outputs.some(output => !output.token)).toBe(false)
    // so the whole remainder is the fee, above the targeted rate, and above the net the user sees
    const { feeSats } = transactionBuilder.calculateTransactionFee()
    expect(feeSats).toBeGreaterThan(calculateFeeForSize(transactionBuilder.getTransactionSize()))
    expect(feeSats).toBeGreaterThan(totalSatsReceived - BigInt(DUST_LIMIT_SATS))
  })

  test('a withdrawal from a pool below the dust limit pays the remainder to the miner', async () => {
    const tinyPool: CauldronActivePool = { ...testFuruPool, owner_pkh: testUserPkh, sats: 1600, tokens: 100 }
    const provider = setupProvider([tinyPool], [])

    const { transactionBuilder } = await prepareWithdrawAll(
      tinyPool, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()

    // only the token output survives, the 1600 - 1000 sat remainder cannot be paid out
    expect(transactionBuilder.outputs.length).toBe(1)
    expect(transactionBuilder.calculateTransactionFee().feeSats).toBe(600n)
  })

  test('a shortfall in bch throws a typed error carrying the missing amount', async () => {
    const provider = setupProvider([testFuruPool], [randomUtxo({ satoshis: 1000n })])

    const error = await prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    ).catch(caught => caught)

    expect(error).toBeInstanceOf(InsufficientFundsError)
    expect(error.shortfallSats).toBeGreaterThan(0n)
    // topping the wallet up by the reported shortfall makes the trade go through
    const toppedUpProvider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n + error.shortfallSats }),
    ])
    const { transactionBuilder } = await prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, toppedUpProvider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
  })

  test('a shortfall in tokens throws a typed error carrying the missing amount', async () => {
    const provider = setupProvider([testFuruPool], [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 60n } }),
      randomUtxo({ satoshis: 100_000n }),
    ])

    const error = await prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    ).catch(caught => caught)

    expect(error).toBeInstanceOf(InsufficientTokensError)
    expect(error.shortfallTokens).toBe(40n)
  })

  test('a fee shortfall throws a typed error carrying the missing amount', async () => {
    // the pool cannot pay the miner fee out of its own 700 sats once the token output is funded
    const tinyPool: CauldronActivePool = { ...testFuruPool, owner_pkh: testUserPkh, sats: 700, tokens: 100 }
    const provider = setupProvider([tinyPool], [])

    const error = await prepareWithdrawAll(
      tinyPool, testUserTokenAddress, testUserWif, provider
    ).catch(caught => caught)

    expect(error).toBeInstanceOf(InsufficientFundsError)
    expect(error.shortfallSats).toBeGreaterThan(0n)
  })

  test('a rejected change output keeps its own error instead of looking like a shortfall', async () => {
    // a valid token address, but on chipnet while the provider is on mainnet. Selling the exact balance
    // leaves no token change, so the BCH change output is the first one to hit the bad address
    const chipnetTokenAddress = "bchtest:zps99uejnueu4dsv0dd2m9u9uzxntg66nyl7c7z260"
    const userUtxos = [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 200n } }),
      randomUtxo({ satoshis: 100_000n }),
    ]
    const provider = setupProvider([testFuruPool], userUtxos)

    const error = await prepareSellTokens(
      [testFuruPool], 200n, chipnetTokenAddress, testUserWif, provider, userUtxos
    ).catch(caught => caught)

    // the inputs cover the fee many times over, so this must not be reported as a funding problem
    expect(error).not.toBeInstanceOf(InsufficientFundsError)
    expect(error.message).toMatch(/wrong network/)
  })

  test('an invalid fee rate is rejected before any utxo is fetched', async () => {
    const provider = setupProvider([testFuruPool], [randomUtxo({ satoshis: 100_000_000n })])

    await expect(prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider, undefined, 0.5
    )).rejects.toThrow(/at least 1/)
  })
})
