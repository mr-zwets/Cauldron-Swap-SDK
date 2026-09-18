import { expect } from 'vitest';
import type { TransactionBuilder } from 'cashscript';
import { calculateFeeForSize, DEFAULT_FEE_RATE_SATS_PER_BYTE } from '../src/fees.js';

/**
 * Asserts the transaction pays exactly `ceil(rate * size)` satoshis. Pinning the satoshi amount rather
 * than the reported rate matters: `calculateTransactionFee` rounds its rate to two decimals, which hides
 * change that was absorbed into the fee.
 */
export function expectFeeRate(
  transactionBuilder: TransactionBuilder,
  feeRateSatsPerByte = DEFAULT_FEE_RATE_SATS_PER_BYTE,
) {
  const { feeSats } = transactionBuilder.calculateTransactionFee();
  const expectedFeeSats = calculateFeeForSize(transactionBuilder.getTransactionSize(), feeRateSatsPerByte);
  expect(feeSats).toBe(expectedFeeSats);
}
