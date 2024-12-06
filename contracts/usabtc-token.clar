
;; title: USABTC Token Contract
;; version: 1.0.0
;; summary: USABTC is a specialized fungible token implemented on the Stacks blockchain.
;; description: USABTC is designed to provide a unique economic mechanism that bridges Bitcoin
;; and the US financial system through the decentralized and secure Stacks network. USABTC
;; maintains a 1:1 relationship with sBTC.

;; traits
;;
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; token definitions
;;
(define-fungible-token usabtc)

;; constants
;;
(define-constant CONTRACT_OWNER tx-sender)
(define-constant USABTC_EXIT_TAX u2100) ;; 21% exit tax

;; error codes
(define-constant ERR_UNAUTHORIZED (err u1000))
(define-constant ERR_NOT_TOKEN_OWNER (err u1001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u1002))
(define-constant ERR_INVALID_AMOUNT (err u1003))
(define-constant ERR_PROPOSAL_NOT_ACTIVE (err u1004))
(define-constant ERR_PROPOSAL_STILL_ACTIVE (err u1005))
(define-constant ERR_VOTED_ALREADY (err u1006))
(define-constant ERR_NOTHING_STACKED (err u1007))
(define-constant ERR_USER_NOT_FOUND (err u1008))
(define-constant ERR_VOTE_FAILED (err u1009))


;; data vars
;;
(define-data-var token-uri (optional (string-utf8 256)) (some u"https://usabtc.org/token-metadata.json"))
(define-data-var active-exit-tax uint u0)
(define-data-var destination-wallet principal CONTRACT_OWNER)
(define-data-var custodian-trust-wallet principal CONTRACT_OWNER)

;; data maps
;;
;; TBD

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
        sender: sender,
        recipient: recipient,
        amount: amount,
        memo: memo
      }
    })
    ;; make transfer
    (ft-transfer? usabtc amount sender recipient)
  )
)

;; USABTC-specific functions

(define-public (deposit (amount uint))
  (begin
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (try! (contract-call? .sbtc-token transfer amount tx-sender (as-contract tx-sender) none))
    (try! (ft-mint? usabtc amount tx-sender))
    (print {
      notification: "usabtc-deposit",
      payload: {
        user: tx-sender,
        amount: amount
      }
    })
    (ok true)
  )
)

(define-public (withdraw (amount uint))
  (let (
    (user-balance (unwrap-panic (get-balance  tx-sender)))
    (exit-amount (- amount (/ (* amount (var-get active-exit-tax)) u10000)))
    (tax-amount (/ (* amount (var-get active-exit-tax)) u10000))
  )
    (asserts! (>= user-balance amount) ERR_INSUFFICIENT_BALANCE)
    (try! (ft-burn? usabtc amount tx-sender))
    ;; TODO: fix (as-contract) context here
    (try! (as-contract (contract-call? .sbtc-token transfer exit-amount tx-sender tx-sender none)))
    (try! (as-contract (contract-call? .sbtc-token transfer tax-amount tx-sender (var-get destination-wallet) none)))
    (print {
      notification: "usabtc-withdraw",
      payload: {
        user: tx-sender,
        amount: amount,
        exit-amount: exit-amount,
        tax-amount: tax-amount
      }
    })
    (ok true)
  )
)


;; governance functions

(define-public (enable-exit-tax)
  (begin
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_UNAUTHORIZED)
    (var-set active-exit-tax USABTC_EXIT_TAX)
    (print {
      notification: "usabtc-exit-tax-enabled",
      payload: {
        active-exit-tax: USABTC_EXIT_TAX
      }
    })
    (ok true)
  )
)

(define-public (disable-exit-tax)
  (begin
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_UNAUTHORIZED)
    (var-set active-exit-tax u0)
    (print {
      notification: "usabtc-exit-tax-enabled",
      payload: {
        active-exit-tax: u0
      }
    })
    (ok true)
  )
)

(define-public (set-custodian-wallet (new-custodian-wallet principal))
  (begin
    (asserts! (is-eq tx-sender (var-get custodian-trust-wallet)) ERR_UNAUTHORIZED)
    (asserts! (not (is-eq (var-get custodian-trust-wallet) new-custodian-wallet)) ERR_UNAUTHORIZED)
    (var-set destination-wallet new-custodian-wallet)
    (print {
      notification: "usabtc-custodian-wallet-update",
      payload: {
        new-custodian-wallet: new-custodian-wallet
      }
    })
    (ok true)
  )
)

;; read only functions
;;

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

;; private functions
;;
