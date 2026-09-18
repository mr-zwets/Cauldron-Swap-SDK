/* Transaction Building Errors */

/** The user's BCH UTXOs do not cover the trade amount, the new outputs and the miner fee. */
export class InsufficientFundsError extends Error {
  // how many sats the inputs fell short by
  readonly shortfallSats: bigint;

  constructor(errorString: string, shortfallSats: bigint) {
    super(errorString);
    this.name = 'InsufficientFundsError';
    this.shortfallSats = shortfallSats;
  }
}

/** The user's UTXOs of the traded token do not add up to the amount being sold or deposited. */
export class InsufficientTokensError extends Error {
  // how many token base units the inputs fell short by
  readonly shortfallTokens: bigint;

  constructor(errorString: string, shortfallTokens: bigint) {
    super(errorString);
    this.name = 'InsufficientTokensError';
    this.shortfallTokens = shortfallTokens;
  }
}
