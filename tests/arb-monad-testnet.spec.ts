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

describe('Arbitrum Sepolia to Monad Testnet Swap (Real Testnet)', () => {
    const srcChainId = 421614  // Arbitrum Sepolia
    const dstChainId = 10143   // Monad Testnet

    // Deployed contract addresses
    const contractAddresses = {
        arbitrum: {
            resolver: '0xF1bF3e727Cb948C19d9D3b8c0a73cDf0a822bb04',
            factory: '0x06770B86ABee7B3991f235BE4b6d920862979e13',
            limitOrderProtocol: '0xfde2d93A9D538940A9899CA6bEFa2517D9A0B23f',
            escrowSrcImpl: '0xdf72A53658b379205832eA29beACD273Bb38c91a',
            escrowDstImpl: '0xb5D6A8D096e9DbeD4DD7F1b05f5b0c7F6e831666'
        },
        monad: {
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
        console.log('🚀 Setting up Arbitrum Sepolia → Monad Testnet test (Real Testnet)...')

        // Initialize providers for real testnets
        src = {
            provider: new JsonRpcProvider('https://arb-sepolia.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', srcChainId, {
                cacheTimeout: -1,
                staticNetwork: true
            }),
            escrowFactory: contractAddresses.arbitrum.factory,
            resolver: contractAddresses.arbitrum.resolver
        }

        console.log('✅ Arbitrum Sepolia provider initialized')
        dst = {
            provider: new JsonRpcProvider('https://monad-testnet.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', dstChainId, {
                cacheTimeout: -1,
                staticNetwork: true
            }),
            escrowFactory: contractAddresses.monad.factory,
            resolver: contractAddresses.monad.resolver
        }
        console.log('✅ Monad Testnet provider initialized')

        // Initialize wallets
        srcChainUser = new Wallet(userPk, src.provider)
        dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, src.provider)
        dstChainResolver = new Wallet(resolverPk, dst.provider)

        // Initialize factories
        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)
        dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)


        // Setup token approvals for real testnet (similar to fork version)
        console.log('📝 Setting up token approvals...')

        // User approves WETH to LOP on Arbitrum
        await srcChainUser.approveToken(
            WETH,
            contractAddresses.arbitrum.limitOrderProtocol,
            MaxUint256
        )
        console.log('✅ User approved WETH to LOP on Arbitrum')



        // Use arbitraryCalls to approve factory to spend WMON on behalf of resolver contract
        const resolverInterface = new Interface(['function arbitraryCalls(address[],bytes[]) external'])
        const erc20Interface = new Interface(['function approve(address,uint256)'])
        
        // Create approval call data
        const approveCallData = erc20Interface.encodeFunctionData('approve', [dst.escrowFactory, MaxUint256])
        
        // Create arbitraryCalls transaction
        const arbitraryCallsData = resolverInterface.encodeFunctionData('arbitraryCalls', [[WMON], [approveCallData]])
        
        await dstChainResolver.send({
            to: dst.resolver,
            data: arbitraryCallsData
        })
        console.log('✅ Resolver contract approved WMON to Factory via arbitraryCalls')

        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)

        console.log('✅ Setup complete!')
        console.log(`📍 Using EOA: ${eoa}`)
        console.log(`📍 Arbitrum Sepolia Factory: ${src.escrowFactory}`)
        console.log(`📍 Arbitrum Sepolia Resolver: ${src.resolver}`)
        console.log(`📍 Monad Testnet Factory: ${dst.escrowFactory}`)
        console.log(`📍 Monad Testnet Resolver: ${dst.resolver}`)

        // Check balances
        const srcBalance = await srcChainUser.provider.getBalance(await srcChainUser.getAddress())
        const dstBalance = await dstChainUser.provider.getBalance(await dstChainUser.getAddress())
        const srcWethBalance = await srcChainUser.tokenBalance(WETH)
        const dstWmonBalance = await dstChainResolver.tokenBalance(WMON)

        console.log(`💰 Initial Arbitrum ETH balance: ${srcBalance}`)
        console.log(`💰 Initial Arbitrum WETH balance: ${srcWethBalance}`)
        console.log(`💰 Initial Monad MON balance: ${dstBalance}`)
        console.log(`💰 Resolver WMON balance: ${dstWmonBalance}`)
    })

    // afterAll(async () => {
    //     if (src?.provider) src.provider.destroy()
    //     if (dst?.provider) dst.provider.destroy()
    // })

    describe('WETH → WMON Cross-Chain Swap (Real Testnet)', () => {
        it('should swap WETH (Arbitrum) → WMON (Monad) on real testnets', async () => {
            console.log('\n🔄 Starting WETH → WMON cross-chain swap on real testnets...')

            // Get initial token balances (using WETH/WMON instead of native tokens)
            const wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            let wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())
            let resolverWmonBalance = await wmonContract.balanceOf(await dstChainResolver.getAddress())

            console.log(`💰 Initial Arbitrum WETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${initialDstBalance}`)
            console.log(`💰 Resolver WMON balance: ${resolverWmonBalance}`)

            // User creates cross-chain order  
            const secret = uint8ArrayToHex(randomBytes(32))
            const swapAmount = parseUnits('0.01', 18) // Swap 0.01 WETH for 0.01 WMON

            console.log('📝 Creating cross-chain order...')
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,           // 0.01 WETH
                    takingAmount: swapAmount,           // 0.01 WMON (1:1 for demo)
                    makerAsset: new Address(WETH),      // WETH token
                    takerAsset: new Address(WMON)       // WMON token
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        // srcWithdrawal: 120n,         // 2 minutes
                        // srcPublicWithdrawal: 600n,   // 10 minutes
                        // srcCancellation: 720n,       // 12 minutes
                        // srcPublicCancellation: 840n, // 14 minutes
                        // dstWithdrawal: 120n,         // 2 minutes
                        // dstPublicWithdrawal: 480n,   // 8 minutes
                        // dstCancellation: 600n        // 10 minutes

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

            // Resolver fills order on source chain (Arbitrum)
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`🔄 Resolver filling order on Arbitrum Sepolia...`)
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

            console.log(`✅ Order filled on Arbitrum: ${orderFillHash}`)

            // Get source escrow deployment event
            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log(`🔄 Creating destination escrow on Monad...`)

            // Debug: Check resolver WMON balance and allowance
            wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'],
                dstChainResolver.provider
            )
            resolverWmonBalance = await wmonContract.balanceOf(await dstChainResolver.getAddress())
            const resolverAllowance = await wmonContract.allowance(await dstChainResolver.getAddress(), dst.escrowFactory)

            console.log(`💰 Resolver WMON balance: ${resolverWmonBalance}`)
            console.log(`🔓 Resolver WMON allowance to factory: ${resolverAllowance}`)
            console.log(`💸 Required WMON amount: ${swapAmount}`)
            console.log(`💸 Required MON safety deposit: ${parseEther('0.0001')}`)

            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`✅ Destination escrow created on Monad: ${dstDepositHash}`)

            // Wait for finality period (real testnet - shorter for demo)
            console.log('⏰ Waiting for finality period (15 seconds)...')
            await new Promise(resolve => setTimeout(resolve, 15000)) // Wait 15 seconds

            // Calculate escrow addresses using the deployed implementation addresses
            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                new Address(contractAddresses.arbitrum.escrowSrcImpl)
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                new Address(contractAddresses.monad.escrowDstImpl)
            )

            // User withdraws WMON from destination chain
            console.log(`💸 User withdrawing WMON from Monad escrow: ${dstEscrowAddress}`)
            const { txHash: userWithdrawHash } = await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            console.log(`✅ User withdrew WMON: ${userWithdrawHash}`)

            // Resolver withdraws WETH from source chain
            console.log(`💸 Resolver withdrawing WETH from Arbitrum escrow: ${srcEscrowAddress}`)
            const { txHash: resolverWithdrawHash } = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(`✅ Resolver withdrew WETH: ${resolverWithdrawHash}`)

            // Check final token balances
            const finalSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const finalDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())

            console.log(`💰 Final Arbitrum WETH balance: ${finalSrcBalance}`)
            console.log(`💰 Final Monad WMON balance: ${finalDstBalance}`)

            // Verify swap occurred
            const srcBalanceChange = initialSrcBalance - finalSrcBalance
            const dstBalanceChange = finalDstBalance - initialDstBalance

            console.log(`📊 WETH spent: ${srcBalanceChange}`)
            console.log(`📊 WMON received: ${dstBalanceChange}`)

            // User should have received WMON on destination
            expect(dstBalanceChange).toBeGreaterThan(parseUnits('0.009', 18)) // Received close to 0.01 WMON

            // User should have spent WETH on source
            expect(srcBalanceChange).toBeGreaterThanOrEqual(swapAmount)

            console.log('🎉 WETH → WMON cross-chain swap completed successfully on real testnets!')
        }, 600000) // 10 minute timeout for real testnet
    })

    describe('Balance and Contract Checks', () => {
        it('should verify EOA has sufficient balance on both chains', async () => {
            const srcBalance = await src.provider.getBalance(eoa)
            const dstBalance = await dst.provider.getBalance(eoa)

            console.log(`💰 EOA Balance on Arbitrum Sepolia: ${srcBalance}`)
            console.log(`💰 EOA Balance on Monad Testnet: ${dstBalance}`)

            expect(srcBalance).toBeGreaterThan(parseEther('0.01'))
            expect(dstBalance).toBeGreaterThan(parseEther('0.01'))
        })

        it('should verify all contracts are deployed at expected addresses', async () => {
            // Check Arbitrum contracts
            const srcFactoryCode = await src.provider.getCode(contractAddresses.arbitrum.factory)
            const srcResolverCode = await src.provider.getCode(contractAddresses.arbitrum.resolver)

            expect(srcFactoryCode).not.toBe('0x')
            expect(srcResolverCode).not.toBe('0x')

            // Check Monad contracts
            const dstFactoryCode = await dst.provider.getCode(contractAddresses.monad.factory)
            const dstResolverCode = await dst.provider.getCode(contractAddresses.monad.resolver)

            expect(dstFactoryCode).not.toBe('0x')
            expect(dstResolverCode).not.toBe('0x')

            console.log('✅ All contracts verified on both chains')
        })
    })
})
