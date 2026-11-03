// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaRemit
/// @notice Rail 5: escrowed remittance to an address or to a claim link.
/// @dev A claim link holds a one-time private key, and `target` is its address (a hash of the
/// key's public key). Claiming signs the receiver, so a watcher cannot redirect the claim the
/// way it could if a plain code were revealed in a transaction.
contract TalariaRemit is TalariaRail {
    uint8 private constant RAIL = 5;
    uint32 private constant DEFAULT_TTL = 30 days;

    struct Remit {
        address sender;
        uint48 amount;
        uint32 expiry;
        bool cancellable;
        address target;
        bool byCode;
    }

    mapping(uint256 => Remit) public remits;
    uint256 public remitCount;

    event RemitSent(uint256 indexed id, address indexed sender, address indexed target, bool byCode, uint48 amount, uint32 expiry, bool cancellable);
    event RemitClaimed(uint256 indexed id, address indexed receiver);
    event RemitReturned(uint256 indexed id, address indexed sender);

    constructor(ITalariaCoreRails core_) TalariaRail(core_) {}

    function sendRemit(address target, bool byCode, uint256 amount, bool cancellable, uint32 expiry) external returns (uint256) {
        return _send(msg.sender, target, byCode, amount, cancellable, expiry);
    }

    function cancelRemit(uint256 id) external {
        _cancel(msg.sender, id);
    }

    function claimRemit(uint256 id) external {
        _claimDirect(msg.sender, id);
    }

    /// @notice Anyone can submit a claim-link signature: funds only go to the signed receiver.
    function claimWithCode(uint256 id, address receiver, uint8 v, bytes32 r, bytes32 s) external {
        Remit storage remit = remits[id];
        address recovered = ecrecover(keccak256(abi.encode(block.chainid, address(this), id, receiver)), v, r, s);
        if (!remit.byCode || recovered == address(0) || recovered != remit.target) revert NotAuthorized();
        _claim(id, receiver);
    }

    /// @notice Anyone can return an expired remit to its sender.
    function refundExpired(uint256 id) external {
        Remit storage remit = remits[id];
        if (remit.sender == address(0) || block.timestamp <= remit.expiry) revert Unavailable();
        _return(id);
    }

    /// @dev Actions: 0 send (payee, or ref = claim address when payee is zero), 1 cancel, 2 claim (ref = remit id).
    function onIntent(uint8 action, address owner, address, address payee, uint256 amount, bytes32 ref) external onlyCore {
        if (action == 0) {
            bool byCode = payee == address(0);
            address target = byCode ? address(uint160(uint256(ref))) : payee;
            _send(owner, target, byCode, amount, true, uint32(block.timestamp) + DEFAULT_TTL);
        } else if (action == 1) {
            _cancel(owner, uint256(ref));
        } else {
            _claimDirect(owner, uint256(ref));
        }
    }

    function _send(address sender, address target, bool byCode, uint256 amount, bool cancellable, uint32 expiry) private returns (uint256 id) {
        if (target == address(0) || amount == 0 || expiry <= block.timestamp) revert InvalidParams();
        id = ++remitCount;
        uint48 packed = _to48(amount);
        remits[id] = Remit(sender, packed, expiry, cancellable, target, byCode);
        emit RemitSent(id, sender, target, byCode, packed, expiry, cancellable);
        core.railTransfer(RAIL, sender, address(this), amount, bytes32(id), false);
    }

    function _cancel(address caller, uint256 id) private {
        Remit storage remit = remits[id];
        if (remit.sender != caller) revert NotAuthorized();
        if (!remit.cancellable) revert Unavailable();
        _return(id);
    }

    function _claimDirect(address caller, uint256 id) private {
        Remit storage remit = remits[id];
        if (remit.byCode || remit.target != caller) revert NotAuthorized();
        _claim(id, caller);
    }

    function _claim(uint256 id, address receiver) private {
        Remit memory remit = remits[id];
        if (block.timestamp > remit.expiry) revert Unavailable();
        delete remits[id];
        emit RemitClaimed(id, receiver);
        core.railTransfer(RAIL, address(this), receiver, remit.amount, bytes32(id), true);
    }

    function _return(uint256 id) private {
        Remit memory remit = remits[id];
        delete remits[id];
        emit RemitReturned(id, remit.sender);
        core.railTransfer(RAIL, address(this), remit.sender, remit.amount, bytes32(id), false);
    }
}
