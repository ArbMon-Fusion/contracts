import 'dotenv/config'
import { expect, jest } from '@jest/globals'
import * as dotenv from 'dotenv'

dotenv.config()

import {
    JsonRpcProvider,
    parseEther,
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
const eoa = '0x6F44684bC0D57f1b661f193C40Ad3a521fd73f3E'

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
            provider: new JsonRpcProvider(process.env.ARBITRUM_SEPOLIA_RPC, srcChainId, {
                cacheTimeout: -1,
                staticNetwork: true
            }),
            escrowFactory: contractAddresses.arbitrum.factory,
            resolver: contractAddresses.arbitrum.resolver
        }

        console.log('✅ Arbitrum Sepolia provider initialized')
        dst = {
            provider: new JsonRpcProvider(process.env.MONAD_TESTNET_RPC, dstChainId, {
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

        // For real testnet, use resolver EOA directly (no contract impersonation needed)
        // The resolver contracts are already deployed at the specified addresses
        srcResolverContract = srcChainResolver  // Use resolver EOA
        dstResolverContract = dstChainResolver  // Use resolver EOA

        // Check resolver balances for sufficient funds
        const srcResolverBalance = await srcChainResolver.provider.getBalance(await srcChainResolver.getAddress())
        const dstResolverBalance = await dstChainResolver.provider.getBalance(await dstChainResolver.getAddress())
        
        console.log(`💰 Resolver balance on Arbitrum: ${srcResolverBalance}`)
        console.log(`💰 Resolver balance on Monad: ${dstResolverBalance}`)

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
        console.log(`💰 Initial Arbitrum ETH balance: ${srcBalance}`)
        console.log(`💰 Initial Monad MON balance: ${dstBalance}`)
    })

    afterAll(async () => {
        if (src?.provider) src.provider.destroy()
        if (dst?.provider) dst.provider.destroy()
    })

    describe('ETH → MON Cross-Chain Swap (Real Testnet)', () => {
        it('should swap ETH (Arbitrum) → MON (Monad) on real testnets', async () => {
            console.log('\n🔄 Starting ETH → MON cross-chain swap on real testnets...')

            // Get initial balances
            const initialSrcBalance = await srcChainUser.provider.getBalance(await srcChainUser.getAddress())
            const initialDstBalance = await dstChainUser.provider.getBalance(await dstChainUser.getAddress())

            console.log(`💰 Initial Arbitrum ETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad MON balance: ${initialDstBalance}`)

            // User creates cross-chain order
            const secret = uint8ArrayToHex(randomBytes(32))
            const swapAmount = parseEther('0.01') // Swap 0.01 ETH for 0.01 MON (smaller amount for testnet)

            console.log('📝 Creating cross-chain order...')
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,           // 0.01 ETH
                    takingAmount: swapAmount,           // 0.01 MON (1:1 for demo)
                    makerAsset: new Address('0x0000000000000000000000000000000000000000'), // Native ETH
                    takerAsset: new Address('0x0000000000000000000000000000000000000000')  // Native MON
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
                    srcSafetyDeposit: parseEther('0.01'),
                    dstSafetyDeposit: parseEther('0.01')
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

            // Debug: Check EIP-712 domain and order data
            const typedData = order.getTypedData(srcChainId)
            console.log('🔍 EIP-712 Domain:', JSON.stringify(typedData.domain, null, 2))
            console.log('🔍 Order maker:', await srcChainUser.getAddress())
            console.log('🔍 Order structure:', JSON.stringify({
                maker: order.maker.toString(),
                makerAsset: order.makerAsset.toString(),
                takerAsset: order.takerAsset.toString(),
                makingAmount: order.makingAmount.toString(),
                takingAmount: order.takingAmount.toString()
            }, null, 2))

            const signature = await srcChainUser.signOrder(srcChainId, order, contractAddresses.arbitrum.limitOrderProtocol)
            const orderHash = order.getOrderHash(srcChainId)

            console.log(`📋 Order hash: ${orderHash}`)
            console.log(`📋 Signature: ${signature}`)

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
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`✅ Destination escrow created on Monad: ${dstDepositHash}`)

            // Wait for finality period (real testnet - actual wait time)
            console.log('⏰ Waiting for finality period (2.5 minutes)...')
            await new Promise(resolve => setTimeout(resolve, 150000)) // Wait 2.5 minutes

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

            // User withdraws MON from destination chain
            console.log(`💸 User withdrawing MON from Monad escrow: ${dstEscrowAddress}`)
            const { txHash: userWithdrawHash } = await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            console.log(`✅ User withdrew MON: ${userWithdrawHash}`)

            // Resolver withdraws ETH from source chain
            console.log(`💸 Resolver withdrawing ETH from Arbitrum escrow: ${srcEscrowAddress}`)
            const { txHash: resolverWithdrawHash } = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(`✅ Resolver withdrew ETH: ${resolverWithdrawHash}`)

            // Check final balances
            const finalSrcBalance = await srcChainUser.provider.getBalance(await srcChainUser.getAddress())
            const finalDstBalance = await dstChainUser.provider.getBalance(await dstChainUser.getAddress())

            console.log(`💰 Final Arbitrum ETH balance: ${finalSrcBalance}`)
            console.log(`💰 Final Monad MON balance: ${finalDstBalance}`)

            // Verify swap occurred (allowing for gas costs)
            const srcBalanceChange = initialSrcBalance - finalSrcBalance
            const dstBalanceChange = finalDstBalance - initialDstBalance

            console.log(`📊 ETH spent (including gas): ${srcBalanceChange}`)
            console.log(`📊 MON received: ${dstBalanceChange}`)

            // User should have received MON on destination
            expect(dstBalanceChange).toBeGreaterThan(parseEther('0.0009')) // Received close to 0.001 MON

            // User should have spent ETH on source (including gas, so more than just swap amount)
            expect(srcBalanceChange).toBeGreaterThan(swapAmount)

            console.log('🎉 ETH → MON cross-chain swap completed successfully on real testnets!')
        })
    })

    describe('Balance and Contract Checks', () => {
        it('should verify EOA has sufficient balance on ARB chains', async () => {
            const srcBalance = await src.provider.getBalance(eoa)
            // const dstBalance = await dst.provider.getBalance(eoa)

            console.log(`💰 EOA Balance on Arbitrum Sepolia: ${srcBalance}`)
            // console.log(`💰 EOA Balance on Monad Testnet: ${dstBalance}`)

            expect(srcBalance).toBeGreaterThan(parseEther('0.01'))
            // expect(dstBalance).toBeGreaterThan(parseEther('0.01'))
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
