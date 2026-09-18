import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import { prepareSellTokens } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';

const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"

const testFuruPool: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
  owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
  sats: 587793838,
  token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
  tokens: 4363102,
  tx_pos: 0,
  txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
}

function setupSellTx(userInputs: Utxo[]) {
  const provider = new MockNetworkProvider();
  provider.network = 'mainnet';
  const options = { provider, contractType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifactWithPkh(testFuruPool.owner_pkh), [], options);
  provider.addUtxo(cauldronContract.address, convertPoolToUtxo(testFuruPool))

  for (const utxo of userInputs) {
    provider.addUtxo(testUserTokenAddress, utxo);
  }

  return provider
}

describe('prepareSellTokens', () => {
  test('should fail when insufficient token balance', async() => {
    const provider = setupSellTx([
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 50n } }),
      randomUtxo({ satoshis: 100_000n }),
    ])

    const promise = prepareSellTokens([testFuruPool], 100n, testUserTokenAddress, testUserWif, provider)
    await expect(promise).rejects.toThrow(/Insufficient tokens/)
  })

  test('should fail when insufficient bch for fee', async() => {
    const provider = setupSellTx([
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
    ])

    const promise = prepareSellTokens([testFuruPool], 100n, testUserTokenAddress, testUserWif, provider)
    await expect(promise).rejects.toThrow(/missing userBchFeeInput/)
  })

  test('should succeed with single token input', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ]
    const provider = setupSellTx(userInputs)

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()

    transactionBuilder.build()
    const { feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
    expect(feeSatsPerByte > 1 && feeSatsPerByte < 5).toBe(true);
  })

  test('should succeed with multiple small token inputs', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 30n } }),
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 30n } }),
      randomUtxo({ satoshis: 100_000n }),
    ]
    const provider = setupSellTx(userInputs)

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()

    transactionBuilder.build()
    const { feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
    expect(feeSatsPerByte > 1 && feeSatsPerByte < 5).toBe(true);
  })

  test('should succeed with exact token balance (no token change)', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 1000n, token: { category: testFuruPool.token_id, amount: 200n } }),
      randomUtxo({ satoshis: 100_000n }),
    ]
    const provider = setupSellTx(userInputs)

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 200n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()

    transactionBuilder.build()
    const { feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
    expect(feeSatsPerByte > 1 && feeSatsPerByte < 5).toBe(true);
  })

  test('should succeed with combined bch + tokens on single input', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 10_000_000n, token: { category: testFuruPool.token_id, amount: 500n } }),
      randomUtxo({ satoshis: 100_000n }),
    ]
    const provider = setupSellTx(userInputs)

    const { transactionBuilder } = await prepareSellTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    
    transactionBuilder.build()
    const { feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
    expect(feeSatsPerByte > 1 && feeSatsPerByte < 5).toBe(true);
  })
})
