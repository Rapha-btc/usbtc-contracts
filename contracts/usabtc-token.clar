
;; title: USABTC Token Contract
;; version: 1.0.0
;; summary: USABTC is a specialized fungible token implemented on the Stacks blockchain.
;; description: USABTC is designed to provide a unique economic mechanism that bridges Bitcoin
;; and the US financial system through the decentralized and secure Stacks network. USABTC
;; maintains a 1:1 relationship with sBTC.

;; KEY POINTS
;; - USABTC is a network union that requests 0% capital gains tax in exchange from a 21% exit tax
;;   from the USABTC Digital Economic Zone (DEZ).
;; - USABTC is a specialized fungible token implemented on the Stacks blockchain.
;; - USABTC has a 1:1 relationship with sBTC, a tokenized version of Bitcoin on the Stacks network.
;; - sBTC is secured by the decentralized signers on the Stacks network, which is anchored to Bitcoin.
;; - Depositing sBTC into this contract locks it and mints an equivalent amount of USABTC.
;; - USABTC can be withdrawn back to sBTC at any time with an exit tax that starts at 0%.
;; - USABTC that is withdrawn is burned (destroyed) and the exit tax is sent to the custodian trust wallet.
;; - The 21% exit tax can be enabled by the custodian trust wallet but with a delay of 4.8 months, with
;;   the expectation that no federal capital gains tax will be applied to assets in the DEZ.
;; - Funds CANNOT be directly transferred to this contract or the will be unrecoverable. Only sBTC
;;   transferred through the "deposit" function will be minted into USABTC.
;; - USABTC https://usabtc.org | Stacks https://stacks.co

;; traits
;;
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; token definitions
;;
(define-fungible-token usabtc)

;; constants
;;

(define-constant CONTRACT_OWNER tx-sender)
(define-constant USABTC_CONTRACT (as-contract tx-sender))

;; exit tax
(define-constant USABTC_EXIT_TAX u2100) ;; 21% exit tax
(define-constant EXIT_TAX_DELAY u21000) ;; approx 4.8 months in Bitcoin block time

;; error codes
(define-constant ERR_NOT_CUSTODIAN_WALLET (err u1000))
(define-constant ERR_SAME_AS_CURRENT_CUSTODIAN (err u1001))
(define-constant ERR_NOT_TOKEN_OWNER (err u1002))
(define-constant ERR_INSUFFICIENT_BALANCE (err u1003))
(define-constant ERR_INVALID_AMOUNT (err u1004))


;; data vars
;;
;; TODO: decide home for metadata. ordinal? IPFS? URL?
(define-data-var token-uri (optional (string-utf8 256)) (some u"https://usabtc.org/token-metadata.json"))
;; holds the active exit tax used in calculations
;; exit task starts at 0% until activated, always 21% or 0%
(define-data-var previous-exit-tax uint u0)
(define-data-var active-exit-tax uint u0)
(define-data-var active-exit-tax-activation-block uint u0)
;; destination wallet for exit tax funds and responsibilities
;; temporarily set to deployer and blocked from enabling exit tax
(define-data-var custodian-trust-wallet principal CONTRACT_OWNER)

;; public functions
;;

;; SIP-010 transfer
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    ;; check ownership
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    ;; print memo (legacy)
    (if (is-some memo)
      (print memo)
      none
    )
    ;; print event
    (print {
      notification: "usabtc-transfer",
      payload: {
        amount: amount,
        memo: memo,
        recipient: recipient,
        sender: sender
      }
    })
    ;; make transfer
    (ft-transfer? usabtc amount sender recipient)
  )
)

;; USABTC-specific functions

(define-public (deposit (amount uint))
  (begin
    ;; make sure it's more than 0
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    ;; transfer sBTC to this contract
    (try! (contract-call? .sbtc-token transfer amount tx-sender USABTC_CONTRACT none))
    ;; mint USABTC to the despositor
    (try! (ft-mint? usabtc amount tx-sender))
    ;; print event
    (print {
      notification: "usabtc-deposit",
      payload: {
        amount: amount,
        sender: tx-sender
      }
    })
    (ok true)
  )
)

