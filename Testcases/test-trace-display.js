#!/usr/bin/env node

const http = require('http');

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

// Main test
async function test() {
  console.log('\n🔍 === TRACE MOD DISPLAY TEST ===\n');
  
  try {
    // Setup game
    console.log('1. Setting up game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game ready\n');
    
    // Activate Ask a Mod
    console.log('2. Activating Ask a Mod...');
    const activateResult = await apiCall('activate_ask_a_mod');
    console.log('   Result:', JSON.stringify(activateResult, null, 2).substring(0, 200));
    console.log('');
    
    // Send ONE test message
    console.log('3. Sending ONE test mod message...');
    const msgResult = await apiCall('send_mod_message', {
      username: 'kagewins',
      message: 'The answer is definitely B'
    });
    console.log('   Result:', JSON.stringify(msgResult, null, 2).substring(0, 200));
    console.log('');
    
    // Check state
    console.log('4. Getting current state...');
    // Use GET request for state
    const stateResult = await new Promise((resolve, reject) => {
      http.get('http://localhost:8081/api/state', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: 'Failed to parse state' });
          }
        });
      }).on('error', reject);
    });
    console.log('   ask_a_mod_active:', stateResult.ask_a_mod_active);
    console.log('   mod_responses:', stateResult.mod_responses);
    console.log('');
    
    console.log('📋 NOW CHECK:');
    console.log('1. Open http://localhost:8081/gameshow');
    console.log('2. Open browser DevTools console (F12)');
    console.log('3. Look for these console messages:');
    console.log('   - "🛡️ Ask a Mod display update received"');
    console.log('   - "🛡️ Displaying response from moderator kagewins"');
    console.log('4. Check if the mod response panel shows the message');
    console.log('5. In console, type: document.getElementById("mod-responses-list").children.length');
    console.log('   (This should show 1 if the message was added)\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run
test().catch(console.error);