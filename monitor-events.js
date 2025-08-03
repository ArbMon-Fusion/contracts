const { JsonRpcProvider, Interface } = require('ethers');
const EscrowFactoryContract = require('./dist/contracts/EscrowFactory.sol/EscrowFactory.json');

async function monitorEvents() {
    const provider = new JsonRpcProvider('https://arb-sepolia.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', 421614);
    const iface = new Interface(EscrowFactoryContract.abi);
    const factoryAddress = '0x06770B86ABee7B3991f235BE4b6d920862979e13';
    
    const event = iface.getEvent('SrcEscrowCreated');
    console.log('Monitoring SrcEscrowCreated events...');
    console.log('Factory address:', factoryAddress);
    console.log('Event topicHash:', event.topicHash);
    
    let lastBlockNumber = await provider.getBlockNumber();
    console.log('Starting from block:', lastBlockNumber);
    
    setInterval(async () => {
        try {
            const currentBlock = await provider.getBlockNumber();
            
            if (currentBlock > lastBlockNumber) {
                console.log(`\nChecking blocks ${lastBlockNumber + 1} to ${currentBlock}...`);
                
                const logs = await provider.getLogs({
                    fromBlock: lastBlockNumber + 1,
                    toBlock: currentBlock,
                    address: factoryAddress,
                    topics: [event.topicHash]
                });
                
                if (logs.length > 0) {
                    console.log(`Found ${logs.length} SrcEscrowCreated events!`);
                    
                    logs.forEach((log, index) => {
                        console.log(`\nEvent ${index + 1}:`);
                        console.log('  Block:', log.blockNumber);
                        console.log('  TxHash:', log.transactionHash);
                        console.log('  BlockHash:', log.blockHash);
                        
                        try {
                            const decoded = iface.decodeEventLog(event, log.data, log.topics);
                            console.log('  ✅ Successfully decoded event');
                            console.log('  srcImmutables keys:', Object.keys(decoded.srcImmutables || {}));
                            console.log('  dstImmutablesComplement keys:', Object.keys(decoded.dstImmutablesComplement || {}));
                            
                            if (decoded.srcImmutables) {
                                console.log('  orderHash:', decoded.srcImmutables.orderHash);
                                console.log('  hashlock:', decoded.srcImmutables.hashlock);
                            }
                        } catch (error) {
                            console.error('  ❌ Decode error:', error.message);
                        }
                    });
                } else {
                    console.log(`No events found in blocks ${lastBlockNumber + 1}-${currentBlock}`);
                }
                
                lastBlockNumber = currentBlock;
            } else {
                console.log(`No new blocks (current: ${currentBlock})`);
            }
        } catch (error) {
            console.error('Error monitoring events:', error.message);
        }
    }, 10000); // Check every 10 seconds
}

monitorEvents().catch(console.error);