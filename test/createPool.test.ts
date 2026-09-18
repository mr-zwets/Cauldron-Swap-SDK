import {
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import { decodeTransactionUnsafe, hexToBin, binToHex } from '@bitauth/libauth';
import { prepareCreatePool } from '../src/index.js';
import { expectFeeRate } from './utils.js';

// This is the token address derived from testUserWif on mainnet
const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"
const testTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"

function setupCreatePoolTx(userInputs: Utxo[]) {
  const provider = new MockNetworkProvider();
  provider.network = 'mainnet';
  for (const utxo of userInputs) {
    provider.addUtxo(testUserTokenAddress, utxo);
  }
  return provider
}

describe('prepareCreatePool', () => {
  test('should fail with non-positive poolSats', async() => {
    const provider = setupCreatePoolTx([])
    const promise = prepareCreatePool(testTokenId, 0n, 100n, testUserWif, 'mainnet', provider)
    await expect(promise).rejects.toThrow(/satsAmount must be a positive number/)
  })

  test('should fail with non-positive poolTokens', async() => {
    const provider = setupCreatePoolTx([])
    const promise = prepareCreatePool(testTokenId, 100_000n, 0n, testUserWif, 'mainnet', provider)
    await expect(promise).rejects.toThrow(/tokenAmount must be a positive number/)
  })

  test('should fail when insufficient token balance', async() => {
    const provider = setupCreatePoolTx([
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 50n } }),
    ])
    const promise = prepareCreatePool(testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider)
    await expect(promise).rejects.toThrow(/Insufficient tokens/)
  })

  test('should fail when insufficient bch balance', async() => {
    const provider = setupCreatePoolTx([
      randomUtxo({ satoshis: 1000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 500n } }),
    ])
    const promise = prepareCreatePool(testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider)
    await expect(promise).rejects.toThrow(/Insufficient BCH/)
  })

  test('should succeed with sufficient balances', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 500n } }),
    ]
    const provider = setupCreatePoolTx(userInputs)

    const { transactionBuilder, poolContractAddress, ownerPkh } = await prepareCreatePool(
      testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider
    )

    expect(poolContractAddress).toBeDefined()
    expect(ownerPkh).toBeDefined()

    transactionBuilder.build()
    expectFeeRate(transactionBuilder)
  })

  test('should succeed with exact token balance (no token change)', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 100n } }),
    ]
    const provider = setupCreatePoolTx(userInputs)

    const { transactionBuilder } = await prepareCreatePool(
      testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider
    )

    const txHex = transactionBuilder.build()
    expectFeeRate(transactionBuilder)

    // With exact token balance there should be no token change output
    const decoded = decodeTransactionUnsafe(hexToBin(txHex))
    // Outputs: pool UTXO, OP_RETURN, BCH change (no token change)
    expect(decoded.outputs.length).toBe(3)
  })

  test('should succeed with multiple small token inputs', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 30n } }),
    ]
    const provider = setupCreatePoolTx(userInputs)

    const { transactionBuilder } = await prepareCreatePool(
      testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider
    )

    transactionBuilder.build()
    expectFeeRate(transactionBuilder)
  })

  test('should include OP_RETURN with SUMMON and owner PKH', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 500n } }),
    ]
    const provider = setupCreatePoolTx(userInputs)

    const { transactionBuilder, ownerPkh } = await prepareCreatePool(
      testTokenId, 100_000n, 100n, testUserWif, 'mainnet', provider
    )

    const txHex = transactionBuilder.build()
    const decoded = decodeTransactionUnsafe(hexToBin(txHex))

    // OP_RETURN is at index 1 (after pool output, before change)
    const opReturnOutput = decoded.outputs[1]
    expect(opReturnOutput.valueSatoshis).toBe(0n)

    // OP_RETURN lockingBytecode should contain "SUMMON" and the owner PKH
    const lockingHex = binToHex(opReturnOutput.lockingBytecode)
    const summonHex = binToHex(new TextEncoder().encode('SUMMON'))
    expect(lockingHex).toContain(summonHex)
    expect(lockingHex).toContain(ownerPkh)
  })

  test('pool output should be at index 0 with correct token and sats', async() => {
    const poolSats = 200_000n
    const poolTokens = 500n
    const userInputs = [
      randomUtxo({ satoshis: 1_000_000n }),
      randomUtxo({ satoshis: 1000n, token: { category: testTokenId, amount: 1000n } }),
    ]
    const provider = setupCreatePoolTx(userInputs)

    const { transactionBuilder } = await prepareCreatePool(
      testTokenId, poolSats, poolTokens, testUserWif, 'mainnet', provider
    )

    const txHex = transactionBuilder.build()
    const decoded = decodeTransactionUnsafe(hexToBin(txHex))

    // First output is the pool UTXO
    const poolOutput = decoded.outputs[0]
    expect(poolOutput.valueSatoshis).toBe(poolSats)
    expect(poolOutput.token?.amount).toBe(poolTokens)
    expect(binToHex(poolOutput.token!.category)).toBe(testTokenId)
  })
})
