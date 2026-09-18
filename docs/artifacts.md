# Artifacts

## Need for custom artifacts

The Cauldron contract doesn't have a CashScript Artifact as it's written in raw BCH Script. However to use the CashScript TypeScript SDK it's only possible to use the `Contract` class when providing a contract artifact. 

Because CashScript artifacts were not designed to support contracts written with raw script, some workarounds were needed to create artifacts for the Cauldron smart contract. These workarounds are covered in the following section:

## Difficulties

- Converting the whitepaper opcodes to CashScript asm is not 1-for-1
-> note the encoding of OP_2 & OP_3 and a missing OP_EQUALVERIFY opcode in the whitepaper

- CashScript Artifacts currently don't support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- Artifact expects to use a `FunctionIndex` argument when there more than 1 `abi` function
-> solved: use 2 separate Artifacts to represent the Cauldron contract
