// scripts/super-short-deploy.ts
import { ethers } from 'ethers'
import * as dotenv from 'dotenv'

dotenv.config()

import LimitOrderProtocol from '../dist/contracts/LimitOrderProtocol.sol/LimitOrderProtocol.json'
import EscrowFactory from '../dist/contracts/EscrowFactory.sol/EscrowFactory.json'
import Resolver from '../dist/contracts/Resolver.sol/Resolver.json'


async function deployToChain(name: string, rpc: string, chainId: number, wethAddress: string) {
  console.log(`🚀 Deploying to ${name}...`)

  const provider = new ethers.JsonRpcProvider(rpc)
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider)
  console.log(`Using deployer: ${deployer.address}`)

  // 1. LimitOrderProtocol
  const lop = await new ethers.ContractFactory(LimitOrderProtocol.abi, LimitOrderProtocol.bytecode, deployer)
    .deploy(wethAddress)
  await lop.waitForDeployment()
  const lopAddr = await lop.getAddress()

  // 2. EscrowFactory (auto-deploys implementations)
  const factory = await new ethers.ContractFactory(EscrowFactory.abi, EscrowFactory.bytecode, deployer)
    .deploy(lopAddr, wethAddress, ethers.ZeroAddress, await deployer.getAddress(), 300, 300)
  await factory.waitForDeployment()
  const factoryAddr = await factory.getAddress()

  const factoryContract = new ethers.Contract(factoryAddr, EscrowFactory.abi, provider)
  const escrowSrcImpl = await factoryContract.ESCROW_SRC_IMPLEMENTATION()
  const escrowDstImpl = await factoryContract.ESCROW_DST_IMPLEMENTATION()

  // 3. Resolver
  const resolver = await new ethers.ContractFactory(Resolver.abi, Resolver.bytecode, deployer)
    .deploy(factoryAddr, lopAddr, await deployer.getAddress())
  await resolver.waitForDeployment()
  const resolverAddr = await resolver.getAddress()

  console.log(`✅ ${name}: LOP=${lopAddr.slice(0, 8)}... Factory=${factoryAddr.slice(0, 8)}... Resolver=${resolverAddr.slice(0, 8)}...`)
  console.log("resolver address:", resolverAddr);
  console.log("factory address:", factoryAddr);
  console.log("limit order protocol address:", lopAddr);
  console.log(`EscrowSrc Implementation: ${escrowSrcImpl}`)
  console.log(`EscrowDst Implementation: ${escrowDstImpl}`)


  return { chainId, name, limitOrderProtocol: lopAddr, escrowFactory: factoryAddr, resolver: resolverAddr }
}

async function main() {
  console.log('⚡ SUPER SHORT DEPLOYMENT')

  const [arbSepolia, monad] = await Promise.all([
    deployToChain(
      'Arbitrum Sepolia',
      'https://arb-sepolia.g.alchemy.com/v2/BLFwGlKbnWCyiD9p1LLcJkIRXk08dl-t',
      421614,
      '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73' // Your WETH address on ARB Sepolia
    ),
    deployToChain(
      'Monad',
      process.env.MONAD_RPC || 'https://monad-testnet.g.alchemy.com/v2/BLFwGlKbnWCyiD9p1LLcJkIRXk08dl-t',
      10143, // Replace with actual Monad chain ID
      '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701' // Your wrapped Monad address
    )
  ])

  console.log('🎉 DONE!')
  console.table({ arbSepolia, monad })

  // Save results
  require('fs').writeFileSync('./deployments.json', JSON.stringify({ arbSepolia, monad }, null, 2))
}

main().catch(console.error)
