import { Cl, cvToValue } from "@stacks/transactions";
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

const accounts = simnet.getAccounts();
const transferAmount = 1000000; // 0.01 USABTC (8 decimals)
const depositAmount = transferAmount * 2; // 0.02 USABTC
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
  it("transfer(): succeeds, prints memo and event", () => {
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
  it("deposit(): fails if amount is 0", () => {});
  it("deposit(): succeeds, transfers sBTC to contract, mints USABTC", () => {});
  it("withdraw(): fails if sender does not have enough USABTC", () => {});
  it("withdraw(): succeeds with exit tax = 0, burns USABTC, transfers sBTC to sender", () => {});
  it("withdraw(): succeeds with exit tax > 0, burns USABTC, transfers sBTC sender and custodian", () => {});
  it("enable-exit-tax(): fails if called by contract deployer", () => {});
  it("enable-exit-tax(): fails if not called by custodian wallet", () => {});
  it("enable-exit-tax(): succeeds, set exit tax values, prints event", () => {});
  it("disable-exit-tax(): fails if called by contract deployer", () => {});
  it("disable-exit-tax(): fails if not called by custodian wallet", () => {});
  it("disable-exit-tax(): succeeds, set exit tax values, prints event", () => {});
  it("update-custodian-wallet(): fails if not called by custodian wallet", () => {});
  it("update-custodian-wallet(): fails if new custodian wallet matches current", () => {});
  it("update-custodian-wallet(): succeeds, set custodian wallet, print event", () => {});
  it("get-exit-tax-values(): returns the exit tax values", () => {});
  it("get-current-exit-tax(): returns the current exit tax", () => {});
  it("get-exit-tax-for-amount(): returns the exit tax for an amount", () => {});
  it("get-custodian-wallet(): returns the custodian wallet", () => {});
});

/*
describe("USABTC Integration Tests", () => {
  it("multiple deposits and withdrawals", () => {});
  it("before, during, after active tax block height", () => {});
  it("any other tricky scenarios to cover?", () => {});
});
*/
