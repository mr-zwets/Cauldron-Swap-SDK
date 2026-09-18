import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
  type Recipient,
  type Utxo,
} from 'cashscript';
import { binToHex, hash160, encodeCashAddress, CashAddressType, CashAddressNetworkPrefix } from '@bitauth/libauth'
import type { CauldronActivePool, CauldronNetwork } from './interfaces.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo, gatherBchUtxos, gatherTokenUtxos, validateTokenAddress } from './utils.js';
import { ceilDiv, computeOptimalBuy, computeOptimalSell } from './multipool.js';
import {
  addBchChangeOutput,
  assertValidFeeRate,
  BUILDER_MAX_FEE_SATS_PER_BYTE,
  calculateFeePerUserInput,
  calculateSelectionFeeReserve,
  DEFAULT_FEE_RATE_SATS_PER_BYTE,
} from './fees.js';

function buildCauldronInputsOutputs(
  allocations: { pool: CauldronActivePool; demandAmount: bigint }[],
  direction: 'buy' | 'sell',
  options: { provider: NetworkProvider; contractType: 'p2sh32' }
) {
  const cauldronInputs: { utxo: Utxo; contract: Contract }[] = [];
  const cauldronOutputs: Recipient[] = [];
  let totalUserReceive = 0n;

  for (const allocation of allocations) {
    const pool = allocation.pool
    const cauldronUtxo = convertPoolToUtxo(pool)
    const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
    const cauldronContract = new Contract(cauldronArtifact, [], options)

    // calculate new pool state after trade
    const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats)
    let newTokens:bigint
    let tradeValue:bigint
    if(direction === 'buy'){
      newTokens = BigInt(pool.tokens) - allocation.demandAmount
      tradeValue = ceilDiv(poolConstantK, newTokens) - BigInt(pool.sats)
    } else {
      newTokens = BigInt(pool.tokens) + allocation.demandAmount
      tradeValue = BigInt(pool.sats) - ceilDiv(poolConstantK, newTokens)
    }
    // apply 0.3% swap fee
    // For buys: the contract computes fee on the total sats delta (which includes the fee),
    // so we solve the circular dependency: fee = ceil(3 * tradeValue / 997)
    // For sells: tradeValue * 3 / 1000 is conservative (overpays slightly), which is fine
    const newSatsExclFee = ceilDiv(poolConstantK, newTokens)
    const feeAmount = direction === 'buy'
      ? ceilDiv(tradeValue * 3n, 997n)
      : tradeValue * 3n / 1000n
    const newSats = newSatsExclFee + feeAmount
    const newTokensOutput = ceilDiv(poolConstantK, newSatsExclFee)

    if (direction === 'sell') {
      totalUserReceive += tradeValue - feeAmount
    }

    cauldronInputs.push({ utxo: cauldronUtxo, contract: cauldronContract })
    cauldronOutputs.push({
      to: cauldronContract.tokenAddress,
      amount: newSats,
      token: {
        category: pool.token_id,
        amount: newTokensOutput,
      },
    });
  }

  return { cauldronInputs, cauldronOutputs, totalUserReceive };
}

/**
 * Prepare a buy-tokens transaction.
 *
 * @param userUtxos Pre-fetched UTXOs for `userTokenAddress`; skips the internal fetch.
 * @param feeRateSatsPerByte Miner fee rate the transaction targets exactly. Defaults to 1.2 sat/byte.
 */
