import 'dotenv/config'
import { expect, jest } from '@jest/globals'

import { createServer, CreateServerReturnType } from 'prool'
import { anvil } from 'prool/instances'
import * as dotenv from 'dotenv'

dotenv.config()

import {
    computeAddress,
    ContractFactory,
    JsonRpcProvider,
    parseEther,
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

const userPk = process.env.DEPLOYER_PRIVATE_KEY!.toString()
const resolverPk = process.env.DEPLOYER_PRIVATE_KEY!.toString()

describe('Arbitrum Sepolia to Monad Testnet Swap', () => {
    const srcChainId = config.chain.source.chainId as any     // 421614
    const dstChainId = config.chain.destination.chainId as any // 10143

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

        // Fund accounts on forks if needed
        if (config.chain.source.createFork) {
            console.log('💰 Funding user with ETH on fork...')
            // Impersonate a rich account to fund test accounts
            await src.provider.send('anvil_impersonateAccount', ['0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'])
            const richAccount = await src.provider.getSigner('0x980B62Da83eFf3D4576C647993b0c1D7faf17c73')

            const fundingTx = await richAccount.sendTransaction({
                to: await srcChainUser.getAddress(),
                value: parseEther('100')
            })
            await fundingTx.wait()
        }

        if (config.chain.destination.createFork) {
            console.log('💰 Funding resolver with MON on fork...')
            await dst.provider.send('anvil_impersonateAccount', ['0x760afe86e5de5fa0ee542fc7b7b713e1c5425701'])
           const richAccount = await dst.provider.getSigner('0x760afe86e5de5fa0ee542fc7b7b713e1c5425701')

            const fundingTx2 = await richAccount.sendTransaction({
                to: await dstChainResolver.getAddress(),
                value: parseEther('100')
            })
            await fundingTx2.wait()
        }

        srcResolverContract = await Wallet.fromAddress(src.resolver, src.provider)
        dstResolverContract = await Wallet.fromAddress(dst.resolver, dst.provider)

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

    describe('ETH → MON Cross-Chain Swap', () => {
        it('should swap ETH (Arbitrum) → MON (Monad)', async () => {
            console.log('\n🔄 Starting ETH → MON cross-chain swap...')

            // Get initial balances
            const initialSrcBalance = await srcChainUser.provider.getBalance(await srcChainUser.getAddress())
            const initialDstBalance = await dstChainUser.provider.getBalance(await dstChainUser.getAddress())

            console.log(`💰 Initial Arbitrum ETH balance: ${initialSrcBalance}`)
            console.log(`💰 Initial Monad MON balance: ${initialDstBalance}`)

            // User creates cross-chain order
            const secret = uint8ArrayToHex(randomBytes(32))
            const swapAmount = parseEther('0.01') // Swap 0.01 ETH for 0.01 MON

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
                        srcWithdrawal: 60n,         // 1 minute
                        srcPublicWithdrawal: 300n,  // 5 minutes
                        srcCancellation: 360n,      // 6 minutes
                        srcPublicCancellation: 420n, // 7 minutes
                        dstWithdrawal: 60n,         // 1 minute
                        dstPublicWithdrawal: 240n,  // 4 minutes
                        dstCancellation: 300n       // 5 minutes
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

            // User withdraws MON from destination chain
            console.log(`💸 User withdrawing MON from Monad escrow: ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )

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
            expect(dstBalanceChange).toBeGreaterThan(parseEther('0.009')) // Received close to 0.01 MON

            // User should have spent ETH on source (including gas, so more than just swap amount)
            expect(srcBalanceChange).toBeGreaterThan(swapAmount)

            console.log('🎉 ETH → MON cross-chain swap completed successfully!')
        }, 300000) // 5 minute timeout for real testnet
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
