import { Cl, cvToValue, TupleCV } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

// matches error codes in contract
enum ErrCode {
  ERR_NOT_CUSTODIAN_WALLET = 1000,
  ERR_SAME_AS_CURRENT_CUSTODIAN,
  ERR_NOT_TOKEN_OWNER,
  ERR_INSUFFICIENT_BALANCE,
  ERR_INVALID_AMOUNT,
}

// generalized function for minting sBTC using test-mint
function mintSBTC(amount: number, recipient: string) {
  simnet.callPublicFn(
    "sbtc-token",
    "test-mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    simnet.getAccounts().get("deployer")!
  );
}

type ExitTaxValues = {
  activeExitTax: number;
  activeExitTaxActivationBlock: number;
  previousExitTax: number;
};

// generalized function to extract exit tax values as a typed object
function extractExitTaxValues(exitTaxValuesCV: TupleCV): ExitTaxValues {
  const exitTaxValues = cvToValue(exitTaxValuesCV);
  const activeExitTax = parseInt(exitTaxValues["active-exit-tax"].value);
  const activeExitTaxActivationBlock = parseInt(
    exitTaxValues["active-exit-tax-activation-block"].value
  );
  const previousExitTax = parseInt(exitTaxValues["previous-exit-tax"].value);
  return {
    activeExitTax,
    activeExitTaxActivationBlock,
    previousExitTax,
  };
}

function checkExitTaxValues(
  exitTaxValuesCV: TupleCV,
  expectedActiveExitTax: number,
  expectedActiveExitTaxActivationBlock: number,
  expectedPreviousExitTax: number
) {
  const expectedTaxValues = Cl.tuple({
    "active-exit-tax": Cl.uint(expectedActiveExitTax),
    "active-exit-tax-activation-block": Cl.uint(
      expectedActiveExitTaxActivationBlock
    ),
    "previous-exit-tax": Cl.uint(expectedPreviousExitTax),
  });
  expect(exitTaxValuesCV).toStrictEqual(expectedTaxValues);
}

const accounts = simnet.getAccounts();
const transferAmount = 1000000; // 0.01 USABTC (8 decimals)
const depositAmount = transferAmount * 2; // 0.02 USABTC
const exitTaxDelay = 21000;
const usabtcTokenContract = "usabtc-token";

// a random value between 1 and depositAmount
function getRandomDepositAmount() {
  return Math.round(Math.random() * depositAmount);
}

describe("SIP-010 Functions", () => {
  it("transfer(): fails if sender is not owner", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;
    const impersonator = accounts.get("wallet_2")!;
    // mint sBTC for the sender
    mintSBTC(transferAmount * 100, sender); // 1 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      impersonator
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_TOKEN_OWNER));
  });
  it("transfer(): succeeds with no memo", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;
    // mint sBTC for the sender
    mintSBTC(transferAmount * 100, sender); // 1 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      sender
    );
    // ASSERT
    // check that the transfer succeeded
    expect(response.result).toBeOk(Cl.bool(true));
    // check sender and recipient balances
    const senderBalance = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    const recipientBalance = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(recipient)],
      sender
    );
    expect(senderBalance.result).toBeOk(Cl.uint(transferAmount));
    expect(recipientBalance.result).toBeOk(Cl.uint(transferAmount));
  });
  it("transfer(): succeeds with a memo", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;
    const memo = "test";
    const memoCV = Cl.bufferFromAscii(memo);
    // mint sBTC for the sender
    mintSBTC(transferAmount * 100, sender); // 1 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.some(memoCV),
      ],
      sender
    );
    // ASSERT
    // check that the transfer succeeded
    expect(response.result).toBeOk(Cl.bool(true));
    // check sender and recipient balances
    const senderBalance = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    const recipientBalance = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(recipient)],
      sender
    );
    expect(senderBalance.result).toBeOk(Cl.uint(transferAmount));
    expect(recipientBalance.result).toBeOk(Cl.uint(transferAmount));
    // check that the memo was printed as first event
    const memoPrintEvent = response.events[0];
    const memoValue = memoPrintEvent.data.value;
    expect(memoValue).toStrictEqual(Cl.some(memoCV));
  });
  it("get-name(): returns the token name", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-name",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.stringAscii("USABTC"));
  });
  it("get-symbol(): returns the token symbol", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-symbol",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.stringAscii("USABTC"));
  });
  it("get-decimals(): returns the token decimals", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-decimals",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(8));
  });
  it("get-balance(): returns the balance of an account", () => {
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(accounts.get("deployer")!)],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(0));
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // mint sBTC for the account
    mintSBTC(transferAmount * 100, sender); // 1 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response2 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    // ASSERT
    expect(response2.result).toBeOk(Cl.uint(depositAmount));
  });
  it("get-total-supply(): returns the total supply of the token", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-total-supply",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(0));

    // ARRANGE
    const sender = accounts.get("deployer")!;
    // mint sBTC for the sender
    mintSBTC(transferAmount * 100, sender); // 1 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response2 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-total-supply",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response2.result).toBeOk(Cl.uint(depositAmount));
  });
  it("get-token-uri(): returns the token URI", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-token-uri",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeOk(
      Cl.some(Cl.stringUtf8("https://usabtc.org/token-metadata.json"))
    );
  });
});

