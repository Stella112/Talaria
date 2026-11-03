// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaRail} from "./TalariaCore.sol";

interface ITalariaCoreRails {
    function railTransfer(uint8 rail, address from, address to, uint256 amount, bytes32 ref, bool receipt) external;
}

/// @notice Shared base for rail contracts. Escrowed funds sit in Core under the rail's own address.
abstract contract TalariaRail is ITalariaRail {
    ITalariaCoreRails public immutable core;

    error NotCore();
    error NotAuthorized();
    error InvalidParams();
    error Unavailable();

    modifier onlyCore() {
        if (msg.sender != address(core)) revert NotCore();
        _;
    }

    constructor(ITalariaCoreRails core_) {
        core = core_;
    }

    function _to48(uint256 value) internal pure returns (uint48) {
        if (value > type(uint48).max) revert InvalidParams();
        return uint48(value);
    }
}
