/** The networks Cauldron runs an indexer for. */
export type CauldronNetwork = 'mainnet' | 'chipnet';

export interface CauldronGetActivePools {
  active: CauldronActivePool[]
}

export interface CauldronActivePool {
  owner_p2pkh_addr: string;
  owner_pkh: string;
  sats: number;
  token_id: string;
  tokens: number;
  tx_pos: number;
  txid: string;
}

export interface PoolAllocation {
  pool: CauldronActivePool;
  demandAmount: bigint;
  supplyAmount: bigint;
  feeAmount: bigint;
}