const WebSocket = require('ws');
const fetch = require('node-fetch');

console.log('🔄 Testing real-time updates between API and WebSocket...');

// Start WebSocket listener
const ws = new WebSocket('ws://localhost:8081');
let messageCount = 0;

ws.on('open', function open() {
  console.log('✅ WebSocket connected, listening for updates...');
  
  // Register as test client
  ws.send(JSON.stringify({
    type: 'register',
    client: 'test_realtime'
  }));
});

ws.on('message', function message(data) {
  try {
    const parsed = JSON.parse(data.toString());
    messageCount++;
    console.log(`📨 [${messageCount}] Received: ${parsed.type}`);
    
    if (parsed.type === 'game_state' || parsed.type === 'state') {
      console.log(`   📊 Game active: ${parsed.game_active || parsed.data?.game_active}`);
      console.log(`   🎯 Current question: ${parsed.current_question || parsed.data?.current_question}`);
    }
  } catch (e) {
    console.log('📤 Raw message received');
  }
});

// Test API call that should trigger WebSocket broadcast
setTimeout(async () => {
  console.log('\n🚀 Sending API request to trigger real-time update...');
  try {
    const response = await fetch('http://localhost:8081/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_game' })
    });
    
    const result = await response.json();
    console.log('✅ API response:', result.status);
  } catch (error) {
    console.error('❌ API error:', error.message);
  }
}, 1000);

// Close after 3 seconds
setTimeout(() => {
  console.log(`\n📈 Total messages received: ${messageCount}`);
  console.log('🏁 Real-time test complete');
  ws.close();
  process.exit(0);
}, 3000);
