import { Cl, cvToValue } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

// generalized function for minting sBTC using test-mint
function mintSBTC(amount: number, recipient: string) {
  simnet.callPublicFn(
    "sbtc-token",
    "test-mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    simnet.getAccounts().get("deployer")!
  );
}

describe("USABTC Token - Transfer Function", () => {
  const USABTC_CONTRACT = "usabtc-token";

  const TRANSFER_AMOUNT = 1000000; // 0.01 USABTC (assuming 8 decimal places)

  it("transfer(): succeeds with valid parameters", () => {
    // ARRANGE
    const accounts = simnet.getAccounts();
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;

    // mint sBTC for the sender
    mintSBTC(TRANSFER_AMOUNT * 100, sender); // 1 sBTC

    // deposit sBTC to mint USABTC
    const depositResponse = simnet.callPublicFn(
      USABTC_CONTRACT,
      "deposit",
      [Cl.uint(TRANSFER_AMOUNT * 2)],
      sender
    );
    expect(depositResponse.result).toBeOk(Cl.bool(true));

    // ACT
    const response = simnet.callPublicFn(
      USABTC_CONTRACT,
      "transfer",
      [
        Cl.uint(TRANSFER_AMOUNT),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      sender
    );

    // ASSERT
    expect(response.result).toBeOk(Cl.bool(true));

    // Check balances
    const senderBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    const recipientBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(recipient)],
      sender
    );

    expect(senderBalance.result).toBeOk(Cl.uint(TRANSFER_AMOUNT));
    expect(recipientBalance.result).toBeOk(Cl.uint(TRANSFER_AMOUNT));
  });

  it("transfer(): fails when sender is not the token owner", () => {
    // ARRANGE
    const accounts = simnet.getAccounts();
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;
    const impersonator = accounts.get("wallet_2")!;

    // deposit sBTC to mint USABTC
    simnet.callPublicFn(
      USABTC_CONTRACT,
      "deposit",
      [Cl.uint(TRANSFER_AMOUNT)],
      sender
    );

    // ACT
    const response = simnet.callPublicFn(
      USABTC_CONTRACT,
      "transfer",
      [
        Cl.uint(TRANSFER_AMOUNT),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      impersonator
    );

    // ASSERT
    expect(response.result).toBeErr(Cl.uint(1001)); // ERR_NOT_TOKEN_OWNER
  });

  it("transfer(): fails with insufficient balance", () => {
    // ARRANGE
    const accounts = simnet.getAccounts();
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;

    // mint sBTC for the sender
    mintSBTC(TRANSFER_AMOUNT * 100, sender); // 1 sBTC

    // deposit sBTC to mint USABTC
    simnet.callPublicFn(
      USABTC_CONTRACT,
      "deposit",
      [Cl.uint(TRANSFER_AMOUNT / 2)],
      sender
    );

    // ACT
    const response = simnet.callPublicFn(
      USABTC_CONTRACT,
      "transfer",
      [
        Cl.uint(TRANSFER_AMOUNT),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      sender
    );

    // ASSERT
    expect(response.result).toBeErr(Cl.uint(1)); // standard ft error code
  });

  it("transfer(): succeeds with memo", () => {
    // ARRANGE
    const accounts = simnet.getAccounts();
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;
    const memo = Buffer.from("Test transfer with memo");

    // mint sBTC for the sender
    mintSBTC(TRANSFER_AMOUNT * 100, sender); // 1 sBTC

    // deposit sBTC to mint USABTC
    simnet.callPublicFn(
      USABTC_CONTRACT,
      "deposit",
      [Cl.uint(TRANSFER_AMOUNT)],
      sender
    );

    // ACT
    const response = simnet.callPublicFn(
      USABTC_CONTRACT,
      "transfer",
      [
        Cl.uint(TRANSFER_AMOUNT),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.some(Cl.buffer(memo)),
      ],
      sender
    );

    // ASSERT
    expect(response.result).toBeOk(Cl.bool(true));
  });

  it("transfer(): correctly updates balances", () => {
    // ARRANGE
    const accounts = simnet.getAccounts();
    const sender = accounts.get("deployer")!;
    const recipient = accounts.get("wallet_1")!;

    // mint sBTC for the sender
    mintSBTC(TRANSFER_AMOUNT * 100, sender); // 1 sBTC

    // deposit sBTC to mint USABTC
    simnet.callPublicFn(
      USABTC_CONTRACT,
      "deposit",
      [Cl.uint(TRANSFER_AMOUNT * 2)],
      sender
    );

    // Get initial balances
    const initialSenderBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    const initialRecipientBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(recipient)],
      sender
    );

    // ACT
    simnet.callPublicFn(
      USABTC_CONTRACT,
      "transfer",
      [
        Cl.uint(TRANSFER_AMOUNT),
        Cl.principal(sender),
        Cl.principal(recipient),
        Cl.none(),
      ],
      sender
    );

    // Get final balances
    const finalSenderBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(sender)],
      sender
    );
    const finalRecipientBalance = simnet.callReadOnlyFn(
      USABTC_CONTRACT,
      "get-balance",
      [Cl.principal(recipient)],
      sender
    );

    // ASSERT
    expect(finalSenderBalance.result).toBeOk(Cl.uint(TRANSFER_AMOUNT));
    expect(finalRecipientBalance.result).toBeOk(Cl.uint(TRANSFER_AMOUNT));

    // convert Clarity values to JS values for arithmetic
    const initialSenderAmount = Number(
      cvToValue(initialSenderBalance.result).value
    );
    const initialRecipientAmount = Number(
      cvToValue(initialRecipientBalance.result).value
    );
    const finalSenderAmount = Number(
      cvToValue(finalSenderBalance.result).value
    );
    const finalRecipientAmount = Number(
      cvToValue(finalRecipientBalance.result).value
    );

    // Perform balance checks
    expect(finalSenderAmount).toBe(initialSenderAmount - TRANSFER_AMOUNT);
    expect(finalRecipientAmount).toBe(initialRecipientAmount + TRANSFER_AMOUNT);
  });
});
