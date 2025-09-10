#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');

// Helper function to make API calls
function apiCall(action, data = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ action, ...data });
    
    const options = {
      hostname: 'localhost',
      port: 8081,
      path: '/api/control',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Failed to parse response' });
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Connect to WebSocket and monitor messages
function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:8081');
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      ws.send(JSON.stringify({
        type: 'register',
        client: 'test_monitor'
      }));
      resolve(ws);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        // Log Ask a Mod related messages
        if (message.type && message.type.includes('ask_a_mod')) {
          console.log('📨 Received:', message.type);
          
          if (message.type === 'ask_a_mod_display_update') {
            console.log('  📍 Display Update Details:');
            console.log('    - Has newResponse:', !!message.newResponse);
            console.log('    - Has allResponses:', !!message.allResponses);
            console.log('    - Total responses:', message.totalResponses);
            if (message.newResponse) {
              console.log('    - New response from:', message.newResponse.username);
              console.log('    - Message:', message.newResponse.message);
            }
          }
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    });
    
    ws.on('error', reject);
  });
}

// Main test function
async function testModDisplay() {
  console.log('\n🔍 === MOD RESPONSE DISPLAY TEST ===\n');
  console.log('This test will monitor WebSocket messages to debug display issues.\n');
  
  let ws;
  
  try {
    // Connect WebSocket first to monitor all messages
    console.log('1. Connecting WebSocket monitor...');
    ws = await connectWebSocket();
    console.log('   ✓ Monitoring all messages\n');
    
    // Setup game
    console.log('2. Setting up fresh game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game ready\n');
    
    // Activate Ask a Mod
    console.log('3. Activating Ask a Mod...');
    const result = await apiCall('activate_ask_a_mod');
    console.log('   ✓ Ask a Mod activated\n');
    
    // Send test messages with delays
    console.log('4. Sending test mod messages...\n');
    
    const testMessages = [
      { username: 'kagewins', message: 'I think the answer is B' },
      { username: 'ch0nsi', message: 'B - Initial Public Offering' },
      { username: 'mandalo__', message: 'Definitely B!' }
    ];
    
    for (const msg of testMessages) {
      console.log(`   📤 Sending: ${msg.username}: "${msg.message}"`);
      await apiCall('send_mod_message', msg);
      
      // Wait to see WebSocket message
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('');
    }
    
    console.log('5. Checking final state...');
    const state = await apiCall('get_state');
    console.log(`   Ask a Mod active: ${state.ask_a_mod_active}`);
    console.log(`   Responses collected: ${state.mod_responses ? state.mod_responses.length : 0}\n`);
    
    console.log('📋 SUMMARY:');
    console.log('- Check browser console at http://localhost:8081/gameshow');
    console.log('- Look for "Ask a Mod display update received" messages');
    console.log('- Check if mod-response-panel is visible');
    console.log('- Verify mod-responses-list has child elements\n');
    
    console.log('⏳ Keeping connection open for 10 seconds to monitor...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (ws) {
      ws.close();
      console.log('\n✅ Test complete - WebSocket closed');
    }
  }
}

// Run the test
testModDisplay().catch(console.error);