export async function prepareBuyTokens(
  pools:CauldronActivePool[],
  amountToBuy:bigint,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet'),
  userUtxos?:Utxo[],
  feeRateSatsPerByte:number = DEFAULT_FEE_RATE_SATS_PER_BYTE
){
  validateTokenAddress(userTokenAddress)
  assertValidFeeRate(feeRateSatsPerByte)
  if(amountToBuy <= 0n) throw new Error('amountToBuy must be a positive number')
  if(!pools.every(p => p.token_id === pools[0].token_id)) throw new Error('All pools must share the same token_id')

  const allocations = computeOptimalBuy(pools, amountToBuy, 2n);
  const options = { provider, contractType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs } = buildCauldronInputsOutputs(allocations, 'buy', options)

  const resolvedUserUtxos = userUtxos ?? await provider.getUtxos(userTokenAddress);
  const userBchUtxos = resolvedUserUtxos.filter(utxo => !utxo.token)

  // calculate required bch input amount, the exact fee is settled by the change output
  const totalSupply = allocations.reduce((sum, allocation) => sum + allocation.supplyAmount, 0n)
  const tokenOutputDust = 1000n
  const feeReserve = calculateSelectionFeeReserve(allocations.length, feeRateSatsPerByte)
  // the trade cost and the token output have to be covered, the reserve on top is an over-estimate
  const requiredBchAmount = totalSupply + tokenOutputDust
  const feePerUserInput = calculateFeePerUserInput(feeRateSatsPerByte)
  const { bchInputUtxos } = gatherBchUtxos(
    userBchUtxos, requiredBchAmount + feeReserve, feePerUserInput, requiredBchAmount
  )

  const tokenId = allocations[0].pool.token_id

  const boughtTokensOutput:Recipient = {
    to: userTokenAddress,
    amount: tokenOutputDust,
    token: {
      category: tokenId,
      amount: amountToBuy
    }
  }

  const userTemplate = new SignatureTemplate(signer)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint)
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: BUILDER_MAX_FEE_SATS_PER_BYTE })
  for (const cauldronInput of cauldronInputs) {
    transactionBuilder.addInput(cauldronInput.utxo, cauldronInput.contract.unlock.swap())
  }
  transactionBuilder.addInputs(bchInputUtxos, userTemplate.unlockP2PKH())
    .addOutputs([...cauldronOutputs, boughtTokensOutput])
  addBchChangeOutput(transactionBuilder, userTokenAddress, feeRateSatsPerByte)

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(cauldronInput => cauldronInput.utxo), ...bchInputUtxos]
  const totalFees = allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsCost: totalSupply, totalFees, effectivePricePerToken: totalSupply / amountToBuy }
}

/**
 * Prepare a sell-tokens transaction.
 *
 * `totalSatsReceived` is what the pools pay for the tokens, before the miner fee is deducted from it in
 * the BCH change output. On a trade small enough that the remainder is dust, that output is dropped and
 * the miner keeps it — compare against `transactionBuilder.calculateTransactionFee()` to see the net.
 *
 * @param userUtxos Pre-fetched UTXOs for `userTokenAddress`; skips the internal fetch.
 * @param feeRateSatsPerByte Miner fee rate the transaction targets exactly. Defaults to 1.2 sat/byte.
 */
