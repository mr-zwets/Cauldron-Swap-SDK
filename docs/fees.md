# Miner Fees

Every prepare function targets an exact fee rate and settles it from the serialized transaction size, so
the fee is always `ceil(rate × size)` satoshis. The default is **1.2 sats/byte**, just above the 1
sat/byte relay floor. The rate must be at least 1 and below 10 sats/byte, which the builders pass to
CashScript as a `maximumFeeSatsPerByte` safety cap.

For how to set the rate, see the Miner Fees section of the [README](../README.md#miner-fees). This
document covers the consequences worth knowing before building on top of the returned transaction.

## How the fee is settled

The fee cannot be known before the transaction exists, and the transaction cannot be assembled without
knowing how much BCH to gather. The SDK resolves that in two steps:

1. **Selection** uses `calculateSelectionFeeReserve()`, a deliberate over-estimate built from measured
   sizes — 193 bytes per cauldron input/output pair, 141 bytes per Schnorr-signed P2PKH input. Falling
   short of the reserve alone is not fatal; only falling short of the genuinely required amount (the
   trade cost plus any new dust outputs) throws.
2. **Settlement** happens once every other input and output is added. `addBchChangeOutput()` wraps
   CashScript's `addBchChangeOutputIfNeeded()`, pays the exact fee for the final size, and returns the
   unused reserve as change.

## Three consequences

**The BCH change output must be added last**, which makes it the output where leftover funds arrive —
including the sale proceeds of a sell and the withdrawn balance of `prepareWithdrawAll`. Output order
therefore ends with it:

| | outputs |
|---|---|
| `prepareBuyTokens` | cauldron outputs, bought tokens, BCH change |
| `prepareSellTokens` | cauldron outputs, token change (if any), BCH change |
| `prepareWithdrawAll` | token output, BCH change |
| `prepareCreatePool` | pool UTXO, `OP_RETURN SUMMON`, token change (if any), BCH change |

**The returned builder is locked.** CashScript refuses any further BCH input or output once a change
output has been added, so a returned `transactionBuilder` can be inspected, signed and broadcast, but not
extended with extra outputs (a referral fee, a memo, a second recipient).

**Change below the dust limit goes to the miner.** There is no way to spend an output under 546 sats, so
CashScript absorbs it into the fee rather than creating one. On a sell this means the transaction pays no
BCH to the user at all — but only when the proceeds are within a few hundred satoshi of the fee, roughly a
tenth of a cent, so it takes a trade nobody would rationally make. `totalSatsReceived` reports what the
pools pay before the miner fee, so compare it against `transactionBuilder.calculateTransactionFee()` when
the exact net matters.

## Selling without a separate BCH UTXO

Because the fee is settled from the transaction's whole BCH surplus, the sale proceeds can pay for it.
`prepareSellTokens` only needs a BCH UTXO when the proceeds and the BCH already sitting on the token
inputs do not cover the fee and any token-change dust.
