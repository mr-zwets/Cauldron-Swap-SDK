import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
  type Utxo,
} from 'cashscript';
import { prepareBuyTokens } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';
import { expectFeeRate } from './utils.js';

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

function setupBuyTx(userInputs: Utxo[]) {
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

describe('prepareBuyTokens', () => {
  test('should fail when insufficient bch balance', async() => {
    const provider = setupBuyTx([
      randomUtxo({ satoshis: 1000n }),
    ])

    const promise = prepareBuyTokens([testFuruPool], 100n, testUserTokenAddress, testUserWif, provider)
    await expect(promise).rejects.toThrow(/Insufficient BCH/)
  })

  test('should succeed with single user input', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 100_000_000n }),
    ]
    const provider = setupBuyTx(userInputs)

    const { transactionBuilder } = await prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    
    transactionBuilder.build()
    expectFeeRate(transactionBuilder)
  })

  test('should succeed with multiple small bch inputs', async() => {
    const userInputs = [
      randomUtxo({ satoshis: 5_000_000n }),
      randomUtxo({ satoshis: 5_000_000n }),
      randomUtxo({ satoshis: 5_000_000n }),
      randomUtxo({ satoshis: 5_000_000n }),
    ]
    const provider = setupBuyTx(userInputs)

    const { transactionBuilder } = await prepareBuyTokens(
      [testFuruPool], 100n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    transactionBuilder.build()
    expectFeeRate(transactionBuilder)
  })

  test('should succeed with large buy relative to pool size (fee rounding)', async() => {
    // Small pool where buy fee rounding matters for contract evaluation
    const smallPool: CauldronActivePool = {
      owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
      owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
      sats: 1_000_000,
      token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
      tokens: 1_000,
      tx_pos: 0,
      txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
    }
    const userInputs = [
      randomUtxo({ satoshis: 500_000_000n }),
    ]
    const provider = new MockNetworkProvider();
    provider.network = 'mainnet';
    const options = { provider, contractType:'p2sh32' as const };
    const cauldronContract = new Contract(cauldronArtifactWithPkh(smallPool.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(smallPool))
    for (const utxo of userInputs) {
      provider.addUtxo(testUserTokenAddress, utxo);
    }

    // Buy 300 tokens (30% of pool) — triggers fee rounding mismatch
    const { transactionBuilder } = await prepareBuyTokens(
      [smallPool], 300n, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    transactionBuilder.build()
    expectFeeRate(transactionBuilder)
  })
})
