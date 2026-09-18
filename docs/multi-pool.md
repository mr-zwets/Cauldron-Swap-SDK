# Multi-Pool Optimal Trading

## Why split across pools?

Cauldron pools use a **constant product** formula (`K = tokens * sats`). Buying or selling a large amount from a single pool causes significant price impact. By splitting across multiple pools, each pool absorbs less impact and the overall rate improves.

## Algorithm

The optimal split is found using **binary search on the marginal rate**. At the optimal allocation, all used pools end up with the same marginal cost — this is the mathematically optimal solution for constant product AMMs.

### Steps

1. **Binary search**: Find the target marginal rate where the combined demand across all pools equals the requested trade amount. Each pool's contribution at a given rate is derived from `new_tokens = isqrt(K * RATE_DENOMINATOR / rate)`.
2. **Stepper**: After the binary search converges, fine-tune by adding or removing 1 token at a time from the pool with the best or worst marginal rate, until the total exactly matches the requested amount.
3. **Pool elimination**: Each additional pool adds ~197 bytes to the transaction. If a pool's cost savings don't exceed its byte overhead, it gets dropped and the trade is re-solved with the remaining pools.
4. **Pool cap**: A hard cap (`MAX_POOLS_PER_TRANSACTION = 350`) ensures the transaction stays within BCH's 100KB consensus size limit. If the allocation still exceeds the cap after elimination, the largest allocations are kept and the trade is re-solved with just those pools.

The algorithm uses bigint arithmetic throughout to avoid floating-point rounding issues.

## Key functions

- `computeOptimalBuy(pools, totalTokensToBuy, txFeePerByte, maxPools?)` — Returns a `PoolAllocation[]` with the optimal split for buying tokens.
- `computeOptimalSell(pools, totalTokensToSell, txFeePerByte, maxPools?)` — Returns a `PoolAllocation[]` with the optimal split for selling tokens.

Each `PoolAllocation` contains `{ pool, demandAmount, supplyAmount, feeAmount }`.

## Rate-targeted helpers

Two helpers let consumers query how much liquidity is available at a given price, without committing to a trade:

- `computeBuyAmountBelowRate(pools, maxSatsPerToken, includeFees?)` — How many tokens can be bought before the effective rate exceeds `maxSatsPerToken`.
- `computeSellAmountAboveRate(pools, minSatsPerToken, includeFees?)` — How many tokens can be sold before the effective rate drops below `minSatsPerToken`.

Both return a `bigint` amount that can be fed directly into `computeOptimalBuy` / `computeOptimalSell`. This enables limit-order-style workflows: query the available amount, let the user decide, then execute via the existing path.

By default (`includeFees = true`), the 0.3% swap fee is factored into the rate calculation so the returned amount reflects what the user would actually pay or receive. Pass `includeFees = false` to get the raw AMM amount without fee adjustment.

## Transaction layout

The Cauldron contract uses `OP_INPUTINDEX` to validate that its output matches its input position. So multi-pool transactions must place cauldron inputs/outputs first in 1:1 order:

```
Input 0:  cauldron pool A  →  Output 0: cauldron pool A (new state)
Input 1:  cauldron pool B  →  Output 1: cauldron pool B (new state)
Input 2+: user BCH/tokens  →  Output 2: user token output
                               Output 3: user BCH change
```
