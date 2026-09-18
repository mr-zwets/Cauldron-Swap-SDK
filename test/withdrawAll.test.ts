import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
} from 'cashscript';
import { prepareWithdrawAll } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';

const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"

const testFuruPool: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:qps99uejnueu4dsv0dd2m9u9uzxntg66nyux08wmzq",
  owner_pkh: "6052f3329f33cab60c7b5aad9785e08d35a35a99",
  sats: 587793838,
  token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
  tokens: 4363102,
  tx_pos: 0,
  txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
}

describe('prepareWithdrawAll', () => {
  test('should succeed and have valid fee rate', async() => {
    const provider = new MockNetworkProvider();
    provider.network = 'mainnet';
    const options = { provider, contractType:'p2sh32' as const };
    const cauldronContract = new Contract(cauldronArtifactWithPkh(testFuruPool.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(testFuruPool))

    const { transactionBuilder } = await prepareWithdrawAll(
      testFuruPool, testUserTokenAddress, testUserWif, provider
    )
    expect(() => transactionBuilder.debug()).not.toThrow()
    
    transactionBuilder.build()
    const { feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
    expect(feeSatsPerByte > 1 && feeSatsPerByte < 5).toBe(true);
  })
})
