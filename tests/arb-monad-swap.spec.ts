import 'dotenv/config'
import { expect, jest } from '@jest/globals'

import { createServer, CreateServerReturnType } from 'prool'
import { anvil } from 'prool/instances'
import * as dotenv from 'dotenv'

dotenv.config()

import {
    computeAddress,
    Contract,
    ContractFactory,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
    Wallet as SignerWallet
} from 'ethers'
import { uint8ArrayToHex, UINT_40_MAX } from '@1inch/byte-utils'
import assert from 'node:assert'
import { ChainConfig, config } from './config-arb-monad'
import { Wallet } from './wallet'
import { Resolver } from './resolver'
import { EscrowFactory } from './escrow-factory'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'

// Import SDK utilities (still usable even if NetworkEnum isn't)
import Sdk from '@1inch/cross-chain-sdk'
const { Address } = Sdk

jest.setTimeout(1000 * 60 * 5) // 5 minutes for real testnet calls

const userPk = process.env.USER_PRIVATE_KEY!.toString()
const resolverPk = process.env.DEPLOYER_PRIVATE_KEY!.toString()
const WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" // Arbitrum Sepolia WETH
const WMON = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701" // Arbitrum Sepolia WMON

describe('Arbitrum Sepolia to Monad Testnet Swap', () => {
    const srcChainId = config.chain.source.chainId      // 421614
    const dstChainId = config.chain.destination.chainId // 10143

    type Chain = {
        node?: CreateServerReturnType | undefined
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

    async function increaseTime(t: number): Promise<void> {
        // Only works on forks, skip on real testnets
        if (config.chain.source.createFork || config.chain.destination.createFork) {
            await Promise.all([src, dst].map((chain) =>
                chain.node ? chain.provider.send('evm_increaseTime', [t]) : Promise.resolve()
            ))
        } else {
            console.log(`⏰ Waiting ${t} seconds for real testnet...`)
            await new Promise(resolve => setTimeout(resolve, t * 1000))
        }
    }

    beforeAll(async () => {
        console.log('🚀 Setting up Arbitrum Sepolia → Monad Testnet test...')

        try {
            // Initialize both chains (will deploy contracts automatically)
            ;[src, dst] = await Promise.all([
                initChain(config.chain.source),
                initChain(config.chain.destination)
            ])
        } catch (error) {
            console.error('Setup failed:', error)
            throw error
        }

        srcChainUser = new Wallet(userPk, src.provider)
        dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, src.provider)
        dstChainResolver = new Wallet(resolverPk, dst.provider)

        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)
        dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)

        console.log("src resolver address", src.resolver)

        srcResolverContract = await Wallet.fromAddress(src.resolver, src.provider)
        dstResolverContract = await Wallet.fromAddress(dst.resolver, dst.provider)

        console.log("srcChainResolver and srcResolverContract", await srcChainResolver.getAddress(), await srcResolverContract.getAddress())

        // Fund accounts on forks if needed
        if (config.chain.source.createFork) {
            console.log('💰 Funding user with WETH on fork...')
            // Impersonate WETH rich account to transfer WETH to user
            await src.provider.send('anvil_impersonateAccount', ['0xd7512902999b34af2B2940Eb8827CC8345DC77C6'])
            const wethRichAccount = await src.provider.getSigner('0xd7512902999b34af2B2940Eb8827CC8345DC77C6')

            // Transfer WETH tokens to user
            const wethContract = new Contract(
                WETH,
                [
                    'function transfer(address to, uint256 amount) returns (bool)',
                    'function balanceOf(address) view returns (uint256)'
                ],
                wethRichAccount
            )

            console.log(`User balance before getting 10 weth: ${await srcChainUser.tokenBalance(WETH)}`)
            const wethRichAddress = await wethRichAccount.getAddress()
            console.log(`Wethrich account token balance before giving 10 weth: ${await wethContract.balanceOf(wethRichAddress)}`)


            await srcChainUser.topUpFromDonor(
                config.chain.source.tokens.WETH.address,
                config.chain.source.tokens.WETH.donor,
                parseUnits('10', 18)
            )

            await srcChainUser.approveToken(
                config.chain.source.tokens.WETH.address,
                config.chain.source.limitOrderProtocol,
                MaxUint256
            )


            // const wethTransferTx = await wethContract.transfer(await srcChainUser.getAddress(), parseEther('10'))
            // await wethTransferTx.wait()



            console.log('✅ User funded with WETH on Arbitrum Sepolia fork')

            // Impersonate a rich account to fund test accounts
            await src.provider.send('anvil_impersonateAccount', ['0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'])
            const richAccount1 = await src.provider.getSigner('0x980B62Da83eFf3D4576C647993b0c1D7faf17c73')

            const fundingTx = await richAccount1.sendTransaction({
                to: await srcChainUser.getAddress(),
                value: parseEther('100')
            })
            await fundingTx.wait()

            console.log('✅ User funded with WETH and ETH on Arbitrum Sepolia fork')
            console.log(`User balance after getting 10 weth: ${await srcChainUser.tokenBalance(WETH)}`)

            const fundingTx1 = await richAccount1.sendTransaction({
                to: await srcChainResolver.getAddress(),
                value: parseEther('100')
            })
            await fundingTx1.wait()
        }

        if (config.chain.destination.createFork) {
            console.log('💰 Funding resolver with WMON on fork...')
            // Impersonate WMON rich account to transfer WMON to resolver
            await dst.provider.send('anvil_impersonateAccount', ['0xFA735CcA8424e4eF30980653bf9015331d9929dB'])
            const wmonRichAccount = await dst.provider.getSigner('0xFA735CcA8424e4eF30980653bf9015331d9929dB')

            // Transfer WMON tokens to resolver (assuming WMON token at wrapped native address)
            const wmonContract = new Contract(
                WMON,
                ['function transfer(address to, uint256 amount) returns (bool)'],
                wmonRichAccount
            )

            const wmonTransferTx = await wmonContract.transfer(await dstChainResolver.getAddress(), parseEther('10'))
            await wmonTransferTx.wait()



            // Impersonate a rich account to fund test accounts

            await dst.provider.send('anvil_impersonateAccount', ['0x760afe86e5de5fa0ee542fc7b7b713e1c5425701'])
            const richAccount2 = await dst.provider.getSigner('0x760afe86e5de5fa0ee542fc7b7b713e1c5425701')

            const fundingTx2 = await richAccount2.sendTransaction({
                to: await dstChainResolver.getAddress(),
                value: parseEther('100')
            })
            await fundingTx2.wait()

            await dstResolverContract.topUpFromDonor(
                config.chain.destination.tokens.WMON.address,
                config.chain.destination.tokens.WMON.donor,
                parseUnits('20', 18)
            )

            await dstChainResolver.transfer(dst.resolver, parseEther('1'))
            await dstResolverContract.unlimitedApprove(config.chain.destination.tokens.WMON.address, dst.escrowFactory)
        }



        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)

        console.log('✅ Setup complete!')
        console.log(`📍 Arbitrum Sepolia Factory: ${src.escrowFactory}`)
        console.log(`📍 Arbitrum Sepolia Resolver: ${src.resolver}`)
        console.log(`📍 Monad Testnet Factory: ${dst.escrowFactory}`)
        console.log(`📍 Monad Testnet Resolver: ${dst.resolver}`)
    })

    afterAll(async () => {
        if (src?.provider) src.provider.destroy()
        if (dst?.provider) dst.provider.destroy()
        await Promise.all([src?.node?.stop(), dst?.node?.stop()].filter(Boolean))
    })

    describe('WETH → WMON Cross-Chain Swap', () => {
        it('should swap WETH (Arbitrum) → WMON (Monad)', async () => {
            console.log('\n🔄 Starting WETH → WMON cross-chain swap...')

            // Get initial token balances
            const wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            const wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())


            console.log("resolver address:", await dstChainResolver.getAddress())
            console.log("resolver initial WMON token balance:", await wmonContract.balanceOf(await dstChainResolver.getAddress()))

            console.log(`💰 Initial Arbitrum WETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${initialDstBalance}`)

            // User creates cross-chain order
            const secret = uint8ArrayToHex(randomBytes(32))
            const swapAmount = parseEther('0.01') // Swap 0.01 WETH for 0.01 WMON

            console.log('📝 Creating cross-chain order...')

            console.log("srcchain resolver balance:", await wethContract.balanceOf(await srcChainResolver.getAddress()))

            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,           // 0.01 WETH
                    takingAmount: swapAmount,           // 0.01 WMON (1:1 for demo)
                    makerAsset: new Address(WETH), // WETH token
                    takerAsset: new Address(WMON)  // WMON token
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        // srcWithdrawal: 60n,         // 1 minute
                        // srcPublicWithdrawal: 300n,  // 5 minutes
                        // srcCancellation: 360n,      // 6 minutes
                        // srcPublicCancellation: 420n, // 7 minutes
                        // dstWithdrawal: 60n,         // 1 minute
                        // dstPublicWithdrawal: 240n,  // 4 minutes
                        // dstCancellation: 300n       // 5 minutes


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
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
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
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`✅ Destination escrow created on Monad: ${dstDepositHash}`)

            // Wait for finality period
            console.log('⏰ Waiting for finality period...')
            await increaseTime(65) // Wait > 60 seconds

            // Calculate escrow addresses
            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            // User withdraws WMON from destination chain
            console.log(`💸 User withdrawing WMON from Monad escrow: ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )

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
            expect(dstBalanceChange).toBeGreaterThan(parseEther('0.009')) // Received close to 0.01 WMON

            // User should have spent WETH on source
            expect(srcBalanceChange).toBeGreaterThanOrEqual(swapAmount)

            console.log('🎉 WETH → WMON cross-chain swap completed successfully!')
        }, 300000) // 5 minute timeout for real testnet

        it('should swap WETH -> WMON. Multiple fills. Fill 100%', async () => {

            // Get initial token balances
            const wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            const wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())


            console.log("resolver address:", await dstChainResolver.getAddress())
            console.log("resolver initial WMON token balance:", await wmonContract.balanceOf(await dstChainResolver.getAddress()))

            console.log(`💰 Initial Arbitrum WETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${initialDstBalance}`)

            // User creates order
            // 11 secrets
            const swapAmount = parseEther('0.01') // Swap 0.01 WETH for 0.01 WMON
            const secrets = Array.from({ length: 11 }).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,
                    takingAmount: swapAmount,
                    makerAsset: new Address(config.chain.source.tokens.WETH.address),
                    takerAsset: new Address(config.chain.destination.tokens.WMON.address)
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10s finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10s finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
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
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            const fillAmount = order.makingAmount
            const idx = secrets.length - 1 // last index to fulfill
            // Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / order.makingAmount)

            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const secret = secrets[idx]

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            await increaseTime(11) // finality lock passed
            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const { txHash: resolverWithdrawHash } = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

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
            expect(dstBalanceChange).toBeGreaterThan(parseEther('0.009')) // Received close to 0.01 WMON

            // User should have spent WETH on source
            expect(srcBalanceChange).toBeGreaterThanOrEqual(swapAmount)

            console.log('🎉 WETH → WMON cross-chain swap completed successfully!')
        }, 300000) // 5 minute timeout for real testnet

        it('should swap Ethereum USDC -> Bsc USDC. Multiple fills. Fill 50%', async () => {
            // Get initial token balances
            const wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            const wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())


            console.log("resolver address:", await dstChainResolver.getAddress())
            console.log("resolver initial WMON token balance:", await wmonContract.balanceOf(await dstChainResolver.getAddress()))

            console.log(`💰 Initial Arbitrum WETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${initialDstBalance}`)

            // User creates order
            // 11 secrets
            const swapAmount = parseEther('0.01') // Swap 0.01 WETH for 0.01 WMON
            const secrets = Array.from({ length: 11 }).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,
                    takingAmount: swapAmount,
                    makerAsset: new Address(config.chain.source.tokens.WETH.address),
                    takerAsset: new Address(config.chain.destination.tokens.WMON.address)
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10s finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10s finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
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
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            const signature = await srcChainUser.signOrder(srcChainId, order)
            const orderHash = order.getOrderHash(srcChainId)
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            const fillAmount = order.makingAmount / 2n
            const idx = Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / order.makingAmount)

            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const secret = secrets[idx]

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            await increaseTime(11) // finality lock passed
            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )

            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const { txHash: resolverWithdrawHash } = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

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
            expect(dstBalanceChange).toBeGreaterThan(parseEther('0.0005')) // Received close to 0.0005 WMON

            // User should have spent WETH on source
            expect(srcBalanceChange).toBeGreaterThanOrEqual(swapAmount / 2n)

            console.log('🎉 WETH → WMON cross-chain swap completed successfully!')
        }, 300000) // 5 minute timeout for real testnet
    })

    describe('Cancel', () => {
        it('should cancel swap Ethereum USDC -> Bsc USDC', async () => {
            // Get initial token balances
            const wethContract = new Contract(
                WETH,
                ['function balanceOf(address) view returns (uint256)'],
                srcChainUser.provider
            )
            const wmonContract = new Contract(
                WMON,
                ['function balanceOf(address) view returns (uint256)'],
                dstChainUser.provider
            )

            const initialSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const initialDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())


            console.log("resolver address:", await dstChainResolver.getAddress())
            console.log("resolver initial WMON token balance:", await wmonContract.balanceOf(await dstChainResolver.getAddress()))

            console.log(`💰 Initial Arbitrum WETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${initialDstBalance}`)

            // User creates order
            const swapAmount = parseEther('0.01') // Swap 0.01 WETH for 0.01 WMON
            const hashLock = Sdk.HashLock.forSingleFill(uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in real world
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: swapAmount,
                    takingAmount: swapAmount,
                    makerAsset: new Address(config.chain.source.tokens.WETH.address),
                    takerAsset: new Address(config.chain.destination.tokens.WMON.address)
                },
                {
                    hashLock,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 0n, // no finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 0n, // no finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: parseEther('0.001'),
                    dstSafetyDeposit: parseEther('0.001')
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
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
            // Resolver fills order
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)

            const fillAmount = order.makingAmount
            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            await increaseTime(125)
            // user does not share secret, so cancel both escrows
            console.log(`[${dstChainId}]`, `Cancelling dst escrow ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.cancel('dst', dstEscrowAddress, dstImmutables.withDeployedAt(dstDeployedAt))
            )

            console.log(`[${srcChainId}]`, `Cancelling src escrow ${srcEscrowAddress}`)
            const { txHash: cancelSrcEscrow } = await srcChainResolver.send(
                resolverContract.cancel('src', srcEscrowAddress, srcEscrowEvent[0])
            )
            console.log(`[${srcChainId}]`, `Cancelled src escrow ${srcEscrowAddress} in tx ${cancelSrcEscrow}`)

            const resultSrcBalance = await wethContract.balanceOf(await srcChainUser.getAddress())
            const resultDstBalance = await wmonContract.balanceOf(await dstChainUser.getAddress())

            console.log(`💰 Initial Arbitrum WETH balance: ${resultSrcBalance}`)
            console.log(`💰 Initial Monad WMON balance: ${resultDstBalance}`)

            expect(initialSrcBalance).toEqual(resultSrcBalance)
            expect(initialDstBalance).toEqual(resultDstBalance)
        })
    })
})

