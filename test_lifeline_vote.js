const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8081');

ws.on('open', () => {
    console.log('Connected to server');
    
    // Register as chat integration
    ws.send(JSON.stringify({
        type: 'register',
        client: 'chat_integration'
    }));
    
    // Send a lifeline vote for "1"
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'testuser1',
            text: '1',
            timestamp: Date.now()
        }));
        console.log('Sent vote for position 1 (should be fiftyFifty)');
        
        // Wait and close
        setTimeout(() => {
            ws.close();
            process.exit(0);
        }, 2000);
    }, 500);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'lifeline_vote_update') {
        console.log('Vote update received:', msg.voteCounts);
        console.log('Available lifelines order:', msg.availableLifelines);
    }
});

ws.on('error', console.error);
