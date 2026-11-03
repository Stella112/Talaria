// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaBridgeOut
/// @notice Rail 7: moves value from Portaldot to a source chain.
/// @dev The deployed TalariaUSD has no burn function, so funds move to this contract's Core
/// balance instead. No function can ever move them out again, which makes them unspendable.
contract TalariaBridgeOut is TalariaRail {
    uint8 private constant RAIL = 7;

    address public immutable owner;
    uint256 public nonce;
    mapping(uint256 => bool) public allowedDest;

    event DestSet(uint256 indexed destChainId, bool allowed);
    event BridgeOut(bytes32 indexed id, address indexed from, address indexed recipient, uint256 amount, uint256 destChainId, uint256 nonce);

    constructor(ITalariaCoreRails core_, address owner_) TalariaRail(core_) {
        owner = owner_;
    }

    function setDest(uint256 destChainId, bool allowed) external {
        if (msg.sender != owner) revert NotAuthorized();
        allowedDest[destChainId] = allowed;
        emit DestSet(destChainId, allowed);
    }

    function bridgeOut(uint256 amount, uint256 destChainId, address recipient) external returns (bytes32) {
        return _bridgeOut(msg.sender, amount, destChainId, recipient);
    }

    /// @dev Action 0: payee = recipient, amount, ref = destination chain id. Session keys need rail bit 7.
    function onIntent(uint8, address owner_, address, address payee, uint256 amount, bytes32 ref) external onlyCore {
        _bridgeOut(owner_, amount, uint256(ref), payee);
    }

    function _bridgeOut(address from, uint256 amount, uint256 destChainId, address recipient) private returns (bytes32 id) {
        if (amount == 0 || recipient == address(0) || !allowedDest[destChainId]) revert InvalidParams();
        uint256 current = nonce++;
        id = keccak256(abi.encode(block.chainid, address(this), current));
        emit BridgeOut(id, from, recipient, amount, destChainId, current);
        core.railTransfer(RAIL, from, address(this), amount, id, true);
    }
}
