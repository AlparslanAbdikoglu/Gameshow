const WebSocket = require('ws');

console.log('🔌 Testing WebSocket connection to bridge server...');
const ws = new WebSocket('ws://localhost:8081');

ws.on('open', function open() {
  console.log('✅ WebSocket connected to bridge server');
  
  // Register as test client
  ws.send(JSON.stringify({
    type: 'register',
    client: 'test_client'
  }));
  console.log('📝 Registered as test_client');
  
  // Test sending a game action
  setTimeout(() => {
    console.log('🎮 Testing game action via WebSocket...');
    ws.send(JSON.stringify({
      type: 'game_action',
      action: 'reset_game'
    }));
  }, 1000);
});

ws.on('message', function message(data) {
  try {
    const parsed = JSON.parse(data.toString());
    console.log('📨 Received message type:', parsed.type);
    
    if (parsed.type === 'game_state') {
      console.log('🎯 Game state update received - game_active:', parsed.game_active);
      console.log('📊 Current question:', parsed.current_question);
    } else if (parsed.type === 'acknowledgment') {
      console.log('✅ Server acknowledged registration');
    } else {
      console.log('💬 Other message:', parsed.type, '-', JSON.stringify(parsed).substring(0, 100) + '...');
    }
  } catch (e) {
    console.log('📤 Raw message:', data.toString().substring(0, 200) + '...');
  }
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', function close() {
  console.log('🔐 WebSocket connection closed');
});

// Auto-close after 5 seconds
setTimeout(() => {
  console.log('⏰ Test complete, closing connection');
  ws.close();
  process.exit(0);
}, 5000);