describe("USABTC Functions", () => {
  it("deposit(): fails if amount is 0", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(0)],
      sender
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_INVALID_AMOUNT));
  });
  it("deposit(): succeeds, transfers sBTC to contract, mints USABTC", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // mint sBTC for the sender
    mintSBTC(depositAmount, sender); // 0.02 sBTC
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(depositAmount));
  });
  it("withdraw(): fails if sender does not have enough USABTC", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(depositAmount)],
      sender
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_INSUFFICIENT_BALANCE));
  });
  it("withdraw(): succeeds with exit tax = 0, burns USABTC, transfers sBTC to sender", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // mint sBTC for the sender
    mintSBTC(depositAmount, sender); // 0.02 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(depositAmount)],
      sender
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(depositAmount));
  });
  it("withdraw(): succeeds with exit tax = 10%, burns USABTC, transfers sBTC sender and custodian", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const taxAmount = (depositAmount * 10) / 100;
    // mint sBTC for the sender
    mintSBTC(depositAmount, sender); // 0.02 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));
    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));
    const activationBlockHeight = simnet.burnBlockHeight + exitTaxDelay;
    // capture exit tax values after enabling
    const exitTaxValuesAfter = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const exitTaxValuesAfterObj = extractExitTaxValues(
      exitTaxValuesAfter.result as TupleCV
    );
    // verify activation block height is correct
    expect(exitTaxValuesAfterObj.activeExitTaxActivationBlock).toBe(
      activationBlockHeight
    );
    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(depositAmount)],
      sender
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.uint(depositAmount - taxAmount));
  });
  it("enable-exit-tax(): fails if called by contract deployer", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      sender
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_CUSTODIAN_WALLET));
  });
  it("enable-exit-tax(): fails if not called by custodian wallet", () => {
    // ARRANGE
    const impersonator = accounts.get("wallet_2")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      impersonator
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_CUSTODIAN_WALLET));
  });
  it("enable-exit-tax(): succeeds and sets exit tax values", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    // mint sBTC for the sender
    mintSBTC(depositAmount, sender); // 0.02 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.bool(true));
  });
  it("disable-exit-tax(): fails if called by contract deployer", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "disable-exit-tax",
      [],
      sender
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_CUSTODIAN_WALLET));
  });
  it("disable-exit-tax(): fails if not called by custodian wallet", () => {
    // ARRANGE
    const impersonator = accounts.get("wallet_2")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "disable-exit-tax",
      [],
      impersonator
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_CUSTODIAN_WALLET));
  });
  it("disable-exit-tax(): succeeds and sets exit tax values", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    // mint sBTC for the sender
    mintSBTC(depositAmount, sender); // 0.02 sBTC
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "disable-exit-tax",
      [],
      custodian
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.bool(true));
  });
  it("update-custodian-wallet(): fails if not called by custodian wallet", () => {
    // ARRANGE
    const impersonator = accounts.get("wallet_2")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(impersonator)],
      impersonator
    );
    // ASSERT
    expect(response.result).toBeErr(Cl.uint(ErrCode.ERR_NOT_CUSTODIAN_WALLET));
  });
  it("update-custodian-wallet(): fails if new custodian wallet matches current", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(sender)],
      sender
    );
    // ASSERT
    expect(response.result).toBeErr(
      Cl.uint(ErrCode.ERR_SAME_AS_CURRENT_CUSTODIAN)
    );
  });
  it("update-custodian-wallet(): succeeds and sets custodian wallet", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    // ASSERT
    expect(response.result).toBeOk(Cl.bool(true));
  });
  it("get-exit-tax-values(): returns the exit tax values", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toBeTuple({
      "active-exit-tax": Cl.uint(0),
      "active-exit-tax-activation-block": Cl.uint(0),
      "previous-exit-tax": Cl.uint(0),
    });
  });
  it("get-current-exit-tax(): returns the current exit tax", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toStrictEqual(Cl.uint(0));
  });
  it("get-exit-tax-for-amount(): returns the exit tax for an amount", () => {
    // ARRANGE
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(depositAmount)],
      accounts.get("deployer")!
    );
    // ASSERT
    expect(response.result).toStrictEqual(Cl.uint(0));
  });
  it("get-custodian-wallet(): returns the custodian wallet", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-custodian-wallet",
      [],
      sender
    );
    // ASSERT
    expect(response.result).toStrictEqual(Cl.principal(sender));
  });
});

