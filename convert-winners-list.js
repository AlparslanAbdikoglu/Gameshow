#!/usr/bin/env node

/**
 * Convert simple username list to proper previous winners format
 * Usage: node convert-winners-list.js
 */

const fs = require('fs');
const path = require('path');

// Your simple list
const simpleList = [
  "Kerviz",
  "ottokar16",
  "imsin__",
  "el_boris",
  "pipelinsk",
  "xeenonLion",
  "gabo0o93",
  "domchec",
  "mannaka02",
  "inkyDeranged"
];

// Convert to proper format
const winners = simpleList.map((username, index) => {
  // Create dates going backwards from now (newest first)
  const date = new Date();
  date.setDate(date.getDate() - index); // Each winner from a different day
  
  return {
    game_id: `game_${Date.now() - (index * 86400000)}_${username.toLowerCase()}`,
    date: date.toISOString(),
    username: username,
    final_points: 1000 + (index * 50), // Sample points
    correct_answers: 10 + index,
    total_answers: 12,
    accuracy: Math.round(((10 + index) / 12) * 100),
    best_streak: 8 + index,
    fastest_correct_time: 10000 - (index * 500),
    hot_seat_appearances: 0,
    hot_seat_correct: 0,
    questions_completed: 12
  };
});

// Create proper structure
const properFormat = {
  winners: winners,
  metadata: {
    total_games: winners.length,
    last_updated: new Date().toISOString()
  }
};

// Save to file
const outputPath = path.join(__dirname, 'previous-winners.json');
fs.writeFileSync(outputPath, JSON.stringify(properFormat, null, 2));

console.log('✅ Converted previous winners list!');
console.log(`📁 Saved to: ${outputPath}`);
console.log(`🏆 Total winners: ${winners.length}`);
console.log('\nFirst winner entry:');
console.log(JSON.stringify(winners[0], null, 2));
