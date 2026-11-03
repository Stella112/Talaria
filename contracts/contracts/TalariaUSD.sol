// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TalariaUSD
/// @notice Test stablecoin for the Talaria demo on testnets. It has no value.
contract TalariaUSD is ERC20, ERC20Permit, Ownable2Step {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_CAP = 10_000_000e6;

    uint256 public faucetMinted;

    error FaucetCapReached();

    event FaucetUsed(address indexed to, uint256 amount);

    constructor(address initialOwner)
        ERC20("Talaria Test USD (no value)", "tUSD")
        ERC20Permit("Talaria Test USD (no value)")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints to the bridge reserve or another owner-chosen address.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Public demo faucet, limited by a global cap.
    function faucet() external {
        uint256 minted = faucetMinted + FAUCET_AMOUNT;
        if (minted > FAUCET_CAP) revert FaucetCapReached();
        faucetMinted = minted;
        emit FaucetUsed(msg.sender, FAUCET_AMOUNT);
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
