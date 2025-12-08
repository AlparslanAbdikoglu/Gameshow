process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_RUNTIME = 'true';

const test = require('node:test');
const assert = require('node:assert');

const bridge = require('../bridge-server');

test('current game leaderboard exposes at least the top 10 players', () => {
  bridge.leaderboardSettings.display_count = 7;

  bridge.leaderboardData.current_game = {};
  for (let i = 1; i <= 12; i += 1) {
    bridge.leaderboardData.current_game[`player${i}`] = {
      points: 200 - i,
      total_answers: 0,
      total_votes: 0,
      correct_answers: 0,
      current_streak: 0,
      best_streak: 0
    };
  }

  const stats = bridge.getLeaderboardStats();

  assert.strictEqual(stats.current_game.length, 10);
  assert.deepStrictEqual(
    stats.current_game.slice(0, 3).map((entry) => entry.displayRank),
    [1, 2, 3]
  );
});