describe("USABTC Exit Tax Precision", () => {
  it("get-exit-tax-for-amount(): calculates correct tax for the smallest amount", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const smallestAmount = 10; // 0.0000001 BTC
    const expectedTaxAmount = 1; // 0.00000001 BTC (1 sat)

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(smallestAmount)],
      sender
    );

    // ASSERT
    // 10% of 0.00001 BTC should be 0.000001 BTC (100 satoshis)
    expect(response.result).toStrictEqual(Cl.uint(expectedTaxAmount));
  });
  it("get-exit-tax-for-amount(): calculates correct tax for small amounts", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const smallAmount = 1000; // 0.00001 BTC
    const expectedTaxAmount = 100; // 0.000001 BTC (100 sat)

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(smallAmount)],
      sender
    );

    // ASSERT
    // 10% of 0.00001 BTC should be 0.000001 BTC (100 satoshis)
    expect(response.result).toStrictEqual(Cl.uint(expectedTaxAmount));
  });

  it("get-exit-tax-for-amount(): maintains precision for large amounts", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const largeAmount = 10000000000n; // 100 BTC

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(largeAmount)],
      sender
    );

    // ASSERT
    // 10% of 100 BTC should be 10 BTC (1,000,000,000 satoshis)
    expect(response.result).toStrictEqual(Cl.uint(1000000000));
  });

  it("get-exit-tax-for-amount(): maintains precision for odd amounts", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const oddAmount = 123456789n; // 1.23456789 BTC
    const oddAmount2 = 987654321n; // 9.87654321 BTC

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(oddAmount)],
      sender
    );

    const response2 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(oddAmount2)],
      sender
    );

    // ASSERT
    // 10% of 1.23456789 BTC should be 0.12345678 BTC (12,345,678 satoshis)
    expect(response.result).toStrictEqual(Cl.uint(12345678));
    // 10% of 9.87654321 BTC should be 0.98765432 BTC (98,765,432 satoshis)
    expect(response2.result).toStrictEqual(Cl.uint(98765432));
  });

  // this test verifies the full withdrawal flow with the smallest amount
  it("withdraw(): handles smallest amount correctly with active exit tax", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const smallestAmount = 10; // 0.0000001 BTC
    const expectedTaxAmount = 1; // 0.00000001 BTC (1 sat)

    // mint sBTC for the sender
    mintSBTC(smallestAmount, sender);

    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(smallestAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(smallestAmount));

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(smallestAmount)],
      sender
    );

    // ASSERT
    // Should succeed and return amount minus tax
    expect(response.result).toBeOk(Cl.uint(smallestAmount - expectedTaxAmount));
  });

  // This test verifies the full withdrawal flow with a small amount
  it("withdraw(): handles small amounts correctly with active exit tax", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_1")!;
    const smallAmount = 1000; // 0.00001 BTC
    const expectedTaxAmount = 100; // 0.000001 BTC (10% of smallAmount)

    // mint sBTC for the sender
    mintSBTC(smallAmount, sender);

    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(smallAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(smallAmount));

    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));

    // enable exit tax
    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));

    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);

    // ACT
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(smallAmount)],
      sender
    );

    // ASSERT
    // Should succeed and return amount minus tax
    expect(response.result).toBeOk(Cl.uint(smallAmount - expectedTaxAmount));
  });
});

