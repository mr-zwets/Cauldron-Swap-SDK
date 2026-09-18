import type { Network, NetworkProvider, Utxo } from 'cashscript';
import type { CauldronActivePool, CauldronNetwork } from './interfaces.js';
import { assertValidFeeRate, DEFAULT_FEE_RATE_SATS_PER_BYTE } from './fees.js';
import { getCauldronPools } from './indexer.js';
import {
  prepareBuyTokens,
  prepareCreatePool,
  prepareSellTokens,
  prepareWithdrawAll,
} from './transactions.js';

/** Narrows a provider's network to the two Cauldron runs an indexer for. */
function toCauldronNetwork(network:Network):CauldronNetwork {
  if(network !== 'mainnet' && network !== 'chipnet'){
    throw new Error(`Unsupported network '${network}': Cauldron only has indexers for mainnet and chipnet`)
  }
  return network
}

export interface CauldronManagerConfig {
  /** Provider used for every call. Its network also decides which indexer pools are fetched from. */
  provider: NetworkProvider;
  /** Miner fee rate every prepared transaction targets. Defaults to 1.2 sats/byte. */
  feeRateSatsPerByte?: number;
}

/**
 * Binds a provider and a fee rate so they do not have to be repeated on every call, and keeps the
 * indexer and the transactions on the same network. The standalone functions stay exported for
 * one-off use; every method here just forwards to one of them.
 */
export class CauldronManager {
  provider: NetworkProvider;
  feeRateSatsPerByte: number;
  network: CauldronNetwork;

  constructor(config:CauldronManagerConfig){
    this.provider = config.provider
    this.network = toCauldronNetwork(config.provider.network)
    this.feeRateSatsPerByte = config.feeRateSatsPerByte ?? DEFAULT_FEE_RATE_SATS_PER_BYTE
    assertValidFeeRate(this.feeRateSatsPerByte)
  }

  getCauldronPools(tokenId:string){
    return getCauldronPools(tokenId, this.network)
  }

  prepareBuyTokens(
    pools:CauldronActivePool[],
    amountToBuy:bigint,
    userTokenAddress:string,
    signer:string | Uint8Array,
    userUtxos?:Utxo[]
  ){
    return prepareBuyTokens(
      pools, amountToBuy, userTokenAddress, signer, this.provider, userUtxos, this.feeRateSatsPerByte
    )
  }

  prepareSellTokens(
    pools:CauldronActivePool[],
    amountToSell:bigint,
    userTokenAddress:string,
    signer:string | Uint8Array,
    userUtxos?:Utxo[]
  ){
    return prepareSellTokens(
      pools, amountToSell, userTokenAddress, signer, this.provider, userUtxos, this.feeRateSatsPerByte
    )
  }

  prepareWithdrawAll(
    pool:CauldronActivePool,
    userTokenAddress:string,
    signer:string | Uint8Array
  ){
    return prepareWithdrawAll(pool, userTokenAddress, signer, this.provider, this.feeRateSatsPerByte)
  }

  prepareCreatePool(
    tokenId:string,
    satsAmount:bigint,
    tokenAmount:bigint,
    signer:string | Uint8Array,
    userUtxos?:Utxo[]
  ){
    return prepareCreatePool(
      tokenId, satsAmount, tokenAmount, signer, this.network, this.provider, userUtxos, this.feeRateSatsPerByte
    )
  }
}
