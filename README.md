# Cauldron Swap SDK

TypeScript SDK for trading on the [Cauldron DEX](https://cauldron.quest) on Bitcoin Cash, built with the CashScript SDK.

## Overview

`prepareBuyTokens` and `prepareSellTokens` accept an array of pools and optimally split the trade across them using binary search on the marginal rate of the constant product curve, so each pool ends up at the same marginal cost — minimizing total price impact. Pools that don't save enough to justify their extra transaction bytes are automatically dropped. See [docs/multi-pool.md](docs/multi-pool.md) for details on the algorithm.

**Note:** Pools are fetched from the Cauldron indexer API, which is a trusted third party. All token amounts are in base units (raw on-chain amounts, `bigint`) — BCMR decimal places are not supported.

## Install

Install the cauldron-swap-sdk from NPM with:

```bash
pnpm install @mr-zwets/cauldron-swap-sdk
```

## CauldronManager

`CauldronManager` binds a provider and a fee rate so they don't have to be repeated on every call, and
keeps the indexer and the transactions on the same network. It is the recommended entry point:

```ts
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronManager } from "@mr-zwets/cauldron-swap-sdk"
import { userTokenAddress, signer } from "./config"

const cauldron = new CauldronManager({
  provider: new ElectrumNetworkProvider('mainnet'),
  feeRateSatsPerByte: 2,  // optional, defaults to 1.2
})

const cauldronPools = await cauldron.getCauldronPools(tokenId)
const { transactionBuilder } = await cauldron.prepareBuyTokens(cauldronPools, 100n, userTokenAddress, signer)

const txDetails = await transactionBuilder.send()
```

The network comes from the provider, so `getCauldronPools` cannot end up querying a different one than the
transaction is built for. A provider on a network Cauldron has no indexer for is rejected by the
constructor. Every method forwards to the standalone function of the same name, which stays exported for
one-off use — the sections below use those directly.

## Buy Tokens

```ts
import { getCauldronPools, prepareBuyTokens } from "@mr-zwets/cauldron-swap-sdk"
import { userTokenAddress, signer } from "./config"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToBuy = 100_000n

const cauldronPools = await getCauldronPools(furuTokenId)

// pass all pools — the SDK optimally splits the trade across pools
const { transactionBuilder, totalSatsCost, totalFees, effectivePricePerToken } = await prepareBuyTokens(
  cauldronPools,
  amountToBuy,
  userTokenAddress,
  signer
)

// review the effective price before broadcasting
console.log(`Cost: ${totalSatsCost} sats (${totalFees} fees), ${effectivePricePerToken} sats/token`)

const txDetails = await transactionBuilder.send()
```

## Sell Tokens

```ts
import { getCauldronPools, prepareSellTokens } from "@mr-zwets/cauldron-swap-sdk"
import { userTokenAddress, signer } from "./config"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToSell = 100_000n

const cauldronPools = await getCauldronPools(furuTokenId)

// pass all pools — the SDK optimally splits the trade across pools
const { transactionBuilder, totalSatsReceived, totalFees, effectivePricePerToken } = await prepareSellTokens(
  cauldronPools,
  amountToSell,
  userTokenAddress,
  signer
)

// review the effective price before broadcasting
console.log(`Receive: ${totalSatsReceived} sats (${totalFees} fees), ${effectivePricePerToken} sats/token`)

const txDetails = await transactionBuilder.send()
```

## Rate-Targeted Trading

Two helpers let you query how much liquidity is available at a given price — useful for limit-order-style UIs:

```ts
import { getCauldronPools } from "@mr-zwets/cauldron-swap-sdk"
import { computeBuyAmountBelowRate, computeSellAmountAboveRate } from "@mr-zwets/cauldron-swap-sdk"

const cauldronPools = await getCauldronPools(furuTokenId)

// How many tokens can I buy before the marginal rate exceeds 150 sats/token?
const buyableAmount = computeBuyAmountBelowRate(cauldronPools, 150n)

// How many tokens can I sell before the marginal rate drops below 80 sats/token?
const sellableAmount = computeSellAmountAboveRate(cauldronPools, 80n)

// Then feed the result into the existing prepare functions
const result = await prepareBuyTokens(cauldronPools, buyableAmount, userTokenAddress, signer)
```

## Create Pool

```ts
import { prepareCreatePool } from "@mr-zwets/cauldron-swap-sdk"
import { signer } from "./config"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const satsAmount = 100_000n    // BCH liquidity to seed the pool with
const tokenAmount = 100n       // token base units to seed the pool with

// the signer's token address is derived automatically
const { transactionBuilder, poolContractAddress, ownerPkh } = await prepareCreatePool(
  furuTokenId,
  satsAmount,
  tokenAmount,
  signer,
)

console.log(`Pool contract: ${poolContractAddress}`)

const txDetails = await transactionBuilder.send()
```

The transaction includes an `OP_RETURN SUMMON <PKH>` output so the Cauldron indexer picks up the new pool immediately.

## Withdraw Liquidity

```ts
import { getCauldronPools, prepareWithdrawAll } from "@mr-zwets/cauldron-swap-sdk"
import { userTokenAddress, signer } from "./config"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const poolOwnerAddress = "bitcoincash:qps99uejnueu4dsv0dd2m9u9uzxntg66nyux08wmzq"
const cauldronPools = await getCauldronPools(furuTokenId)

// filter your pool
const poolToUse = cauldronPools.find(pool => pool.owner_p2pkh_addr == poolOwnerAddress)

// prepare withdraw transaction
const { transactionBuilder } = await prepareWithdrawAll(
  poolToUse,
  userTokenAddress,
  signer,
)

const txDetails = await transactionBuilder.send()
```

## Chipnet Usage

Point the provider at chipnet and everything else follows:

```ts
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronManager } from "@mr-zwets/cauldron-swap-sdk"
import { userTokenAddress, signer } from "./config"

const chipnetTokenId = "53636bc8c1afbe35a7ba169eadfac0aebadeacf96954a9a066a483e885580ed4"

const cauldron = new CauldronManager({ provider: new ElectrumNetworkProvider('chipnet') })
const cauldronPools = await cauldron.getCauldronPools(chipnetTokenId)
const { transactionBuilder } = await cauldron.prepareBuyTokens(cauldronPools, 100n, userTokenAddress, signer)

const txDetails = await transactionBuilder.send()
```

Using the standalone functions instead means passing the network to `getCauldronPools` and a matching
provider to every prepare call, since they default to mainnet independently.

## Miner Fees

Every prepare function targets an exact fee rate and settles it from the serialized transaction size,
returning the remainder in a BCH change output. The default is **1.2 sats/byte**.

Set it once on the manager, or pass it as the last argument of a standalone prepare function:

```ts
const cauldron = new CauldronManager({ provider, feeRateSatsPerByte: 2 })

// or, standalone
const { transactionBuilder } = await prepareBuyTokens(
  cauldronPools, amountToBuy, userTokenAddress, signer, provider, undefined /* userUtxos */, 2,
)

// what the transaction actually pays
const { feeSats, feeSatsPerByte } = transactionBuilder.calculateTransactionFee()
```

Settling the fee this way has consequences for output order, for extending the returned builder, and for
trades small enough that the change would be dust — see [docs/fees.md](docs/fees.md).

## Errors

Funding failures throw typed errors carrying how much was missing, so a wallet can act on them without
matching error strings:

```ts
import { prepareSellTokens, InsufficientFundsError, InsufficientTokensError } from "@mr-zwets/cauldron-swap-sdk"

try {
  await prepareSellTokens(cauldronPools, amountToSell, userTokenAddress, signer)
} catch (error) {
  if (error instanceof InsufficientTokensError) {
    console.log(`Need ${error.shortfallTokens} more tokens`)
  } else if (error instanceof InsufficientFundsError) {
    console.log(`Need ${error.shortfallSats} more sats`)
  } else throw error
}
```

`shortfallSats` is the amount that will make the transaction work, miner fee included. Everything else
throws a plain `Error`, since those are programming mistakes rather than states a user can resolve.

## Custom Arifacts

The Cauldron contract does not have a ready-to-go CashScript artifact, so custom artifacts were created to be able to use the CashScript SDK tooling.

You can see the JSON artifacts in `src/artifact` and find an explanation of this in [docs/artifacts.md](docs/artifacts.md).

## Run the Tests

```
npm i
npm run test
```

or using pnpm:

```
pnpm i
pnpm run test
```

## Future Extensions

### BCMR token metadata

The trading logic currently operates on base token units (the raw on-chain amount). The BCMR standard allows tokens to define a ticker symbol and decimal places for a higher-level display unit, but this SDK does not yet support that abstraction. Token amounts passed to `prepareBuyTokens`/`prepareSellTokens` must be in base units (and hence are BigInt type).

### On-chain pool discovery

Currently pool discovery relies on the Cauldron indexer API, which is a trusted third party. Ideally pools could be discovered directly on-chain. The challenge is that Cauldron pools use P2SH, so the contract code is hidden behind a hash — you can't identify them by script fingerprinting alone. However, new pools can be discovered by their OP_RETURN marker `SUMMON` in the creation transaction. BCHN's [bytecode pattern RPC](https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node/-/merge_requests/1958) (`redeemBytecodePattern` with fingerprint matching) could help identify existing pools when they are spent, since the redeem script is revealed at spend time.