// Same initChain and getProvider functions from main.spec.ts
async function initChain(
    cnf: ChainConfig
): Promise<{ node?: CreateServerReturnType; provider: JsonRpcProvider; escrowFactory: string; resolver: string }> {
    const { node, provider } = await getProvider(cnf)
    const deployer = new SignerWallet(cnf.ownerPrivateKey, provider)

    console.log(`🏗️  Deploying contracts on ${cnf.name}...`)

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployer.address, // owner
            60 * 5, // src rescue delay (5 min for testnet)
            60 * 5 // dst rescue delay (5 min for testnet)
        ],
        provider,
        deployer
    )
    console.log(`[${cnf.chainId}]`, `Escrow factory deployed:`, escrowFactory)

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        provider,
        deployer
    )
    console.log(`[${cnf.chainId}]`, `Resolver deployed:`, resolver)

    return { node: node, provider, resolver, escrowFactory }
}

async function getProvider(cnf: ChainConfig): Promise<{ node?: CreateServerReturnType; provider: JsonRpcProvider }> {
    if (!cnf.createFork) {
        console.log(`🔗 Connecting to real ${cnf.name} testnet...`)
        return {
            provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
                cacheTimeout: -1,
                staticNetwork: true
            })
        }
    }

    console.log(`🍴 Creating local fork of ${cnf.name}...`)
    const node = createServer({
        instance: anvil({ forkUrl: cnf.url, chainId: cnf.chainId }),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, cnf.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

async function deploy(
    json: { abi: any; bytecode: any },
    params: unknown[],
    provider: JsonRpcProvider,
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()

    return await deployed.getAddress()
}
