// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaSubscriptions
/// @notice Rail 2: merchant plans with permissionless charging when a period is due.
contract TalariaSubscriptions is TalariaRail {
    uint8 private constant RAIL = 2;

    struct Plan {
        address merchant;
        uint48 amount;
        uint32 interval;
        uint16 maxPeriods;
    }

    struct Subscription {
        address subscriber;
        uint32 planId;
        uint32 nextDue;
        uint16 periods;
        bool paused;
    }

    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    uint32 public planCount;
    uint32 public subscriptionCount;

    event PlanCreated(uint256 indexed id, address indexed merchant, uint48 amount, uint32 interval, uint16 maxPeriods);
    event Subscribed(uint256 indexed id, uint256 indexed planId, address indexed subscriber);
    event Charged(uint256 indexed id, uint16 period);
    event Paused(uint256 indexed id, bool paused);
    event Cancelled(uint256 indexed id);

    constructor(ITalariaCoreRails core_) TalariaRail(core_) {}

    function createPlan(uint48 amount, uint32 interval, uint16 maxPeriods) external returns (uint256 id) {
        if (amount == 0 || interval == 0 || maxPeriods == 0) revert InvalidParams();
        id = ++planCount;
        plans[id] = Plan(msg.sender, amount, interval, maxPeriods);
        emit PlanCreated(id, msg.sender, amount, interval, maxPeriods);
    }

    function subscribe(uint32 planId) external returns (uint256) {
        return _subscribe(msg.sender, planId);
    }

    function cancel(uint256 id) external {
        _cancel(msg.sender, id);
    }

    function setPaused(uint256 id, bool paused) external {
        _setPaused(msg.sender, id, paused);
    }

    /// @notice Anyone can charge a subscription once its period is due.
    function charge(uint256 id) external {
        Subscription storage sub = subscriptions[id];
        if (sub.subscriber == address(0) || sub.paused || block.timestamp < sub.nextDue) revert Unavailable();
        Plan storage plan = plans[sub.planId];
        if (sub.periods >= plan.maxPeriods) revert Unavailable();
        uint16 period = ++sub.periods;
        sub.nextDue += plan.interval;
        emit Charged(id, period);
        core.railTransfer(RAIL, sub.subscriber, plan.merchant, plan.amount, bytes32(id), true);
    }

    /// @dev Actions: 0 subscribe (ref = plan id), 1 cancel, 2 pause, 3 resume (ref = subscription id).
    function onIntent(uint8 action, address owner, address, address payee, uint256 amount, bytes32 ref) external onlyCore {
        uint256 id = uint256(ref);
        if (action == 0) {
            Plan storage plan = plans[id];
            if (plan.merchant != payee || plan.amount != amount) revert InvalidParams();
            _subscribe(owner, uint32(id));
        } else if (action == 1) {
            _cancel(owner, id);
        } else {
            _setPaused(owner, id, action == 2);
        }
    }

    function _subscribe(address subscriber, uint32 planId) private returns (uint256 id) {
        if (plans[planId].merchant == address(0)) revert Unavailable();
        id = ++subscriptionCount;
        subscriptions[id] = Subscription(subscriber, planId, uint32(block.timestamp), 0, false);
        emit Subscribed(id, planId, subscriber);
    }

    function _cancel(address subscriber, uint256 id) private {
        if (subscriptions[id].subscriber != subscriber) revert NotAuthorized();
        delete subscriptions[id];
        emit Cancelled(id);
    }

    function _setPaused(address subscriber, uint256 id, bool paused) private {
        Subscription storage sub = subscriptions[id];
        if (sub.subscriber != subscriber) revert NotAuthorized();
        sub.paused = paused;
        // Resuming never bills for the time spent paused.
        if (!paused && sub.nextDue < block.timestamp) sub.nextDue = uint32(block.timestamp);
        emit Paused(id, paused);
    }
}
