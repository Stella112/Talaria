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

    ITalariaToken public immutable token;
    address public immutable owner;

    mapping(address => uint256) public balances;
    uint256 public receiptCount;

    error NotAuthorized();
    error InsufficientBalance();
    error TransferFailed();

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
