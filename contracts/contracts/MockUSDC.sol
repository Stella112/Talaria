// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Test token for the Base Sepolia side of the demo. It is not USDC and has no value.
contract MockUSDC is ERC20 {
    uint256 public constant MAX_MINT = 10_000e6;

    error MintTooLarge();

    constructor() ERC20("Mock USDC (test, no value)", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge();
        _mint(msg.sender, amount);
    }
}