(define-public (withdraw (amount uint))
  (let
    (
      ;; custodian and sender information
      (custodian (var-get custodian-trust-wallet))
      (sender tx-sender)
      (sender-balance (unwrap-panic (get-balance sender)))
      ;; calculate exit tax amount and remaining amount
      (exit-tax-amount (get-exit-tax-for-amount amount))
      (amount-after-tax (- amount exit-tax-amount))
    )
    ;; check that user has enough USABTC
    (asserts! (>= sender-balance amount) ERR_INSUFFICIENT_BALANCE)
    ;; burn USABTC
    (try! (ft-burn? usabtc amount sender))
    ;; TODO: review (as-contract) context here
    ;; transfer sBTC tax to the custodian if > 0
    (and (> exit-tax-amount u0)
      (try! (as-contract (contract-call? .sbtc-token transfer exit-tax-amount USABTC_CONTRACT custodian none)))
    )
    ;; transfer sBTC to the sender
    (try! (as-contract (contract-call? .sbtc-token transfer amount-after-tax USABTC_CONTRACT sender none)))
    ;; print event
    (print {
      notification: "usabtc-withdrawal",
      payload: {
        amount: amount,
        amount-after-tax: amount-after-tax,
        custodian: custodian,
        exit-tax-amount: exit-tax-amount,
        sender: sender
      }
    })
    (ok true)
  )
)

;; governance functions

(define-public (enable-exit-tax)
  (begin
    ;; verify sender is not deployer
    (asserts! (not (is-eq tx-sender CONTRACT_OWNER)) ERR_NOT_CUSTODIAN_WALLET)
    ;; verify sender is custodian
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_NOT_CUSTODIAN_WALLET)
    ;; set exit tax values
    (var-set previous-exit-tax (var-get active-exit-tax))
    (var-set active-exit-tax USABTC_EXIT_TAX)
    (var-set active-exit-tax-activation-block (+ burn-block-height EXIT_TAX_DELAY))
    ;; print event
    (print {
      notification: "usabtc-exit-tax-enabled",
      payload: {
        activation-block: (var-get active-exit-tax-activation-block),
        active-exit-tax: USABTC_EXIT_TAX,
        previous-exit-tax: (var-get previous-exit-tax)
      }
    })
    (ok true)
  )
)

(define-public (disable-exit-tax)
  (begin
    ;; verify sender is not deployer
    (asserts! (not (is-eq tx-sender CONTRACT_OWNER)) ERR_NOT_CUSTODIAN_WALLET)
    ;; verify sender is custodian
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_NOT_CUSTODIAN_WALLET)
    ;; set exit tax values
    (var-set previous-exit-tax (var-get active-exit-tax))
    (var-set active-exit-tax u0)
    ;; TODO: could make this no delay?
    (var-set active-exit-tax-activation-block (+ burn-block-height EXIT_TAX_DELAY))
    ;; print event
    (print {
      notification: "usabtc-exit-tax-disabled",
      payload: {
        activation-block: (var-get active-exit-tax-activation-block),
        active-exit-tax: u0,
        previous-exit-tax: (var-get previous-exit-tax)
      }
    })
    (ok true)
  )
)

(define-public (update-custodian-wallet (new-custodian-wallet principal))
  (begin
    ;; verify sender is custodian
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_NOT_CUSTODIAN_WALLET)
    ;; verify new custodian is not the same as the current custodian
    (asserts! (not (is-eq (var-get custodian-trust-wallet) new-custodian-wallet)) ERR_SAME_AS_CURRENT_CUSTODIAN)
    ;; update custodian wallet
    (var-set custodian-trust-wallet new-custodian-wallet)
    ;; print event
    (print {
      notification: "usabtc-custodian-wallet-updated",
      payload: {
        custodian-trust-wallet: new-custodian-wallet,
        previous-custodian-wallet: (var-get custodian-trust-wallet)
      }
    })
    (ok true)
  )
)

;; read only functions
;;

;; exit tax functions

(define-read-only (get-exit-tax-values)
  {
    active-exit-tax: (var-get active-exit-tax),
    previous-exit-tax: (var-get previous-exit-tax),
    active-exit-tax-activation-block: (var-get active-exit-tax-activation-block)
  }
)

(define-read-only (get-current-exit-tax)
  (if (>= burn-block-height (var-get active-exit-tax-activation-block))
    ;; tax is active
    (var-get active-exit-tax)
    ;; tax is not active yet
    (var-get previous-exit-tax)
  )
)

(define-read-only (get-exit-tax-for-amount (amount uint))
  ;; TODO: review using better precision
  (if (>= burn-block-height (var-get active-exit-tax-activation-block))
    ;; tax is active
    (/ (* amount (var-get active-exit-tax)) u10000)
    ;; tax is not active yet
    (/ (* amount (var-get previous-exit-tax)) u10000)
  )
)

;; custodian wallet functions

(define-read-only (get-custodian-wallet)
  (var-get custodian-trust-wallet)
)

;; SIP-010 read-only functions

(define-read-only (get-name)
  (ok "USABTC")
)

(define-read-only (get-symbol)
  (ok "USABTC")
)

(define-read-only (get-decimals)
  (ok u8)
)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance usabtc who))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply usabtc))
)

(define-read-only (get-token-uri)
  (ok (var-get token-uri))
)
