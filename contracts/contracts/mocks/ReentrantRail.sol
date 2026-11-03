// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice TEST ONLY, never deployed to a live network: a rail that tries to re-enter Core.
contract ReentrantRail {
    address private immutable core;

    constructor(address core_) {
        core = core_;
    }

    function onIntent(uint8, address, address, address, uint256 amount, bytes32) external {
        (bool ok, bytes memory data) = core.call(abi.encodeWithSignature("withdraw(uint256)", amount));
        if (!ok) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
    }
}
