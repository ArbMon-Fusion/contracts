import {id, Interface, JsonRpcProvider} from 'ethers'
import Sdk from '@1inch/cross-chain-sdk'
import EscrowFactoryContract from '../dist/contracts/EscrowFactory.sol/EscrowFactory.json'

export class EscrowFactory {
    private iface = new Interface(EscrowFactoryContract.abi)

    constructor(
        private readonly provider: JsonRpcProvider,
        private readonly address: string
    ) {}

    public async getSourceImpl(): Promise<Sdk.Address> {
        return Sdk.Address.fromBigInt(
            BigInt(
                await this.provider.call({
                    to: this.address,
                    data: id('ESCROW_SRC_IMPLEMENTATION()').slice(0, 10)
                })
            )
        )
    }

    public async getDestinationImpl(): Promise<Sdk.Address> {
        return Sdk.Address.fromBigInt(
            BigInt(
                await this.provider.call({
                    to: this.address,
                    data: id('ESCROW_DST_IMPLEMENTATION()').slice(0, 10)
                })
            )
        )
    }

    public async getSrcDeployEvent(blockHash: string): Promise<[Sdk.Immutables, Sdk.DstImmutablesComplement]> {
        const event = this.iface.getEvent('SrcEscrowCreated')!
        
        // Retry mechanism: check every 10 seconds up to 5 times
        for (let attempt = 1; attempt <= 5; attempt++) {
            console.log(`🔍 Attempt ${attempt}/5: Looking for SrcEscrowCreated event in block ${blockHash}...`)
            
            const logs = await this.provider.getLogs({
                blockHash,
                address: this.address,
                topics: [event.topicHash]
            })

            if (logs.length > 0) {
                console.log(`✅ Found ${logs.length} SrcEscrowCreated event(s)!`)
                
                const decodedLog = this.iface.decodeEventLog(event, logs[0].data, logs[0].topics)
                
                if (!decodedLog) {
                    throw new Error('Failed to decode SrcEscrowCreated event')
                }

                const immutables = decodedLog.srcImmutables
                const complement = decodedLog.dstImmutablesComplement
                
                console.log('🎯 Event decoded successfully!')
                
                return [
                    Sdk.Immutables.new({
                        orderHash: immutables[0],
                        hashLock: Sdk.HashLock.fromString(immutables[1]),
                        maker: Sdk.Address.fromBigInt(immutables[2]),
                        taker: Sdk.Address.fromBigInt(immutables[3]),
                        token: Sdk.Address.fromBigInt(immutables[4]),
                        amount: immutables[5],
                        safetyDeposit: immutables[6],
                        timeLocks: Sdk.TimeLocks.fromBigInt(immutables[7])
                    }),
                    Sdk.DstImmutablesComplement.new({
                        maker: Sdk.Address.fromBigInt(complement[0]),
                        amount: complement[1],
                        token: Sdk.Address.fromBigInt(complement[2]),
                        safetyDeposit: complement[3]
                    })
                ]
            }
            
            if (attempt < 5) {
                console.log(`⏰ No events found, waiting 10 seconds before retry...`)
                await new Promise(resolve => setTimeout(resolve, 10000))
            }
        }
        
        throw new Error(`No SrcEscrowCreated events found in block ${blockHash} after 5 attempts`)
    }
}
