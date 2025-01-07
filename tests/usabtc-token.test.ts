import { Cl, cvToValue, TupleCV, UIntCV } from "@stacks/transactions";
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
    // capture USABTC total supply before deposit
    const totalSupplyBefore = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-total-supply",
      [],
      sender
    );
    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      usabtcTokenContract,
      "deposit",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.uint(depositAmount));
    // ACT
    // capture USABTC exit tax before withdrawal
    const exitTaxValues = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    const response = simnet.callPublicFn(
      usabtcTokenContract,
      "withdraw",
      [Cl.uint(depositAmount)],
      sender
    );
    const totalSupplyAfter = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-total-supply",
      [],
      sender
    );
    // ASSERT
    expect(exitTaxValues.result).toBeTuple({
      "active-exit-tax": Cl.uint(0),
      "active-exit-tax-activation-block": Cl.uint(0),
      "previous-exit-tax": Cl.uint(0),
    });
    expect(response.result).toBeOk(Cl.uint(depositAmount));
    expect(totalSupplyBefore).toEqual(totalSupplyAfter);
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
    // capture exit tax values before enabling
    const exitTaxValuesBefore = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    // check expected exit tax values
    checkExitTaxValues(exitTaxValuesBefore.result as TupleCV, 0, 0, 0);
    // capture exit tax for amount before enabled
    const exitTaxValueForAmountBeforeCV = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(exitTaxValueForAmountBeforeCV.result).toStrictEqual(Cl.uint(0));
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
    // check expected exit tax values
    checkExitTaxValues(
      exitTaxValuesAfter.result as TupleCV,
      10,
      activationBlockHeight,
      0
    );
    // capture exit tax for amount after enabled
    const exitTaxValueForAmountAfterCV = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(exitTaxValueForAmountAfterCV.result).toStrictEqual(Cl.uint(0));
    // skip to when exit tax is active
    simnet.mineEmptyBurnBlocks(exitTaxDelay);
    // capture exit tax values after activation block
    const exitTaxValuesAfterActivation = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-values",
      [],
      sender
    );
    // check expected exit tax values
    checkExitTaxValues(
      exitTaxValuesAfterActivation.result as TupleCV,
      10,
      activationBlockHeight,
      0
    );
    // capture exit tax for amount after enabled
    const exitTaxValueForAmountAfterActivationCV = simnet.callReadOnlyFn(
      usabtcTokenContract,
      "get-exit-tax-for-amount",
      [Cl.uint(depositAmount)],
      sender
    );
    expect(exitTaxValueForAmountAfterActivationCV.result).toStrictEqual(
      Cl.uint(taxAmount)
    );
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
    // TODO
    // ARRANGE
    // ACT
    // ASSERT
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
  it("disable-exit-tax(): succeeds, set exit tax values, prints event", () => {
    // TODO
    // ARRANGE
    // ACT
    // ASSERT
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
  it("update-custodian-wallet(): succeeds, set custodian wallet, print event", () => {
    // TODO
    // ARRANGE
    // ACT
    // ASSERT
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

/*
describe("USABTC Integration Tests", () => {
  it("multiple deposits and withdrawals", () => {});
  it("before, during, after active tax block height", () => {});
  it("any other tricky scenarios to cover?", () => {});
});
*/