export async function prepareSellTokens(
  pools:CauldronActivePool[],
  amountToSell:bigint,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet'),
  userUtxos?:Utxo[],
  feeRateSatsPerByte:number = DEFAULT_FEE_RATE_SATS_PER_BYTE
){
  validateTokenAddress(userTokenAddress)
  assertValidFeeRate(feeRateSatsPerByte)
  if(amountToSell <= 0n) throw new Error('amountToSell must be a positive number')
  if(!pools.every(p => p.token_id === pools[0].token_id)) throw new Error('All pools must share the same token_id')

  const allocations = computeOptimalSell(pools, amountToSell, 2n);
  const tokenId = allocations[0].pool.token_id;
  const options = { provider, contractType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs, totalUserReceive } = buildCauldronInputsOutputs(allocations, 'sell', options)

  const resolvedUserUtxos = userUtxos ?? await provider.getUtxos(userTokenAddress);
  const userTokenUtxos = resolvedUserUtxos.filter(utxo => utxo.token?.category === tokenId)
  const userBchUtxos = resolvedUserUtxos.filter(utxo => !utxo.token)

  // select token inputs
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, amountToSell)

  // calculate required bch input amount, the exact fee is settled by the change output
  const tokenChangeAmount = userTokenInputTotal - amountToSell
  const tokenChangeDust = tokenChangeAmount > 0n ? 1000n : 0n
  const feeReserve = calculateSelectionFeeReserve(allocations.length, feeRateSatsPerByte, userTokenInputs.length)
  // the sale proceeds and the BCH sitting on the token inputs already cover part of the fee
  const bchOnTokenInputs = userTokenInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n)
  const bchAlreadyAvailable = totalUserReceive + bchOnTokenInputs
  const shortfall = (needed: bigint) => needed > bchAlreadyAvailable ? needed - bchAlreadyAvailable : 0n

  const feePerUserInput = calculateFeePerUserInput(feeRateSatsPerByte)
  const { bchInputUtxos } = gatherBchUtxos(
    userBchUtxos, shortfall(tokenChangeDust + feeReserve), feePerUserInput, shortfall(tokenChangeDust)
  )

  const tokenChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: tokenChangeDust,
    token: {
      category: tokenId,
      amount: tokenChangeAmount
    }
  }

  const userTemplate = new SignatureTemplate(signer)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint).
  // The sale proceeds come back to the user in the BCH change output.
  const outputs:Recipient[] = [...cauldronOutputs]
  if(tokenChangeAmount > 0n) outputs.push(tokenChangeOutput)

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: BUILDER_MAX_FEE_SATS_PER_BYTE })
  for (const cauldronInput of cauldronInputs) {
    transactionBuilder.addInput(cauldronInput.utxo, cauldronInput.contract.unlock.swap())
  }
  transactionBuilder.addInputs(userTokenInputs, userTemplate.unlockP2PKH())
    .addInputs(bchInputUtxos, userTemplate.unlockP2PKH())
    .addOutputs(outputs)
  addBchChangeOutput(transactionBuilder, userTokenAddress, feeRateSatsPerByte)

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(cauldronInput => cauldronInput.utxo), ...userTokenInputs, ...bchInputUtxos]
  const totalFees = allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsReceived: totalUserReceive, totalFees, effectivePricePerToken: totalUserReceive / amountToSell }
}

/**
 * Prepare a transaction that withdraws all BCH and tokens from a pool the signer owns.
 *
 * @param feeRateSatsPerByte Miner fee rate the transaction targets exactly. Defaults to 1.2 sat/byte.
 */
export async function prepareWithdrawAll(
  pool:CauldronActivePool,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet'),
  feeRateSatsPerByte:number = DEFAULT_FEE_RATE_SATS_PER_BYTE
){
  validateTokenAddress(userTokenAddress)
  assertValidFeeRate(feeRateSatsPerByte)

  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  const ownerTemplate = new SignatureTemplate(signer)
  const ownerPk = ownerTemplate.getPublicKey()

  // Derive owner pkh from provided private key and compare to pool owner pkh
  const ownerPkh = binToHex(hash160((ownerPk)))
  if(pool.owner_pkh !== ownerPkh){
    throw new Error('Provided private key does not match pool owner')
  }

  // Get the specific cauldron contract for the selected pool (based on owner pkh)
  // add 'false' to use the managePool artifact
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh, false)
  const options = { provider, contractType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifact, [], options);

  const userTokenOutput:Recipient = {
    to: userTokenAddress,
    amount: 1000n,
    token: {
      category: pool.token_id,
      amount: BigInt(pool.tokens)
    }
  }

  // the pool's BCH funds the fee, the remainder returns to the owner in the change output
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: BUILDER_MAX_FEE_SATS_PER_BYTE })
    .addInput(cauldronUtxo, cauldronContract.unlock.managePool(ownerPk, ownerTemplate))
    .addOutput(userTokenOutput)
  addBchChangeOutput(transactionBuilder, userTokenAddress, feeRateSatsPerByte)

  // all input utxos for external fee calculation
  const inputUtxos = [cauldronUtxo]
  return { transactionBuilder, inputUtxos }
}

/**
 * Prepare a create-pool transaction.
 *
 * @param userUtxos Pre-fetched UTXOs for the owner's token address (derived from `signer`); skips the internal fetch.
 * @param feeRateSatsPerByte Miner fee rate the transaction targets exactly. Defaults to 1.2 sat/byte.
 */
