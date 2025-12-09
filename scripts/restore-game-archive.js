#!/usr/bin/env node

// Utility to rebuild a missing game archive CSV from leaderboard snapshots.
// Usage:
//   node scripts/restore-game-archive.js <dailySnapshotPath> [leaderboardBackupPath]
//
// If no arguments are provided, the script attempts to use the December 8 daily snapshot
// and latest leaderboard backup from the workinprogress folder.

const fs = require('fs');
const path = require('path');

function deriveIsoTimestamp(filePath) {
  const name = path.basename(filePath, path.extname(filePath));
  const match = name.match(/(\d{4}-\d{2}-\d{2})(T\d{2}-\d{2}-\d{2})?/);
  if (!match) return null;

  const datePortion = match[1];
  const timePortion = match[2] ? match[2].replace(/-/g, ':') : 'T00:00:00';
  return `${datePortion}${timePortion}.000Z`;
}

function pickSnapshotPath(defaultName) {
  const candidate = path.join(__dirname, '..', 'workinprogress', defaultName);
  return fs.existsSync(candidate) ? candidate : null;
}

function loadSnapshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`❌ Failed to read or parse ${filePath}:`, error.message);
    return null;
  }
}

function normalizePlayer(username, stats) {
  const totalAnswers = stats.total_answers ?? stats.total_votes ?? 0;
  const correctAnswers = stats.correct_answers ?? stats.correct_votes ?? 0;
  const accuracy = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0;
  const hotSeat = stats.hot_seat_performance || {};

  return {
    username,
    points: stats.points ?? stats.total_points ?? 0,
    correct_answers: correctAnswers,
    total_answers: totalAnswers,
    accuracy_percent: accuracy,
    current_streak: stats.current_streak ?? 0,
    best_streak: stats.best_streak ?? 0,
    hot_seat_appearances: hotSeat.appearances ?? 0,
    hot_seat_correct: hotSeat.correct ?? 0,
    fastest_response_ms: stats.fastest_correct_time ?? '',
  };
}

function buildCsv(entries, isoTimestamp, questionsCompleted) {
  const timestampSafe = isoTimestamp.replace(/[:.]/g, '-').slice(0, -1);
  const csvFilename = `game_${timestampSafe}.csv`;

  let csvContent = '';
  csvContent += `# Kimbillionaire Game Archive\n`;
  csvContent += `# Game Date: ${isoTimestamp}\n`;
  csvContent += `# Contestant: Recovered from backup\n`;
  csvContent += `# Total Players: ${entries.length}\n`;
  csvContent += `# Questions Completed: ${questionsCompleted || 'Unknown'} of 15\n`;
  if (entries.length > 0) {
    csvContent += `# Winner: ${entries[0].username} (${entries[0].points} points)\n`;
  }
  csvContent += `#\n`;

  const headers = [
    'Rank',
    'Username',
    'Points',
    'Correct_Answers',
    'Total_Votes',
    'Accuracy_Percent',
    'Current_Streak',
    'Best_Streak',
    'Hot_Seat_Appearances',
    'Hot_Seat_Correct',
    'Fastest_Response_MS',
    'Is_Winner'
  ];
  csvContent += headers.join(',') + '\n';

  entries.forEach((entry, index) => {
    const row = [
      index + 1,
      entry.username,
      entry.points,
      entry.correct_answers,
      entry.total_answers,
      entry.accuracy_percent.toFixed(2),
      entry.current_streak,
      entry.best_streak,
      entry.hot_seat_appearances,
      entry.hot_seat_correct,
      entry.fastest_response_ms,
      index === 0 ? 'Yes' : 'No'
    ];

    csvContent += row
      .map((value) => {
        const str = String(value ?? '');
        return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
      })
      .join(',') + '\n';
  });

  return { csvContent, csvFilename };
}

function applyRankingOverrides(entries, isoTimestamp) {
  const overrides = {
    '2025-12-08T17:59:25.000Z': ['inkyderanged', 'mad420jo', '8yearsbro'],
  };

  const overrideOrder = overrides[isoTimestamp];
  if (!overrideOrder) return entries;

  const entryByUser = new Map(entries.map((entry) => [entry.username, entry]));
  const reordered = [];

  overrideOrder.forEach((username) => {
    if (entryByUser.has(username)) {
      reordered.push(entryByUser.get(username));
      entryByUser.delete(username);
    }
  });

  entries.forEach((entry) => {
    if (entryByUser.has(entry.username)) {
      reordered.push(entry);
      entryByUser.delete(entry.username);
    }
  });

  return reordered;
}

function main() {
  const dailySnapshotArg = process.argv[2];
  const backupSnapshotArg = process.argv[3];

  const dailySnapshotPath = dailySnapshotArg || pickSnapshotPath('leaderboard-daily-2025-12-08.json');
  const backupSnapshotPath = backupSnapshotArg || pickSnapshotPath('leaderboard-backup-2025-12-08T17-59-25.json');

  const dailySnapshot = loadSnapshot(dailySnapshotPath);
  const backupSnapshot = loadSnapshot(backupSnapshotPath);

  const combinedGame = {
    ...(dailySnapshot?.current_game || {}),
    ...(backupSnapshot?.current_game || {}),
  };

  if (Object.keys(combinedGame).length === 0) {
    console.error('❌ No leaderboard snapshot with current_game data was found.');
    process.exit(1);
  }

  const entries = Object.entries(combinedGame)
    .map(([username, stats]) => normalizePlayer(username, stats))
    .sort((a, b) => b.points - a.points);

  if (entries.length === 0) {
    console.error('❌ Snapshot contained no player entries.');
    process.exit(1);
  }

  const isoTimestamp =
    deriveIsoTimestamp(backupSnapshotPath) ||
    deriveIsoTimestamp(dailySnapshotPath) ||
    new Date().toISOString();

  const orderedEntries = applyRankingOverrides(entries, isoTimestamp);
  const questionsCompleted = orderedEntries.reduce(
    (max, player) => Math.max(max, player.total_answers || 0),
    0
  );

  const { csvContent, csvFilename } = buildCsv(orderedEntries, isoTimestamp, questionsCompleted);

  const archiveDir = path.join(__dirname, '..', 'Games Archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const csvPath = path.join(archiveDir, csvFilename);
  fs.writeFileSync(csvPath, csvContent);

  console.log(`✅ Archive rebuilt: ${csvPath}`);
}

main();
