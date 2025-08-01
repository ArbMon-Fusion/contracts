const { JsonRpcProvider, Interface } = require('ethers');
const EscrowFactoryContract = require('./dist/contracts/EscrowFactory.sol/EscrowFactory.json');

async function checkEvent() {
    const provider = new JsonRpcProvider('https://arb-sepolia.g.alchemy.com/v2/TRxeW47imEqxxdPubmvTuhcG334Udxb0', 421614);
    const iface = new Interface(EscrowFactoryContract.abi);

    // Use the block hash from the successful order fill
    // const blockHash = '0xa53b1101def6008bed8a2d2e79f27e02fc1baf1272d42e71c41f8f59ccdc5547';
    const tx = await provider.getTransactionReceipt("0xae36c83b2c479209f7d3121449b7208ebec3894a74b5082633634e846b7b455a");
    const blockHash = tx.blockHash;
    const factoryAddress = '0x06770B86ABee7B3991f235BE4b6d920862979e13';

    const event = iface.getEvent('SrcEscrowCreated');
    console.log('Event:', event);
    console.log('Event topicHash:', event.topicHash);

    const logs = await provider.getLogs({
        blockHash,
        address: factoryAddress,
        topics: [event.topicHash]
    });

    console.log('Found logs:', logs.length);

    if (logs.length > 0) {
        logs.forEach((log, index) => {
            console.log(`\nLog ${index}:`);
            console.log('  Data:', log.data);
            console.log('  Topics:', log.topics);

            try {
                const decoded = iface.decodeEventLog(event, log.data, log.topics);
                console.log('  Decoded:', decoded);
                console.log('  srcImmutables:', decoded.srcImmutables);
                console.log('  dstImmutablesComplement:', decoded.dstImmutablesComplement);
            } catch (error) {
                console.error('  Decode error:', error.message);
            }
        });
    } else {
        console.log('No logs found');
    }
}

checkEvent().catch(console.error);