export async function prepareCreatePool(
  tokenId:string,
  satsAmount:bigint,
  tokenAmount:bigint,
  signer:string | Uint8Array,
  network:CauldronNetwork = 'mainnet',
  provider:NetworkProvider = new ElectrumNetworkProvider(network),
  userUtxos?:Utxo[],
  feeRateSatsPerByte:number = DEFAULT_FEE_RATE_SATS_PER_BYTE
){
  assertValidFeeRate(feeRateSatsPerByte)
  if(satsAmount <= 0n) throw new Error('satsAmount must be a positive number')
  if(tokenAmount <= 0n) throw new Error('tokenAmount must be a positive number')

  // Derive owner address and PKH from signer
  const signerTemplate = new SignatureTemplate(signer)
  const ownerPk = signerTemplate.getPublicKey()
  const ownerPkh = binToHex(hash160(ownerPk))
  const addressPrefix = network === 'mainnet' ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet;
  const userTokenAddress = encodeCashAddress({ prefix: addressPrefix, type: CashAddressType.p2pkhWithTokens, payload: hash160(ownerPk) }).address

  // Build the Cauldron contract for this owner
  const cauldronArtifact = cauldronArtifactWithPkh(ownerPkh)
  const options = { provider, contractType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifact, [], options)

  const resolvedUserUtxos = userUtxos ?? await provider.getUtxos(userTokenAddress)
  const userBchUtxos = resolvedUserUtxos.filter(utxo => !utxo.token)
  const userTokenUtxos = resolvedUserUtxos.filter(utxo => utxo.token?.category === tokenId)

  // Select token inputs
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, tokenAmount)

  // Calculate required BCH, the exact fee is settled by the change output
  const tokenChangeAmount = userTokenInputTotal - tokenAmount
  const tokenChangeDust = tokenChangeAmount > 0n ? 1000n : 0n
  const feePerUserInput = calculateFeePerUserInput(feeRateSatsPerByte)
  // no cauldron inputs are spent, only the pool output is created
  const feeReserve = calculateSelectionFeeReserve(0, feeRateSatsPerByte, userTokenInputs.length)
  // BCH sitting on token input UTXOs already covers part of the fee
  const bchOnTokenInputs = userTokenInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n)
  const shortfall = (needed: bigint) => needed > bchOnTokenInputs ? needed - bchOnTokenInputs : 0n

  // Select BCH inputs, the reserve on top of the pool and dust amounts is an over-estimate
  const { bchInputUtxos } = gatherBchUtxos(
    userBchUtxos,
    shortfall(satsAmount + tokenChangeDust + feeReserve),
    feePerUserInput,
    shortfall(satsAmount + tokenChangeDust),
  )

  // Build outputs
  const poolOutput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: satsAmount,
    token: {
      category: tokenId,
      amount: tokenAmount,
    },
  }

  const changeOutputs:Recipient[] = []

  if(tokenChangeAmount > 0n){
    changeOutputs.push({
      to: userTokenAddress,
      amount: tokenChangeDust,
      token: {
        category: tokenId,
        amount: tokenChangeAmount,
      },
    })
  }

  // Build transaction: pool output → OP_RETURN → token change → BCH change
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: BUILDER_MAX_FEE_SATS_PER_BYTE })
  transactionBuilder.addInputs(userTokenInputs, signerTemplate.unlockP2PKH())
    .addInputs(bchInputUtxos, signerTemplate.unlockP2PKH())
    .addOutput(poolOutput)
    .addOpReturnOutput(['SUMMON', '0x' + ownerPkh])
    .addOutputs(changeOutputs)
  addBchChangeOutput(transactionBuilder, userTokenAddress, feeRateSatsPerByte)

  const inputUtxos = [...userTokenInputs, ...bchInputUtxos]
  return { transactionBuilder, inputUtxos, poolContractAddress: cauldronContract.tokenAddress, ownerPkh }
}
