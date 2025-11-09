#!/usr/bin/env node

/**
 * Utility helpers for working with previous winners data.
 *
 * Usage:
 *   node convert-winners-list.js --merge     # merge work-in-progress files
 *   node convert-winners-list.js --convert-sample  # rebuild sample winners list (legacy helper)
 */

const fs = require('fs');
const path = require('path');

const ROOT_FILE = path.join(__dirname, 'previous-winners.json');
const WORK_DIR = path.join(__dirname, 'workinprogress', 'previous-winners');

const args = new Set(process.argv.slice(2));

if (args.has('--merge')) {
  mergeWorkInProgress();
} else if (args.has('--convert-sample')) {
  convertSampleList();
} else {
  printUsage();
}

function printUsage() {
  console.log('Previous Winners Helper');
  console.log('-------------------------');
  console.log('Commands:');
  console.log('  --merge             Merge JSON files in workinprogress/previous-winners into previous-winners.json');
  console.log('  --convert-sample    Regenerate the legacy demo winners list (overwrites previous-winners.json)');
  console.log('\nExample: node convert-winners-list.js --merge');
}

function loadJson(filePath, fallback = { winners: [], metadata: {} }) {
  try {
    if (!fs.existsSync(filePath)) {
      return JSON.parse(JSON.stringify(fallback));
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error.message);
    return JSON.parse(JSON.stringify(fallback));
  }
}

function normaliseWinner(winner) {
  if (!winner || typeof winner !== 'object') {
    return null;
  }
  const clone = { ...winner };
  clone.username = (clone.username || '').toLowerCase();
  if (clone.fastest_correct_time !== undefined && clone.fastest_correct_time !== null && clone.fastest_correct_time !== '') {
    const numeric = Number(clone.fastest_correct_time);
    clone.fastest_correct_time = Number.isFinite(numeric) ? numeric : null;
  } else {
    clone.fastest_correct_time = null;
  }
  return clone;
}

function mergeWorkInProgress() {
  const rootData = loadJson(ROOT_FILE);
  const winnerMap = new Map();
  const metadataNotes = new Set();
  const metadataSourceRanges = new Set();
  let lastUpdatedTs = 0;
  let totalSourceEntries = 0;
  let totalPlayersMeta = 0;

  function ingestMetadata(meta) {
    if (!meta || typeof meta !== 'object') {
      return;
    }
    if (meta.last_updated) {
      const ts = new Date(meta.last_updated).getTime();
      if (!Number.isNaN(ts)) {
        lastUpdatedTs = Math.max(lastUpdatedTs, ts);
      }
    }
    if (meta.note) {
      metadataNotes.add(meta.note.trim());
    }
    if (meta.source_range) {
      metadataSourceRanges.add(meta.source_range.trim());
    }
    if (typeof meta.total_source_entries === 'number') {
      totalSourceEntries += meta.total_source_entries;
    }
    if (typeof meta.total_players === 'number') {
      totalPlayersMeta = Math.max(totalPlayersMeta, meta.total_players);
    }
  }

  function addWinners(list, sourceLabel) {
    if (!Array.isArray(list)) {
      return;
    }
    for (const entry of list) {
      const normalised = normaliseWinner(entry);
      if (!normalised) continue;
      const identifier = normalised.game_id || `${normalised.date || 'unknown'}_${normalised.username}`;
      if (winnerMap.has(identifier)) {
        console.warn(`Overwriting winner ${identifier} from ${sourceLabel}`);
      }
      winnerMap.set(identifier, normalised);
    }
  }

  ingestMetadata(rootData.metadata);
  addWinners(rootData.winners, 'root file');

  if (fs.existsSync(WORK_DIR)) {
    const files = fs.readdirSync(WORK_DIR).filter((name) => name.endsWith('.json'));
    files.sort();
    for (const fileName of files) {
      const filePath = path.join(WORK_DIR, fileName);
      const data = loadJson(filePath, null);
      if (!data) continue;
      ingestMetadata(data.metadata);
      addWinners(data.winners, fileName);
    }
  } else {
    console.warn('Work-in-progress directory not found, nothing to merge.');
  }

  const mergedWinners = Array.from(winnerMap.values()).sort((a, b) => {
    const aTime = new Date(a.date || 0).getTime();
    const bTime = new Date(b.date || 0).getTime();
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });

  const metadata = { ...(rootData.metadata || {}) };
  metadata.total_games = mergedWinners.length;
  const distinctUsernames = new Set(mergedWinners.map((w) => w.username));
  metadata.total_players = Math.max(distinctUsernames.size, totalPlayersMeta);
  if (totalSourceEntries > 0) {
    metadata.total_source_entries = totalSourceEntries;
  }
  if (metadataNotes.size > 0) {
    metadata.note = Array.from(metadataNotes).join(' | ');
  }
  if (metadataSourceRanges.size > 0) {
    metadata.source_range = Array.from(metadataSourceRanges).join(' | ');
  }
  if (mergedWinners.length > 0) {
    const mostRecent = mergedWinners.reduce((max, winner) => {
      const ts = new Date(winner.date || 0).getTime();
      return Number.isFinite(ts) ? Math.max(max, ts) : max;
    }, 0);
    lastUpdatedTs = Math.max(lastUpdatedTs, mostRecent);
  }
  if (lastUpdatedTs > 0) {
    metadata.last_updated = new Date(lastUpdatedTs).toISOString();
  }

  const payload = {
    winners: mergedWinners,
    metadata,
  };

  fs.writeFileSync(ROOT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Merged ${winnerMap.size} winner records into ${ROOT_FILE}`);
}

function convertSampleList() {
  const simpleList = [
    'Kerviz',
    'ottokar16',
    'imsin__',
    'el_boris',
    'pipelinsk',
    'xeenonLion',
    'gabo0o93',
    'domchec',
    'mannaka02',
    'inkyDeranged',
  ];

  const winners = simpleList.map((username, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    return {
      game_id: `game_${Date.now() - index * 86400000}_${username.toLowerCase()}`,
      date: date.toISOString(),
      username: username,
      final_points: 1000 + index * 50,
      correct_answers: 10 + index,
      total_answers: 12,
      accuracy: Math.round(((10 + index) / 12) * 100),
      best_streak: 8 + index,
      fastest_correct_time: 10000 - index * 500,
      hot_seat_appearances: 0,
      hot_seat_correct: 0,
      questions_completed: 12,
    };
  });

  const payload = {
    winners,
    metadata: {
      total_games: winners.length,
      last_updated: new Date().toISOString(),
    },
  };

  fs.writeFileSync(ROOT_FILE, JSON.stringify(payload, null, 2));
  console.log('✅ Converted previous winners list!');
  console.log(`📁 Saved to: ${ROOT_FILE}`);
  console.log(`🏆 Total winners: ${winners.length}`);
  console.log('\nFirst winner entry:');
  console.log(JSON.stringify(winners[0], null, 2));
}
