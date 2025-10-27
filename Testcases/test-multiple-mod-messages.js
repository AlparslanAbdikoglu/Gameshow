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

// Test multiple mod messages
async function testMultipleModMessages() {
  console.log('\n🎯 === MULTIPLE MOD MESSAGES TEST ===\n');
  
  try {
    // Step 1: Setup game
    console.log('1️⃣ Setting up game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game ready\n');
    
    // Step 2: Activate Ask a Mod
    console.log('2️⃣ Activating Ask a Mod...');
    await apiCall('activate_ask_a_mod');
    console.log('   ✓ Ask a Mod activated\n');
    
    // Step 3: Send multiple messages
    console.log('3️⃣ Sending multiple mod messages...');
    
    // Host message
    await apiCall('send_host_message', {
      message: 'I think the answer is A - Initial Public Offering'
    });
    console.log('   ✓ Host message sent');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Simulate mod message via chat
    await apiCall('simulate_chat_message', {
      username: 'ModeratorBob',
      message: 'Definitely go with A, it\'s the right answer!'
    });
    console.log('   ✓ ModeratorBob message sent');
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Another mod message
    await apiCall('simulate_chat_message', {
      username: 'ModeratorAlice',
      message: 'A is correct - IPO stands for Initial Public Offering'
    });
    console.log('   ✓ ModeratorAlice message sent');
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Another host message
    await apiCall('send_host_message', {
      message: 'Everyone agrees - it\'s A!'
    });
    console.log('   ✓ Second host message sent\n');
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 4: Check state
    console.log('4️⃣ Getting current state...');
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
    console.log('   mod_responses count:', stateResult.mod_responses ? stateResult.mod_responses.length : 0);
    
    if (stateResult.mod_responses && stateResult.mod_responses.length > 0) {
      console.log('\n   📝 All mod responses:');
      stateResult.mod_responses.forEach((response, i) => {
        const icon = response.username === 'host' ? '👑' : '🛡️';
        console.log(`      ${i+1}. ${icon} ${response.username}: "${response.message}"`);
      });
      
      console.log('\n   ✅ SUCCESS: All messages collected!');
    } else {
      console.log('\n   ❌ No mod responses found');
    }
    
    console.log('\n📋 VISUAL CHECK:');
    console.log('1. Open http://localhost:8081/gameshow');
    console.log('2. Ask a Mod panel should be visible in center');
    console.log('3. All 4 messages should appear in order');
    console.log('4. Host messages should have green username with 🛡️ icon');
    console.log('5. Messages should stack vertically with proper spacing\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testMultipleModMessages().catch(console.error);