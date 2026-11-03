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

    ITalariaToken public immutable token;
    address public immutable owner;

    mapping(address => uint256) public balances;
    uint256 public receiptCount;
    mapping(address => uint256) public nonces;

    error NotAuthorized();
    error InsufficientBalance();
    error TransferFailed();
    error IntentExpired();
    error BadNonce();
    error BadSignature();
    error UnknownRail();

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event Receipt(bytes32 indexed receiptId, uint8 indexed rail, address indexed payer, address payee, uint256 amount, bytes32 ref);

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
        if (intent.signer != intent.owner) revert NotAuthorized();
        _dispatch(intent);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("TalariaCore"), keccak256("1"), block.chainid, address(this)));
    }

    function _digest(Intent calldata intent) private view returns (bytes32) {
        return keccak256(abi.encodePacked("", domainSeparator(), keccak256(abi.encode(INTENT_TYPEHASH, intent))));
    }

    function _dispatch(Intent calldata intent) private {
        uint8 rail = intent.rail & 0x0f;
        uint8 action = intent.rail >> 4;
        if (rail == RAIL_ACCOUNT) {
            if (action == ACTION_WITHDRAW) _withdraw(intent.owner, intent.payee, intent.amount);
            else _settle(RAIL_ACCOUNT, intent.owner, intent.payee, intent.amount, intent.ref);
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
