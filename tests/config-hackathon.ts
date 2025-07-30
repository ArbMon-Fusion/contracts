// import {z} from 'zod'
// import * as process from 'node:process'

// const bool = z
//     .string()
//     .transform((v) => v.toLowerCase() === 'true')
//     .pipe(z.boolean())

// const ConfigSchema = z.object({
//     // Arbitrum Sepolia
//     ARBITRUM_SEPOLIA_RPC: z.string().url(),
//     ARBITRUM_SEPOLIA_CREATE_FORK: bool.default('false'), // Use real testnet, not fork
//     ARBITRUM_SEPOLIA_ESCROW_FACTORY: z.string().optional(),
//     ARBITRUM_SEPOLIA_RESOLVER: z.string().optional(),
//     ARBITRUM_SEPOLIA_LOP: z.string().optional(),
    
//     // Monad Testnet  
//     MONAD_TESTNET_RPC: z.string().url(),
//     MONAD_TESTNET_CREATE_FORK: bool.default('false'), // Use real testnet, not fork
//     MONAD_TESTNET_ESCROW_FACTORY: z.string().optional(),
//     MONAD_TESTNET_RESOLVER: z.string().optional(),
//     MONAD_TESTNET_LOP: z.string().optional(),
// })

// const fromEnv = ConfigSchema.parse(process.env)

// export const hackathonConfig = {
//     chain: {
//         source: {
//             chainId: 421614, // Arbitrum Sepolia
//             name: 'Arbitrum Sepolia',
//             url: fromEnv.ARBITRUM_SEPOLIA_RPC,
//             createFork: fromEnv.ARBITRUM_SEPOLIA_CREATE_FORK,
//             limitOrderProtocol: fromEnv.ARBITRUM_SEPOLIA_LOP || '0x0000000000000000000000000000000000000000', // Will be updated after deployment
//             wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // Arbitrum Sepolia WETH
//             escrowFactory: fromEnv.ARBITRUM_SEPOLIA_ESCROW_FACTORY || '0x0000000000000000000000000000000000000000',
//             resolver: fromEnv.ARBITRUM_SEPOLIA_RESOLVER || '0x0000000000000000000000000000000000000000',
//             ownerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY!,
//             resolverPrivateKey: process.env.RESOLVER_OWNER_PRIVATE_KEY!,
//             explorer: 'https://sepolia.arbiscan.io',
//             tokens: {
//                 USDC: {
//                     // Arbitrum Sepolia USDC (if available) or deploy mock
//                     address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Example - update with real address
//                     decimals: 6,
//                     donor: '0x0000000000000000000000000000000000000000' // Mock donor for testnet
//                 },
//                 WETH: {
//                     address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
//                     decimals: 18,
//                     donor: '0x0000000000000000000000000000000000000000'
//                 }
//             }
//         },
//         destination: {
//             chainId: 10143, // Monad Testnet (update with actual chain ID)
//             name: 'Monad Testnet',
//             url: fromEnv.MONAD_TESTNET_RPC,
//             createFork: fromEnv.MONAD_TESTNET_CREATE_FORK,
//             limitOrderProtocol: fromEnv.MONAD_TESTNET_LOP || '0x0000000000000000000000000000000000000000', // Will be updated after deployment
//             wrappedNative: '0x0000000000000000000000000000000000000000', // Will be deployed or found
//             escrowFactory: fromEnv.MONAD_TESTNET_ESCROW_FACTORY || '0x0000000000000000000000000000000000000000',
//             resolver: fromEnv.MONAD_TESTNET_RESOLVER || '0x0000000000000000000000000000000000000000',
//             ownerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY!,
//             resolverPrivateKey: process.env.RESOLVER_OWNER_PRIVATE_KEY!,
//             explorer: 'https://testnet.monad.xyz', // Update with actual explorer
//             tokens: {
//                 USDC: {
//                     // Will deploy mock USDC on Monad testnet
//                     address: '0x0000000000000000000000000000000000000000', // To be deployed
//                     decimals: 6,
//                     donor: '0x0000000000000000000000000000000000000000'
//                 },
//                 WMON: {
//                     // Wrapped Monad token
//                     address: '0x0000000000000000000000000000000000000000', // To be deployed
//                     decimals: 18,
//                     donor: '0x0000000000000000000000000000000000000000'
//                 }
//             }
//         }
//     },
//     // Testnet-optimized timelock settings (much shorter than production)
//     timelocks: {
//         srcWithdrawal: 60,        // 1 minute (vs 10 minutes in production)
//         srcPublicWithdrawal: 300, // 5 minutes (vs 2 hours in production)
//         srcCancellation: 360,     // 6 minutes (vs ~2 hours in production)
//         srcPublicCancellation: 420, // 7 minutes
//         dstWithdrawal: 60,        // 1 minute
//         dstPublicWithdrawal: 240, // 4 minutes
//         dstCancellation: 300,     // 5 minutes
//     },
//     // Safety deposits (small amounts for testnet)
//     safetyDeposits: {
//         src: '0.001', // 0.001 ETH
//         dst: '0.001', // 0.001 ETH or MON
//     }
// } as const

// export type HackathonChainConfig = (typeof hackathonConfig.chain)['source' | 'destination']

// // Helper function to update config after deployment
// export function updateConfigWithDeployedAddresses(
//     chain: 'source' | 'destination',
//     addresses: {
//         escrowFactory?: string
//         resolver?: string
//         limitOrderProtocol?: string
//         wrappedNative?: string
//     }
// ) {
//     const chainConfig = hackathonConfig.chain[chain] as any
    
//     if (addresses.escrowFactory) {
//         chainConfig.escrowFactory = addresses.escrowFactory
//     }
//     if (addresses.resolver) {
//         chainConfig.resolver = addresses.resolver
//     }
//     if (addresses.limitOrderProtocol) {
//         chainConfig.limitOrderProtocol = addresses.limitOrderProtocol
//     }
//     if (addresses.wrappedNative) {
//         chainConfig.wrappedNative = addresses.wrappedNative
//     }
    
//     console.log(`✅ Updated ${chain} config with deployed addresses`)
// }

// // Export for compatibility with existing test structure
// export const config = hackathonConfig
