const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8081');

ws.on('open', () => {
    console.log('Connected');
    ws.send(JSON.stringify({ type: 'register', client: 'chat_integration' }));
    
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: 'chat_message',
            platform: 'test',
            username: 'testuser2',
            text: '1',
            timestamp: Date.now()
        }));
        console.log('Voted for position 1 (should be takeAnotherVote now)');
        
        setTimeout(() => {
            ws.close();
            process.exit(0);
        }, 2000);
    }, 500);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'lifeline_vote_update') {
        console.log('Vote counts:', msg.voteCounts);
        console.log('Available order:', msg.availableLifelines);
    }
});
