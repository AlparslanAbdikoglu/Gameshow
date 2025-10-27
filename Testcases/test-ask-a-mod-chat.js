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

// Connect to WebSocket server
function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:8081');
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected to bridge server');
      
      // Register as a test client
      ws.send(JSON.stringify({
        type: 'register',
        client: 'test_chat_client'
      }));
      
      resolve(ws);
    });
    
    ws.on('error', reject);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'ask_a_mod_display_update') {
          console.log('📺 Display update received:', {
            totalResponses: message.totalResponses,
            response: message.response ? message.response.username + ': ' + message.response.message : null
          });
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    });
  });
}

// Simulate chat message from moderator
async function sendChatMessage(ws, username, text, isMod = true) {
  const chatMessage = {
    type: 'chat',
    username: username,
    text: text,
    timestamp: Date.now(),
    platform: 'twitch',
    badges: isMod ? ['moderator'] : [],
    isModerator: isMod
  };
  
  console.log(`💬 Sending chat message from ${username}: "${text}"`);
  ws.send(JSON.stringify(chatMessage));
  
  // Wait a bit for processing
  await new Promise(resolve => setTimeout(resolve, 500));
}

// Test Ask a Mod with real chat messages
async function testAskAModChat() {
  console.log('=== Ask a Mod Chat Integration Test ===\n');
  
  let ws;
  
  try {
    // Step 1: Connect WebSocket
    console.log('1. Connecting to WebSocket...');
    ws = await connectWebSocket();
    console.log('   ✓ WebSocket connected\n');
    
    // Step 2: Reset and setup game
    console.log('2. Setting up fresh game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game setup complete\n');
    
    // Step 3: Activate Ask a Mod
    console.log('3. Activating Ask a Mod...');
    const activateResult = await apiCall('activate_ask_a_mod');
    if (activateResult.success && activateResult.state.ask_a_mod_active) {
      console.log('   ✓ Ask a Mod activated successfully\n');
    } else {
      console.log('   ✗ Failed to activate Ask a Mod');
      return;
    }
    
    // Step 4: Send chat messages from moderators
    console.log('4. Sending chat messages from moderators...\n');
    
    // Test various message formats
    await sendChatMessage(ws, 'kagewins', 'Looking at the question, I believe B is the correct answer');
    await sendChatMessage(ws, 'ch0nsi', 'B - Initial Public Offering');
    await sendChatMessage(ws, 'mandalo__', 'Definitely B! IPO = Initial Public Offering');
    await sendChatMessage(ws, 'thatboidhtx', 'I agree with everyone, the answer is B');
    
    // Test non-moderator (should be ignored)
    await sendChatMessage(ws, 'regular_viewer', 'I think it\'s A!', false);
    console.log('   ⚠️ Sent non-mod message (should be ignored)\n');
    
    // Test duplicate message from same mod
    await sendChatMessage(ws, 'kagewins', 'Actually, let me clarify - B is definitely correct');
    
    // Test VIP if enabled (mock VIP badge)
    const vipMessage = {
      type: 'chat',
      username: 'vip_user',
      text: 'As a VIP, I also think B is right',
      timestamp: Date.now(),
      platform: 'twitch',
      badges: ['vip'],
      isVIP: true
    };
    console.log('💎 Sending VIP message...');
    ws.send(JSON.stringify(vipMessage));
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Send API test messages for comparison
    console.log('\n5. Sending API test messages for comparison...');
    await apiCall('send_mod_message', {
      username: 'host',
      message: 'From API: B is the correct answer'
    });
    console.log('   ✓ API message sent\n');
    
    // Step 6: Check collected responses
    console.log('6. Waiting for responses to be processed...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 7: Monitor for session end
    console.log('\n7. Monitoring Ask a Mod session...');
    console.log('   Session should end in ~25 seconds...');
    
    // Keep connection open to receive updates
    await new Promise(resolve => setTimeout(resolve, 25000));
    
    console.log('\n=== Test Complete ===');
    console.log('Check the browser at http://localhost:8081/gameshow to verify:');
    console.log('- Mod response panel is visible and not hidden behind other elements');
    console.log('- Messages from chat appear in the panel');
    console.log('- Text is readable despite compact size');
    console.log('- Timer counts down properly');
    console.log('- Panel can scroll if many messages');
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    if (ws) {
      ws.close();
      console.log('\n✅ WebSocket connection closed');
    }
  }
}

// Run the test
testAskAModChat().catch(console.error);