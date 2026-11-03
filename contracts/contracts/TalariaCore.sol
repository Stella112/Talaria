// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITalariaToken {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function permit(address holder, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

/// @title TalariaCore
/// @notice Payment engine: internal tUSD accounts and receipts.
/// @dev Kept small on purpose because code size costs tPOT deposits on Portaldot.
contract TalariaCore is ReentrancyGuard {
    uint8 public constant RAIL_ACCOUNT = 0;
    uint8 private constant ACTION_WITHDRAW = 1;
    uint8 private constant ACTION_ADD_KEY = 2;
    uint8 private constant ACTION_REVOKE_KEY = 3;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(uint8 rail,address owner,address signer,address payee,uint256 amount,bytes32 ref,uint256 nonce,uint256 deadline)"
    );

    /// @dev Low 4 bits of `rail` select the rail, high 4 bits select the action within it.
    struct Intent {
        uint8 rail;
        address owner;
        address signer;
        address payee;
        uint256 amount;
        bytes32 ref;
        uint256 nonce;
        uint256 deadline;
    }

    struct SessionKey {
        uint64 maxPerTx;
        uint64 maxPerDay;
        uint64 spentToday;
        uint32 day;
        uint40 expiry;
        uint8 rails;
        address payee; // zero means any payee
    }

    ITalariaToken public immutable token;
    address public immutable owner;

    mapping(address => uint256) public balances;
    uint256 public receiptCount;
    mapping(address => uint256) public nonces;
    mapping(address => mapping(address => SessionKey)) public sessionKeys;
    mapping(bytes32 => address) public pendingOwner;

    error NotAuthorized();
    error InsufficientBalance();
    error TransferFailed();
    error IntentExpired();
    error BadNonce();
    error BadSignature();
    error UnknownRail();
    error KeyInvalid();
    error NotPending();

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event Receipt(bytes32 indexed receiptId, uint8 indexed rail, address indexed payer, address payee, uint256 amount, bytes32 ref);

    event SessionKeySet(address indexed owner, address indexed key, uint64 maxPerTx, uint64 maxPerDay, uint40 expiry, uint8 rails, address payee);
    event SessionKeyRevoked(address indexed owner, address indexed key);
    event IntentQueued(bytes32 indexed intentHash, address indexed owner, address indexed signer, uint8 rail, address payee, uint256 amount, bytes32 ref, uint256 nonce, uint256 deadline);
    event IntentResolved(bytes32 indexed intentHash, bool approved);

    constructor(ITalariaToken token_, address owner_) {
        token = token_;
        owner = owner_;
    }

    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    /// @notice Gasless deposit: anyone can submit the permit signed by `from`.
    function depositWithPermit(address from, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        token.permit(from, address(this), amount, deadline, v, r, s);
        _deposit(from, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        _withdraw(msg.sender, msg.sender, amount);
    }

    /// @notice Pays another internal account and emits a receipt.
    function pay(address to, uint256 amount, bytes32 ref) external nonReentrant {
        _settle(RAIL_ACCOUNT, msg.sender, to, amount, ref);
    }

    /// @notice Executes a signed intent. Any relayer can submit it and pays the gas.
    function execute(Intent calldata intent, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (intent.nonce != nonces[intent.signer]++) revert BadNonce();
        address recovered = ecrecover(_digest(intent), v, r, s);
        if (recovered == address(0) || recovered != intent.signer) revert BadSignature();
        if (intent.signer != intent.owner && !_withinPolicy(intent)) {
            bytes32 intentHash = keccak256(abi.encode(intent));
            pendingOwner[intentHash] = intent.owner;
            emit IntentQueued(intentHash, intent.owner, intent.signer, intent.rail, intent.payee, intent.amount, intent.ref, intent.nonce, intent.deadline);
            return;
        }
        _dispatch(intent);
    }

    function addSessionKey(address key, uint64 maxPerTx, uint64 maxPerDay, uint40 expiry, uint8 rails, address payee) external {
        _setKey(msg.sender, key, maxPerTx, maxPerDay, expiry, rails, payee);
    }

    function revokeSessionKey(address key) external {
        _revokeKey(msg.sender, key);
    }

    /// @notice Owner approves a queued intent, overriding the policy that held it.
    function approvePending(Intent calldata intent) external nonReentrant {
        if (block.timestamp > intent.deadline) revert IntentExpired();
        _resolve(keccak256(abi.encode(intent)), true);
        _dispatch(intent);
    }

    function rejectPending(bytes32 intentHash) external {
        _resolve(intentHash, false);
    }

    function _resolve(bytes32 intentHash, bool approved) private {
        address holder = pendingOwner[intentHash];
        if (holder == address(0)) revert NotPending();
        if (holder != msg.sender) revert NotAuthorized();
        delete pendingOwner[intentHash];
        emit IntentResolved(intentHash, approved);
    }

    /// @dev Reverts for an unusable key. Returns false when the intent should wait for the owner.
    function _withinPolicy(Intent calldata intent) private returns (bool) {
        SessionKey storage key = sessionKeys[intent.owner][intent.signer];
        if (key.expiry <= block.timestamp) revert KeyInvalid();
        if (intent.rail >> 4 >= ACTION_ADD_KEY && intent.rail & 0x0f == RAIL_ACCOUNT) revert NotAuthorized();
        uint32 today = uint32(block.timestamp / 1 days);
        uint256 spent = key.day == today ? key.spentToday : 0;
        if (
            key.rails & (1 << (intent.rail & 0x0f)) == 0 ||
            (key.payee != address(0) && key.payee != intent.payee) ||
            intent.amount > key.maxPerTx ||
            spent + intent.amount > key.maxPerDay
        ) return false;
        key.day = today;
        key.spentToday = uint64(spent + intent.amount);
        return true;
    }

    function _setKey(address holder, address key, uint64 maxPerTx, uint64 maxPerDay, uint40 expiry, uint8 rails, address payee) private {
        sessionKeys[holder][key] = SessionKey(maxPerTx, maxPerDay, 0, 0, expiry, rails, payee);
        emit SessionKeySet(holder, key, maxPerTx, maxPerDay, expiry, rails, payee);
    }

    function _revokeKey(address holder, address key) private {
        delete sessionKeys[holder][key];
        emit SessionKeyRevoked(holder, key);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("TalariaCore"), keccak256("1"), block.chainid, address(this)));
    }

    function _digest(Intent calldata intent) private view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), keccak256(abi.encode(INTENT_TYPEHASH, intent))));
    }

    function _dispatch(Intent calldata intent) private {
        uint8 rail = intent.rail & 0x0f;
        uint8 action = intent.rail >> 4;
        if (rail == RAIL_ACCOUNT) {
            if (action == ACTION_WITHDRAW) {
                _withdraw(intent.owner, intent.payee, intent.amount);
            } else if (action == ACTION_ADD_KEY) {
                // amount packs maxPerTx (high) and maxPerDay (low); ref packs expiry, rails and payee.
                uint256 packed = uint256(intent.ref);
                _setKey(intent.owner, intent.payee, uint64(intent.amount >> 64), uint64(intent.amount), uint40(packed >> 168), uint8(packed >> 160), address(uint160(packed)));
            } else if (action == ACTION_REVOKE_KEY) {
                _revokeKey(intent.owner, intent.payee);
            } else {
                _settle(RAIL_ACCOUNT, intent.owner, intent.payee, intent.amount, intent.ref);
            }
        } else {
            revert UnknownRail();
        }
    }

    function _deposit(address from, uint256 amount) private {
        balances[from] += amount;
        emit Deposited(from, amount);
        if (!token.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _withdraw(address from, address to, uint256 amount) private {
        _debit(from, amount);
        emit Withdrawn(from, to, amount);
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _debit(address from, uint256 amount) private {
        uint256 balance = balances[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balances[from] = balance - amount;
        }
    }

    function _move(address from, address to, uint256 amount) private {
        _debit(from, amount);
        balances[to] += amount;
    }

    function _settle(uint8 rail, address from, address to, uint256 amount, bytes32 ref) private {
        _move(from, to, amount);
        bytes32 receiptId = keccak256(abi.encode(block.chainid, address(this), receiptCount++, rail, from, to, amount, ref));
        emit Receipt(receiptId, rail, from, to, amount, ref);
    }
}
