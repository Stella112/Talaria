// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITalariaCoreRails, TalariaRail} from "./TalariaRail.sol";

/// @title TalariaChannels
/// @notice Rail 4: prepaid pay-per-call channels settled with cumulative off-chain vouchers.
contract TalariaChannels is TalariaRail {
    uint8 private constant RAIL = 4;
    uint32 public constant CHALLENGE_WINDOW = 1 hours;
    uint256 public constant MAX_BATCH = 50;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VOUCHER_TYPEHASH = keccak256("Voucher(uint256 channelId,uint256 cumulativeAmount,uint256 nonce)");

    struct Channel {
        address payer;
        uint48 deposit;
        uint48 redeemed;
        address provider;
        uint32 closeAt;
        address signer;
    }

    struct SignedVoucher {
        uint256 channelId;
        uint256 cumulativeAmount;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    mapping(uint256 => Channel) public channels;
    uint256 public channelCount;

    event ChannelOpened(uint256 indexed id, address indexed payer, address indexed provider, address signer, uint48 deposit);
    event VoucherRedeemed(uint256 indexed id, uint256 cumulativeAmount, uint256 paid);
    event CloseRequested(uint256 indexed id, uint32 closeAt);
    event ChannelClosed(uint256 indexed id, uint256 refunded);

    constructor(ITalariaCoreRails core_) TalariaRail(core_) {}

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("TalariaChannels"), keccak256("1"), block.chainid, address(this)));
    }

    function openChannel(address provider, uint256 deposit) external returns (uint256) {
        return _open(msg.sender, msg.sender, provider, deposit);
    }

    /// @notice Anyone can redeem: funds only ever go to the channel's provider.
    function redeem(SignedVoucher calldata voucher) external {
        _redeem(voucher);
    }

    function redeemBatch(SignedVoucher[] calldata vouchers) external {
        if (vouchers.length > MAX_BATCH) revert InvalidParams();
        for (uint256 i; i < vouchers.length; ++i) _redeem(vouchers[i]);
    }

    function requestClose(uint256 id) external {
        _requestClose(msg.sender, id);
    }

    function finishClose(uint256 id) external {
        _finishClose(msg.sender, id);
    }

    /// @dev Actions: 0 open (payee, amount = deposit), 1 request close, 2 finish close (ref = channel id).
    function onIntent(uint8 action, address owner, address signer, address payee, uint256 amount, bytes32 ref) external onlyCore {
        if (action == 0) _open(owner, signer, payee, amount);
        else if (action == 1) _requestClose(owner, uint256(ref));
        else _finishClose(owner, uint256(ref));
    }

    function _open(address payer, address signer, address provider, uint256 deposit) private returns (uint256 id) {
        if (provider == address(0) || deposit == 0) revert InvalidParams();
        id = ++channelCount;
        uint48 packed = _to48(deposit);
        channels[id] = Channel(payer, packed, 0, provider, 0, signer);
        emit ChannelOpened(id, payer, provider, signer, packed);
        core.railTransfer(RAIL, payer, address(this), deposit, bytes32(id), false);
    }

    function _redeem(SignedVoucher calldata voucher) private {
        Channel storage channel = channels[voucher.channelId];
        if (channel.payer == address(0)) revert Unavailable();
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, voucher.channelId, voucher.cumulativeAmount, voucher.nonce));
        address recovered = ecrecover(keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash)), voucher.v, voucher.r, voucher.s);
        if (recovered == address(0) || recovered != channel.signer) revert NotAuthorized();
        if (voucher.cumulativeAmount <= channel.redeemed || voucher.cumulativeAmount > channel.deposit) revert InvalidParams();
        uint256 paid = voucher.cumulativeAmount - channel.redeemed;
        channel.redeemed = uint48(voucher.cumulativeAmount);
        emit VoucherRedeemed(voucher.channelId, voucher.cumulativeAmount, paid);
        core.railTransfer(RAIL, address(this), channel.provider, paid, bytes32(voucher.channelId), true);
    }

    function _requestClose(address caller, uint256 id) private {
        Channel storage channel = channels[id];
        if (channel.payer != caller) revert NotAuthorized();
        if (channel.closeAt != 0) revert Unavailable();
        uint32 closeAt = uint32(block.timestamp) + CHALLENGE_WINDOW;
        channel.closeAt = closeAt;
        emit CloseRequested(id, closeAt);
    }

    function _finishClose(address caller, uint256 id) private {
        Channel storage channel = channels[id];
        if (channel.payer != caller) revert NotAuthorized();
        if (channel.closeAt == 0 || block.timestamp < channel.closeAt) revert Unavailable();
        uint256 refunded = uint256(channel.deposit) - channel.redeemed;
        delete channels[id];
        emit ChannelClosed(id, refunded);
        if (refunded != 0) core.railTransfer(RAIL, address(this), caller, refunded, bytes32(id), false);
    }
}
