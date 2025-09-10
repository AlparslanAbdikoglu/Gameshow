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

// Interactive Ask a Mod test with real-time updates
async function interactiveTest() {
  console.log('\n🎮 === INTERACTIVE ASK A MOD TEST ===\n');
  console.log('Open browser at: http://localhost:8081/gameshow');
  console.log('Watch the mod response panel appear in the center!\n');
  
  try {
    // Step 1: Setup game
    console.log('📌 Step 1: Setting up game...');
    await apiCall('reset_game');
    await apiCall('start_game');
    await apiCall('show_question');
    await apiCall('show_answers');
    console.log('   ✓ Game ready with question displayed\n');
    
    // Step 2: Activate Ask a Mod
    console.log('📌 Step 2: Activating Ask a Mod lifeline...');
    const activateResult = await apiCall('activate_ask_a_mod');
    console.log('   ✓ Ask a Mod panel should now be visible!\n');
    
    // Step 3: Send mod messages with delays for dramatic effect
    console.log('📌 Step 3: Sending mod responses (watch the panel!)...\n');
    
    const mods = [
      { username: 'kagewins', message: 'Looking at this carefully, I think the answer is B', delay: 2000 },
      { username: 'ch0nsi', message: 'B - Initial Public Offering for sure!', delay: 3000 },
      { username: 'mandalo__', message: 'Definitely B! IPO stands for Initial Public Offering', delay: 2500 },
      { username: 'thatboidhtx', message: 'I agree with the other mods - B is correct', delay: 2000 },
      { username: 'host', message: 'Based on everyone\'s input, B seems to be the consensus', delay: 2000 }
    ];
    
    for (const mod of mods) {
      console.log(`   💬 ${mod.username} is typing...`);
      await new Promise(resolve => setTimeout(resolve, mod.delay));
      
      const result = await apiCall('send_mod_message', {
        username: mod.username,
        message: mod.message
      });
      
      console.log(`   ✓ ${mod.username}: "${mod.message}"`);
      console.log(`      (Message should appear in the panel now!)\n`);
    }
    
    // Step 4: Check final state
    console.log('📌 Step 4: Session status...');
    console.log('   ⏱️  Timer counting down from 30 seconds');
    console.log('   📝 All 5 mod responses should be visible in the panel');
    console.log('   🎯 Panel should be centered on screen with improved styling\n');
    
    console.log('📌 Visual checklist:');
    console.log('   □ Panel is 500px wide (not tiny 220px)');
    console.log('   □ Text is 14px font size (readable)');
    console.log('   □ No text bleeding outside panel borders');
    console.log('   □ Messages wrap properly for long text');
    console.log('   □ Timer shows countdown in top-right of panel');
    console.log('   □ Mod usernames are in green with shield icon');
    console.log('   □ Panel can scroll if many messages\n');
    
    console.log('⏳ Waiting for session to end (about 20 more seconds)...\n');
    
    // Wait for session to end
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    console.log('✅ === TEST COMPLETE ===');
    console.log('The Ask a Mod panel should have closed after 30 seconds.');
    console.log('Check if all styling improvements are working correctly!\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the interactive test
console.log('Starting interactive test in 3 seconds...');
console.log('Make sure you have the browser open at http://localhost:8081/gameshow');
setTimeout(interactiveTest, 3000);