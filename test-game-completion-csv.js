const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing Game Completion & CSV Export\n');

// Helper function to make HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8081,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function testGameCompletion() {
  try {
    console.log('📋 Starting game completion test...\n');
    
    // Step 1: Reset game to clean state
    console.log('1️⃣ Resetting game to clean state...');
    await makeRequest('POST', '/api/control', { action: 'reset_game' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Set contestant
    console.log('2️⃣ Setting contestant...');
    await makeRequest('POST', '/api/control', { 
      action: 'set_contestant', 
      name: 'Test Player' 
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 3: Start game
    console.log('3️⃣ Starting game...');
    await makeRequest('POST', '/api/control', { action: 'start_game' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 4: Skip to question 14 (to test question 15 completion)
    console.log('4️⃣ Advancing to question 14...');
    const state = await makeRequest('GET', '/api/state');
    
    // We need to manually set the game state to question 14
    // For testing purposes, we'll simulate advancing through questions
    for (let i = 0; i < 14; i++) {
      console.log(`   Advancing to question ${i + 1}...`);
      await makeRequest('POST', '/api/control', { action: 'next_question' });
      await new Promise(resolve => setTimeout(resolve, 200));
      await makeRequest('POST', '/api/control', { action: 'show_question' });
      await new Promise(resolve => setTimeout(resolve, 200));
      await makeRequest('POST', '/api/control', { action: 'show_answers' });
      await new Promise(resolve => setTimeout(resolve, 200));
      await makeRequest('POST', '/api/control', { 
        action: 'set_selected_answer', 
        answerIndex: 0 
      });
      await makeRequest('POST', '/api/control', { action: 'lock_answer' });
      await new Promise(resolve => setTimeout(resolve, 200));
      await makeRequest('POST', '/api/control', { action: 'reveal_answer' });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Step 5: Now we're at question 14, advance to question 15
    console.log('5️⃣ Moving to final question (15)...');
    await makeRequest('POST', '/api/control', { action: 'next_question' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await makeRequest('POST', '/api/control', { action: 'show_question' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await makeRequest('POST', '/api/control', { action: 'show_answers' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 6: Lock and reveal answer for question 15
    console.log('6️⃣ Revealing answer for question 15 (should trigger game completion)...');
    await makeRequest('POST', '/api/control', { 
      action: 'set_selected_answer', 
      answerIndex: 0 
    });
    await makeRequest('POST', '/api/control', { action: 'lock_answer' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // This should trigger game completion
    await makeRequest('POST', '/api/control', { action: 'reveal_answer' });
    
    // Wait for game completion and CSV export
    console.log('⏳ Waiting for game completion and CSV export...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 7: Check if game_completed flag is set
    console.log('7️⃣ Checking game completion status...');
    const finalState = await makeRequest('GET', '/api/state');
    
    if (finalState.game_completed) {
      console.log('  ✅ Game marked as completed!');
    } else {
      console.log('  ❌ Game NOT marked as completed');
    }
    
    // Step 8: Check if CSV file was created in Games Archive
    console.log('8️⃣ Checking for CSV export in Games Archive...');
    const archiveDir = path.join(__dirname, 'Games Archive');
    
    if (fs.existsSync(archiveDir)) {
      const files = fs.readdirSync(archiveDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));
      
      if (csvFiles.length > 0) {
        console.log(`  ✅ Found ${csvFiles.length} CSV file(s):`);
        csvFiles.forEach(file => {
          const stats = fs.statSync(path.join(archiveDir, file));
          console.log(`     - ${file} (${stats.size} bytes)`);
        });
        
        // Read and display content of most recent CSV
        if (csvFiles.length > 0) {
          const latestFile = csvFiles[csvFiles.length - 1];
          console.log(`\n  📄 Contents of ${latestFile}:`);
          const content = fs.readFileSync(path.join(archiveDir, latestFile), 'utf8');
          const lines = content.split('\n').slice(0, 10);
          lines.forEach(line => console.log(`     ${line}`));
          if (content.split('\n').length > 10) {
            console.log(`     ... (${content.split('\n').length - 10} more lines)`);
          }
        }
      } else {
        console.log('  ⚠️ No CSV files found in Games Archive');
      }
    } else {
      console.log('  ❌ Games Archive directory does not exist');
    }
    
    // Step 9: Check if current_game leaderboard is preserved
    console.log('\n9️⃣ Checking if current_game leaderboard is preserved...');
    const leaderboard = await makeRequest('GET', '/api/leaderboard');
    
    if (leaderboard.current_game && leaderboard.current_game.length > 0) {
      console.log('  ✅ Current game leaderboard still has data:');
      console.log(`     Players: ${leaderboard.current_game.length}`);
      if (leaderboard.current_game[0]) {
        console.log(`     Top player: ${leaderboard.current_game[0].username} with ${leaderboard.current_game[0].points} points`);
      }
    } else {
      console.log('  ⚠️ Current game leaderboard is empty');
    }
    
    console.log('\n🎯 Summary: Game completion and CSV export test complete');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testGameCompletion();