describe("USABTC Integration Tests", () => {
  it("accurately tracks multiple deposits and withdrawals", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const wallets = [
      accounts.get("wallet_1")!,
      accounts.get("wallet_2")!,
      accounts.get("wallet_3")!,
      accounts.get("wallet_4")!,
      accounts.get("wallet_5")!,
      accounts.get("wallet_6")!,
      accounts.get("wallet_7")!,
    ];
    // fill array to length of wallets with random deposit amounts
    const depositAmounts = Array.from(
      { length: wallets.length },
      getRandomDepositAmount
    );
    // mint sBTC to all wallets
    wallets.forEach((wallet, idx) => {
      mintSBTC(depositAmounts[idx], wallet);
    });
    // ACT
    // deposit sBTC to mint USABTC for all wallets
    wallets.forEach((wallet, idx) => {
      const depositResponse = simnet.callPublicFn(
        usabtcTokenContract,
        "deposit",
        [Cl.uint(depositAmounts[idx])],
        wallet
      );
      expect(depositResponse.result).toBeOk(Cl.uint(depositAmounts[idx]));
    });
    // withdraw USABTC for all wallets
    wallets.forEach((wallet, idx) => {
      const response = simnet.callPublicFn(
        usabtcTokenContract,
        "withdraw",
        [Cl.uint(depositAmounts[idx])],
        wallet
      );
      expect(response.result).toBeOk(Cl.uint(depositAmounts[idx]));
    });
    // ASSERT
  });
  it("accurately tracks before, during, after active tax block height", () => {
    // ARRANGE
    const sender = accounts.get("deployer")!;
    const custodian = accounts.get("wallet_8")!;
    const wallets = [
      accounts.get("wallet_1")!,
      accounts.get("wallet_2")!,
      accounts.get("wallet_3")!,
    ];
    // fill array to length of wallets with random deposit amounts
    const depositAmounts = Array.from(
      { length: wallets.length },
      getRandomDepositAmount
    );
    // mint sBTC to all wallets
    wallets.forEach((wallet, idx) => {
      mintSBTC(depositAmounts[idx], wallet);
    });
    // deposit sBTC to mint USABTC for all wallets
    wallets.forEach((wallet, idx) => {
      const depositResponse = simnet.callPublicFn(
        usabtcTokenContract,
        "deposit",
        [Cl.uint(depositAmounts[idx])],
        wallet
      );
      expect(depositResponse.result).toBeOk(Cl.uint(depositAmounts[idx]));
    });
    // set custodian
    const updateCustodianResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "update-custodian-wallet",
      [Cl.principal(custodian)],
      sender
    );
    expect(updateCustodianResponse.result).toBeOk(Cl.bool(true));
    // 1. exit tax is not enabled
    // ACT
    const exitTaxValues1 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const currentExitTax1 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      sender
    );
    wallets.forEach((_, idx) => {
      const exitTaxValueForAmount1 = simnet.callReadOnlyFn(
        usabtcTokenContract,
        "get-exit-tax-for-amount",
        [Cl.uint(depositAmounts[idx])],
        sender
      );
      // ASSERT
      expect(exitTaxValueForAmount1.result).toStrictEqual(Cl.uint(0));
    });
    // ASSERT
    checkExitTaxValues(exitTaxValues1.result as TupleCV, 0, 0, 0);
    expect(currentExitTax1.result).toStrictEqual(Cl.uint(0));
    // 2. exit tax is enabled but not active
    // ARRANGE

    const enableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "enable-exit-tax",
      [],
      custodian
    );
    expect(enableExitTaxResponse.result).toBeOk(Cl.bool(true));
    const activationBlockHeight = simnet.burnBlockHeight + exitTaxDelay;
    // ACT
    const exitTaxValues2 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const currentExitTax2 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      sender
    );
    wallets.forEach((_, idx) => {
      const exitTaxValueForAmount2 = simnet.callReadOnlyFn(
        usabtcTokenContract,
        "get-exit-tax-for-amount",
        [Cl.uint(depositAmounts[idx])],
        sender
      );
      // ASSERT
      expect(exitTaxValueForAmount2.result).toStrictEqual(Cl.uint(0));
    });
    // ASSERT
    checkExitTaxValues(
      exitTaxValues2.result as TupleCV,
      10,
      activationBlockHeight,
      0
    );
    expect(currentExitTax2.result).toStrictEqual(Cl.uint(0));
    // 3. exit tax is enabled and active
    // ARRANGE
    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);
    // ACT
    const exitTaxValues3 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const currentExitTax3 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      sender
    );
    wallets.forEach((_, idx) => {
      const exitTaxValueForAmount3 = simnet.callReadOnlyFn(
        usabtcTokenContract,
        "get-exit-tax-for-amount",
        [Cl.uint(depositAmounts[idx])],
        sender
      );
      // ASSERT
      expect(exitTaxValueForAmount3.result).toStrictEqual(
        Cl.uint(Math.floor((depositAmounts[idx] * 10) / 100))
      );
    });
    // ASSERT
    checkExitTaxValues(
      exitTaxValues3.result as TupleCV,
      10,
      activationBlockHeight,
      0
    );
    expect(currentExitTax3.result).toStrictEqual(Cl.uint(10));
    // 4. exit tax is disabled but not active
    // ARRANGE
    const disableExitTaxResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "disable-exit-tax",
      [],
      custodian
    );
    expect(disableExitTaxResponse.result).toBeOk(Cl.bool(true));
    const disabledBlockHeight = simnet.burnBlockHeight + exitTaxDelay;
    // ACT
    const exitTaxValues4 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const currentExitTax4 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      sender
    );
    wallets.forEach((_, idx) => {
      const exitTaxValueForAmount4 = simnet.callReadOnlyFn(
        usabtcTokenContract,
        "get-exit-tax-for-amount",
        [Cl.uint(depositAmounts[idx])],
        sender
      );
      // ASSERT
      expect(exitTaxValueForAmount4.result).toStrictEqual(
        Cl.uint(Math.floor((depositAmounts[idx] * 10) / 100))
      );
    });
    // ASSERT
    checkExitTaxValues(
      exitTaxValues4.result as TupleCV,
      0,
      disabledBlockHeight,
      10
    );
    expect(currentExitTax4.result).toStrictEqual(Cl.uint(10));
    // 5. exit tax is disabled and active
    // ARRANGE
    // skip to when exit tax is disabled
    simnet.mineEmptyBurnBlocks(exitTaxDelay);
    // ACT
    const exitTaxValues5 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const currentExitTax5 = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-current-exit-tax",
      [],
      sender
    );
    wallets.forEach((_, idx) => {
      const exitTaxValueForAmount5 = simnet.callReadOnlyFn(
        usabtcTokenContract,
        "get-exit-tax-for-amount",
        [Cl.uint(depositAmounts[idx])],
        sender
      );
      // ASSERT
      expect(exitTaxValueForAmount5.result).toStrictEqual(Cl.uint(0));
    });
    // ASSERT
    checkExitTaxValues(
      exitTaxValues5.result as TupleCV,
      0,
      disabledBlockHeight,
      10
    );
    expect(currentExitTax5.result).toStrictEqual(Cl.uint(0));
  });
});
