// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

// Import the actual LimitOrderProtocol from the submodule
import {LimitOrderProtocol} from "../lib/cross-chain-swap/lib/limit-order-protocol/contracts/LimitOrderProtocol.sol";
import {IWETH} from "../lib/cross-chain-swap/lib/solidity-utils/contracts/interfaces/IWETH.sol";

/**
 * @title LimitOrderProtocolWrapper
 * @dev Simple wrapper for LimitOrderProtocol to make it available in our build artifacts
 * @notice This contract is identical to LimitOrderProtocol, just wrapped for deployment
 */
contract LimitOrderProtocolWrapper is LimitOrderProtocol {
    /**
     * @dev Constructor that passes WETH address to parent LimitOrderProtocol
     * @param _weth Address of the WETH contract
     */
    constructor(IWETH _weth) LimitOrderProtocol(_weth) {
        // No additional logic needed, just pass through to parent
    }
}

