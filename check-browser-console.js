#!/usr/bin/env node

const WebSocket = require('ws');

console.log('🎯 Testing Giveaway Winner Display Size & Visibility...');
const ws = new WebSocket('ws://localhost:8081');

ws.on('open', () => {
  console.log('✅ Connected to bridge server');
  
  // Register as browser source to mimic OBS browser source
  ws.send(JSON.stringify({
    type: 'register',
    client: 'test_browser_source'
  }));
  
  setTimeout(() => {
    console.log('\n🏆 Sending giveaway_winners message with proper format...');
    
    // Send a properly formatted giveaway_winners message
    ws.send(JSON.stringify({
      type: 'giveaway_winners',
      winners: [
        { 
          username: 'TestWinner1', 
          weight: 3,
          entryMethod: 'chat',
          announcement: 'TestWinner1 won the giveaway!' 
        },
        { 
          username: 'TestWinner2', 
          weight: 1,
          entryMethod: 'chat',
          announcement: 'TestWinner2 won the giveaway!' 
        }
      ],
      timestamp: Date.now()
    }));
    
    console.log('📨 Sent giveaway_winners message to test winner display');
    console.log('\n🔍 CHECK OBS BROWSER SOURCE: http://localhost:8081/gameshow');
    console.log('\n👀 Look for:');
    console.log('   - Large "WINNERS" text (should be 84px font size)');
    console.log('   - Winner names in large text (should be 72px font size)');
    console.log('   - Keyword section should be hidden');
    console.log('   - Entries section should be hidden');
    console.log('   - Winner section should be visible with white text');
    console.log('\n🐞 If winners appear small, check browser console (F12) for:');
    console.log('   - "🏆 Showing giveaway winners:" message');
    console.log('   - "🔍 DOM Elements found:" with all elements true');
    console.log('   - "🏆 Added WINNERS header with forced large styling"');
    console.log('   - "🎉 Added winner X: [name] with forced large styling"');
    
    setTimeout(() => {
      console.log('\n🧪 Test completed. Winner display should now be visible.');
      console.log('💡 If text is still small, CSS may be overriding inline styles.');
      ws.close();
    }, 3000);
  }, 1000);
});

ws.on('close', () => {
  console.log('\n🔌 Test connection closed');
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
