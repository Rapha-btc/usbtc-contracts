
;; title: USABTC Token Contract
;; version: 1.0.0
;; summary: USABTC is a specialized fungible token implemented on the Stacks blockchain.
;; description: USABTC is designed to provide a unique economic mechanism that bridges Bitcoin and the US financial system through the decentralized and secure Stacks network. USABTC maintains a 1:1 relationship with sBTC.

;; traits
;;
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; token definitions
;;
(define-fungible-token usabtc)

;; constants
;;
(define-constant CONTRACT_OWNER tx-sender)
(define-constant VOTE_SCALE_FACTOR (pow u10 u16)) ;; 16 decimal places

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
(define-data-var exit-tax uint u0) ;; Stored as basis points (e.g., 500 = 5%)
(define-data-var destination-wallet principal CONTRACT_OWNER)
(define-data-var trust-voting-wallet principal CONTRACT_OWNER)

;; voting-related variables
(define-data-var voteActive bool false)
(define-data-var voteStart uint u0)
(define-data-var voteEnd uint u0)
(define-data-var proposalId uint u0)
(define-data-var yesVotes uint u0)
(define-data-var yesTotal uint u0)
(define-data-var noVotes uint u0)
(define-data-var noTotal uint u0)

;; data maps
;;
(define-map UserVotes
  { user: principal, proposal: uint }
  { vote: bool, amount: uint }
)

;; public functions
;;

;; SIP-010 transfer
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (asserts! (>= (get-balance sender) amount) ERR_INSUFFICIENT_BALANCE)
    (try! (ft-transfer? usabtc amount sender recipient))
    (print {
      notification: "usabtc-transfer",
      payload: {
        sender: sender,
        recipient: recipient,
        amount: amount,
        memo: memo
      }
    })
    (ok true)
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
    (exit-amount (- amount (/ (* amount (var-get exit-tax)) u10000)))
    (tax-amount (/ (* amount (var-get exit-tax)) u10000))
  )
    (asserts! (>= (get-balance tx-sender) amount) ERR_INSUFFICIENT_BALANCE)
    (try! (ft-burn? usabtc amount tx-sender))
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

(define-public (set-exit-tax (new-exit-tax uint))
  (begin
    (asserts! (is-eq tx-sender (var-get trust-voting-wallet)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get voteActive)) ERR_PROPOSAL_STILL_ACTIVE)
    (var-set exit-tax new-exit-tax)
    (print {
      notification: "usabtc-exit-tax-update",
      payload: {
        new-exit-tax: new-exit-tax
      }
    })
    (ok true)
  )
)

(define-public (set-destination-wallet (new-destination-wallet principal))
  (begin
    (asserts! (is-eq tx-sender (var-get trust-voting-wallet)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get voteActive)) ERR_PROPOSAL_STILL_ACTIVE)
    (var-set destination-wallet new-destination-wallet)
    (print {
      notification: "usabtc-destination-wallet-update",
      payload: {
        new-destination-wallet: new-destination-wallet
      }
    })
    (ok true)
  )
)

;; voting functions

(define-public (start-vote (proposal-id uint))
  (begin
    (asserts! (is-eq tx-sender (var-get trust-voting-wallet)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get voteActive)) ERR_PROPOSAL_STILL_ACTIVE)
    (var-set voteActive true)
    (var-set voteStart block-height)
    (var-set proposalId proposal-id)
    (var-set yesVotes u0)
    (var-set yesTotal u0)
    (var-set noVotes u0)
    (var-set noTotal u0)
    (print {
      notification: "usabtc-vote-start",
      payload: {
        proposal-id: proposal-id,
        start-block: block-height
      }
    })
    (ok true)
  )
)

(define-public (vote-on-proposal (vote bool))
  (let (
    (voter-balance (ft-get-balance usabtc tx-sender))
    (voter-record (map-get? UserVotes { user: tx-sender, proposal: (var-get proposalId) }))
  )
    (asserts! (var-get voteActive) ERR_PROPOSAL_NOT_ACTIVE)
    (asserts! (> voter-balance u0) ERR_NOTHING_STACKED)
    (match voter-record prev-vote
      (begin
        (asserts! (not (is-eq (get vote prev-vote) vote)) ERR_VOTED_ALREADY)
        (map-set UserVotes { user: tx-sender, proposal: (var-get proposalId) } { vote: vote, amount: voter-balance })
        (if (get vote prev-vote)
          (begin
            (var-set yesVotes (- (var-get yesVotes) u1))
            (var-set yesTotal (- (var-get yesTotal) (get amount prev-vote)))
          )
          (begin
            (var-set noVotes (- (var-get noVotes) u1))
            (var-set noTotal (- (var-get noTotal) (get amount prev-vote)))
          )
        )
      )
      (map-insert UserVotes { user: tx-sender, proposal: (var-get proposalId) } { vote: vote, amount: voter-balance })
    )
    (if vote
      (begin
        (var-set yesVotes (+ (var-get yesVotes) u1))
        (var-set yesTotal (+ (var-get yesTotal) voter-balance))
      )
      (begin
        (var-set noVotes (+ (var-get noVotes) u1))
        (var-set noTotal (+ (var-get noTotal) voter-balance))
      )
    )
    (print {
      notification: "usabtc-vote",
      payload: {
        user: tx-sender,
        proposal-id: (var-get proposalId),
        vote: vote,
        amount: voter-balance
      }
    })
    (ok true)
  )
)

(define-public (end-vote)
  (begin
    (asserts! (var-get voteActive) ERR_PROPOSAL_NOT_ACTIVE)
    (asserts! (> (+ (var-get yesVotes) (var-get noVotes)) u0) ERR_VOTE_FAILED)
    (var-set voteActive false)
    (var-set voteEnd block-height)
    (print {
      notification: "usabtc-vote-end",
      payload: {
        proposal-id: (var-get proposalId),
        end-block: block-height,
        yes-votes: (var-get yesVotes),
        yes-total: (var-get yesTotal),
        no-votes: (var-get noVotes),
        no-total: (var-get noTotal),
        result: (> (var-get yesTotal) (var-get noTotal))
      }
    })
    (ok (> (var-get yesTotal) (var-get noTotal)))
  )
)

;; read only functions
;;

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
