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

// Test Host messages in Ask a Mod
async function testHostMessages() {
  console.log('\n🎯 === HOST MESSAGE IN ASK A MOD TEST ===\n');
  console.log('Testing that host messages appear in Ask a Mod panel...\n');
  
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
    const activateResult = await apiCall('activate_ask_a_mod');
    console.log('   ✓ Ask a Mod activated\n');
    
    // Step 3: Send HOST message
    console.log('3️⃣ Sending HOST message...');
    const hostResult = await apiCall('send_host_message', {
      message: 'The answer is definitely A - Initial Public Offering'
    });
    console.log('   Result:', JSON.stringify(hostResult, null, 2).substring(0, 200));
    
    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 4: Check state
    console.log('\n4️⃣ Getting current state...');
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
      console.log('\n   📝 Mod responses received:');
      stateResult.mod_responses.forEach((response, i) => {
        console.log(`      ${i+1}. ${response.username}: "${response.message}"`);
      });
      
      // Check if host message is in there
      const hostResponse = stateResult.mod_responses.find(r => r.username === 'host');
      if (hostResponse) {
        console.log('\n   ✅ SUCCESS: Host message found in mod responses!');
      } else {
        console.log('\n   ❌ ISSUE: Host message not found in mod responses');
      }
    } else {
      console.log('\n   ❌ No mod responses found');
    }
    
    console.log('\n📋 CHECKLIST:');
    console.log('1. Open http://localhost:8081/gameshow');
    console.log('2. Check if Ask a Mod panel is visible');
    console.log('3. Look for host message in the panel');
    console.log('4. Message should show: "host: The answer is definitely A - Initial Public Offering"');
    console.log('5. Host username should be in green with 🛡️ icon\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testHostMessages().catch(console.error);