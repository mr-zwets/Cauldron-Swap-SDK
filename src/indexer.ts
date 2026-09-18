import type { CauldronGetActivePools, CauldronNetwork } from './interfaces.js';

export const CAULDRON_INDEXER_URLS: Record<CauldronNetwork, string> = {
  mainnet: 'https://indexer.cauldron.quest/cauldron',
  chipnet: 'https://indexer-chipnet.riften.net/cauldron',
};

/**
 * Fetch all active Cauldron pools for a given token from the indexer.
 */
export async function getCauldronPools(tokenId:string, network:CauldronNetwork = 'mainnet'){
  const indexerUrl = CAULDRON_INDEXER_URLS[network];
  const result = await fetch(`${indexerUrl}/pool/active?token=${tokenId}`)
  const data = await result.json() as CauldronGetActivePools
  return data.active
}
