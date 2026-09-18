# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript SDK for interacting with Cauldron liquidity pools on Bitcoin Cash (BCH). Uses CashScript SDK to build and sign swap/withdrawal transactions, and the Cauldron indexer API to discover pools.

**Status**: Early development, not yet published on npm.

## Commands

```bash
pnpm install          # install dependencies
pnpm build            # compile to dist/
pnpm typecheck        # typecheck src/ and test/
pnpm test             # run all tests (vitest in watch mode)
pnpm test -- --run    # run tests once without watch
pnpm test -- --run test/swap.test.ts  # run a single test file
```

## Architecture

**Core flow**: Fetch pools from indexer → select a pool → build a CashScript transaction → sign and broadcast.

### Key modules

- `src/index.ts` — Barrel re-exporting the public API, nothing else
- `src/transactions.ts` — `prepareBuyTokens`, `prepareSellTokens`, `prepareWithdrawAll`, `prepareCreatePool`
- `src/indexer.ts` — `getCauldronPools` and the indexer URLs
- `src/cauldronManager.ts` — `CauldronManager`, which binds a provider and fee rate and forwards to the functions above
- `src/multipool.ts` — Pure bigint math module for optimal trade splitting across multiple pools. Exports `computeOptimalBuy`, `computeOptimalSell`, rate-targeted helpers (`computeBuyAmountBelowRate`, `computeSellAmountAboveRate`), price-impact helpers (`bestMarginalBuyRate`, `bestMarginalSellRate`, `computeEffectiveBuyImpact`/`Sell`, `computeMarginalBuyImpact`/`Sell`), and math utilities (`isqrt`, `ceilDiv`, `calcBuyFromPool`, `calcSellToPool`)
- `src/utils.ts` — `cauldronArtifactWithPkh()` patches a `<withdraw_pkh>` placeholder in artifact bytecode at runtime; `convertPoolToUtxo()` adapts pool data to CashScript UTXO format; `validateTokenAddress()` validates CashAddress is token-aware; `gatherBchUtxos()` / `gatherTokenUtxos()` for UTXO selection
- `src/interfaces.ts` — `CauldronActivePool`, `PoolAllocation` and `CauldronNetwork` type definitions
- `src/fees.ts` / `src/errors.ts` — Fee rate handling and the typed funding errors
- `src/artifact/` — Two custom CashScript JSON artifacts (swap and managePool) since the Cauldron contract is raw BCH Script, not CashScript (see `artifacts.md` for rationale)

### Why two artifacts

CashScript doesn't support multi-function contracts with proper function indexing for raw script contracts. `swap_artifact.json` has a no-arg `swap()` function; `managepool_artifact.json` has `managePool(pubkey, sig)`. The `<withdraw_pkh>` template variable in the bytecode is replaced at runtime with the actual pool owner's public key hash.

### Multi-pool optimal trading

`prepareBuyTokens` and `prepareSellTokens` accept `CauldronActivePool[]` and a `bigint` amount. The trade is optimally split across pools using binary search on the marginal rate (constant product AMM math). The algorithm:

1. Binary searches for the rate at which combined demand across all pools equals the target amount
2. Uses a stepper to adjust rounding so the sum of allocations exactly matches the requested amount
3. Eliminates pools whose savings don't justify the extra ~197 bytes of tx overhead
4. Applies a hard cap (`MAX_POOLS_PER_TRANSACTION = 350`) to guarantee the transaction stays within BCH's 100KB consensus limit. The cap keeps the largest allocations and re-solves. Both `computeOptimalBuy` and `computeOptimalSell` accept an optional `maxPools` parameter to override the default.

Multi-pool transactions place cauldron inputs/outputs first in 1:1 order (required by the contract's `OP_INPUTINDEX` validation), followed by user inputs and outputs.

### Price impact

Two distinct, complementary metrics — both signed (buys positive, sells negative):

- **`computeEffectiveBuyImpact` / `computeEffectiveSellImpact`** — premium-over-spot the user actually pays/receives: `(volume_weighted_fill − best_spot_rate) / best_spot_rate`. Mirrors the user-side cost expressed in % rather than dollars.
- **`computeMarginalBuyImpact` / `computeMarginalSellImpact`** — Cauldron-UI-style curve displacement: `(best_marginal_rate_after − before) / before`. Independent of "how much premium the user paid"; measures how much the trade moves the pool's marginal rate. For slippage-dominated constant-product trades, ≈ 2× the effective impact.

Both pair with `bestMarginalBuyRate(pools)` / `bestMarginalSellRate(pools)`, which return the cheapest/best spot rate (sats/token) across a pool set as a `number | undefined`. The impact functions return `number | undefined` (`undefined` for empty pools/allocations or drained pools).

### Transaction building

All prepare functions (`prepareBuyTokens`, `prepareSellTokens`, `prepareWithdrawAll`, `prepareCreatePool`) return `{ transactionBuilder, inputUtxos }` instead of broadcasting directly. Consumers call `.send()` on the builder to broadcast, or `.build()` to get the raw hex. Use `transactionBuilder.calculateTransactionFee()` for the fee and fee rate.

Transactions use CashScript's `TransactionBuilder` (not the contract's higher-level `.functions` API) to manually compose inputs/outputs with `maximumFeeSatsPerByte: BUILDER_MAX_FEE_SATS_PER_BYTE`. Contracts use `p2sh32` address type. The swap fee is 0.3% (calculated differently for buys vs sells to match the on-chain contract).

UTXO selection: `prepareBuyTokens` uses `gatherBchUtxos` (multi-input, since trade amounts can be large). `prepareSellTokens` uses `gatherTokenUtxos` + `gatherBchUtxos` for any shortfall. `prepareCreatePool` uses both.

Miner fees (`src/fees.ts`): each prepare function takes an optional trailing `feeRateSatsPerByte`, defaulting to 1.2. The exact fee is settled by the BCH change output, which is therefore always added last. Funding failures throw the typed errors in `src/errors.ts`.

Pool creation (`prepareCreatePool`): Derives the owner's token address and PKH from the signer, templates the contract artifact, and builds a transaction that sends BCH + tokens to the contract's token address. Output order: pool UTXO (index 0), `OP_RETURN SUMMON <PKH>` (index 1, for indexer discovery), then change outputs. Unlike buy/sell/withdraw, it does not take a `userTokenAddress` parameter — the address is derived from the signer.

### Dependencies

- `cashscript` — CashScript SDK for contract interaction and transaction building
- `@bitauth/libauth` — Crypto primitives (hash160, binToHex, decodeCashAddress)

### Testing

Tests use `MockNetworkProvider` from CashScript to avoid real blockchain calls. Test files are in `test/` and mirror the main API functions. Tests verify transaction serialization via `.build()` and assert the exact fee rate with `test/utils.ts:expectFeeRate()`. Use `.debug()` to verify contract script evaluation — `.build()` only serializes the transaction without evaluating the script.

Sell tests cover single token input, multiple small token inputs, exact balance (no change), and combined BCH+tokens on a single input. `test/multipool.test.ts` covers the pure algorithm (split correctness, rounding, pool elimination). `test/multipoolSwap.test.ts` covers multi-pool transaction building with 2-3 pools.
