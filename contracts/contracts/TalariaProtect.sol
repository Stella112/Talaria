// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TalariaCore} from "./TalariaCore.sol";
import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaProtect
/// @notice Rail 6: trust-priced settlement. A trust attestation decides how long a payment is held,
/// the buyer can dispute while it is held, and a trusted arbiter resolves disputes.
contract TalariaProtect is TalariaRail {
    uint8 private constant RAIL = 6;
    uint256 private constant BPS = 10_000;
    uint8 private constant MIN_FEEDBACK = 3;
    uint8 private constant TRUSTED_SCORE = 80;
    uint8 private constant ESTABLISHED_SCORE = 50;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "TrustAttestation(address subject,uint256 agentId,uint8 score,uint32 feedbackCount,uint256 srcChainId,uint256 srcBlock,uint256 expiry,uint256 nonce)"
    );

    enum Status {
        None,
        Held,
        Disputed,
        Released,
        Refunded,
        Resolved
    }

    struct Payment {
        address buyer;
        uint48 amount;
        uint48 refunded;
        address merchant;
        uint32 releaseAt;
        Status status;
    }

    struct Attestation {
        address subject;
        uint256 agentId;
        uint8 score;
        uint32 feedbackCount;
        uint256 srcChainId;
        uint256 srcBlock;
        uint256 expiry;
        uint256 nonce;
    }

    struct Sig {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @dev Index 0 is Trusted, 1 Established, 2 New.
    struct Tiers {
        uint32 holdTrusted;
        uint32 holdEstablished;
        uint32 holdNew;
        uint48 capTrusted;
        uint48 capEstablished;
        uint48 capNew;
    }

    address public immutable admin;
    address public immutable arbiter;

    Tiers public tiers;
    address public attester;
    uint64 public paymentCount;
    /// @dev Hold chosen by an attestation for the intent being executed, plus one. Zero when unset.
    uint32 private pendingHold;

    mapping(uint256 => Payment) public payments;
    /// @dev Bitmap of used attestation nonces, so sequential nonces share one storage slot.
    mapping(uint256 => uint256) private usedNonces;

    error NotHeld();
    error WindowOpen();
    error WindowClosed();
    error BadAttestation();
    error RefundTooLarge();

    event TiersSet(Tiers tiers);
    event AttesterSet(address attester);
    event PaymentOpened(uint256 indexed id, address indexed buyer, address indexed merchant, uint256 amount, bytes32 ref, uint32 releaseAt);
    event TrustApplied(uint256 indexed paymentId, address indexed subject, uint256 agentId, uint8 score, uint32 feedbackCount, uint256 srcChainId, uint256 srcBlock);
    event PaymentReleased(uint256 indexed id, uint256 amount);
    event PaymentRefunded(uint256 indexed id, uint256 amount, uint256 totalRefunded);
    event PaymentDisputed(uint256 indexed id, address indexed buyer, bytes32 reasonHash);
    event PaymentResolved(uint256 indexed id, uint16 refundBps, uint256 refunded, uint256 paid);

    constructor(ITalariaCoreRails core_, address admin_, address arbiter_, address attester_, Tiers memory tiers_) TalariaRail(core_) {
        admin = admin_;
        arbiter = arbiter_;
        attester = attester_;
        tiers = tiers_;
    }

    function setTiers(Tiers calldata tiers_) external {
        if (msg.sender != admin) revert NotAuthorized();
        tiers = tiers_;
        emit TiersSet(tiers_);
    }

    function setAttester(address attester_) external {
        if (msg.sender != admin) revert NotAuthorized();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("TalariaProtect"), keccak256("1"), block.chainid, address(this)));
    }

    /// @notice Runs a signed buyer intent with a merchant attestation, which sets the hold.
    /// An intent sent straight to Core has no attestation, so it gets the New tier's hold.
    function payWithTrust(TalariaCore.Intent calldata intent, Sig calldata intentSig, Attestation calldata attestation, Sig calldata attestationSig) external {
        if (intent.rail != RAIL || attestation.subject != intent.payee) revert BadAttestation();
        _useAttestation(attestation, attestationSig);
        pendingHold = _holdFor(attestation.score, attestation.feedbackCount) + 1;
        uint64 before = paymentCount;
        TalariaCore(address(core)).execute(intent, intentSig.v, intentSig.r, intentSig.s);
        pendingHold = 0;
        // No new payment means the intent was queued for its owner, which uses the New tier later.
        if (paymentCount != before) {
            emit TrustApplied(paymentCount, attestation.subject, attestation.agentId, attestation.score, attestation.feedbackCount, attestation.srcChainId, attestation.srcBlock);
        }
    }

    /// @notice Anyone can release a held payment once its window has passed.
    function release(uint256 id) external {
        Payment storage payment = payments[id];
        if (payment.status != Status.Held) revert NotHeld();
        if (block.timestamp < payment.releaseAt) revert WindowOpen();
        payment.status = Status.Released;
        uint256 amount = uint256(payment.amount) - payment.refunded;
        emit PaymentReleased(id, amount);
        core.railTransfer(RAIL, address(this), payment.merchant, amount, bytes32(id), true);
    }

    function dispute(uint256 id, bytes32 reasonHash) external {
        _dispute(msg.sender, id, reasonHash);
    }

    function refund(uint256 id, uint256 amount) external {
        _refund(msg.sender, id, amount);
    }

    /// @notice Trusted arbiter splits a disputed payment between buyer and merchant.
    function resolve(uint256 id, uint16 refundBps) external {
        if (msg.sender != arbiter) revert NotAuthorized();
        if (refundBps > BPS) revert InvalidParams();
        Payment storage payment = payments[id];
        if (payment.status != Status.Disputed) revert NotHeld();
        uint256 remaining = uint256(payment.amount) - payment.refunded;
        uint256 toBuyer = (remaining * refundBps) / BPS;
        uint256 toMerchant = remaining - toBuyer;
        payment.status = Status.Resolved;
        payment.refunded += uint48(toBuyer);
        emit PaymentResolved(id, refundBps, toBuyer, toMerchant);
        if (toBuyer != 0) core.railTransfer(RAIL, address(this), payment.buyer, toBuyer, bytes32(id), false);
        if (toMerchant != 0) core.railTransfer(RAIL, address(this), payment.merchant, toMerchant, bytes32(id), true);
    }

    /// @dev Actions: 0 pay (payee = merchant), 1 dispute (ref = id), 2 refund (ref = id, payee = buyer).
    function onIntent(uint8 action, address owner, address, address payee, uint256 amount, bytes32 ref) external onlyCore {
        if (action == 0) {
            uint32 pending = pendingHold;
            _open(owner, payee, amount, ref, pending == 0 ? tiers.holdNew : pending - 1);
        } else if (action == 1) {
            _dispute(owner, uint256(ref), bytes32(0));
        } else {
            if (payments[uint256(ref)].buyer != payee) revert InvalidParams();
            _refund(owner, uint256(ref), amount);
        }
    }

    function _open(address buyer, address merchant, uint256 amount, bytes32 ref, uint32 hold) private returns (uint256 id) {
        if (merchant == address(0) || amount == 0) revert InvalidParams();
        id = ++paymentCount;
        uint32 releaseAt = uint32(block.timestamp) + hold;
        // Trusted merchants settle at once. The record stays so they can still refund.
        payments[id] = Payment(buyer, _to48(amount), 0, merchant, releaseAt, hold == 0 ? Status.Released : Status.Held);
        emit PaymentOpened(id, buyer, merchant, amount, ref, releaseAt);
        if (hold == 0) {
            emit PaymentReleased(id, amount);
            core.railTransfer(RAIL, buyer, merchant, amount, bytes32(id), true);
        } else {
            core.railTransfer(RAIL, buyer, address(this), amount, bytes32(id), false);
        }
    }

    function _dispute(address buyer, uint256 id, bytes32 reasonHash) private {
        Payment storage payment = payments[id];
        if (payment.buyer != buyer) revert NotAuthorized();
        if (payment.status != Status.Held) revert NotHeld();
        if (block.timestamp >= payment.releaseAt) revert WindowClosed();
        payment.status = Status.Disputed;
        emit PaymentDisputed(id, buyer, reasonHash);
    }

    function _refund(address merchant, uint256 id, uint256 amount) private {
        Payment storage payment = payments[id];
        if (payment.merchant != merchant) revert NotAuthorized();
        Status status = payment.status;
        if (status != Status.Held && status != Status.Released) revert NotHeld();
        uint256 total = uint256(payment.refunded) + amount;
        if (amount == 0 || total > payment.amount) revert RefundTooLarge();
        payment.refunded = uint48(total);
        if (total == payment.amount) payment.status = Status.Refunded;
        emit PaymentRefunded(id, amount, total);
        // A held payment refunds from escrow. A released one comes from the merchant's balance.
        core.railTransfer(RAIL, status == Status.Held ? address(this) : merchant, payment.buyer, amount, bytes32(id), false);
    }

    function _useAttestation(Attestation calldata a, Sig calldata sig) private {
        if (block.timestamp > a.expiry) revert BadAttestation();
        uint256 word = a.nonce >> 8;
        uint256 bit = 1 << (a.nonce & 0xff);
        if (usedNonces[word] & bit != 0) revert BadAttestation();
        usedNonces[word] |= bit;
        bytes32 structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, a));
        address recovered = ecrecover(keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash)), sig.v, sig.r, sig.s);
        if (recovered == address(0) || recovered != attester) revert BadAttestation();
    }

    /// @dev Fewer than three feedbacks always counts as New, whatever the score.
    function _tierOf(uint8 score, uint32 feedbackCount) private pure returns (uint8) {
        if (feedbackCount < MIN_FEEDBACK || score < ESTABLISHED_SCORE) return 2;
        return score >= TRUSTED_SCORE ? 0 : 1;
    }

    function _holdFor(uint8 score, uint32 feedbackCount) private view returns (uint32) {
        uint8 tier = _tierOf(score, feedbackCount);
        return tier == 0 ? tiers.holdTrusted : tier == 1 ? tiers.holdEstablished : tiers.holdNew;
    }
}
