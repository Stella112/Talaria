// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaStreams
/// @notice Rail 3: per-second payment streams. Accrual is computed, never ticked.
contract TalariaStreams is TalariaRail {
    uint8 private constant RAIL = 3;

    struct Stream {
        address sender;
        uint64 ratePerSecond;
        uint32 start;
        address receiver;
        uint48 deposit;
        uint48 withdrawn;
    }

    mapping(uint256 => Stream) public streams;
    uint256 public streamCount;

    event StreamStarted(uint256 indexed id, address indexed sender, address indexed receiver, uint64 ratePerSecond, uint48 deposit);
    event StreamWithdrawn(uint256 indexed id, uint256 amount);
    event StreamStopped(uint256 indexed id, uint256 paid, uint256 refunded);

    constructor(ITalariaCoreRails core_) TalariaRail(core_) {}

    function accrued(uint256 id) public view returns (uint256) {
        Stream storage stream = streams[id];
        uint256 total = (block.timestamp - stream.start) * stream.ratePerSecond;
        return total < stream.deposit ? total : stream.deposit;
    }

    function startStream(address to, uint64 ratePerSecond, uint256 deposit) external returns (uint256) {
        return _start(msg.sender, to, ratePerSecond, deposit);
    }

    function withdraw(uint256 id) external {
        _withdraw(msg.sender, id);
    }

    function stopStream(uint256 id) external {
        _stop(msg.sender, id);
    }

    /// @dev Actions: 0 start (payee, amount = deposit, ref = rate), 1 withdraw, 2 stop (ref = stream id).
    function onIntent(uint8 action, address owner, address, address payee, uint256 amount, bytes32 ref) external onlyCore {
        if (action == 0) {
            uint256 rate = uint256(ref);
            if (rate > type(uint64).max) revert InvalidParams();
            _start(owner, payee, uint64(rate), amount);
        } else if (action == 1) {
            _withdraw(owner, uint256(ref));
        } else {
            _stop(owner, uint256(ref));
        }
    }

    function _start(address sender, address to, uint64 ratePerSecond, uint256 deposit) private returns (uint256 id) {
        if (to == address(0) || ratePerSecond == 0 || deposit == 0) revert InvalidParams();
        id = ++streamCount;
        uint48 packed = _to48(deposit);
        streams[id] = Stream(sender, ratePerSecond, uint32(block.timestamp), to, packed, 0);
        emit StreamStarted(id, sender, to, ratePerSecond, packed);
        core.railTransfer(RAIL, sender, address(this), deposit, bytes32(id), false);
    }

    function _withdraw(address caller, uint256 id) private {
        Stream storage stream = streams[id];
        if (stream.receiver != caller) revert NotAuthorized();
        uint256 amount = accrued(id) - stream.withdrawn;
        if (amount == 0) revert Unavailable();
        stream.withdrawn += uint48(amount);
        emit StreamWithdrawn(id, amount);
        core.railTransfer(RAIL, address(this), caller, amount, bytes32(id), true);
    }

    function _stop(address caller, uint256 id) private {
        Stream memory stream = streams[id];
        if (stream.sender != caller) revert NotAuthorized();
        uint256 total = accrued(id);
        uint256 owed = total - stream.withdrawn;
        uint256 refunded = stream.deposit - total;
        delete streams[id];
        emit StreamStopped(id, owed, refunded);
        if (owed != 0) core.railTransfer(RAIL, address(this), stream.receiver, owed, bytes32(id), true);
        if (refunded != 0) core.railTransfer(RAIL, address(this), caller, refunded, bytes32(id), false);
    }
}
