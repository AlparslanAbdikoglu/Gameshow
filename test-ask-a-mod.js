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

// Test Ask a Mod functionality
async function testAskAMod() {
  console.log('=== Ask a Mod Test Suite ===\n');
  
  try {
    // Step 1: Reset and setup game
    console.log('1. Setting up fresh game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game setup complete\n');
    
    // Step 2: Activate Ask a Mod
    console.log('2. Activating Ask a Mod...');
    const activateResult = await apiCall('activate_ask_a_mod');
    if (activateResult.success && activateResult.state.ask_a_mod_active) {
      console.log('   ✓ Ask a Mod activated successfully');
    } else {
      console.log('   ✗ Failed to activate Ask a Mod');
      return;
    }
    
    // Step 3: Send test mod responses
    console.log('\n3. Sending mod responses...');
    const mods = [
      { username: 'kagewins', message: 'I believe the answer is B based on the context' },
      { username: 'ch0nsi', message: 'B looks correct to me too' },
      { username: 'mandalo__', message: 'Definitely B is the right answer' },
      { username: 'host', message: 'I agree with everyone, B is correct' }
    ];
    
    for (const mod of mods) {
      const result = await apiCall('send_mod_message', mod);
      if (result.success) {
        console.log(`   ✓ Response from ${mod.username} sent`);
      } else {
        console.log(`   ✗ Failed to send response from ${mod.username}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
    }
    
    // Step 4: Check collected responses
    console.log('\n4. Checking collected responses...');
    const stateResult = await apiCall('get_state');
    const state = stateResult.state || stateResult;
    
    console.log(`   Ask a Mod Active: ${state.ask_a_mod_active}`);
    console.log(`   Responses collected: ${state.mod_responses ? state.mod_responses.length : 0}`);
    
    if (state.mod_responses && state.mod_responses.length > 0) {
      console.log('\n   Mod Responses:');
      state.mod_responses.forEach(resp => {
        console.log(`   - ${resp.username}: "${resp.message}"`);
      });
    }
    
    // Step 5: Wait for timer to expire (or manually end)
    console.log('\n5. Waiting for Ask a Mod session to end...');
    console.log('   (30-second timer or until manually ended)');
    
    // Check periodically for session end
    let sessionActive = true;
    let checks = 0;
    const maxChecks = 35; // Check for up to 35 seconds
    
    while (sessionActive && checks < maxChecks) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const checkResult = await apiCall('get_state');
      const checkState = checkResult.state || checkResult;
      sessionActive = checkState.ask_a_mod_active;
      checks++;
      
      if (checks % 5 === 0) {
        console.log(`   Still active after ${checks} seconds...`);
      }
    }
    
    if (!sessionActive) {
      console.log('   ✓ Ask a Mod session ended');
    } else {
      console.log('   ✗ Session still active after timeout');
    }
    
    // Final state check
    console.log('\n6. Final state check...');
    const finalResult = await apiCall('get_state');
    const finalState = finalResult.state || finalResult;
    
    console.log(`   Total responses: ${finalState.mod_responses ? finalState.mod_responses.length : 0}`);
    console.log(`   Revote active: ${finalState.is_revote_active || false}`);
    console.log(`   Poll active: ${finalState.audience_poll_active || false}`);
    
    console.log('\n=== Test Complete ===');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testAskAMod().catch(console.error);