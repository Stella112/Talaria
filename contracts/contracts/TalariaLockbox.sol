// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TalariaLockbox
/// @notice Source-chain side of the bridge. A trusted single relayer watches `Locked` and credits
/// the recipient on Portaldot; the owner can release funds for refunds. Not trustless in this build.
contract TalariaLockbox is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    error ZeroAmount();
    error ZeroAddress();

    event Locked(address indexed payer, address indexed portaldotRecipient, uint256 amount, bytes32 intentRef);
    event Released(address indexed to, uint256 amount, bytes32 reason);

    constructor(IERC20 token_, address initialOwner) Ownable(initialOwner) {
        token = token_;
    }

    function lock(address portaldotRecipient, uint256 amount, bytes32 intentRef) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (portaldotRecipient == address(0)) revert ZeroAddress();
        emit Locked(msg.sender, portaldotRecipient, amount, intentRef);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function release(address to, uint256 amount, bytes32 reason) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        emit Released(to, amount, reason);
        token.safeTransfer(to, amount);
    }
}
