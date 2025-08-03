import * as dotenv from 'dotenv'
dotenv.config()

import {
    Contract,
    Interface,
    JsonRpcProvider,
    formatEther,
    parseEther
} from 'ethers'
import { Wallet } from './tests/wallet'

type ChainConfig = {
    name: string
    rpcUrl: string
    chainId: number
    tokenSymbol: string
    tokenAddress: string
    resolverAddress: string
}

const chainConfigs: Record<string, ChainConfig> = {
    arbitrum_sepolia: {
        name: 'Arbitrum Sepolia',
        rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC!,
        chainId: 421614,
        tokenSymbol: 'WETH',
        tokenAddress: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
        resolverAddress: '0xF1bF3e727Cb948C19d9D3b8c0a73cDf0a822bb04'
    },
    monad_testnet: {
        name: 'Monad Testnet',
        rpcUrl: process.env.MONAD_TESTNET_RPC!,
        chainId: 10143,
        tokenSymbol: 'WMON',
        tokenAddress: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701',
        resolverAddress: '0xF1bF3e727Cb948C19d9D3b8c0a73cDf0a822bb04'
    }
}

async function withdrawResolverFunds(chainKey: string, amountToWithdraw?: bigint) {
    const config = chainConfigs[chainKey]
    if (!config) throw new Error(`Invalid chainKey: ${chainKey}`)

    console.log(`🚀 Starting withdrawal of ${config.tokenSymbol} from Resolver contract on ${config.name}...\n`)

    const provider = new JsonRpcProvider(config.rpcUrl, config.chainId)
    const resolverWallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider)
    const resolverAddress = config.resolverAddress

    console.log('📍 Resolver EOA:', await resolverWallet.getAddress())
    console.log('📍 Resolver Contract:', resolverAddress)
    console.log('📍 Token:', config.tokenAddress)
    console.log()

    const tokenContract = new Contract(
        config.tokenAddress,
        ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256)'],
        provider
    )

    const eoaBalance = await tokenContract.balanceOf(await resolverWallet.getAddress())
    const contractBalance = await tokenContract.balanceOf(resolverAddress)

    console.log('💰 Current Balances:')
    console.log(`   Resolver EOA: ${formatEther(eoaBalance)} ${config.tokenSymbol}`)
    console.log(`   Resolver Contract: ${formatEther(contractBalance)} ${config.tokenSymbol}`)
    console.log()

    if (contractBalance === 0n) {
        console.log(`❌ No ${config.tokenSymbol} to withdraw from resolver contract`)
        return
    }

    const withdrawAmount = amountToWithdraw && amountToWithdraw <= contractBalance
        ? amountToWithdraw
        : contractBalance

    const resolverInterface = new Interface(['function arbitraryCalls(address[],bytes[]) external'])
    const erc20Interface = new Interface(['function transfer(address,uint256)'])

    const transferCallData = erc20Interface.encodeFunctionData('transfer', [
        await resolverWallet.getAddress(),
        withdrawAmount
    ])

    console.log(`🔄 Preparing withdrawal of ${formatEther(withdrawAmount)} ${config.tokenSymbol}...`)
    const arbitraryCallsData = resolverInterface.encodeFunctionData('arbitraryCalls', [
        [config.tokenAddress],
        [transferCallData]
    ])

    try {
        const { txHash } = await resolverWallet.send({
            to: resolverAddress,
            data: arbitraryCallsData
        })

        console.log(`✅ Withdrawal successful!`)
        console.log(`📄 Transaction: ${txHash}`)

        const finalEOABalance = await tokenContract.balanceOf(await resolverWallet.getAddress())
        const withdrawn = finalEOABalance - eoaBalance
        console.log(`🎉 Withdrawn: ${formatEther(withdrawn)} ${config.tokenSymbol}`)

    } catch (err) {
        console.error('❌ Withdrawal failed:', err)
    }
}

// CLI entry point
if (require.main === module) {
    const args = process.argv.slice(2)
    const chainKey = args[0]
    const amountArg = args[1]

    if (!chainKey) {
        console.log('Usage:')
        console.log('  ts-node withdraw.ts <chainKey> [amount]')
        process.exit(1)
    }

    const amount = amountArg ? parseEther(amountArg) : undefined
    withdrawResolverFunds(chainKey, amount).catch(console.error)
}

export { withdrawResolverFunds }


// # Withdraw full amount
// npx tsx withdraw-resolver-fund.ts arbitrum_sepolia
    
// # Withdraw 0.5 tokens
// npx tsx withdraw-resolver-fund.ts monad_testnet 0.5
