const WebSocket = require('ws');

console.log('Testing lifeline vote display...');

// Connect to the server
const ws = new WebSocket('ws://localhost:8081');

ws.on('open', () => {
    console.log('Connected to server');
    
    // Register as chat integration
    ws.send(JSON.stringify({
        type: 'register',
        client: 'chat_integration'
    }));
    
    // Send multiple votes with short delays
    setTimeout(() => {
        // Vote 1 for 50:50
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'voter1',
            text: '1',
            timestamp: Date.now()
        }));
        console.log('Sent vote 1 (50:50) from voter1');
    }, 500);
    
    setTimeout(() => {
        // Vote 2 for Take Another Vote
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'voter2',
            text: '2',
            timestamp: Date.now()
        }));
        console.log('Sent vote 2 (Take Another Vote) from voter2');
    }, 1000);
    
    setTimeout(() => {
        // Vote 2 again from another user
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'voter3',
            text: '2',
            timestamp: Date.now()
        }));
        console.log('Sent vote 2 (Take Another Vote) from voter3');
    }, 1500);
    
    setTimeout(() => {
        // Vote 3 for Ask a Mod
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'voter4',
            text: '3',
            timestamp: Date.now()
        }));
        console.log('Sent vote 3 (Ask a Mod) from voter4');
    }, 2000);
    
    setTimeout(() => {
        // Another vote for 50:50
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'voter5',
            text: '1',
            timestamp: Date.now()
        }));
        console.log('Sent vote 1 (50:50) from voter5');
    }, 2500);
    
    // Close after all votes
    setTimeout(() => {
        console.log('All votes sent - check the display!');
        console.log('Expected totals: 50:50=2, Take Another Vote=2, Ask a Mod=1, Total=5');
        ws.close();
        process.exit(0);
    }, 3000);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'lifeline_vote_update') {
        console.log('Vote update received:', msg.voteCounts || msg.votes);
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});