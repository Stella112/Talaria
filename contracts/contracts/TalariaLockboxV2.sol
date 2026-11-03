// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TalariaLockboxV2
/// @notice Source-chain side of the two-way bridge: locks funds going in, and releases them for
/// bridge-outs. One trusted relayer in this build, so this is not trustless.
contract TalariaLockboxV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public relayer;
    mapping(bytes32 => bool) public processed;

    error ZeroAmount();
    error ZeroAddress();
    error NotRelayer();
    error AlreadyProcessed();
    error InsufficientLocked();

    event RelayerSet(address relayer);
    event Locked(address indexed payer, address indexed portaldotRecipient, uint256 amount, bytes32 intentRef);
    event Released(bytes32 indexed id, address indexed recipient, uint256 amount);

    constructor(IERC20 token_, address initialOwner, address relayer_) Ownable(initialOwner) {
        token = token_;
        relayer = relayer_;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        relayer = newRelayer;
        emit RelayerSet(newRelayer);
    }

    function lock(address portaldotRecipient, uint256 amount, bytes32 intentRef) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (portaldotRecipient == address(0)) revert ZeroAddress();
        emit Locked(msg.sender, portaldotRecipient, amount, intentRef);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Pays out a bridge-out, or a refund from the owner. Each id can only be used once.
    function release(bytes32 id, address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != relayer && msg.sender != owner()) revert NotRelayer();
        if (recipient == address(0)) revert ZeroAddress();
        if (processed[id]) revert AlreadyProcessed();
        if (amount > token.balanceOf(address(this))) revert InsufficientLocked();
        processed[id] = true;
        emit Released(id, recipient, amount);
        token.safeTransfer(recipient, amount);
    }
}
