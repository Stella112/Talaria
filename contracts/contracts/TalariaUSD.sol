// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TalariaUSD
/// @notice Test stablecoin for the Talaria demo on testnets. It has no value.
/// @dev Hand-written ERC-20 + EIP-2612 instead of OpenZeppelin because code size costs
/// tPOT deposits on Portaldot. Unaudited; for test use only.
contract TalariaUSD {
    string public constant name = "Talaria Test USD (no value)";
    string public constant symbol = "tUSD";
    uint8 public constant decimals = 6;

    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_CAP = 10_000_000e6;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    address public owner;
    uint256 public faucetMinted;

    error OwnableUnauthorizedAccount(address account);
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error FaucetCapReached();
    error ERC2612ExpiredSignature(uint256 deadline);
    error ERC2612InvalidSigner(address signer, address owner);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FaucetUsed(address indexed to, uint256 amount);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("1"), block.chainid, address(this)));
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function permit(address holder, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (block.timestamp > deadline) revert ERC2612ExpiredSignature(deadline);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, holder, spender, value, nonces[holder], deadline));
        address signer = ecrecover(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash)), v, r, s);
        if (signer == address(0) || signer != holder) revert ERC2612InvalidSigner(signer, holder);
        nonces[holder]++;
        _approve(holder, spender, value);
    }

    /// @notice Mints to the bridge reserve or another owner-chosen address.
    function mint(address to, uint256 value) external {
        if (msg.sender != owner) revert OwnableUnauthorizedAccount(msg.sender);
        _mint(to, value);
    }

    /// @notice Public demo faucet, limited by a global cap.
    function faucet() external {
        uint256 minted = faucetMinted + FAUCET_AMOUNT;
        if (minted > FAUCET_CAP) revert FaucetCapReached();
        faucetMinted = minted;
        emit FaucetUsed(msg.sender, FAUCET_AMOUNT);
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert OwnableUnauthorizedAccount(msg.sender);
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _approve(address holder, address spender, uint256 value) private {
        if (spender == address(0)) revert ZeroAddress();
        allowance[holder][spender] = value;
        emit Approval(holder, spender, value);
    }

    function _mint(address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }
}
