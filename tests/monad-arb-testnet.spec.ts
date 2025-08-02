import 'dotenv/config'
import { expect, jest } from '@jest/globals'
import * as dotenv from 'dotenv'

dotenv.config()

import {
    Contract,
    Interface,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes
} from 'ethers'
import { uint8ArrayToHex, UINT_40_MAX } from '@1inch/byte-utils'
import { Wallet } from './wallet'
import { Resolver } from './resolver'
import { EscrowFactory } from './escrow-factory'

// Import SDK utilities
import Sdk from '@1inch/cross-chain-sdk'
const { Address } = Sdk

jest.setTimeout(1000 * 60 * 10) // 10 minutes for real testnet calls

// Use the provided EOA address and private key from .env
const userPk = process.env.USER_PRIVATE_KEY!.toString()
const resolverPk = process.env.DEPLOYER_PRIVATE_KEY!.toString()
const eoa = '0x3816BA21dCC9dfD3C714fFDB987163695408653F'

// Token addresses for real testnet
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" // Arbitrum Sepolia WETH
const WMON = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701" // Update with actual WMON on Monad testnet

describe('Monad Testnet to Arbitrum Sepolia Swap (Real Testnet)', () => {
    const srcChainId = 10143   // Monad Testnet (now source)
    const dstChainId = 421614  // Arbitrum Sepolia (now destination)

    // Deployed contract addresses
    const contractAddresses = {
        monad: {
            resolver: '0xF1bF3e727Cb948C19d9D3b8c0a73cDf0a822bb04',
            factory: '0x06770B86ABee7B3991f235BE4b6d920862979e13',
            limitOrderProtocol: '0xfde2d93A9D538940A9899CA6bEFa2517D9A0B23f',
            escrowSrcImpl: '0xdf72A53658b379205832eA29beACD273Bb38c91a',
            escrowDstImpl: '0xb5D6A8D096e9DbeD4DD7F1b05f5b0c7F6e831666'
        },
        arbitrum: {
            resolver: '0xF1bF3e727Cb948C19d9D3b8c0a73cDf0a822bb04',
            factory: '0x06770B86ABee7B3991f235BE4b6d920862979e13',
            limitOrderProtocol: '0xfde2d93A9D538940A9899CA6bEFa2517D9A0B23f',
            escrowSrcImpl: '0xdf72A53658b379205832eA29beACD273Bb38c91a',
            escrowDstImpl: '0xb5D6A8D096e9DbeD4DD7F1b05f5b0c7F6e831666'
        }
    }

    type Chain = {
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
    }

    let src: Chain
    let dst: Chain

    let srcChainUser: Wallet
    let dstChainUser: Wallet
    let srcChainResolver: Wallet
    let dstChainResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let srcResolverContract: Wallet
    let dstResolverContract: Wallet

    let srcTimestamp: bigint

    beforeAll(async () => {
        console.log('🚀 Setting up Monad Testnet → Arbitrum Sepolia test (Real Testnet)...')

        // Initialize providers for real testnets (swapped roles)
        src = {
            provider: new JsonRpcProvider('https://monad-testnet.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', srcChainId, {
                cacheTimeout: -1,
                staticNetwork: true
            }),
            escrowFactory: contractAddresses.monad.factory,
            resolver: contractAddresses.monad.resolver
        }

        console.log('✅ Monad Testnet provider initialized')
        dst = {
            provider: new JsonRpcProvider('https://arb-sepolia.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', dstChainId, {
                cacheTimeout: -1,
                staticNetwork: true
            }),
            escrowFactory: contractAddresses.arbitrum.factory,
            resolver: contractAddresses.arbitrum.resolver
        }
        console.log('✅ Arbitrum Sepolia provider initialized')

        // Initialize wallets
        srcChainUser = new Wallet(userPk, src.provider)
        dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, src.provider)
        dstChainResolver = new Wallet(resolverPk, dst.provider)

        // Initialize factories
        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)
        dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)

        // Setup token approvals for real testnet 
        console.log('📝 Setting up token approvals...')

        // User approves WMON to LOP on Monad
        await srcChainUser.approveToken(
            WMON, 
            contractAddresses.monad.limitOrderProtocol,
            MaxUint256
        )
        console.log('✅ User approved WMON to LOP on Monad')

        // Use arbitraryCalls to approve factory to spend WETH on behalf of resolver contract
        const resolverInterface = new Interface(['function arbitraryCalls(address[],bytes[]) external'])
        const erc20Interface = new Interface(['function approve(address,uint256)'])
        
        // Create approval call data
        const approveCallData = erc20Interface.encodeFunctionData('approve', [dst.escrowFactory, MaxUint256])
        
        // Create arbitraryCalls transaction
        const arbitraryCallsData = resolverInterface.encodeFunctionData('arbitraryCalls', [[WETH], [approveCallData]])
        
        await dstChainResolver.send({
            to: dst.resolver,
            data: arbitraryCallsData
        })
        console.log('✅ Resolver contract approved WETH to Factory via arbitraryCalls')

        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)

        console.log('✅ Setup complete!')
        console.log(`📍 Using EOA: ${eoa}`)
        console.log(`📍 Monad Testnet Factory: ${src.escrowFactory}`)
        console.log(`📍 Monad Testnet Resolver: ${src.resolver}`)
        console.log(`📍 Arbitrum Sepolia Factory: ${dst.escrowFactory}`)
        console.log(`📍 Arbitrum Sepolia Resolver: ${dst.resolver}`)

        // Check balances
        const srcBalance = await srcChainUser.provider.getBalance(await srcChainUser.getAddress())
        const dstBalance = await dstChainUser.provider.getBalance(await dstChainUser.getAddress())
        const srcWmonBalance = await srcChainUser.tokenBalance(WMON)
        const dstWethBalance = await dstChainResolver.tokenBalance(WETH)

        console.log(`💰 Initial Monad MON balance: ${srcBalance}`)
        console.log(`💰 Initial Monad WMON balance: ${srcWmonBalance}`)
        console.log(`💰 Initial Arbitrum ETH balance: ${dstBalance}`)
        console.log(`💰 Resolver WETH balance: ${dstWethBalance}`)
    })

    describe('WMON → WETH Cross-Chain Swap (Real Testnet)', () => {
        it('should swap WMON (Monad) → WETH (Arbitrum) on real testnets', async () => {
            console.log('\n🔄 Starting WMON → WETH cross-chain swap on real testnets...')

            // Get initial token balances (using WMON/WETH instead of native tokens)
            const wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            let wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wmonContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wethContract.balanceOf(await dstChainUser.getAddress())
            let resolverWethBalance = await wethContract.balanceOf(await dstChainResolver.getAddress())

            console.log(`💰 Initial Monad WMON balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Arbitrum WETH balance: ${initialDstBalance}`)
            console.log(`💰 Resolver WETH balance: ${resolverWethBalance}`)

            // User creates cross-chain order  
            const secret = uint8ArrayToHex(randomBytes(32))
            const swapAmount = parseUnits('0.01', 18) // Swap 0.01 WMON for 0.01 WETH

            console.log('📝 Creating cross-chain order...')
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,           // 0.01 WMON
                    takingAmount: swapAmount,           // 0.01 WETH (1:1 for demo)
                    makerAsset: new Address(WMON),      // WMON token
                    takerAsset: new Address(WETH)       // WETH token
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n,
                        srcCancellation: 121n,
                        srcPublicCancellation: 122n,
                        dstWithdrawal: 10n,
                        dstPublicWithdrawal: 100n,
                        dstCancellation: 101n
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: parseEther('0.0001'),
                    dstSafetyDeposit: parseEther('0.0001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 240n, // 4 minutes
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)

            console.log(`📋 Order hash: ${orderHash}`)

            // Resolver fills order on source chain (Monad)
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`🔄 Resolver filling order on Monad Testnet...`)
            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    swapAmount
                )
            )

            console.log(`✅ Order filled on Monad: ${orderFillHash}`)

            // Get source escrow deployment event
            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log(`🔄 Creating destination escrow on Arbitrum...`)

            // Debug: Check resolver WETH balance and allowance
            wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'],
                dstChainResolver.provider
            )
            resolverWethBalance = await wethContract.balanceOf(await dstChainResolver.getAddress())
            const resolverAllowance = await wethContract.allowance(await dstChainResolver.getAddress(), dst.escrowFactory)

            console.log(`💰 Resolver WETH balance: ${resolverWethBalance}`)
            console.log(`🔓 Resolver WETH allowance to factory: ${resolverAllowance}`)
            console.log(`💸 Required WETH amount: ${swapAmount}`)
            console.log(`💸 Required ETH safety deposit: ${parseEther('0.0001')}`)

            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`✅ Destination escrow created on Arbitrum: ${dstDepositHash}`)

            // Wait for finality period (real testnet - shorter for demo)
            console.log('⏰ Waiting for finality period (15 seconds)...')
            await new Promise(resolve => setTimeout(resolve, 15000)) // Wait 15 seconds

            // Calculate escrow addresses using the deployed implementation addresses
            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                new Address(contractAddresses.monad.escrowSrcImpl)
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                new Address(contractAddresses.arbitrum.escrowDstImpl)
            )

            // User withdraws WETH from destination chain
            console.log(`💸 User withdrawing WETH from Arbitrum escrow: ${dstEscrowAddress}`)
            const { txHash: userWithdrawHash } = await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            console.log(`✅ User withdrew WETH: ${userWithdrawHash}`)

            // Resolver withdraws WMON from source chain
            console.log(`💸 Resolver withdrawing WMON from Monad escrow: ${srcEscrowAddress}`)
            const { txHash: resolverWithdrawHash } = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(`✅ Resolver withdrew WMON: ${resolverWithdrawHash}`)

            // Check final token balances
            const finalSrcBalance = await wmonContract.balanceOf(await srcChainUser.getAddress())
            const finalDstBalance = await wethContract.balanceOf(await dstChainUser.getAddress())

            console.log(`💰 Final Monad WMON balance: ${finalSrcBalance}`)
            console.log(`💰 Final Arbitrum WETH balance: ${finalDstBalance}`)

            // Verify swap occurred
            const srcBalanceChange = initialSrcBalance - finalSrcBalance
            const dstBalanceChange = finalDstBalance - initialDstBalance

            console.log(`📊 WMON spent: ${srcBalanceChange}`)
            console.log(`📊 WETH received: ${dstBalanceChange}`)

            // User should have received WETH on destination
            expect(dstBalanceChange).toBeGreaterThan(parseUnits('0.009', 18)) // Received close to 0.01 WETH

            // User should have spent WMON on source
            expect(srcBalanceChange).toBeGreaterThanOrEqual(swapAmount)

            console.log('🎉 WMON → WETH cross-chain swap completed successfully on real testnets!')
        }, 600000) // 10 minute timeout for real testnet
    })

    describe('Balance and Contract Checks', () => {
        it('should verify EOA has sufficient balance on both chains', async () => {
            const srcBalance = await src.provider.getBalance(eoa)
            const dstBalance = await dst.provider.getBalance(eoa)

            console.log(`💰 EOA Balance on Monad Testnet: ${srcBalance}`)
            console.log(`💰 EOA Balance on Arbitrum Sepolia: ${dstBalance}`)

            expect(srcBalance).toBeGreaterThan(parseEther('0.01'))
            expect(dstBalance).toBeGreaterThan(parseEther('0.01'))
        })

        it('should verify all contracts are deployed at expected addresses', async () => {
            // Check Monad contracts
            const srcFactoryCode = await src.provider.getCode(contractAddresses.monad.factory)
            const srcResolverCode = await src.provider.getCode(contractAddresses.monad.resolver)

            expect(srcFactoryCode).not.toBe('0x')
            expect(srcResolverCode).not.toBe('0x')

            // Check Arbitrum contracts
            const dstFactoryCode = await dst.provider.getCode(contractAddresses.arbitrum.factory)
            const dstResolverCode = await dst.provider.getCode(contractAddresses.arbitrum.resolver)

            expect(dstFactoryCode).not.toBe('0x')
            expect(dstResolverCode).not.toBe('0x')

            console.log('✅ All contracts verified on both chains')
        })
    })
})
