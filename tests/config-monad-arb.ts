import {z} from 'zod'
import * as process from 'node:process'
import Sdk from '@1inch/cross-chain-sdk'


const bool = z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .pipe(z.boolean())

const ConfigSchema = z.object({
    ARBITRUM_SEPOLIA_RPC: z.string().url(),
    MONAD_TESTNET_RPC: z.string().url(),
    ARBITRUM_SEPOLIA_CREATE_FORK: bool.default('true'), // Use fork of testnet
    MONAD_TESTNET_CREATE_FORK: bool.default('true'),    // Use fork of testnet
})

const fromEnv = ConfigSchema.parse(process.env)

export const config = {
    chain: {
        source: {
            // chainId: 10143 as any, // ✅ Monad Testnet (direct chain ID)  
            chainId: Sdk.NetworkEnum.MONAD, // ✅ Monad Testnet (direct chain ID)  
            name: 'Monad Testnet',
            url: fromEnv.MONAD_TESTNET_RPC,
            createFork: fromEnv.MONAD_TESTNET_CREATE_FORK,
            limitOrderProtocol: '0xfde2d93A9D538940A9899CA6bEFa2517D9A0B23f', // 
            wrappedNative: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701', // Will use zero address or deploy WMON
            resolver: '0x3816BA21dCC9dfD3C714fFDB987163695408653F', // Same resolver address for both chains
            ownerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            tokens: {
                MON: {
                    address: '0x0000000000000000000000000000000000000000', // Native MON
                    donor: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701'  // Not needed for native MON
                },
                WMON: {
                    address: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701', // Will deploy or use zero address
                    donor: '0xFA735CcA8424e4eF30980653bf9015331d9929dB' // Example donor address
                }
            }
        },
        destination: {
            // chainId: 421614 as any, // ✅ Arbitrum Sepolia (direct chain ID)
            chainId: Sdk.NetworkEnum.ARBITRUM_SEPOLIA, // ✅ Arbitrum Sepolia (direct chain ID)
            name: 'Arbitrum Sepolia',
            url: fromEnv.ARBITRUM_SEPOLIA_RPC,
            createFork: fromEnv.ARBITRUM_SEPOLIA_CREATE_FORK,
            limitOrderProtocol: '0xfde2d93A9D538940A9899CA6bEFa2517D9A0B23f', // 
            wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // Arbitrum Sepolia WETH
            resolver: '0x3816BA21dCC9dfD3C714fFDB987163695408653F', // Deployed resolver address
            ownerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            tokens: {
                ETH: {
                    address: '0x0000000000000000000000000000000000000000', // Native ETH
                    donor: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'  // Not needed for native ETH
                },
                WETH: {
                    address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // Arbitrum Sepolia WETH
                    donor: '0xd7512902999b34af2B2940Eb8827CC8345DC77C6'
                }
            }  
        }
    }
} as const

export type ChainConfig = (typeof config.chain)['source' | 'destination']
