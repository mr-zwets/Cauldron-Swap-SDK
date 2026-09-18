import type { TransactionBuilder } from 'cashscript';
import { InsufficientFundsError } from './errors.js';

/* Miner Fee Utils */

export const DEFAULT_FEE_RATE_SATS_PER_BYTE = 1.2
// Safety cap the prepare functions pass as `maximumFeeSatsPerByte`, a configured `feeRateSatsPerByte`
// must stay below it. `addBchChangeOutput` settles the fee exactly, so the only slack is dust-sized
// change absorbed into the fee, which the cap leaves room for at any valid rate
export const BUILDER_MAX_FEE_SATS_PER_BYTE = 10
// serialized size of a Schnorr-signed P2PKH input (SignatureTemplate signs Schnorr by default):
// 32 + 4 + 1 + (1 + 65 + 1 + 33) + 4, see https://documentation.cash/protocol/blockchain/transaction.html
const SIGNED_P2PKH_INPUT_BYTES = 141n
// upper bound on one cauldron input plus its matching output, measured at 193 bytes
const CAULDRON_POOL_BYTES = 200n
// upper bound on the non-cauldron, non-user-input part of a swap: version, counts, locktime and the
// user's own outputs (bought tokens / proceeds, token change, BCH change)
const SWAP_OVERHEAD_BYTES = 300n

/**
 * @throws when the fee rate is below the 1 sat/byte relay floor or at/above the builder's safety cap
 */
export function assertValidFeeRate(feeRateSatsPerByte: number) {
  if(!Number.isFinite(feeRateSatsPerByte) || feeRateSatsPerByte < 1){
    throw new Error('feeRateSatsPerByte must be a finite number of at least 1 (the relay policy floor)')
  }
  if(feeRateSatsPerByte >= BUILDER_MAX_FEE_SATS_PER_BYTE){
    throw new Error(`feeRateSatsPerByte must stay below the builder's cap of ${BUILDER_MAX_FEE_SATS_PER_BYTE} sats/byte`)
  }
}

export function calculateFeeForSize(sizeBytes: bigint, feeRateSatsPerByte = DEFAULT_FEE_RATE_SATS_PER_BYTE) {
  return BigInt(Math.ceil(Number(sizeBytes) * feeRateSatsPerByte))
}

export function calculateFeePerUserInput(feeRateSatsPerByte = DEFAULT_FEE_RATE_SATS_PER_BYTE) {
  return calculateFeeForSize(SIGNED_P2PKH_INPUT_BYTES, feeRateSatsPerByte)
}

/**
 * Upper bound on the fee of the cauldron part of a swap, used to pick user UTXOs before the transaction
 * exists. Not a network fee estimate: the exact fee is settled from the serialized size by
 * `addBchChangeOutput`, and any excess reserve returns as change.
 *
 * @param poolCount Number of cauldron pools the trade is split across.
 * @param otherUserInputCount User inputs the caller adds itself (token inputs), which
 *   `gatherBchUtxos` does not surcharge for.
 */
export function calculateSelectionFeeReserve(
  poolCount: number,
  feeRateSatsPerByte = DEFAULT_FEE_RATE_SATS_PER_BYTE,
  otherUserInputCount = 0,
) {
  const cauldronBytes = SWAP_OVERHEAD_BYTES + CAULDRON_POOL_BYTES * BigInt(poolCount)
  return calculateFeeForSize(cauldronBytes, feeRateSatsPerByte)
    + calculateFeePerUserInput(feeRateSatsPerByte) * BigInt(otherUserInputCount)
}

/**
 * Adds a BCH change output paying the fee for the final transaction size via cashscript's
 * `addBchChangeOutputIfNeeded`, which leaves dust change to the miner and locks the builder afterwards:
 * no BCH input or output can be added once this has run.
 *
 * Should be called after every other input and output is added. A remainder below the dust limit is
 * left to the miner rather than becoming an output, as there is no other way to spend it.
 *
 * @throws {InsufficientFundsError} when the inputs do not cover the fee even without a change output
 */
export function addBchChangeOutput(
  transactionBuilder: TransactionBuilder,
  changeAddress: string,
  feeRateSatsPerByte = DEFAULT_FEE_RATE_SATS_PER_BYTE,
) {
  try {
    transactionBuilder.addBchChangeOutputIfNeeded({ to: changeAddress, feeRate: feeRateSatsPerByte })
  } catch (error) {
    // nothing was added before it threw, so the builder still reports the whole surplus as the fee
    const { feeSats: surplus } = transactionBuilder.calculateTransactionFee()
    const feeWithoutChange = calculateFeeForSize(transactionBuilder.getTransactionSize(), feeRateSatsPerByte)
    // cashscript also rejects the change output itself (a mismatched network, a locked builder),
    // which is not a funding problem and must keep its own descriptive error
    if(surplus >= feeWithoutChange) throw error
    const shortfall = feeWithoutChange - surplus
    throw new InsufficientFundsError(
      `Insufficient BCH: inputs are ${shortfall} sats short of the ${feeWithoutChange} sats miner fee`,
      shortfall,
    )
  }
}
