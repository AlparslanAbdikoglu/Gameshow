const http = require('http');

console.log('🧪 Testing Leaderboard Streak Display & Field Mapping\n');

function fetchLeaderboard() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:8081/api/leaderboard', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testLeaderboardStreaks() {
  try {
    // Fetch leaderboard data
    console.log('📊 Fetching leaderboard data...');
    const data = await fetchLeaderboard();
    
    console.log('\n✅ TEST 1: Current Game Leaderboard');
    console.log('Should show: current_streak, total_votes');
    if (data.current_game && data.current_game.length > 0) {
      const player = data.current_game[0];
      console.log(`  Username: ${player.username}`);
      console.log(`  Current Streak: ${player.current_streak} (should be defined)`);
      console.log(`  Best Streak: ${player.best_streak}`);
      console.log(`  Total Votes: ${player.total_votes} (should match total_answers)`);
      console.log(`  Correct Answers: ${player.correct_answers}`);
      
      // Verify fields exist
      if (player.current_streak !== undefined) {
        console.log('  ✅ current_streak field exists');
      } else {
        console.log('  ❌ current_streak field missing!');
      }
      
      if (player.total_votes !== undefined) {
        console.log('  ✅ total_votes field exists');
      } else {
        console.log('  ❌ total_votes field missing!');
      }
    } else {
      console.log('  ⚠️ No players in current game');
    }
    
    console.log('\n✅ TEST 2: Daily Leaderboard');
    console.log('Should show: best_streak only, current_streak should be 0');
    if (data.daily && data.daily.length > 0) {
      const player = data.daily[0];
      console.log(`  Username: ${player.username}`);
      console.log(`  Current Streak: ${player.current_streak} (should be 0 or undefined)`);
      console.log(`  Best Streak: ${player.best_streak} (should be defined)`);
      console.log(`  Total Votes: ${player.total_votes}`);
      
      if (player.best_streak !== undefined) {
        console.log('  ✅ best_streak field exists');
      } else {
        console.log('  ❌ best_streak field missing!');
      }
      
      if (!player.current_streak || player.current_streak === 0) {
        console.log('  ✅ current_streak is 0 or undefined as expected');
      } else {
        console.log('  ⚠️ current_streak should be 0 for non-current game periods');
      }
    } else {
      console.log('  ⚠️ No players in daily leaderboard');
    }
    
    console.log('\n✅ TEST 3: All-Time Leaderboard');
    console.log('Should show: best_streak only');
    if (data.all_time && data.all_time.length > 0) {
      const player = data.all_time[0];
      console.log(`  Username: ${player.username}`);
      console.log(`  Best Streak: ${player.best_streak} (should be defined)`);
      console.log(`  Current Streak: ${player.current_streak} (should be 0)`);
      
      if (player.best_streak !== undefined) {
        console.log('  ✅ best_streak field exists');
      } else {
        console.log('  ❌ best_streak field missing!');
      }
      
      if (!player.current_streak || player.current_streak === 0) {
        console.log('  ✅ current_streak correctly set to 0');
      } else {
        console.log('  ⚠️ current_streak should be 0 for all_time');
      }
    } else {
      console.log('  ⚠️ No players in all-time leaderboard');
    }
    
    console.log('\n🎯 Summary: Leaderboard streak display test complete');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testLeaderboardStreaks();