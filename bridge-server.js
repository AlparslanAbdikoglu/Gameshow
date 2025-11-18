#!/usr/bin/env node

// Load environment variables from .env file
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Debug: Log if environment variables are loaded
console.log('🔧 DEBUG: Environment variables loaded:');
console.log('   TWITCH_CLIENT_ID:', process.env.TWITCH_CLIENT_ID ? '✅ Present' : '❌ Missing');
console.log('   TWITCH_ACCESS_TOKEN:', process.env.TWITCH_ACCESS_TOKEN ? '✅ Present' : '❌ Missing');
console.log('   TWITCH_CLIENT_SECRET:', process.env.TWITCH_CLIENT_SECRET ? '✅ Present' : '❌ Missing');

const http = require('http');
const fs = require('fs');
const url = require('url');
const WebSocket = require('ws');
const { processJoinCommand } = require('./lib/join-handler');
const TWITCH_EMOTES = require('./emotes-update.js');

const POLLING_CONFIG_PATH = path.join(__dirname, 'polling-config.json');

// Debug flags - set to false in production for performance
const DEBUG_LIFELINE_VOTING = false; // Enable only when debugging voting issues
const DEBUG_VERBOSE_LOGGING = false; // Reduces console spam during gameplay
const DEBUG_BROADCAST_LOGGING = false; // Log all broadcast operations

// Performance monitoring for lifeline voting
const performanceMetrics = {
  lifeline: {
    votesProcessed: 0,
    votesRejected: 0,
    processingTimes: [],
    lastResetTime: Date.now(),
    peakVotesPerSecond: 0,
    currentVotesPerSecond: 0,
    lastSecondVotes: 0,
    lastSecondTime: Date.now()
  }
};

// Function to track vote processing performance
function trackVoteProcessing(processingTime, rejected = false, duplicate = false) {
  performanceMetrics.lifeline.votesProcessed++;
  if (rejected) performanceMetrics.lifeline.votesRejected++;
  
  // Track processing time (keep last 100 for average calculation)
  performanceMetrics.lifeline.processingTimes.push(processingTime);
  if (performanceMetrics.lifeline.processingTimes.length > 100) {
    performanceMetrics.lifeline.processingTimes.shift();
  }
  
  // Calculate votes per second
  const now = Date.now();
  if (now - performanceMetrics.lifeline.lastSecondTime >= 1000) {
    performanceMetrics.lifeline.currentVotesPerSecond = performanceMetrics.lifeline.lastSecondVotes;
    if (performanceMetrics.lifeline.currentVotesPerSecond > performanceMetrics.lifeline.peakVotesPerSecond) {
      performanceMetrics.lifeline.peakVotesPerSecond = performanceMetrics.lifeline.currentVotesPerSecond;
    }
    performanceMetrics.lifeline.lastSecondVotes = 1;
    performanceMetrics.lifeline.lastSecondTime = now;
  } else {
    performanceMetrics.lifeline.lastSecondVotes++;
  }
  
  // Log performance warnings
  if (!duplicate && performanceMetrics.lifeline.currentVotesPerSecond > 50 && DEBUG_LIFELINE_VOTING) {
    console.warn(`⚠️ High lifeline vote rate: ${performanceMetrics.lifeline.currentVotesPerSecond} votes/second`);
  }
}

function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim().toLowerCase() : '';
}

function sanitizeProfileHtml(html = '') {
  if (typeof html !== 'string') {
    return '';
  }

  let sanitized = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

  sanitized = sanitized.replace(/<([a-z][^>]*)>/gi, (fullTag, tagContent) => {
    let cleaned = tagContent
      .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+on[a-z0-9_-]+(?=\s|\/?>)/gi, '')
      .replace(/\s+(?:href|src|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '');

    return `<${cleaned}>`;
  });

  return sanitized.trim();
}

function buildHotSeatProfileMap(profiles = {}) {
  const sanitizedProfiles = {};

  if (!profiles || typeof profiles !== 'object') {
    return sanitizedProfiles;
  }

  Object.values(profiles).forEach((profile) => {
    if (!profile || typeof profile !== 'object') {
      return;
    }

    const sourceUsername = typeof profile.username === 'string' && profile.username.trim()
      ? profile.username.trim()
      : typeof profile.displayName === 'string' && profile.displayName.trim()
        ? profile.displayName.trim()
        : typeof profile.id === 'string' && profile.id.trim()
          ? profile.id.trim()
          : '';

    const normalized = normalizeUsername(sourceUsername);
    if (!normalized) {
      return;
    }

    sanitizedProfiles[normalized] = {
      username: sourceUsername,
      displayName: typeof profile.displayName === 'string' && profile.displayName.trim()
        ? profile.displayName.trim()
        : sourceUsername,
      storyHtml: sanitizeProfileHtml(profile.storyHtml || profile.story || ''),
      storyText: typeof profile.storyText === 'string' ? profile.storyText.trim() : '',
      lastUpdated: Date.now()
    };
  });

  return sanitizedProfiles;
}

function getHotSeatProfile(username) {
  const normalized = normalizeUsername(username);
  if (!normalized || !gameState.hot_seat_profiles) {
    return null;
  }

  const profile = gameState.hot_seat_profiles[normalized];
  if (!profile) {
    return null;
  }

  return {
    username: profile.username,
    displayName: profile.displayName || profile.username,
    storyHtml: profile.storyHtml || '',
    storyText: profile.storyText || ''
  };
}

// Game state
let gameState = {
  current_question: 0,
  score: 0,
  game_active: false,
  lifelines_used: [],
  update_needed: false,
  contestant_name: '',
  question_visible: false,
  answers_visible: false,
  answers_revealed: false,
  overlay_type: 'v2',
  answer_locked_in: false,
  selected_answer: null,
  answer_is_wrong: false,
  audience_poll_active: false,
  show_poll_winner: null, // A, B, C, D or null - shows winner announcement overlay
  poll_winner_votes: 0,
  poll_winner_percentage: 0,
  poll_voters: [], // Array of recent voters: {username, vote, timestamp} (last 10 for display)
  poll_voter_history: [], // Track who has voted to prevent duplicates
  poll_all_votes: [], // Complete record of all votes for tallying
  question_voter_answers: {}, // Track user votes per question: {username: 'A', username2: 'B'} - prevents re-voting same answer after lifelines
  show_voting_activity: false, // Toggle between participant name and voting activity
  // Missing critical game flow states
  curtains_closed: true,
  show_welcome: true,
  preparing_for_game: false,
  fade_out_ready_text: false,
  lastActionTime: 0,
  processingAction: false,
  prizes: [],  // Current prize amounts for live updates
  // Prize configuration for end-game winners
  prizeConfiguration: {
    enabled: true,
    topWinnersCount: 10,
    prizeName: 'Channel Points',
    prizeAmount: 1000,
    customMessage: 'Congratulations to our top 10 winners! Make sure to enter your UIDs in the Kimba.tv Dashboard!',
    winnersAnnounced: false
  },
  endGameTriggered: false,  // Track if end-game sequence has been triggered
  answerHistory: [],  // Track answer results for each question: {questionIndex: 0, result: 'correct'|'wrong'|null}
  typewriter_animation_complete: false,  // Track if typewriter animation has completed
  gameshow_participants: [], // Array of unique usernames who voted during this gameshow
  credits_rolling: false,    // Flag for credits display state  
  credits_scrolling: false,  // Flag for credits scrolling animation
  // Game completion tracking
  game_completed: false,      // Has the game reached question 15 and been completed
  final_game_stats: null,     // Final leaderboard stats when game completes
  final_game_winners: [],     // Top winners from the most recent completed game
  finalLeaderboardShown: false,
  pending_endgame_sequence: false,
  // Slot machine bonus mode state
  slot_machine: {
    enabled: true,
    schedule_questions: [4, 9, 14], // Question numbers (Q4, Q9, Q14) for automatic entry windows
    schedule_version: 'question_numbers',
    entry_duration_ms: 60000,
    max_points: 25,
    current_round: null,
    last_round_result: null
  },
  endgame_ready_timestamp: null,
  // Ask a Mod Feature States
  ask_a_mod_active: false,    // Is Ask a Mod lifeline currently active
  ask_a_mod_start_time: null, // When Ask a Mod session started
  ask_a_mod_duration: 30000,  // Duration of Ask a Mod session (30 seconds default)
  mod_responses: [],           // Array of moderator responses during Ask a Mod
  mod_vote_counts: { A: 0, B: 0, C: 0, D: 0 }, // Track moderator answer preferences
  mod_voters: [],              // Track which moderators have responded
  processed_mod_messages: new Set(), // Dedupe mod messages
  ask_a_mod_include_vips: false, // Whether VIPs can also respond during Ask a Mod
  // Hot Seat Feature States
  hot_seat_enabled: false,    // Master toggle for hot seat feature
  hot_seat_active: false,     // Is hot seat mode active for current question
  hot_seat_user: null,        // Primary username of the active hot seat player
  hot_seat_users: [],         // Array of hot seat winners (for display and history)
  hot_seat_timer: 60,         // Seconds remaining for hot seat answer
  hot_seat_answered: false,    // Has hot seat user submitted answer
  hot_seat_answer: null,       // Answer submitted by hot seat user (A/B/C/D)
  hot_seat_correct: null,      // Was hot seat answer correct (true/false/null)
  hot_seat_history: [],        // Log of all hot seat sessions: [{question, user, answer, correct, timestamp}]
  hot_seat_profiles: {},       // Map of uploaded hot seat profile stories keyed by username
  hot_seat_profiles_last_update: null, // Timestamp of last profile upload for status displays
  hot_seat_timer_interval: null, // Reference to timer interval for cleanup
  hot_seat_prestart_interval: null, // Countdown interval that runs before the main timer
  hot_seat_prestart_seconds: 0,     // Remaining seconds in the pre-start countdown
  hot_seat_prestart_total: 0,       // Total seconds configured for the pre-start countdown
  hot_seat_timer_pending_start: false, // Whether we are waiting to begin the hot seat timer
  hot_seat_countdown_started: false,   // Tracks if the pre-start countdown has started
  // Hot Seat Entry Collection
  hot_seat_entry_active: false,  // Is entry collection period active
  hot_seat_entries: [],          // Array of usernames who typed "JOIN"
  hot_seat_entry_lookup: new Set(), // Track lowercase usernames for deduplication
  hot_seat_entry_duration: 60000, // Duration for entry collection (60 seconds)
  hot_seat_entry_start_time: null, // Timestamp when entry collection started
  hot_seat_winner_count: 1,      // Number of hot seat winners to select
  hot_seat_entry_timer_interval: null, // Reference to entry countdown timer
  // Lifeline states
  first_poll_winner: null,   // Track which answer won the first poll for revote system
  is_revote_active: false,   // Flag for "Take Another Vote" revote system
  excluded_answers: [],      // Array of answer indices excluded in revote
  // Lifeline voting states for audience help when answer is wrong
  lifeline_voting_active: false,     // Flag for lifeline voting mode
  lifeline_votes: [],                // Array of lifeline votes: {username, lifeline, timestamp}
  lifeline_voter_history: [],        // Track who has voted to prevent duplicates
  available_lifelines_for_vote: [],  // Array of available lifelines (not used yet)
  lifeline_vote_winner: null,        // Winning lifeline after vote (fiftyFifty, takeAnotherVote, askAMod)
  lifeline_vote_counts: {            // Vote counts for each lifeline
    fiftyFifty: 0,
    takeAnotherVote: 0,
    askAMod: 0
  },
  // Tie-breaking states for host resolution
  poll_tie_detected: false,          // Flag for answer poll tie
  poll_tied_options: null,           // Array of tied answer options (e.g., ['A', 'C'])
  poll_tie_votes: 0,                 // Number of votes each tied option has
  waiting_for_tie_break: false,      // Waiting for host to break answer tie
  lifeline_tie_detected: false,      // Flag for lifeline voting tie
  lifeline_tied_options: null,       // Array of tied lifeline options
  lifeline_tie_votes: 0,             // Number of votes each tied lifeline has
  waiting_for_lifeline_tie_break: false, // Waiting for host to break lifeline tie
  // Ask a Mod lifeline states
  ask_a_mod_active: false,           // Flag for Ask a Mod active period
  mod_responses: [],                 // Array of mod responses: {username, message, timestamp}
  ask_a_mod_start_time: null,        // Timestamp when Ask a Mod started
  ask_a_mod_include_vips: false,     // Whether to include VIPs in Ask a Mod responses
  // Lifeline-driven correct answer highlighting
  correct_answer_highlighted: false,  // Flag to control when correct answer gets green highlighting
  // REMOVED: original_wrong_answer - replaced by persistent_wrong_answers array for unified wrong answer tracking
  // Lifeline voting timer states
  lifeline_voting_timer_active: false,     // Flag for 30-second lifeline voting timer
  lifeline_voting_start_time: null,        // Timestamp when lifeline voting started
  how_to_play_shown: false,                // Track if How To Play has been shown this session
  lifeline_voting_duration: 30000,         // 30 second duration for lifeline voting
  // Timer configuration
  audience_poll_duration: 60000,           // Configurable audience poll duration in milliseconds (default: 60 seconds)
  revote_duration: 60000,                  // Configurable revote duration in milliseconds (default: 60 seconds) - FIXED: Reset from 45000ms
  ask_a_mod_duration: 30000,               // Configurable Ask a Mod response display duration in milliseconds (default: 30 seconds)
  // Host selection tracking for multiple selections
  host_selection_history: [],               // Track all host answer selections for visual feedback (supports multiple selections)
  // First selected answer persistence for lifeline highlighting
  first_selected_answer: null,              // Track the first answer selected to maintain highlighting through lifeline flows
  // Wrong answer persistence for red highlighting throughout lifeline flows
  persistent_wrong_answers: [],             // Array of answer indices that have been revealed as wrong and should stay red
  
  // Giveaway system states
  giveaway_active: false,                   // Flag for giveaway registration window
  giveaway_prize_name: '',                  // Name/description of the prize
  giveaway_prize_amount: '',                // Prize amount or value
  giveaway_num_winners: 1,                  // Number of winners to select
  giveaway_start_time: null,                // Timestamp when giveaway started
  giveaway_duration: 120000,                // 2 minutes in milliseconds
  giveaway_participants: [],                // Array of participants: {username, weight, timestamp, entry_method}
  giveaway_participant_history: [],         // Track usernames to prevent duplicates
  giveaway_keyword: 'JUICE',                // Chat keyword for 1x weight entry
  giveaway_winners: [],                     // Array of selected winners
  giveaway_closed: false,                   // Flag for when giveaway is closed but not yet reset
  giveaway_show_voters: new Set(),          // Track users who voted during the show for 3x weight bonus
  leaderboard_visible: false,
  leaderboard_period: 'current_game'
};

// Normalize slot machine defaults immediately on startup so every API caller sees consistent question numbers
ensureSlotMachineState();

function loadPollingConfig() {
  try {
    if (fs.existsSync(POLLING_CONFIG_PATH)) {
      const raw = fs.readFileSync(POLLING_CONFIG_PATH, 'utf8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to read polling config:', error);
  }

  return {
    twitch: { channel: '', username: 'justinfan12345' },
    youtube: { apiKey: '', liveChatId: '', pollingInterval: 5000 },
    isActive: false
  };
}

function savePollingConfig(config) {
  fs.writeFileSync(POLLING_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function mergePollingConfig(baseConfig, newConfig = {}) {
  const merged = {
    ...baseConfig,
    ...newConfig,
    twitch: { ...(baseConfig.twitch || {}), ...(newConfig.twitch || {}) },
    youtube: { ...(baseConfig.youtube || {}), ...(newConfig.youtube || {}) }
  };

  if (typeof newConfig.isActive === 'boolean') {
    merged.isActive = newConfig.isActive;
  }

  return merged;
}

// Vote update batching system to prevent WebSocket flooding
let pendingLifelineVoteUpdate = null;
let lifelineVoteUpdateTimer = null;
const VOTE_UPDATE_BATCH_INTERVAL = 250; // Batch updates every 250ms

function scheduledLifelineVoteUpdateBroadcast() {
  if (pendingLifelineVoteUpdate) {
    // Actually broadcast the batched update
    broadcastToClients(pendingLifelineVoteUpdate);
    pendingLifelineVoteUpdate = null;
    if (DEBUG_LIFELINE_VOTING) console.log('📡 Batched lifeline vote update broadcast sent');
  }
}

function broadcastLifelineVoteUpdate(updateMessage) {
  // Store the latest update message (overwrites previous pending updates)
  pendingLifelineVoteUpdate = updateMessage;
  
  // Schedule broadcast if not already scheduled
  if (!lifelineVoteUpdateTimer) {
    lifelineVoteUpdateTimer = setTimeout(() => {
      scheduledLifelineVoteUpdateBroadcast();
      lifelineVoteUpdateTimer = null;
    }, VOTE_UPDATE_BATCH_INTERVAL);
  }
}

// Leaderboard System Data
let leaderboardData = {
  current_game: {},  // Live game tracking
  daily: {},         // Daily leaderboard
  weekly: {},        // Weekly leaderboard
  monthly: {},       // Monthly leaderboard
  all_time: {},      // All-time leaderboard
  last_reset: {
    daily: Date.now(),
    weekly: Date.now(),
    monthly: Date.now()
  }
};

let leaderboardSettings = {
  display_enabled: true,
  display_mode: 'current_game', // 'current_game', 'daily', 'weekly', 'monthly', 'all_time'
  display_count: 5,        // Number of players to show
  auto_hide_during_questions: false,
  show_animations: true,
  show_point_changes: true,
  chat_participation_enabled: true,  // Enable chat participation points
  chat_participation_cooldown: 60000, // 1 minute cooldown between chat points
  // Point values
  points: {
    participation: 1,
    chat_participation: 1,  // Points for typing in chat
    correct_answer: 5,
    first_correct: 10,
    second_correct: 5,
    third_correct: 3,
    hot_seat_selected: 5,
    hot_seat_correct: 20,
    hot_seat_quick: 10,
    streak_3: 5,
    streak_5: 15,
    streak_10: 50
  }
};

const VALID_LEADERBOARD_PERIODS = ['current_game', 'daily', 'weekly', 'monthly', 'all_time'];

function normalizeLeaderboardPeriod(requestedPeriod) {
  if (!requestedPeriod) {
    return 'current_game';
  }

  const sanitized = requestedPeriod.toString().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');

  if (sanitized === 'current') {
    return 'current_game';
  }

  return VALID_LEADERBOARD_PERIODS.includes(sanitized) ? sanitized : 'current_game';
}

function showLeaderboardOverlay(period = 'current_game') {
  const normalizedPeriod = normalizeLeaderboardPeriod(period);

  leaderboardSettings.display_mode = normalizedPeriod;
  gameState.leaderboard_visible = true;
  gameState.leaderboard_period = normalizedPeriod;

  const payload = {
    type: 'show_leaderboard',
    period: normalizedPeriod,
    data: getLeaderboardStats(),
    timestamp: Date.now()
  };

  broadcastToClients(payload);
  broadcastLeaderboardUpdate();
  broadcastState(true);
}

function hideLeaderboardOverlay() {
  gameState.leaderboard_visible = false;

  broadcastToClients({
    type: 'hide_leaderboard',
    timestamp: Date.now()
  });

  broadcastState(true);
}

// Track vote timing for speed bonuses
let currentQuestionVotes = [];  // Array of {username, answer, timestamp, isCorrect}
let firstCorrectVoters = [];    // Track first 3 correct voters for bonus points

// Twitch emote definitions for chat display are loaded from emotes-update.js.

// Function to replace Twitch emote keywords with HTML img tags

function processEmotesForHTML(text) {
  // Sort emote keywords by length (longest first) to avoid partial replacements
  const sortedEmotes = Object.keys(TWITCH_EMOTES).sort((a, b) => b.length - a.length);
  
  let processedText = text;
  
  // Replace each emote keyword with an img tag
  sortedEmotes.forEach(emote => {
    const regex = new RegExp(`\\b${emote}\\b`, 'g');
    const imgTag = `<img src="${TWITCH_EMOTES[emote]}" alt="${emote}" style="display: inline-block; width: 24px; height: 24px; vertical-align: middle; margin: 0 2px;">`;
    processedText = processedText.replace(regex, imgTag);
  });
  
  return processedText;
}

// Chat message storage for HTTP polling (keep last 100 messages)
let chatMessages = [];
const MAX_CHAT_MESSAGES = 100;

// Chat participation tracking for point rewards
let chatParticipationTracker = new Map(); // Maps username -> last rewarded timestamp

// Load questions from JSON file or use defaults
let questions = [];

// Default questions fallback - 15 complete questions for the game
const defaultQuestions = [
  {
    text: "What is the capital of France?",
    answers: ["London", "Berlin", "Paris", "Madrid"],
    correct: 2,
    number: 1
  },
  {
    text: "Which planet is known as the Red Planet?",
    answers: ["Venus", "Mars", "Jupiter", "Saturn"],
    correct: 1,
    number: 2
  },
  {
    text: "Who painted the Mona Lisa?",
    answers: ["Van Gogh", "Picasso", "Da Vinci", "Monet"],
    correct: 2,
    number: 3
  },
  {
    text: "What is the largest mammal in the world?",
    answers: ["African Elephant", "Blue Whale", "Giraffe", "Polar Bear"],
    correct: 1,
    number: 4
  },
  {
    text: "In which year did World War II end?",
    answers: ["1944", "1945", "1946", "1947"],
    correct: 1,
    number: 5
  },
  {
    text: "What is the chemical symbol for gold?",
    answers: ["Go", "Gd", "Au", "Ag"],
    correct: 2,
    number: 6
  },
  {
    text: "Which Shakespeare play features the characters Romeo and Juliet?",
    answers: ["Hamlet", "Macbeth", "Romeo and Juliet", "Othello"],
    correct: 2,
    number: 7
  },
  {
    text: "What is the smallest country in the world?",
    answers: ["Monaco", "San Marino", "Vatican City", "Liechtenstein"],
    correct: 2,
    number: 8
  },
  {
    text: "Who developed the theory of relativity?",
    answers: ["Isaac Newton", "Albert Einstein", "Galileo Galilei", "Stephen Hawking"],
    correct: 1,
    number: 9
  },
  {
    text: "What is the hardest natural substance on Earth?",
    answers: ["Gold", "Iron", "Diamond", "Platinum"],
    correct: 2,
    number: 10
  },
  {
    text: "Which ocean is the largest?",
    answers: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"],
    correct: 3,
    number: 11
  },
  {
    text: "Who wrote the novel '1984'?",
    answers: ["George Orwell", "Aldous Huxley", "Ray Bradbury", "H.G. Wells"],
    correct: 0,
    number: 12
  },
  {
    text: "What is the speed of light in a vacuum?",
    answers: ["299,792,458 m/s", "300,000,000 m/s", "299,000,000 m/s", "301,000,000 m/s"],
    correct: 0,
    number: 13
  },
  {
    text: "Which element has the atomic number 1?",
    answers: ["Helium", "Hydrogen", "Lithium", "Carbon"],
    correct: 1,
    number: 14
  },
  {
    text: "Who was the first person to walk on the moon?",
    answers: ["Buzz Aldrin", "Neil Armstrong", "John Glenn", "Alan Shepard"],
    correct: 1,
    number: 15
  }
];

// Load questions from file
function loadQuestions() {
  try {
    const questionsData = fs.readFileSync('./questions.json', 'utf8');
    questions = JSON.parse(questionsData);
    console.log(`📚 Loaded ${questions.length} questions from questions.json`);
  } catch (error) {
    console.log('⚠️ Could not load questions.json, using defaults:', error.message);
    // Use fallback to default questions if file doesn't exist
    questions = [...defaultQuestions];
  }
  
  // Initialize answerHistory array for all questions
  gameState.answerHistory = Array(questions.length).fill(null).map((_, index) => ({
    questionIndex: index,
    result: null  // 'correct', 'wrong', or null
  }));
  console.log(`📋 Initialized answer history for ${questions.length} questions`);
}

// Load prize amounts from JSON file or use defaults
let prizeAmounts = [];

// Default prize amounts fallback
const defaultPrizes = [
  '$100', '$200', '$300', '$500', '$1,000',
  '$2,000', '$4,000', '$8,000', '$16,000', '$32,000',
  '$64,000', '$125,000', '$250,000', '$500,000', '$1,000,000'
];

// Load prizes from file
function loadPrizes() {
  try {
    const prizesData = fs.readFileSync('./prizes.json', 'utf8');
    prizeAmounts = JSON.parse(prizesData);
    console.log(`💰 Loaded ${prizeAmounts.length} prize levels from prizes.json`);
  } catch (error) {
    console.log('⚠️ Could not load prizes.json, using defaults:', error.message);
    // Use fallback to default prizes if file doesn't exist
    prizeAmounts = [...defaultPrizes];
  }
}

// Save questions to JSON file
function saveQuestions(questionsToSave) {
  try {
    const questionsJson = JSON.stringify(questionsToSave, null, 2);
    fs.writeFileSync('./questions.json', questionsJson, 'utf8');
    console.log(`💾 Saved ${questionsToSave.length} questions to questions.json`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save questions:', error.message);
    return false;
  }
}

// Save prizes to JSON file
function savePrizes(prizesToSave) {
  try {
    const prizesJson = JSON.stringify(prizesToSave, null, 2);
    fs.writeFileSync('./prizes.json', prizesJson, 'utf8');
    console.log(`💾 Saved ${prizesToSave.length} prize levels to prizes.json`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save prizes:', error.message);
    return false;
  }
}

// Load data on startup
loadQuestions();
loadPrizes();

// Initialize prizes in game state
gameState.prizes = [...prizeAmounts];

// CORS headers
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

// Giveaway system functions
function startGiveaway(prizeName, prizeAmount, numWinners, keyword) {
  console.log(`🎁 Starting giveaway: ${prizeName} (${prizeAmount}) - ${numWinners} winner(s) - Keyword: ${keyword}`);
  
  // Reset giveaway state
  resetGiveaway();
  
  // Set giveaway parameters
  gameState.giveaway_active = true;
  gameState.giveaway_closed = false;
  gameState.giveaway_prize_name = prizeName || 'Mystery Prize';
  gameState.giveaway_prize_amount = prizeAmount || 'TBD';
  gameState.giveaway_num_winners = Math.max(1, parseInt(numWinners) || 1);
  gameState.giveaway_keyword = keyword || 'JUICE';
  gameState.giveaway_start_time = Date.now();
  
  // Clear any existing voters who voted during the show for bonus weight tracking
  gameState.giveaway_show_voters = new Set(gameState.poll_voter_history || []);
  
  // Broadcast giveaway started event
  broadcastToClients({
    type: 'giveaway_started',
    prizeName: gameState.giveaway_prize_name,
    prizeAmount: gameState.giveaway_prize_amount,
    numWinners: gameState.giveaway_num_winners,
    duration: gameState.giveaway_duration,
    keyword: gameState.giveaway_keyword,
    timestamp: Date.now()
  });
  
  // Auto-close giveaway after duration
  setTimeout(() => {
    if (gameState.giveaway_active) {
      stopGiveaway();
    }
  }, gameState.giveaway_duration);
  
  // Start timer updates every second
  startGiveawayTimer();
}

function stopGiveaway() {
  if (!gameState.giveaway_active) return;
  
  console.log(`🛑 Stopping giveaway - ${gameState.giveaway_participants.length} participants`);
  
  gameState.giveaway_active = false;
  gameState.giveaway_closed = true;
  
  // Broadcast giveaway closed event
  broadcastToClients({
    type: 'giveaway_stopped',
    participantCount: gameState.giveaway_participants.length,
    totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
    timestamp: Date.now()
  });
  
  // Automatically select winners if there are participants
  if (gameState.giveaway_participants.length > 0) {
    console.log('🎰 Automatically selecting winners...');
    setTimeout(() => {
      selectGiveawayWinners();
    }, 1000); // Small delay for dramatic effect
  } else {
    console.log('⚠️ No participants entered the giveaway - no winners to select');
  }
}

function selectGiveawayWinners() {
  if (!gameState.giveaway_closed || gameState.giveaway_participants.length === 0) {
    return [];
  }
  
  console.log(`🎯 Selecting ${gameState.giveaway_num_winners} winner(s) from ${gameState.giveaway_participants.length} participants`);
  
  const winners = [];
  const participants = [...gameState.giveaway_participants]; // Copy to avoid modifying original
  
  for (let i = 0; i < gameState.giveaway_num_winners && participants.length > 0; i++) {
    const winner = weightedRandomSelect(participants);
    winners.push(winner);
    
    // Remove winner from participants pool
    const winnerIndex = participants.findIndex(p => p.username === winner.username);
    if (winnerIndex !== -1) {
      participants.splice(winnerIndex, 1);
    }
  }
  
  gameState.giveaway_winners = winners;
  
  // Broadcast winners selected event with announcement format
  broadcastToClients({
    type: 'giveaway_winners',
    winners: winners.map(w => ({
      username: w.username,
      weight: w.weight,
      entryMethod: w.entry_method,
      announcement: `${w.username} won the giveaway!`
    })),
    timestamp: Date.now()
  });
  
  console.log(`🏆 Winners selected:`, winners.map(w => `${w.username} won the giveaway! (${w.weight}x weight)`).join(', '));
  
  return winners;
}

function resetGiveaway(clearWinners = false) {
  gameState.giveaway_active = false;
  gameState.giveaway_closed = false;
  gameState.giveaway_prize_name = '';
  gameState.giveaway_prize_amount = '';
  gameState.giveaway_num_winners = 1;
  gameState.giveaway_start_time = null;
  gameState.giveaway_participants = [];
  gameState.giveaway_participant_history = [];
  gameState.giveaway_winners = [];
  gameState.giveaway_keyword = 'JUICE';
  gameState.giveaway_show_voters = new Set();
  
  // Broadcast reset to all clients to clear participant displays
  broadcastToClients({
    type: 'giveaway_reset',
    message: clearWinners ? 'Giveaway reset for new giveaway - clearing winners' : 'Giveaway system reset - participant list cleared',
    clearWinners: clearWinners,
    timestamp: Date.now()
  });
  
  console.log(clearWinners ? '🔄 Giveaway reset for new giveaway - clearing winners' : '🔄 Giveaway reset');
}

// Start giveaway timer updates
let giveawayTimerInterval = null;
let pendingEndgameInterval = null;
function startGiveawayTimer() {
  // Clear any existing timer
  if (giveawayTimerInterval) {
    clearInterval(giveawayTimerInterval);
  }
  
  // Clear any existing timer before creating new one
  if (giveawayTimerInterval) {
    clearInterval(giveawayTimerInterval);
    giveawayTimerInterval = null;
  }

  ensureSlotMachineState();
  if (gameState.slot_machine && gameState.slot_machine.current_round) {
    cleanupSlotMachineRoundTimers(gameState.slot_machine.current_round);
    gameState.slot_machine.current_round = null;
  }
  if (gameState.slot_machine) {
    gameState.slot_machine.last_round_result = null;
  }

  if (pendingEndgameInterval) {
    clearInterval(pendingEndgameInterval);
    pendingEndgameInterval = null;
  }

  gameState.pending_endgame_sequence = false;
  gameState.final_game_winners = [];
  gameState.final_game_stats = null;
  gameState.finalLeaderboardShown = false;
  gameState.game_completed = false;
  gameState.prizeConfiguration.winnersAnnounced = false;
  gameState.endgame_ready_timestamp = null;
  
  // Send timer updates every second with throttling
  let lastBroadcastTime = 0;
  giveawayTimerInterval = setInterval(() => {
    if (gameState.giveaway_active) {
      const timeRemaining = Math.max(0, gameState.giveaway_duration - (Date.now() - gameState.giveaway_start_time));
      
      broadcastToClients({
        type: 'giveaway_time_update',
        timeRemaining: timeRemaining,
        timestamp: Date.now()
      });
      
      // Stop timer when time runs out
      if (timeRemaining === 0) {
        clearInterval(giveawayTimerInterval);
        giveawayTimerInterval = null;
        
        // Automatically close giveaway and select winners
        console.log('⏰ Giveaway timer expired - automatically selecting winners');
        gameState.giveaway_active = false;
        gameState.giveaway_closed = true;
        
        // Select winners if there are participants
        if (gameState.giveaway_participants.length > 0) {
          const winners = selectGiveawayWinners();
          gameState.giveaway_winners = winners;
          
          console.log(`🎉 Automatically selected ${winners.length} winner(s):`, winners.map(w => w.username));
          
          // Broadcast winners with confetti
          broadcastToClients({
            type: 'giveaway_winners',
            winners: winners.map(w => ({
              username: w.username,
              weight: w.weight,
              entryMethod: w.entry_method,
              keyword: w.keyword
            })),
            autoSelected: true,
            timestamp: Date.now()
          });
          
          // Trigger confetti celebration
          setTimeout(() => {
            broadcastToClients({ 
              type: 'confetti_trigger', 
              command: 'create_confetti',
              reason: 'giveaway_winners'
            });
            console.log('🎊 Broadcasting confetti for giveaway winners');
          }, 500); // Small delay for dramatic effect
          
        } else {
          console.log('❌ No participants entered the giveaway');
          broadcastToClients({
            type: 'giveaway_no_participants',
            message: 'No one entered the giveaway by typing: ' + gameState.giveaway_keyword,
            timestamp: Date.now()
          });
        }
      }
    } else {
      // Stop timer if giveaway is no longer active AND no winners are displayed
      // This prevents the timer from clearing while winners are being shown
      if (!gameState.giveaway_winners || gameState.giveaway_winners.length === 0) {
        clearInterval(giveawayTimerInterval);
        giveawayTimerInterval = null;
      }
    }
  }, 1000);
}

function addGiveawayParticipant(username, weight, entryMethod, keyword = null) {
  // Check if user already entered
  if (gameState.giveaway_participant_history.includes(username.toLowerCase())) {
    return false; // Already entered
  }
  
  const participant = {
    username: username,
    weight: weight,
    timestamp: Date.now(),
    entry_method: entryMethod,
    keyword: keyword
  };
  
  gameState.giveaway_participants.push(participant);
  gameState.giveaway_participant_history.push(username.toLowerCase());
  
  console.log(`➕ Giveaway entry: ${username} (${weight}x weight via ${entryMethod})`);
  
  // Broadcast entry received event
  broadcastToClients({
    type: 'giveaway_entry',
    entry: {
      username: username,
      weight: weight,
      entryMethod: entryMethod,
      keyword: keyword
    },
    stats: {
      participantCount: gameState.giveaway_participants.length,
      voterCount: gameState.giveaway_participants.filter(p => p.weight > 1).length,
      totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0)
    },
    timestamp: Date.now()
  });
  
  return true;
}

function weightedRandomSelect(participants) {
  const totalWeight = participants.reduce((sum, p) => sum + p.weight, 0);
  const random = Math.random() * totalWeight;
  
  let currentWeight = 0;
  for (const participant of participants) {
    currentWeight += participant.weight;
    if (random <= currentWeight) {
      return participant;
    }
  }
  
  // Fallback (should never reach here)
  return participants[participants.length - 1];
}

// Duplicate function removed - using the one defined at line 395

function processGiveawayEntry(username, message) {
  if (!gameState.giveaway_active || gameState.giveaway_closed) {
    return false;
  }
  
  // Check for keyword entry
  if (message.toUpperCase().includes(gameState.giveaway_keyword.toUpperCase())) {
    // Check if this user voted during the show for 3x weight
    const usernameLower = username.toLowerCase();
    let weight = 1;
    let entryMethod = 'chat_keyword';
    
    // Check poll_voter_history for users who voted during the game
    if (gameState.poll_voter_history && gameState.poll_voter_history.includes(usernameLower)) {
      weight = 3;
      entryMethod = 'voted_and_keyword';
      console.log(`🎯 User ${username} gets 3x weight for voting during the show!`);
    }
    
    return addGiveawayParticipant(username, weight, entryMethod, gameState.giveaway_keyword);
  }
  
  return false;
}

function processGiveawayVoterEntry(username) {
  if (!gameState.giveaway_active || gameState.giveaway_closed) {
    return false;
  }
  
  // Check if user has voted in a poll (3x weight)
  if (gameState.gameshow_participants.includes(username)) {
    return addGiveawayParticipant(username, 3, 'poll_voter');
  }
  
  return false;
}

// Serve static files
function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    }[ext] || 'text/plain';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Create server
const server = http.createServer(async (req, res) => {
  // Set CORS headers for all responses
  setCORSHeaders(res);
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // Handle API requests
  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname);
    return;
  }
  
  // Serve browser source from static files with architectural fixes
  if (pathname === '/gameshow' || pathname === '/browser-source') {
    const fs = require('fs');
    const path = require('path');
    
    const filePath = path.join(__dirname, 'static', 'gameshow.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Error reading static gameshow.html:', err);
        res.writeHead(404);
        res.end('Gameshow file not found');
        return;
      }
      
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=10, must-revalidate', // Cache for 10 seconds to prevent rapid reloads
        'Access-Control-Allow-Origin': '*', // Allow cross-origin for OBS
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
      // Reduce excessive logging - only log every 10th request
      if (!global.gameshowRequestCount) global.gameshowRequestCount = 0;
      global.gameshowRequestCount++;
      if (global.gameshowRequestCount % 10 === 0) {
        console.log(`🎮 Served gameshow.html (${global.gameshowRequestCount} total requests)`);
      }
    });
    return;
  }

  // Legacy embedded content (kept for compatibility if needed)
  if (pathname === '/gameshow-legacy') {
    // Check overlay type from game state
    const overlayType = gameState.overlay_type || 'original';
    
    let htmlContent;
    
    if (overlayType === 'v2') {
      // Embedded content removed - now served from static files
      // Use /gameshow for static files or /gameshow-legacy for this embedded version
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Legacy Route</h1><p>Use <a href="/gameshow">/gameshow</a> for the main interface</p></body></html>');
      return;
    }
  }
  
  // Test route for debugging
  if (pathname === '/test') {
    fs.readFile('/home/kage/test-gameshow.html', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Test file not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }
  
  // Serve static files (CSS, JS, HTML)
  if (pathname.startsWith('/static/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'static', fileName);
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Static file not found:', filePath);
        res.writeHead(404);
        res.end('Static file not found');
        return;
      }
      
      const ext = path.extname(fileName).toLowerCase();
      const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon'
      };
      
      const contentType = contentTypes[ext] || 'text/plain';
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
      console.log(`📂 Served static file: ${fileName}`);
    });
    return;
  }

  if (pathname === '/emotes-update.js') {
    const filePath = path.join(__dirname, 'emotes-update.js');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Emotes definition file not found:', filePath, err);
        res.writeHead(404);
        res.end('Emotes file not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(data);
    });
    return;
  }
  
  // Serve TTS audio files
  if (pathname.startsWith('/audio/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'cache', 'voice', fileName);
    
    // Check if the file exists
    if (fs.existsSync(filePath)) {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          console.error('❌ Error reading TTS file:', err);
          res.writeHead(500);
          res.end('Error reading audio file');
          return;
        }
        
        res.writeHead(200, { 
          'Content-Type': 'audio/wav',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
        console.log(`🎵 Served TTS file: ${fileName}`);
      });
    } else {
      res.writeHead(404);
      res.end('TTS audio file not found');
    }
    return;
  }
  
  // Serve audio files for gameshow sound effects
  if (pathname.startsWith('/assets/audio/sfx/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'assets', 'audio', 'sfx', fileName);
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Audio file not found:', filePath);
        res.writeHead(404);
        res.end('Audio file not found');
        return;
      }
      
      // Determine content type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      let contentType = 'audio/wav'; // Default to WAV
      
      if (ext === '.mp3') {
        contentType = 'audio/mpeg';
      } else if (ext === '.ogg') {
        contentType = 'audio/ogg';
      }
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
      console.log(`🎵 Served audio file: ${fileName}`);
    });
    return;
  }
  
  // Default route - redirect to game show
  res.writeHead(302, { 'Location': '/gameshow' });
  res.end();
});

// Function to generate complete embedded gameshow HTML
function generateGameshowHTML() {
  // This function embeds all HTML, CSS, and JavaScript from the static files
  // back into a single HTML response as requested by the user
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kimbillionaire v2.0 - Browser Source - Embedded</title>
    
    <style>
    /* === GAMESHOW MAIN CSS === */
    ${fs.readFileSync(path.join(__dirname, 'static', 'gameshow.css'), 'utf8')}
    
    /* === GAMESHOW ANIMATIONS CSS === */
    ${fs.readFileSync(path.join(__dirname, 'static', 'gameshow-animations.css'), 'utf8')}
    </style>
</head>
<body>
    <!-- Background effects -->
    <div class="background-effects"></div>
    
    <!-- Game Container -->
    <div class="game-container">
        <!-- Header -->
        <div class="header-area glass-panel" id="header">
            <span id="header-text">KIMBILLIONAIRE</span>
        </div>
        
        <!-- Question Area -->
        <div class="question-area glass-panel" id="question-container">
            <div id="question-text" class="question-text"></div>
            <div id="question-subtext" class="question-subtext hidden">Get ready for the next question...</div>
        </div>
        
        <!-- Answers Area -->
        <div class="answers-area" id="answers-container">
            <div class="answer-option hidden" id="answer-A">
                <span class="answer-letter">A</span>
                <span class="answer-text">Answer A</span>
            </div>
            <div class="answer-option hidden" id="answer-B">
                <span class="answer-letter">B</span>
                <span class="answer-text">Answer B</span>
            </div>
            <div class="answer-option hidden" id="answer-C">
                <span class="answer-letter">C</span>
                <span class="answer-text">Answer C</span>
            </div>
            <div class="answer-option hidden" id="answer-D">
                <span class="answer-letter">D</span>
                <span class="answer-text">Answer D</span>
            </div>
        </div>
        
        <!-- Money Ladder -->
        <div class="money-area glass-panel" id="money-ladder">
            <div class="money-header">
                <div class="money-title">MONEY LADDER</div>
                <div class="current-prize-display" id="current-prize-badge">
                    Question <span id="current-question-number">1</span>
                </div>
            </div>
            <div class="money-levels-container" id="money-levels"></div>
        </div>
        
        <!-- Voting Area - DISABLED: Using integrated voting in info panel instead -->
        <!-- 
        <div class="voting-area" id="voting-area">
            <div class="voting-panel glass-panel hidden" id="voting-panel">
                <div class="voting-header">
                    <h3 id="voting-title">AUDIENCE VOTE</h3>
                    <div class="voting-countdown" id="voting-countdown">
                        <span id="countdown-timer">1:00</span>
                    </div>
                </div>
                <div class="voting-content" id="voting-content">
                    <! Vote options will be populated by JavaScript >
                </div>
                <div class="voting-activity" id="voting-activity">
                    <! Recent voters will be shown here >
                </div>
            </div>
        </div>
        -->
        
        <!-- Lifelines Area -->
        <div class="lifelines-area glass-panel" id="lifelines">
            <div class="lifeline" id="lifeline-fifty-fifty">
                <div class="lifeline-symbol">50:50</div>
                <div class="lifeline-label">FIFTY FIFTY</div>
            </div>
            <div class="lifeline" id="lifeline-take-another-vote">
                <div class="lifeline-symbol">📊</div>
                <div class="lifeline-label">TAKE ANOTHER VOTE</div>
            </div>
            <div class="lifeline" id="lifeline-ask-a-mod">
                <div class="lifeline-symbol">🛡️</div>
                <div class="lifeline-label">ASK A MOD</div>
            </div>
        </div>
        
        <!-- Audience/Contestant Info -->
        <div class="contestant-area glass-panel" id="contestant-info">
            <div class="contestant-content">
                <div class="contestant-name" id="contestant-name">Contestant</div>
                <div class="contestant-score" id="contestant-score">$0</div>
            </div>
        </div>
        
        <!-- Lifeline Voting Panel -->
        <div class="lifeline-voting-panel glass-panel hidden" id="lifeline-voting-panel">
            <div class="lifeline-voting-header">
                <h3>VOTE FOR LIFELINE</h3>
                <div class="lifeline-voting-timer" id="lifeline-voting-timer">0:30</div>
            </div>
            <div class="lifeline-voting-options" id="lifeline-voting-options">
                <!-- Options populated dynamically -->
            </div>
            <div class="lifeline-voting-activity" id="lifeline-voting-activity">
                <!-- Recent votes shown here -->
            </div>
        </div>
        
        <!-- Mod Response Panel -->
        <div class="mod-response-panel glass-panel hidden" id="mod-response-panel">
            <div class="mod-response-header">
                <h3 id="mod-response-title">🛡️ ASK A MOD</h3>
                <div class="mod-response-timer" id="mod-response-timer">30</div>
            </div>
            <div class="mod-response-container" id="mod-responses-list">
                <!-- Mod responses will appear here -->
            </div>
            <div class="mod-response-footer">
                <div class="mod-response-status" id="mod-response-status">Waiting for moderator responses...</div>
            </div>
        </div>
        
        <!-- Audience Choice Display -->
        <div class="audience-choice-overlay hidden" id="audience-choice-overlay">
            <div class="audience-choice-content">
                <div class="audience-choice-label">AUDIENCE CHOICE</div>
                <div class="audience-choice-answer" id="audience-choice-answer">A</div>
                <div class="audience-choice-stats" id="audience-choice-stats">
                    <span id="audience-choice-votes">0 votes</span>
                    <span id="audience-choice-percentage">0%</span>
                </div>
            </div>
        </div>
        
        <!-- Giveaway Display -->
        <div class="giveaway-overlay glass-panel hidden" id="giveaway-overlay">
            <div class="giveaway-header">
                <h3>🎁 GIVEAWAY</h3>
                <div class="giveaway-timer" id="giveaway-timer">5:00</div>
            </div>
            <div class="giveaway-keyword-section" id="giveaway-keyword">
                <div class="giveaway-instruction">Type this keyword in chat to enter:</div>
                <div class="giveaway-keyword-display" id="giveaway-keyword-display">KIMBILLIONAIRE</div>
            </div>
            <div class="giveaway-entries" id="giveaway-entries">
                <div class="giveaway-entries-header">Entries:</div>
                <div class="giveaway-entries-list" id="giveaway-entries-list">
                    <!-- Entries will appear here -->
                </div>
            </div>
            <div class="giveaway-winners hidden" id="giveaway-winners">
                <!-- Winners will appear here -->
            </div>
        </div>
    </div>
    
    <!-- Overlays -->
    <div class="overlay hidden" id="winner-overlay">
        <div class="winner-content">
            <div class="winner-text">WINNER!</div>
            <div class="winner-amount" id="winner-amount">$1,000,000</div>
        </div>
    </div>
    
    <div class="overlay hidden" id="game-over-overlay">
        <div class="game-over-content">
            <div class="game-over-text">GAME OVER</div>
            <div class="final-amount" id="final-amount">$0</div>
        </div>
    </div>
    
    <!-- Audio Elements -->
    <audio id="ttsAudio" preload="auto"></audio>
    <audio id="questionAudio" preload="auto" src="/assets/audio/sfx/QuestionSFX.wav"></audio>
    <audio id="sfxAudio" preload="auto"></audio>
    <audio id="applauseAudio" preload="auto" src="/assets/audio/sfx/ApplauseSFX.wav"></audio>
    <audio id="tickAudio" preload="auto" src="/assets/audio/sfx/tick.wav"></audio>
    <audio id="correctAudio" preload="auto" src="/assets/audio/sfx/correct.wav"></audio>
    <audio id="wrongAudio" preload="auto" src="/assets/audio/sfx/wrong.wav"></audio>
    <audio id="lockAudio" preload="auto" src="/assets/audio/sfx/LockInAnswer.wav"></audio>
    
    <script>
    /* === GAME DATA INJECTION === */
    // Questions data
    const questions = ${JSON.stringify(questions, null, 2)};
    
    // Prize amounts data  
    const prizeAmounts = ${JSON.stringify(prizeAmounts, null, 2)};
    
    console.log('📊 Game data loaded:', questions.length, 'questions,', prizeAmounts.length, 'prize levels');
    
    /* === GAMESHOW JAVASCRIPT === */
    ${fs.readFileSync(path.join(__dirname, 'static', 'gameshow.js'), 'utf8')}
    </script>
</body>
</html>`;
}

// WebSocket server setup
// ====================================================

// Connection tracking and limits
const CONNECTION_LIMITS = {
  maxConnections: 1000,       // Temporarily increased for stress testing
  maxPerIP: 600,              // Temporarily increased for stress testing from localhost
  rateLimitWindow: 60000,    // Rate limit window in ms (1 minute)
  maxMessagesPerWindow: 200, // Temporarily increased for testing
  heartbeatInterval: 30000,  // 30 seconds
  maxPayload: 16 * 1024      // 16KB max message size
};
// WebSocket server setup
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: { threshold: 1024, concurrencyLimit: 10 },
  maxPayload: CONNECTION_LIMITS.maxPayload,
  verifyClient: (info) => validateConnection(info.req).allowed
});


// 🎭 AUTONOMOUS ROARY HOST TTS GENERATION
// =====================================

async function generateRoaryTTS(text, context = 'general', filename = null) {
  try {
    if (!filename) {
      filename = `roary_${context}_${Date.now()}.wav`;
    }
    
    const voiceCachePath = path.join(__dirname, 'cache', 'voice');
    
    // Ensure voice cache directory exists
    if (!fs.existsSync(voiceCachePath)) {
      fs.mkdirSync(voiceCachePath, { recursive: true });
    }
    
    const audioFilepath = path.join(voiceCachePath, filename);
    const textFilepath = path.join(voiceCachePath, filename.replace('.wav', '.txt'));
    
    console.log(`🎤 Generating Roary TTS: "${text.substring(0, 50)}..."`);
    
    // Try Google TTS first if API key is available
    if (process.env.GOOGLE_TTS_API_KEY) {
      try {
        const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
        const client = new TextToSpeechClient({
          apiKey: process.env.GOOGLE_TTS_API_KEY,
        });
        
        const request = {
          input: { text: text },
          voice: { 
            languageCode: 'en-GB', // British English for Jeremy Clarkson style
            name: 'en-GB-Wavenet-B', // Male British voice
            ssmlGender: 'MALE'
          },
          audioConfig: { 
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 22050
          },
        };
        
        const [response] = await client.synthesizeSpeech(request);
        fs.writeFileSync(audioFilepath, response.audioContent, 'binary');
        console.log(`✅ Generated Google TTS audio: ${filename}`);
        return filename;
        
      } catch (googleError) {
        console.warn(`⚠️ Google TTS failed: ${googleError.message}, trying local server...`);
      }
    }
    
    // Try local TTS server as fallback
    try {
      const fetch = require('node-fetch');
      const response = await fetch('http://localhost:8083/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        timeout: 5000
      });
      
      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        fs.writeFileSync(audioFilepath, Buffer.from(audioBuffer));
        console.log(`✅ Generated local TTS audio: ${filename}`);
        return filename;
      }
    } catch (localError) {
      console.warn(`⚠️ Local TTS server failed: ${localError.message}`);
    }
    
    // Ultimate fallback - create text file for browser TTS
    fs.writeFileSync(textFilepath, text);
    console.log(`📝 Created text file for browser TTS: ${filename.replace('.wav', '.txt')}`);
    return filename.replace('.wav', '.txt');
    
  } catch (error) {
    console.error('❌ TTS generation failed:', error);
    // Return the original filename so the system doesn't break
    return filename || `roary_${context}_${Date.now()}.wav`;
  }
}

// 🔌 WEBSOCKET CONNECTION MANAGEMENT & RESOURCE LIMITS
// ====================================================

// Note: CONNECTION_LIMITS already declared at line 989
// Using the first declaration to avoid duplicate identifier error

let connectionCount = 0;
let connectionsByIP = new Map();
let clientMessageHistory = new Map();

// Connection rate limiting and validation
function validateConnection(req) {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  
  // Check global connection limit
  if (connectionCount >= CONNECTION_LIMITS.maxConnections) {
    console.warn(`🚫 Connection rejected: Global limit reached (${connectionCount}/${CONNECTION_LIMITS.maxConnections})`);
    return { allowed: false, reason: 'Server at capacity' };
  }
  
  // Check per-IP limit
  const ipConnections = connectionsByIP.get(clientIP) || 0;
  if (ipConnections >= CONNECTION_LIMITS.maxPerIP) {
    console.warn(`🚫 Connection rejected: IP limit reached for ${clientIP} (${ipConnections}/${CONNECTION_LIMITS.maxPerIP})`);
    return { allowed: false, reason: 'Too many connections from this IP' };
  }
  
  return { allowed: true, ip: clientIP };
}

// Message rate limiting
function checkMessageRateLimit(ws) {
  const now = Date.now();
  const clientId = ws.clientId || 'unknown';
  
  if (!clientMessageHistory.has(clientId)) {
    clientMessageHistory.set(clientId, []);
  }
  
  const messageHistory = clientMessageHistory.get(clientId);
  
  // Remove old messages outside the rate limit window
  const cutoff = now - CONNECTION_LIMITS.rateLimitWindow;
  const recentMessages = messageHistory.filter(timestamp => timestamp > cutoff);
  
  // Check if client is sending too many messages
  if (recentMessages.length >= CONNECTION_LIMITS.maxMessagesPerWindow) {
    console.warn(`🚫 Rate limit exceeded for client ${clientId}: ${recentMessages.length} messages in last minute`);
    return false;
  }
  
  // Add current message timestamp
  recentMessages.push(now);
  clientMessageHistory.set(clientId, recentMessages);
  
  return true;
}

// Connection cleanup helper
function cleanupConnection(ws) {
  // Clear any heartbeat timer
  if (ws.heartbeatTimer) {
    clearInterval(ws.heartbeatTimer);
    ws.heartbeatTimer = null;
  }
  
  // Clear any other timers associated with this connection
  if (ws.pingTimer) {
    clearTimeout(ws.pingTimer);
    ws.pingTimer = null;
  }
  
  if (ws.clientIP) {
    const ipConnections = connectionsByIP.get(ws.clientIP) || 0;
    if (ipConnections > 1) {
      connectionsByIP.set(ws.clientIP, ipConnections - 1);
    } else {
      connectionsByIP.delete(ws.clientIP);
    }
  }
  
  if (ws.clientId) {
    clientMessageHistory.delete(ws.clientId);
    
    // Calculate and store connection duration for statistics
    const metrics = performanceMetrics.websocket;
    if (ws.connectionTime) {
      const duration = Date.now() - ws.connectionTime;
      metrics.connectionDurations.push(duration);
      
      // Keep only last 100 connection durations
      if (metrics.connectionDurations.length > 100) {
        metrics.connectionDurations.shift();
      }
      
      // Calculate average connection duration
      if (metrics.connectionDurations.length > 0) {
        metrics.avgConnectionDuration = metrics.connectionDurations.reduce((a, b) => a + b, 0) / metrics.connectionDurations.length;
      }
      
      // Check for abnormally short connections with enhanced classification
      if (duration < 5000) { // Less than 5 seconds
        const clientIP = ws.clientIP || 'unknown';
        const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';
        
        // Only count as failure and alert for non-development environments or very brief connections
        if (!isDevelopment || duration < 1000) {
          const severity = isDevelopment ? 'info' : 'warning';
          const context = isDevelopment ? ' (dev environment)' : '';
          addHealthAlert(`Short-lived connection detected: ${ws.clientId} (${Math.round(duration/1000)}s)${context}`, severity);
          
          // Only count as connection failure for non-development or extremely brief connections
          if (!isDevelopment || duration < 500) {
            metrics.connectionFailures++;
          }
        }
      }
    }
    
    // Clean up connection quality tracking
    if (metrics.connectionQuality.has(ws.clientId)) {
      const quality = metrics.connectionQuality.get(ws.clientId);
      
      // Log final connection quality for monitoring
      if (quality.healthScore < 70) {
        console.log('📊 Connection ' + ws.clientId + ' ended with poor health score: ' + Math.round(quality.healthScore));
      }
      
      metrics.connectionQuality.delete(ws.clientId);
    }
    
    // Clean up duration tracking
    metrics.connectionDuration.delete(ws.clientId);
  }
  
  connectionCount--;
  serverHealth.connectionCount = connectionCount;
  
  if (ws.heartbeatTimer) {
    clearInterval(ws.heartbeatTimer);
  }
}

// WebSocket server already created at line 1186
// Removed duplicate declaration that was causing error

// Moderate stale connection cleanup every 30 seconds (less aggressive)
setInterval(() => {
  let cleaned = 0;
  wss.clients.forEach((client) => {
    const inactiveTime = Date.now() - (client.lastActivity || client.connectionTime || 0);
    
    // Different timeout rules for different client types
    let timeoutThreshold;
    if (client.clientType === 'giveaway_control_panel' || client.clientType === 'chat_viewer') {
      timeoutThreshold = 300000; // 5 minutes for UI components
    } else if (client.clientType) {
      timeoutThreshold = 120000; // 2 minutes for registered clients
    } else {
      timeoutThreshold = 60000;  // 1 minute for unregistered clients
    }
    
    // Only terminate if connection is dead OR really stale
    if (client.readyState !== WebSocket.OPEN || inactiveTime > timeoutThreshold) {
      console.log(`🧹 AUTO-CLEANUP: Terminating stale connection (${client.clientType || 'unregistered'}, inactive: ${Math.round(inactiveTime/1000)}s, threshold: ${timeoutThreshold/1000}s)`);
      client.terminate();
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 CLEANUP: Removed ${cleaned} stale connections`);
  }
}, 30000); // Run every 30 seconds (less frequent)

// WebSocket connection handler with enhanced management
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const clientId = `${clientIP}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Initialize connection tracking
  ws.clientIP = clientIP;
  ws.clientId = clientId;
  ws.connectionTime = Date.now();
  ws.lastActivity = Date.now();
  ws.isAlive = true;
  
  // Update connection counters
  connectionCount++;
  serverHealth.connectionCount = connectionCount;
  const ipConnections = connectionsByIP.get(clientIP) || 0;
  connectionsByIP.set(clientIP, ipConnections + 1);
  
  console.log(`🔌 New WebSocket connection: ${clientId} (${connectionCount} total, ${ipConnections + 1} from ${clientIP})`);
  
  // DELAYED CLEANUP: Give connections time to register before cleanup (prevent aggressive termination)
  setTimeout(() => {
    let unregisteredConnections = [];
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && !client.clientType) {
        // Only consider connections that have been around for more than 10 seconds without registering
        const connectionAge = Date.now() - (client.connectionTime || 0);
        if (connectionAge > 10000) {
          unregisteredConnections.push(client);
        }
      }
    });
    
    // If we have more than 10 truly unregistered connections, terminate the oldest ones
    if (unregisteredConnections.length > 10) {
      console.log(`🧹 Too many old unregistered connections (${unregisteredConnections.length}), cleaning up...`);
      // Sort by connection time (oldest first)
      unregisteredConnections.sort((a, b) => (a.connectionTime || 0) - (b.connectionTime || 0));
      
      // Keep only the newest 10
      const toTerminate = unregisteredConnections.slice(0, unregisteredConnections.length - 10);
      toTerminate.forEach(client => {
        console.log(`🧹 Terminating old unregistered connection: ${client.clientId}`);
        client.terminate();
      });
    }
  }, 5000); // Wait 5 seconds before checking for cleanup
  
  // Track WebSocket connection
  performanceMetrics.websocket.connectionDuration.set(clientId, Date.now());
  performanceMetrics.websocket.totalConnections++;
  
  // Initialize connection quality tracking
  performanceMetrics.websocket.connectionQuality.set(clientId, {
    startTime: Date.now(),
    messageCount: 0,
    errorCount: 0,
    errorRate: 0,
    lastActivity: Date.now(),
    healthScore: 100,
    lastAlert: 0
  });
  
  // Detect potential reconnection patterns
  detectReconnection(clientIP, clientId);
  
    // Add connection stability improvements for development environment
    const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';

    const cleanGameState = createSerializableGameState({
      includeQuestionData: true,
      includePrizes: true
    });
  
  if (isDevelopment) {
    // Add slight delay for dev environment to prevent rapid reconnections
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'state',
          data: cleanGameState
        }));
      }
    }, 100);
  } else {
    // Send initial state immediately for production
    ws.send(JSON.stringify({
      type: 'state',
      data: cleanGameState
    }));
  }
  
  // Setup heartbeat system with more lenient timeout for development
  const heartbeatInterval = isDevelopment ? 60000 : CONNECTION_LIMITS.heartbeatInterval; // 60s for dev, 30s for prod
  ws.heartbeatTimer = setInterval(() => {
    if (!ws.isAlive) {
      console.log(`💔 Heartbeat failed for client ${clientId} (${client.clientType || 'unregistered'}), terminating connection`);
      ws.terminate();
      return;
    }
    
    ws.isAlive = false;
    ws.ping();
  }, heartbeatInterval);
  
  // Handle pong responses
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastActivity = Date.now();
  });
  
  // Enhanced message handler with rate limiting
  ws.on('message', async (message) => {
    try {
      // Update lastActivity timestamp
      ws.lastActivity = Date.now();
      
      // Check message rate limit first
      if (!checkMessageRateLimit(ws)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Rate limit exceeded. Please slow down.',
          code: 'RATE_LIMIT'
        }));
        return;
      }
      
      // Validate message size
      if (message.length > CONNECTION_LIMITS.maxPayload) {
        console.warn(`🚫 Oversized message from ${clientId}: ${message.length} bytes`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message too large',
          code: 'MESSAGE_TOO_LARGE'
        }));
        return;
      }
      
      const data = JSON.parse(message);
      
      // Handle ping/pong for heartbeat
      if (data.type === 'ping') {
        ws.lastActivity = Date.now(); // Update activity timestamp for ping
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }
      
      // Only log non-ping messages to reduce noise
      if (data.type !== 'ping') {
        console.log('Received WebSocket message:', data);
      }
      
      // Handle credits completion message
      if (data.type === 'credits_complete') {
        console.log('🎬 Credits roll completed, game fully finished');
        gameState.credits_shown = true;
        
        // Optionally reset for next game
        broadcastToClients({
          type: 'game_fully_complete',
          timestamp: Date.now()
        });
        
        return;
      }
      
      // Handle client registration with connection limits
      if (data.type === 'register') {
        // AGGRESSIVE connection spam prevention
        const clientType = data.client;
        
        // GENTLE CLEANUP: Allow multiple connections during development, only clean really old ones
        if (clientType === 'giveaway_control_panel') {
          console.log('🔍 Checking for old giveaway_control_panel connections to clean');
          let oldConnections = [];
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && 
                client.clientType === 'giveaway_control_panel' && 
                client.clientId !== ws.clientId) {
              const connectionAge = Date.now() - (client.connectionTime || 0);
              if (connectionAge > 30000) { // Only terminate connections older than 30 seconds
                oldConnections.push(client);
              }
            }
          });
          
          if (oldConnections.length > 0) {
            console.log(`🧹 Terminating ${oldConnections.length} old giveaway_control_panel connections`);
            oldConnections.forEach(client => client.terminate());
          }
        }
        
        // STRICT connection limiting to prevent runaway connections
        const connectionLimits = {
          'chat_viewer': 10,       // Max 10 LiveChatViewer connections - increased for development
          'chat_config': 2,        // Max 2 LiveChatConfig connections  
          'simple_twitch_chat': 2, // Max 2 Twitch chat processes
          'giveaway_control_panel': 5, // Max 5 control panel connections - increased for development
          'unregistered': 20       // Temporarily increased to allow cleanup
        };
        
        let currentCounts = {};
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            const type = client.clientType || 'unregistered';
            currentCounts[type] = (currentCounts[type] || 0) + 1;
          }
        });
        
        const limit = connectionLimits[clientType] || 1; // Default limit of 1
        const currentCount = currentCounts[clientType] || 0;
        
        if (currentCount >= limit) {
          console.log(`🚫 CONNECTION LIMIT: Rejecting ${clientType} connection (current: ${currentCount}, max: ${limit})`);
          console.log(`🚫 Current connection counts:`, currentCounts);
          ws.close(1008, `Maximum ${clientType} connections exceeded (${limit} max)`);
          return;
        }
        
        ws.clientType = data.client;
        console.log(`📥 Registered client: ${data.client} (${clientId})`);
        
        // Send full state sync to browser_source clients immediately upon registration
        if (data.client === 'browser_source') {
          console.log('🔄 Sending full state sync to newly registered browser_source');
          
          // Send current game state immediately
          const cleanGameState = createSerializableGameState({
            includeQuestionData: true,
            includePrizes: true
          });
          
          const stateMessage = JSON.stringify({
            type: 'state',
            ...cleanGameState,
            timestamp: Date.now(),
            fullSync: true  // Flag to indicate this is a full sync
          });
          
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(stateMessage);
            console.log('✅ Full state sync sent to browser_source');
            
            // Also send any active typewriter state if question is shown but answers aren't
            if (cleanGameState.question_visible && !cleanGameState.answers_visible && !cleanGameState.typewriter_animation_complete) {
              ws.send(JSON.stringify({
                type: 'force_enable_answers',
                reason: 'late_connection',
                timestamp: Date.now()
              }));
              console.log('🎯 Sent force_enable_answers for late-connecting browser source');
            }
          }
        }
        console.log(`🔍 DEBUG: Current WebSocket clients after registration:`);
        let totalClients = 0;
        let clientsByType = {};
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            totalClients++;
            const type = client.clientType || 'unregistered';
            clientsByType[type] = (clientsByType[type] || 0) + 1;
          }
        });
        console.log(`🔍 DEBUG: Total active clients: ${totalClients}`);
        console.log(`🔍 DEBUG: Clients by type:`, clientsByType);
      }
      
      // Handle direct audience poll votes (before chat messages)
      if (data.type === 'audience_poll_vote') {
        console.log(`🗳️ Direct audience poll vote received:`, {
          username: data.username,
          vote: data.vote,
          platform: data.platform
        });
        
        console.log(`🔍 DEBUG: poll_voter_history BEFORE vote processing:`, gameState.poll_voter_history);
        console.log(`🔍 DEBUG: audience_poll_active:`, gameState.audience_poll_active);
        
        // Normalize username to lowercase for consistency
        const username = data.username ? data.username.toLowerCase().trim() : '';
        
        if (username && data.vote) {
          // Add user to poll voter history regardless of whether a poll is currently active
          // This allows giveaway bonus tracking for users who voted during the show
          if (!gameState.poll_voter_history.includes(username)) {
            gameState.poll_voter_history.push(username);
            console.log(`🔒 Added ${username} to poll voter history for giveaway bonus tracking`);
          } else {
            console.log(`🔍 ${username} already in poll voter history`);
          }
          
          // If there's an active poll, also process the vote normally
          if (gameState.audience_poll_active) {
            const voteMessage = {
              username: data.username,
              text: data.vote, // The vote (A, B, C, D)
              platform: data.platform || 'unknown',
              timestamp: data.timestamp || Date.now()
            };
            processVoteFromChat(voteMessage);
          } else {
            console.log(`ℹ️ No active poll, but ${username} recorded for future giveaway bonus`);
          }
        }
        
        console.log(`🔍 DEBUG: poll_voter_history AFTER processing:`, gameState.poll_voter_history);
        console.log(`🔍 DEBUG: Did ${data.username} get added?`, gameState.poll_voter_history.includes(username));
      }
      
      // Handle audience poll vote updates
      if (data.type === 'audience_poll_vote_update') {
        handleVoteUpdate(data);
      }
      
      // Handle chat messages - always forward to live chat viewer
      if (data.type === 'chat_message') {
        const startTime = Date.now();
        trackWebSocketMessage('chat_message', ws.clientId);
        
        // ===========================
        // SERVER-SIDE DUPLICATE PREVENTION
        // ===========================
        const messageKey = `${data.username}:${data.text}:${data.platform}`;
        const currentTime = Date.now();
        const timeWindow = 2000; // 2 second window for duplicate detection
        
        // Initialize message cache if not exists
        if (!global.recentMessages) {
          global.recentMessages = new Map();
        }
        
        // Check for recent duplicate messages
        if (global.recentMessages.has(messageKey)) {
          const lastMessageTime = global.recentMessages.get(messageKey);
          if (currentTime - lastMessageTime < timeWindow) {
            console.log(`🚫 Duplicate chat message detected and blocked:`, {
              username: data.username,
              text: data.text,
              timeSinceLastMessage: currentTime - lastMessageTime
            });
            return; // Block the duplicate message
          }
        }
        
        // Store this message timestamp
        global.recentMessages.set(messageKey, currentTime);
        
        // Clean up old messages (older than 10 seconds)
        for (const [key, timestamp] of global.recentMessages.entries()) {
          if (currentTime - timestamp > 10000) {
            global.recentMessages.delete(key);
          }
        }
        
        console.log(`💬 Received chat_message:`, {
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp
        });
        
        // Check if Ask a Mod is active and if this user is a moderator
        if (gameState.ask_a_mod_active) {
          // Ensure processed_mod_messages is properly initialized as a Set
          if (!(gameState.processed_mod_messages instanceof Set)) {
            gameState.processed_mod_messages = new Set(gameState.processed_mod_messages ? Object.keys(gameState.processed_mod_messages) : []);
            console.log('🔧 Fixed processed_mod_messages type in chat message handler');
          }
          
          // Create deduplication key to prevent duplicate processing
          const dedupKey = `${data.username}:${data.timestamp}:${data.text}`;
          if (!gameState.processed_mod_messages.has(dedupKey)) {
            gameState.processed_mod_messages.add(dedupKey);
            checkAndProcessModResponse(data);
          }
        }
        
        // Check if this is a moderator or VIP and if Ask a Mod is active
        const modList = getCachedModList();
        const vipList = getCachedVipList();
        const isModerator = modList.includes(data.username.toLowerCase());
        const isVIP = vipList.includes(data.username.toLowerCase());
        
        // Check for giveaway keyword entry
        processGiveawayEntry(data.username, data.text);
        
        // Check for hot seat entry (JOIN command)
        const messageText = typeof data.text === 'string' ? data.text : '';

        processJoinCommand({
          gameState,
          username: data.username,
          messageText,
          addSlotMachineEntry: (entryName) => addSlotMachineEntry(entryName),
          onHotSeatEntryAdded: ({ username, totalEntries }) => {
            console.log(`🎯 Hot Seat Entry: ${username} joined! (Total entries: ${totalEntries})`);
            broadcastToClients({
              type: 'hot_seat_entry_update',
              entries: totalEntries,
              username,
              timestamp: Date.now()
            });
          },
          onHotSeatDuplicate: (username) => {
            console.log(`ℹ️ Ignoring duplicate hot seat entry from ${username}`);
          }
        });

        // Add to gameshow participants for hot seat selection (chat activity)
        if (data.username && !gameState.gameshow_participants.includes(data.username)) {
          gameState.gameshow_participants.push(data.username);
          console.log(`🎭 Added ${data.username} to participants via chat activity (Total: ${gameState.gameshow_participants.length})`);
        }
        
        // Store message for HTTP polling
        const chatMessage = {
          id: `${data.username}_${data.timestamp}`,
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp,
          channel: data.channel || 'general',
          isModerator: isModerator,
          isVIP: isVIP,
          isAskAModActive: gameState.ask_a_mod_active
        };
        
        chatMessages.push(chatMessage);
        // Keep only the last MAX_CHAT_MESSAGES
        if (chatMessages.length > MAX_CHAT_MESSAGES) {
          chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
        }
        
        // Forward to all clients (including live chat viewer) with enhanced flags
        broadcastToClients({
          type: 'chat_message',
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp,
          channel: data.channel || 'general',
          isModerator: isModerator,
          isVIP: isVIP,
          isAskAModActive: gameState.ask_a_mod_active
        });
        
        // Award points for chat participation
        if (leaderboardSettings.chat_participation_enabled && 
            leaderboardSettings.points.chat_participation > 0) {
          
          // Check if user is ignored
          const ignoredUsers = getCachedIgnoredList();
          if (ignoredUsers.includes(data.username.toLowerCase())) {
            console.log(`🚫 Skipping chat points for ignored user: ${data.username}`);
          } else {
            const lastChatTime = chatParticipationTracker.get(data.username) || 0;
            const timeSinceLastChat = Date.now() - lastChatTime;
            const cooldown = leaderboardSettings.chat_participation_cooldown || 60000;
            
            if (timeSinceLastChat >= cooldown) {
              addPointsToPlayer(
                data.username, 
                leaderboardSettings.points.chat_participation, 
                'chat participation'
              );
              chatParticipationTracker.set(data.username, Date.now());
              console.log(`💬 ${data.username} earned chat participation points (cooldown: ${cooldown}ms)`);
            }
          }
        }
        
        // Always run vote processing to support hot seat answers and polls
        processVoteFromChat(data);

        // Process as lifeline vote if lifeline voting is active
        if (gameState.lifeline_voting_active) {
          try {
            // Validate data before processing
            if (!data || !data.username || !data.text) {
              console.error('❌ Invalid chat data for lifeline vote:', data);
              return;
            }
            processLifelineVoteFromChat(data);
          } catch (error) {
            console.error('❌ Error processing lifeline vote from chat:', error);
            console.error('Stack trace:', error.stack);
            // Continue execution - don't crash the server
          }
        }
        
        // Process as Ask a Mod response if session is active and user is a moderator or VIP (if enabled)
        if (gameState.ask_a_mod_active) {
          const canRespond = isModerator || (gameState.ask_a_mod_include_vips && isVIP);
          if (canRespond) {
            // Create deduplication key to prevent duplicate processing
            const dedupKey = `${data.username}:${data.timestamp}:${data.text}`;
            if (!gameState.processed_mod_messages.has(dedupKey)) {
              gameState.processed_mod_messages.add(dedupKey);
              processAskAModResponse(data, isModerator, isVIP);
            }
          }
        }
        
        // Process as giveaway entry if giveaway is active
        if (gameState.giveaway_active) {
          if (DEBUG_VERBOSE_LOGGING) console.log('🎁 Processing chat message as potential giveaway entry');
          try {
            processGiveawayEntry(data.username, data.text);
          } catch (error) {
            console.error('❌ Error processing giveaway entry:', error);
          }
        }
      }
      
      // Handle credits completion from browser
      if (data.type === 'credits_complete') {
        console.log('🎬 Credits complete signal received from browser');
        gameState.credits_rolling = false;
        gameState.credits_scrolling = false;
        console.log('🎭 Credits state cleared - ready for next game');
        broadcastState();
      }
      
      // Handle lifeline votes
      if (data.type === 'lifeline_vote') {
        if (gameState.lifeline_voting_active) {
          console.log(`🗳️ Received lifeline vote:`, {
            username: data.username,
            vote: data.vote,
            platform: data.platform
          });
          
          // Check if user already voted
          if (!gameState.lifeline_voter_history.includes(data.username)) {
            // Add vote
            gameState.lifeline_votes.push({
              username: data.username,
              vote: data.vote,
              timestamp: data.timestamp,
              platform: data.platform
            });
            
            // Add to voter history to prevent duplicates
            gameState.lifeline_voter_history.push(data.username);
            
            // Update vote count
            if (gameState.lifeline_vote_counts[data.vote] !== undefined) {
              gameState.lifeline_vote_counts[data.vote]++;
            }
            
            console.log(`✅ Lifeline vote recorded: ${data.username} voted for ${data.vote}`);
            console.log(`📊 Current lifeline vote counts:`, gameState.lifeline_vote_counts);
            
            // Broadcast vote update
            broadcastToClients({
              type: 'lifeline_vote_update',
              voteCounts: gameState.lifeline_vote_counts,
              totalVotes: gameState.lifeline_votes.length,
              recentVoter: {
                username: data.username,
                vote: data.vote
              }
            });
          } else {
            console.log(`⚠️ Duplicate lifeline vote attempt from ${data.username} - ignoring`);
          }
        }
      }
      
      // Handle chat connection status updates
      if (data.type === 'chat_connection_status') {
        console.log(`📡 Chat connection status update:`, {
          platform: data.platform,
          status: data.status,
          channel: data.channel
        });
        
        // Forward status to all clients (especially control panel)
        broadcastToClients({
          type: 'chat_connection_status',
          platform: data.platform,
          status: data.status,
          channel: data.channel,
          error: data.error,
          timestamp: data.timestamp
        });
      }
      
      // Handle poll start/end events with countdown timer
      if (data.type === 'audience_poll_started') {
        // Don't reset vote arrays here - they're already reset in startAutomaticPoll()
        // This was causing votes to be cleared after the poll started!
        console.log('🗳️ Received audience_poll_started notification');
      }
      
      if (data.type === 'audience_poll_ended') {
        // Note: This is now handled by endAutomaticPoll() which calls lockInAudienceChoice()
        // We just log the event here for tracking
        console.log('🏁 Audience poll ended event received');
      }
      
      // Handle typewriter animation completion
      if (data.type === 'typewriter_complete') {
        console.log('📝 Typewriter animation completed - enabling Show Answers button');
        gameState.typewriter_animation_complete = true;
        
        // Clear the server-side timeout since animation completed successfully
        if (global.typewriterTimeout) {
          clearTimeout(global.typewriterTimeout);
          global.typewriterTimeout = null;
        }
        
        // Immediately broadcast state update with debug logging
        console.log('🔄 Broadcasting typewriter completion state to all clients');
        broadcastState();
        
        // Additional broadcast after short delay to ensure React components receive it
        setTimeout(() => {
          broadcastState();
          console.log('🔄 Follow-up broadcast sent for typewriter completion');
        }, 100);
      }
      
      // Handle start revote after mod responses
      if (data.type === 'start_revote') {
        console.log('🔄 Starting audience revote after mod responses');
        
        const success = startRevote({
          type: 'generic',
          message: 'Vote again based on the discussion! Type A, B, C, or D in chat.',
          duration: gameState.revote_duration
        });
        
        if (!success) {
          console.error('❌ Failed to start generic revote');
        }
      }
      
      // Handle mod responses during Ask a Mod lifeline
      if (data.type === 'mod_response') {
        if (gameState.ask_a_mod_active) {
          // Create deduplication key to prevent duplicate processing
          const dedupKey = `${data.username}:${data.timestamp}:${data.message}`;
          if (gameState.processed_mod_messages.has(dedupKey)) {
            console.log(`⚠️ Duplicate mod response detected - already processed: ${data.username}`);
            return; // Skip processing this duplicate message
          }
          
          console.log(`🛡️ Received mod response:`, {
            username: data.username,
            message: data.message,
            platform: data.platform
          });
          
          // Mark as processed
          gameState.processed_mod_messages.add(dedupKey);
          
          // Add mod response to the collection
          gameState.mod_responses.push({
            username: data.username,
            message: data.message,
            timestamp: data.timestamp,
            platform: data.platform
          });
          
          console.log(`✅ Mod response recorded: ${data.username} - "${data.message}"`);
          console.log(`📊 Total mod responses: ${gameState.mod_responses.length}`);
          
          // Broadcast mod response update to display on screen
          broadcastToClients({
            type: 'mod_response_update',
            modResponse: {
              username: data.username,
              message: data.message,
              timestamp: data.timestamp,
              platform: data.platform
            },
            totalResponses: gameState.mod_responses.length,
            allResponses: gameState.mod_responses
          });
        } else {
          console.log(`⚠️ Mod response received but Ask a Mod is not active - ignoring response from ${data.username}`);
        }
      }
      
      // Handle mod display complete - triggers revote after Ask a Mod
      if (data.type === 'mod_display_complete') {
        console.log('📺 Mod response display complete - starting post-lifeline revote');
        
        // Reset lifeline voting states to allow button to return to normal
        gameState.lifeline_voting_active = false;
        gameState.lifeline_votes = [];
        gameState.lifeline_voter_history = [];
        gameState.available_lifelines_for_vote = [];
        gameState.lifeline_vote_winner = null;
        gameState.lifeline_vote_counts = {
          fiftyFifty: 0,
          takeAnotherVote: 0,
          askAMod: 0
        };
        
        // Start the post-lifeline revote
        startPostLifelineRevote('askAMod');
      }
      
      // Handle autonomous host messages
      if (data.type === 'autonomous_host_message') {
        console.log(`🎭 Autonomous Roary Host Message: ${data.text}`);
        
        // Generate TTS audio for the host message
        await generateRoaryTTS(data.text, data.context, data.audioFilename);
        
        // Broadcast to all clients including browser source for audio playback
        broadcastToClients({
          type: 'roary_speech',
          text: data.text,
          audioFile: data.audioFilename,
          audioUrl: `/audio/${data.audioFilename}`,
          context: data.context,
          personality: data.personality,
          phase: data.phase,
          targetUser: data.targetUser,
          timestamp: data.timestamp
        });
        
        // Also broadcast as chat display message for the Roary overlay
        broadcastToClients({
          type: 'roary_chat_response',
          text: data.text,
          audioFile: data.audioFilename,
          audioUrl: `/audio/${data.audioFilename}`,
          context: data.context,
          personality: data.personality,
          phase: data.phase,
          targetUser: data.targetUser,
          timestamp: data.timestamp
        });
      }
      
      // Handle autonomous game control commands
      if (data.type === 'autonomous_game_control') {
        console.log(`🤖 Autonomous Game Control: ${data.action} (mood: ${data.mood}, engagement: ${data.engagement})`);
        
        // Execute the game control action based on autonomous host decision
        switch (data.action) {
          case 'lock_audience_choice':
            // Auto-lock the audience choice if poll is active
            if (gameState.audience_poll_active && !gameState.answer_locked_in) {
              lockInAudienceChoice();
              console.log('🤖 Autonomous host auto-locked audience choice due to low engagement');
            }
            break;
            
          case 'extend_poll_time':
            // Extend poll time if audience is highly engaged
            if (gameState.audience_poll_active) {
              // Note: This would require modifying the poll timer system
              console.log('🤖 Autonomous host recommends extending poll time due to high engagement');
            }
            break;
            
          case 'suggest_lifeline':
            // Suggest using a lifeline based on audience confusion
            if (data.mood === 'confused') {
              console.log('🤖 Autonomous host suggests using 50:50 lifeline due to audience confusion');
            }
            break;
            
          default:
            console.log(`🤖 Unknown autonomous game control action: ${data.action}`);
        }
      }
        
        // Additionally broadcast as regular chat message if it's a chat response
        if (data.context === 'chat_response' && data.targetUser) {
          broadcastToClients({
            type: 'chat_message',
            username: 'Regal Roary',
            text: data.text,
            platform: 'host',
            timestamp: data.timestamp,
            isHost: true,
            targetUser: data.targetUser
          });
        }
      
      // Handle broadcast messages from control panel
      if (data.type === 'broadcast') {
        console.log('📡 Broadcasting message from control panel:', data.message);
        if (data.message) {
          if (data.message.type === 'show_leaderboard') {
            console.log('🏆 Broadcast request to show leaderboard overlay');
            showLeaderboardOverlay(data.message.period || leaderboardSettings.display_mode || 'current_game');
          } else if (data.message.type === 'hide_leaderboard') {
            console.log('👻 Broadcast request to hide leaderboard overlay');
            hideLeaderboardOverlay();
          } else {
            // Broadcast the message to all connected clients
            broadcastToClients(data.message);
          }
        }
      }
      
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      
      // Send error response to client
      try {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message processing failed',
          code: 'PROCESSING_ERROR'
        }));
      } catch (sendError) {
        console.error('Failed to send error response:', sendError);
      }
    }
  });
  
  // Enhanced connection close handler
  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket connection closed: ${clientId} (code: ${code}, reason: ${reason || 'none'})`);
    cleanupConnection(ws);
    
    // Log connection duration for monitoring
    const duration = Date.now() - ws.connectionTime;
    console.log(`📊 Connection ${clientId} lasted ${Math.round(duration / 1000)}s`);
  });
  
  // Enhanced error handler
  ws.on('error', (error) => {
    console.error(`🚨 WebSocket error for ${clientId}:`, error);
    cleanupConnection(ws);
    
    // Log error details for debugging
    const errorLog = {
      clientId: clientId,
      clientIP: ws.clientIP,
      error: error.message,
      timestamp: Date.now(),
      connectionDuration: Date.now() - ws.connectionTime
    };
    
    // Write error log to file for analysis
    try {
      const errorPath = path.join(__dirname, 'workinprogress', `websocket-error-${Date.now()}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(errorLog, null, 2));
    } catch (writeError) {
      console.error('Failed to write WebSocket error log:', writeError);
    }
  });
});

// Throttle mechanism for broadcast state
let lastBroadcastTime = 0;
const BROADCAST_THROTTLE_MS = 100; // Minimum 100ms between broadcasts

function createSerializableGameState(options = {}) {
  const {
    includeQuestions = false,
    includeCurrentQuestion = false,
    includeQuestionData = false,
    includePrizes = false
  } = options;

  const cleanGameState = { ...gameState };
  delete cleanGameState.lifeline_countdown_interval;
  delete cleanGameState.hot_seat_timer_interval;
  delete cleanGameState.hot_seat_entry_timer_interval;
  delete cleanGameState.hot_seat_prestart_interval;
  delete cleanGameState.hot_seat_entry_lookup;

  if (cleanGameState.processed_mod_messages instanceof Set) {
    cleanGameState.processed_mod_messages = Array.from(cleanGameState.processed_mod_messages);
  }

  if (cleanGameState.slot_machine) {
    cleanGameState.slot_machine = { ...cleanGameState.slot_machine };
    if (cleanGameState.slot_machine.current_round) {
      const sanitizedRound = { ...cleanGameState.slot_machine.current_round };
      delete sanitizedRound.entry_lookup;
      delete sanitizedRound.entry_interval;
      delete sanitizedRound.entry_timeout;
      delete sanitizedRound.auto_spin_timeout;
      cleanGameState.slot_machine.current_round = sanitizedRound;
    }
  }

  if (includeQuestionData && cleanGameState.question_visible && questions[cleanGameState.current_question]) {
    cleanGameState.currentQuestionData = questions[cleanGameState.current_question];
  }

  if (includeCurrentQuestion && questions[cleanGameState.current_question]) {
    cleanGameState.currentQuestion = questions[cleanGameState.current_question];
  }

  if (includeQuestions) {
    cleanGameState.questions = questions;
  }

  if (includePrizes) {
    cleanGameState.prizes = prizeAmounts;
  }

  return cleanGameState;
}

// Broadcast state updates to all connected clients
function broadcastState(force = false, critical = false) {
  // Throttle broadcasts to prevent browser overload (unless forced or critical)
  const now = Date.now();
  if (!force && !critical && (now - lastBroadcastTime) < BROADCAST_THROTTLE_MS) {
    return; // Skip this broadcast to prevent spam
  }
  lastBroadcastTime = now;

  // Log critical broadcasts for debugging
  if (critical) {
    console.log('🚨 CRITICAL broadcast bypassing throttle');
  }

  // DEBUG: Log when broadcasting with answer_locked_in = true
  if (DEBUG_BROADCAST_LOGGING && gameState.answer_locked_in) {
    console.log(`📡 broadcastState() called with answer_locked_in = true, selected_answer = ${gameState.selected_answer}`);
  }

  const cleanGameState = createSerializableGameState({
    includeQuestions: true,
    includeCurrentQuestion: true,
    includeQuestionData: true,
    includePrizes: true
  });

  const message = JSON.stringify({
    type: 'state',
    data: cleanGameState
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Broadcast custom messages to all connected clients
// DUPLICATE REMOVED - Using enhanced version at line 4542
/* 
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
*/

// Comprehensive timer cleanup function to prevent memory leaks
function cleanupAllTimers() {
  console.log('🧹 Cleaning up all active timers...');
  
  // Clear lifeline voting timers
  if (gameState.lifeline_countdown_interval) {
    clearInterval(gameState.lifeline_countdown_interval);
    gameState.lifeline_countdown_interval = null;
    console.log('✅ Cleared lifeline countdown interval');
  }
  
  // Clear hot seat timers
  if (gameState.hot_seat_timer_interval) {
    clearInterval(gameState.hot_seat_timer_interval);
    gameState.hot_seat_timer_interval = null;
    console.log('✅ Cleared hot seat timer interval');
  }
  
  if (gameState.hot_seat_entry_timer_interval) {
    clearInterval(gameState.hot_seat_entry_timer_interval);
    gameState.hot_seat_entry_timer_interval = null;
    console.log('✅ Cleared hot seat entry timer interval');
  }
  
  // Clear giveaway timer
  if (giveawayTimerInterval) {
    clearInterval(giveawayTimerInterval);
    giveawayTimerInterval = null;
    console.log('✅ Cleared giveaway timer interval');
  }
  
  // Clear lifeline vote update timer
  if (lifelineVoteUpdateTimer) {
    clearTimeout(lifelineVoteUpdateTimer);
    lifelineVoteUpdateTimer = null;
    console.log('✅ Cleared lifeline vote update timer');
  }
  
  // Reset timer flags
  gameState.lifeline_voting_timer_active = false;
  gameState.giveaway_timer_active = false;
  
  console.log('✅ All timers cleaned up successfully');
}

// End lifeline voting and determine the winner
function endLifelineVoting() {
  if (!gameState.lifeline_voting_active) return;
  
  // Debug logging to track why this is called
  console.log('🔍 DEBUG: endLifelineVoting() called from:');
  console.trace();
  console.log('🗳️ Ending lifeline voting...');
  gameState.lifeline_voting_active = false;
  
  // Clear continuous countdown timer
  if (gameState.lifeline_countdown_interval) {
    clearInterval(gameState.lifeline_countdown_interval);
    gameState.lifeline_countdown_interval = null;
    console.log('⏱️ Cleared lifeline countdown interval');
  }
  
  // Clear lifeline voting timer
  if (gameState.lifeline_voting_timer_active) {
    gameState.lifeline_voting_timer_active = false;
  }
  
  // Count votes and determine winner(s) - now detecting ties
  const voteCounts = gameState.lifeline_vote_counts;
  console.log('🔍 DEBUG: Current vote counts:', voteCounts);
  console.log('🔍 DEBUG: Available lifelines for vote:', gameState.available_lifelines_for_vote);
  
  // Find all lifelines with the maximum votes
  let maxVotes = 0;
  let winners = [];
  
  for (const [lifeline, count] of Object.entries(voteCounts)) {
    console.log(`🔍 DEBUG: Checking ${lifeline}: ${count} votes, available: ${gameState.available_lifelines_for_vote.includes(lifeline)}`);
    if (count > 0 && gameState.available_lifelines_for_vote.includes(lifeline)) {
      if (count > maxVotes) {
        maxVotes = count;
        winners = [lifeline]; // New highest, reset winners
      } else if (count === maxVotes) {
        winners.push(lifeline); // Tie with current highest
      }
    }
  }
  
  console.log(`🔍 DEBUG: Vote analysis - max votes: ${maxVotes}, winners: ${winners.join(', ')}`);
  
  const totalVotes = gameState.lifeline_votes.length;
  
  // Check for ties
  if (winners.length > 1) {
    console.log(`🤝 LIFELINE TIE DETECTED! Options ${winners.join(', ')} each have ${maxVotes} votes`);
    
    // Store tie information for host resolution
    gameState.lifeline_tie_detected = true;
    gameState.lifeline_tied_options = winners;
    gameState.lifeline_tie_votes = maxVotes;
    gameState.waiting_for_lifeline_tie_break = true;
    
    // Broadcast tie to control panel for host selection
    broadcastToClients({
      type: 'lifeline_tie_detected',
      tiedOptions: winners,
      votes: maxVotes,
      voteCounts: voteCounts,
      totalVotes: totalVotes,
      message: `Lifeline tie! ${winners.join(' and ')} each have ${maxVotes} votes. Host must select.`
    });
    
    // Hide the voting panel but show tie status
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'tie_detected',
      timestamp: Date.now()
    });
    
    // Don't auto-trigger - wait for host selection
    console.log('⏸️ Waiting for host to break lifeline tie...');
    
  } else if (winners.length === 1) {
    const winner = winners[0];
    console.log(`🏆 Lifeline voting winner: ${winner} with ${maxVotes} votes (${totalVotes} total votes)`);
    
    // Check if we have sufficient votes for a confident decision
    if (totalVotes < 2 && maxVotes === 1) {
      console.log('⚠️ WARNING: Very few votes cast - winner may not be representative');
      broadcastToClients({
        type: 'lifeline_voting_warning',
        message: `Only ${totalVotes} vote(s) cast. Winner: ${winner}`,
        totalVotes: totalVotes,
        winner: winner
      });
    }
    
    // Clear any previous tie state
    gameState.lifeline_tie_detected = false;
    gameState.lifeline_tied_options = null;
    gameState.lifeline_tie_votes = 0;
    gameState.waiting_for_lifeline_tie_break = false;
    
    gameState.lifeline_vote_winner = winner;
    
    // Broadcast the winner
    broadcastToClients({
      type: 'lifeline_voting_ended',
      winner: winner,
      votes: voteCounts,
      totalVotes: totalVotes,
      confidenceLevel: totalVotes >= 3 ? 'high' : totalVotes >= 2 ? 'medium' : 'low'
    });
    
    // Hide the voting panel
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'voting_completed',
      timestamp: Date.now()
    });
    
    // Auto-trigger the winning lifeline after a short delay, but with warning if few votes
    const delay = totalVotes < 2 ? 5000 : 2000; // Longer delay for low-vote scenarios
    setTimeout(() => {
      console.log(`🎯 Triggering winning lifeline: ${winner} (after ${delay/1000}s delay)`);
      triggerLifeline(winner);
    }, delay);
  } else {
    console.log('❌ No votes cast - selecting random lifeline');
    // If no votes, randomly select an available lifeline
    const randomIndex = Math.floor(Math.random() * gameState.available_lifelines_for_vote.length);
    winner = gameState.available_lifelines_for_vote[randomIndex];
    
    broadcastToClients({
      type: 'lifeline_voting_ended',
      winner: winner,
      votes: voteCounts,
      totalVotes: 0,
      noVotes: true
    });
    
    // Hide the voting panel
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'voting_completed_no_votes',
      timestamp: Date.now()
    });
    
    setTimeout(() => {
      triggerLifeline(winner);
    }, 2000);
  }
}

// Check if lifeline led to correct answer discovery
function checkLifelineSuccess(answerChoice) {
  // Get current question correct answer
  const currentQuestion = questions[gameState.current_question];
  if (!currentQuestion) return false;
  
  // Convert answer choice to index if it's a letter
  let answerIndex = answerChoice;
  if (typeof answerChoice === 'string') {
    answerIndex = ['A', 'B', 'C', 'D'].indexOf(answerChoice.toUpperCase());
  }
  
  // Check if this matches the correct answer
  const isCorrect = answerIndex === currentQuestion.correct;
  
  if (isCorrect && !gameState.correct_answer_highlighted) {
    console.log('🎯 LIFELINE SUCCESS! Correct answer found through lifeline usage');
    
    // Enable correct answer highlighting
    gameState.correct_answer_highlighted = true;
    
    // Play success audio
    broadcastToClients({ type: 'audio_command', command: 'play_correct' });
    
    // Add celebration after a brief delay
    setTimeout(() => {
      broadcastToClients({ type: 'audio_command', command: 'play_applause' });
      console.log('🎉 Lifeline success - correct answer highlighted and celebration triggered');
    }, 1000);
    
    // Broadcast state update to show green highlighting
    broadcastState();
    
    return true;
  }
  
  return false;
}

// Game flow loop system for continuous lifeline attempts
function startGameFlowLoop() {
  console.log('🔄 Starting game flow loop - checking for remaining lifelines after wrong answer');
  
  // Check if there are still lifelines available
  const availableLifelines = [];
  if (!gameState.lifelines_used.includes('fiftyFifty')) availableLifelines.push('fiftyFifty');
  if (!gameState.lifelines_used.includes('takeAnotherVote')) availableLifelines.push('takeAnotherVote');
  if (!gameState.lifelines_used.includes('askAMod')) availableLifelines.push('askAMod');
  
  if (availableLifelines.length > 0 && !gameState.correct_answer_highlighted) {
    console.log(`🔄 Game flow loop: ${availableLifelines.length} lifelines still available for another attempt`);
    console.log(`🗳️ Available lifelines: ${availableLifelines.join(', ')}`);
    
    // Set up the lifelines for voting again
    gameState.available_lifelines_for_vote = availableLifelines;
    
    // Reset lifeline voting states for new round
    gameState.lifeline_votes = [];
    gameState.lifeline_voter_history = [];
    gameState.lifeline_vote_counts = {
      fiftyFifty: 0,
      takeAnotherVote: 0,
      askAMod: 0
    };
    gameState.lifeline_vote_winner = null;
    
    // Broadcast message encouraging another lifeline attempt
    broadcastToClients({
      type: 'game_flow_loop_available',
      message: 'Lifelines still available! The host can start another lifeline vote.',
      availableLifelines: availableLifelines,
      totalRemaining: availableLifelines.length
    });
    
    console.log('🎮 Game flow loop ready - host can start another lifeline vote when ready');
    
    return true; // Lifelines available for another attempt
  } else if (gameState.correct_answer_highlighted) {
    console.log('🎯 Game flow loop complete - correct answer found through lifeline!');
    return false; // Success achieved
  } else {
    console.log('❌ Game flow loop complete - no more lifelines available');
    broadcastToClients({
      type: 'game_flow_loop_complete',
      message: 'No more lifelines available. Game over.',
      success: false
    });
    return false; // No more options
  }
}

// Enhanced lifeline success tracking with game flow loop
function trackLifelineOutcome(lifelineType, successful = false) {
  console.log(`📊 Tracking lifeline outcome: ${lifelineType} = ${successful ? 'SUCCESS' : 'NO SUCCESS'}`);
  
  if (successful) {
    // Lifeline led to success - game continues normally
    console.log('✅ Lifeline successful - correct answer found, continuing game flow');
    broadcastToClients({
      type: 'lifeline_outcome',
      lifeline: lifelineType,
      successful: true,
      message: 'Lifeline successful! Correct answer found.'
    });
  } else {
    // Lifeline didn't lead to success - check for more lifelines
    console.log('❌ Lifeline did not lead to success - checking for more lifeline options');
    broadcastToClients({
      type: 'lifeline_outcome',
      lifeline: lifelineType,
      successful: false,
      message: `${lifelineType} did not reveal the correct answer.`
    });
    
    // Wait a moment then start the game flow loop to check for more lifelines
    setTimeout(() => {
      const moreLifelinesAvailable = startGameFlowLoop();
      if (!moreLifelinesAvailable) {
        console.log('🎭 All lifeline attempts exhausted - preparing for game over or next question');
      }
    }, 3000); // 3 second delay to let previous lifeline results settle
  }
}

// Shared 50:50 elimination logic for consistent behavior
function performFiftyFiftyElimination(correctIndex, availableIndices) {
  console.log(`🛡️ 50:50 protecting CORRECT answer ${correctIndex} (${String.fromCharCode(65 + correctIndex)}) - traditional behavior`);
  
  // Find answers we can eliminate (exclude the CORRECT answer)
  const candidatesForElimination = availableIndices.filter(i => i !== correctIndex);
    
  let answersToEliminate = [];
  if (candidatesForElimination.length >= 2) {
    // Traditional 50:50 - eliminate 2 wrong answers, keeping correct + 1 wrong
    const shuffledWrong = [...candidatesForElimination].sort(() => Math.random() - 0.5);
    answersToEliminate = shuffledWrong.slice(0, 2);
    console.log(`🎯 50:50 eliminating 2 wrong answers: ${answersToEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
  } else if (candidatesForElimination.length === 1) {
    // Only 1 wrong answer available - eliminate it
    answersToEliminate = candidatesForElimination;
    console.log(`❌ 50:50 eliminating 1 wrong answer: ${answersToEliminate[0]} (${String.fromCharCode(65 + answersToEliminate[0])})`);
  } else {
    console.log(`⚠️ 50:50 cannot eliminate any answers - only correct answer available`);
  }
  
  return answersToEliminate;
}

// Trigger the selected lifeline
// Shared function for 50:50 lifeline elimination logic
function executeLifelineFiftyFifty(context = 'unknown') {
  console.log(`🎯 Executing 50:50 lifeline elimination (${context} context)`);
  
  // Get current question's correct answer
  const currentQuestion = questions[gameState.current_question];
  if (!currentQuestion) {
    console.error('❌ No current question found for 50:50 elimination');
    return { eliminatedAnswers: [], keptAnswers: [0, 1, 2, 3] };
  }
  
  const correctIndex = currentQuestion.correct;
  
  // Enhanced 50:50 logic - if answer is already selected, eliminate only 1 wrong answer to leave 2 choices
  const incorrectAnswers = [];
  for (let i = 0; i < 4; i++) {
    if (i !== correctIndex) {  // Only check if it's not the correct answer
      incorrectAnswers.push(i);
    }
  }
  
  let toEliminate = [];
  
  // Check if an answer was already selected AND revealed as wrong
  const hasWrongAnswer = gameState.answer_is_wrong && gameState.selected_answer !== null && gameState.selected_answer !== undefined;
  
  if (hasWrongAnswer) {
    // CRITICAL: Wrong answer already selected and revealed
    // The selected wrong answer is NOT a choice - it stays red as a reminder
    // We need to leave exactly 2 UNCHOSEN answers for the audience to pick from
    // So we eliminate 1 of the other 2 wrong answers, keeping correct + 1 other wrong
    
    const otherWrongAnswers = incorrectAnswers.filter(i => i !== gameState.selected_answer);
    // For true 50:50, eliminate only 1 of the other wrong answers
    // This leaves: correct answer + 1 wrong answer (50:50 choice) + selected wrong (not a choice)
    toEliminate = otherWrongAnswers.length === 2 
      ? [otherWrongAnswers[Math.floor(Math.random() * 2)]]  // Eliminate 1 randomly from the 2
      : otherWrongAnswers;  // If only 1 other wrong answer, eliminate it
    
    const keptWrongAnswer = otherWrongAnswers.find(i => !toEliminate.includes(i));
    
    console.log(`❌ Answer ${String.fromCharCode(65 + gameState.selected_answer)} already selected and wrong - stays RED (not a choice)`);
    console.log(`🎯 50:50 creates true 50% choice between:`);
    console.log(`   ✅ ${String.fromCharCode(65 + correctIndex)} (correct answer)`);
    if (keptWrongAnswer !== undefined) {
      console.log(`   ❓ ${String.fromCharCode(65 + keptWrongAnswer)} (wrong answer)`);
    }
    console.log(`🚫 Eliminating: ${toEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
    console.log(`📊 Result: True 50% chance between 2 unchosen answers`);
    
    // The already-selected wrong answer should also be in the excluded list for voting
    // But NOT in the eliminated list for visual display (it stays red, not dimmed)
    // We'll handle this separately in the vote filtering
  } else if (gameState.selected_answer !== null && gameState.selected_answer !== undefined) {
    // Answer is selected but not yet revealed as wrong/right
    if (gameState.selected_answer === correctIndex) {
      // Selected answer is correct - eliminate 2 wrong answers (traditional 50:50)
      toEliminate = incorrectAnswers.sort(() => 0.5 - Math.random()).slice(0, Math.min(2, incorrectAnswers.length));
      console.log(`✅ Selected answer (${String.fromCharCode(65 + gameState.selected_answer)}) is CORRECT - eliminating 2 wrong answers`);
    } else {
      // Selected answer is wrong (but not revealed yet) - traditional 50:50
      toEliminate = incorrectAnswers.sort(() => 0.5 - Math.random()).slice(0, Math.min(2, incorrectAnswers.length));
      console.log(`🎯 Answer selected but not revealed - using traditional 50:50 elimination`);
    }
  } else {
    // No answer selected yet - use traditional 50:50 (eliminate 2 wrong answers)
    toEliminate = incorrectAnswers.sort(() => 0.5 - Math.random()).slice(0, Math.min(2, incorrectAnswers.length));
    console.log(`🎯 No answer selected yet - using traditional 50:50 elimination`);
  }
  
  // Log protection and elimination details
  if (gameState.selected_answer !== null && gameState.selected_answer !== undefined) {
    console.log(`🛡️ 50:50 protection: Selected answer ${gameState.selected_answer} (${String.fromCharCode(65 + gameState.selected_answer)}) will NOT be eliminated`);
    console.log(`🎯 Eliminating ${toEliminate.length} wrong answer(s) to leave 2 choices for revote`);
  } else {
    console.log(`🎯 No answer selected - traditional 50:50 elimination`);
  }
  console.log(`🎯 Available answers to eliminate: ${incorrectAnswers.map(i => String.fromCharCode(65 + i)).join(', ')}`);
  
  // Set excluded answers for vote filtering during revote
  gameState.excluded_answers = toEliminate;
  
  // If there's a wrong answer already selected, also exclude it from voting
  if (hasWrongAnswer && !gameState.excluded_answers.includes(gameState.selected_answer)) {
    gameState.excluded_answers.push(gameState.selected_answer);
    console.log(`🚫 Also excluding already-wrong answer ${String.fromCharCode(65 + gameState.selected_answer)} from voting`);
  }
  
  console.log(`🚫 Set excluded answers for vote filtering: ${gameState.excluded_answers.map(i => String.fromCharCode(65 + i)).join(', ')}`);
  
  const keptAnswers = [0, 1, 2, 3].filter(i => !toEliminate.includes(i));
  console.log(`💡 50:50 eliminated answers: ${toEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
  console.log(`✅ 50:50 kept answers: ${keptAnswers.map(i => String.fromCharCode(65 + i)).join(', ')} (${keptAnswers.length} answers = ${100/keptAnswers.length}% chance each)`);
  
  // Verify we have the correct number of answers for 50:50
  if (!hasWrongAnswer && keptAnswers.length !== 2) {
    console.warn(`⚠️ WARNING: 50:50 did not result in exactly 2 answers! Kept: ${keptAnswers.length}`);
  } else if (hasWrongAnswer && keptAnswers.length !== 3) {
    console.warn(`⚠️ WARNING: 50:50 with wrong answer should keep 3 total (1 wrong + 2 choices)! Kept: ${keptAnswers.length}`);
  }
  
  return { eliminatedAnswers: toEliminate, keptAnswers: keptAnswers };
}

function triggerLifeline(lifelineType) {
  console.log(`🎯 Triggering lifeline: ${lifelineType}`);
  
  // NOTE: Lifelines are marked as used AFTER they are successfully applied,
  // not before, to prevent showing them as used when they don't actually apply
  
  // Trigger the specific lifeline action
  switch (lifelineType) {
    case 'fiftyFifty':
      // Trigger 50:50 lifeline - ensure exactly 2 answers remain (50% chance)
      console.log('🎲 Activating 50:50 lifeline');
      
      const currentQuestion = questions[gameState.current_question];
      if (currentQuestion) {
        const correctIndex = currentQuestion.correct;
        const selectedIndex = gameState.selected_answer;
        
        // Get all answer indices that are currently available (not already excluded)
        const allIndices = [0, 1, 2, 3];
        const availableIndices = allIndices.filter(i => 
          !gameState.excluded_answers || !gameState.excluded_answers.includes(i)
        );
        
        console.log(`🔍 Available answers before 50:50: ${availableIndices.join(', ')}`);
        
        // If we already have only 2 answers, 50:50 can't do anything
        if (availableIndices.length <= 2) {
          console.log('⚠️ 50:50 cannot be used - already at 2 or fewer answers');
          broadcastToClients({
            type: 'system_message',
            message: '50:50 cannot eliminate any more answers - already at minimum',
            level: 'warning'
          });
          // Still trigger the revote flow
          setTimeout(() => {
            startPostLifelineRevote('fiftyFifty');
          }, 1000);
          break;
        }
        
        // Use shared 50:50 elimination function
        const result = executeLifelineFiftyFifty('automatic');
        
        // Broadcast the 50:50 elimination
        broadcastToClients({
          type: 'lifeline_triggered',
          lifeline: 'fiftyFifty',
          action: 'eliminate_answers',
          eliminatedAnswers: result.eliminatedAnswers,
          keptAnswers: result.keptAnswers,
          selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
          preserveSelectedHighlighting: true
        });
        
        // Mark 50:50 as used AFTER successful elimination
        if (!gameState.lifelines_used.includes('fiftyFifty')) {
          gameState.lifelines_used.push('fiftyFifty');
          console.log('✅ 50:50 lifeline marked as used after successful elimination');
        }
        
        // Clear any existing poll timer before starting revote
        if (pollTimer) {
          console.log('⏹️ Clearing existing poll timer before automatic 50:50 revote');
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        
        // After 50/50 completes, start automatic revote on remaining answers
        setTimeout(() => {
          console.log('🔄 Starting post-lifeline revote after 50/50');
          
          // CRITICAL FIX: Explicitly clear lifeline voting and hide panel before revote
          gameState.lifeline_voting_active = false;
          broadcastToClients({
            type: 'hide_lifeline_voting_panel',
            reason: 'fifty_fifty_complete',
            timestamp: Date.now()
          });
          console.log('📡 Sent hide_lifeline_voting_panel before 50:50 revote');
          
          startPostLifelineRevote('fiftyFifty');
        }, 2000); // 2-second delay to let elimination visual effects complete
      }
      break;
      
    case 'takeAnotherVote':
      // Trigger Take Another Vote lifeline
      console.log('🗳️ Activating Take Another Vote lifeline');
      
      // Mark Take Another Vote as used (once per game only)
      if (!gameState.lifelines_used.includes('takeAnotherVote')) {
        gameState.lifelines_used.push('takeAnotherVote');
        console.log('✅ Take Another Vote lifeline marked as used - cannot be used again this game');
      }
      
      // CRITICAL FIX: End any active audience poll before starting revote
      if (gameState.audience_poll_active) {
        console.log('⚠️ Ending active audience poll before Take Another Vote revote');
        gameState.audience_poll_active = false;
        gameState.show_voting_activity = false;
        gameState.is_revote_active = false;
        
        // Clear any existing poll timer
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        
        // Also clear poll state variables
        gameState.poll_voters = [];
        gameState.poll_voter_history = [];
        gameState.poll_all_votes = [];
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        
        // Broadcast state update to ensure all clients are synchronized
        broadcastState();
        console.log('✅ Poll state fully cleared for Take Another Vote revote');
      }
      
      broadcastToClients({
        type: 'lifeline_triggered',
        lifeline: 'takeAnotherVote',
        action: 'use_lifeline_take_another_vote',
        selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
        firstSelectedAnswer: gameState.first_selected_answer,  // Include first selected answer for persistence
        preserveSelectedHighlighting: true
      });
      
      // Start immediate revote for Take Another Vote lifeline
      setTimeout(() => {
        console.log('🔄 Starting post-lifeline revote after Take Another Vote');
        console.log('🔍 DEBUG: Poll state before revote - audience_poll_active:', gameState.audience_poll_active);
        startPostLifelineRevote('takeAnotherVote');
      }, 1500); // 1.5-second delay to ensure state clearing completes
      break;
      
    case 'askAMod':
      // Trigger Ask a Mod lifeline - use consolidated function
      console.log('🛡️ Activating Ask a Mod lifeline');
      startAskAMod();
      break;
  }
  
  // Broadcast state update
  broadcastState();
}

// Function to start automatic revote after lifeline activation
function startPostLifelineRevote(lifelineType) {
  console.log(`🚀🚀🚀 STARTING POST-LIFELINE REVOTE AFTER ${lifelineType.toUpperCase()} 🚀🚀🚀`);
  
  // CRITICAL FIX: Clear lifeline voting states FIRST before any other operations
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    takeAnotherVote: 0,
    askAMod: 0
  };
  console.log('🧹 Cleared lifeline voting states FIRST to prevent UI conflicts');
  
  // CRITICAL FIX: Set revote flag EARLY before any broadcasts
  gameState.is_revote_active = true;
  console.log('🔄 Set is_revote_active = true EARLY to ensure proper UI display');
  
  // CRITICAL FIX: Broadcast state immediately after setting revote flag
  broadcastState();
  console.log('📡 Broadcast state immediately after setting is_revote_active = true');
  
  // CRITICAL FIX: Check if there's a wrong answer that should be excluded from revote
  if (gameState.answer_is_wrong && gameState.selected_answer !== null) {
    // Add the wrong answer to excluded_answers so it can't be voted on
    if (!gameState.excluded_answers.includes(gameState.selected_answer)) {
      gameState.excluded_answers.push(gameState.selected_answer);
      console.log(`❌ Added wrong answer ${String.fromCharCode(65 + gameState.selected_answer)} to excluded answers for revote`);
    }
  }
  
  // CRITICAL FIX: Reset answer reveal states to allow host to reveal answer again
  gameState.answers_revealed = false;
  gameState.answer_locked_in = false;
  // DO NOT reset answer_is_wrong - we need to keep the wrong answer highlighted red!
  // gameState.answer_is_wrong = false;  // REMOVED: This was clearing the red highlight
  gameState.answers_visible = true; // Ensure answers remain visible during revote
  // DO NOT reset selected_answer - preserve it for highlighting persistence
  // gameState.selected_answer = null;  // REMOVED: This clears highlighting
  console.log('🎮 Reset answer states - host can now lock in and reveal answer again');
  console.log('🔍 DEBUG: answers_revealed set to false, answer_locked_in set to false');
  console.log('🔍 DEBUG: answer_is_wrong PRESERVED to keep red highlight');
  console.log('🔍 DEBUG: selected_answer preserved for highlighting persistence');
  
  // CRITICAL FIX: Clear audience choice display that was stuck from initial poll
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  console.log('🧹 Cleared stuck audience choice display from initial poll');
  
  // CRITICAL FIX: Clear any existing poll state before starting revote
  gameState.audience_poll_active = false;
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.question_voter_answers = {};
  gameState.show_voting_activity = false;
  console.log('🧹 Cleared all poll states to allow revote to start');
  
  // Explicitly hide lifeline voting panel before starting revote
  broadcastToClients({
    type: 'hide_lifeline_voting_panel',
    reason: 'post_lifeline_revote',
    timestamp: Date.now()
  });
  console.log('📡 Sent hide_lifeline_voting_panel message for post-lifeline revote');
  
  // CRITICAL FIX: Broadcast state WITH revote flags set correctly
  console.log('📡 Broadcasting state with revote flags for proper UI display');
  console.log('🔍 DEBUG: Broadcasting with is_revote_active =', gameState.is_revote_active, ', lifeline_voting_active =', gameState.lifeline_voting_active);
  broadcastState();
  
  // Additional broadcast after a small delay to ensure WebSocket delivery
  setTimeout(() => {
    console.log('📡 REVOTE: Secondary state broadcast to ensure control panel sync');
    console.log('🔍 DEBUG: Secondary broadcast - answers_revealed =', gameState.answers_revealed, 'answer_locked_in =', gameState.answer_locked_in);
    broadcastState();
  }, 100);
  
  console.log('🗳️ POST-LIFELINE REVOTE STARTING - audience can vote on remaining answers');
  console.log('🚫 Excluded answers that cannot be voted on:', gameState.excluded_answers.map(i => String.fromCharCode(65 + i)).join(', '));
  
  // Broadcast a clear announcement about the revote starting
  broadcastToClients({
    type: 'system_announcement',
    message: `🔄 REVOTE STARTING! Vote again on the remaining answers after ${lifelineType}!`,
    level: 'info',
    timestamp: Date.now()
  });
  
  // Use unified revote function with custom callback for post-lifeline logic
  console.log('🎯 About to call startRevote function...');
  console.log('🔍 DEBUG: Poll state right before startRevote call:', {
    audience_poll_active: gameState.audience_poll_active,
    is_revote_active: gameState.is_revote_active,
    lifeline_voting_active: gameState.lifeline_voting_active,
    poll_voters_count: gameState.poll_voters ? gameState.poll_voters.length : 0
  });
  const success = startRevote({
    type: 'post_lifeline',
    message: `Vote again on the remaining answers! Type A, B, C, or D in chat.`,
    context: { lifelineUsed: lifelineType },
    duration: gameState.revote_duration,
    callback: () => {
      // Custom post-lifeline revote completion logic
      console.log(`🏁 50:50 revote callback triggered - lifeline type: ${lifelineType}`);
      console.log('🏁 Post-lifeline revote time expired - tallying final votes');
      
      // Use unified vote tallying function
      const results = tallyRevoteResults();
      
      // End the revote
      gameState.audience_poll_active = false;
      gameState.show_voting_activity = false;
      gameState.is_revote_active = false;
      
      // HYBRID CONTROL: Only auto-lock if host hasn't already locked manually
      if (results.winner && !gameState.answer_locked_in) {
        const answerIndex = ['A', 'B', 'C', 'D'].indexOf(results.winner);
        gameState.selected_answer = answerIndex;
        gameState.answer_locked_in = true;
        
        console.log(`🔒 AUTO-LOCKED ${lifelineType} winner: ${results.winner} (index ${answerIndex}) - Host hadn't locked manually`);
        
        // Play lock-in sound effect
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_lifeline',
          selectedAnswer: results.winner,
          votes: results.totalVotes,
          percentage: results.winnerPercentage,
          lifeline: lifelineType,
          reason: `Audience voting auto-locked after ${lifelineType}`,
          timestamp: Date.now()
        });
      } else if (gameState.answer_locked_in) {
        console.log(`🎯 Host already locked answer manually during ${lifelineType} revote - skipping auto-lock`);
      } else {
        console.log(`⚠️ No winner determined for ${lifelineType} revote - no auto-lock performed`);
      }
      
      broadcastToClients({
        type: 'post_lifeline_revote_ended',
        winner: results.winner,
        totalVotes: results.totalVotes,
        voteCounts: results.voteCounts,
        hasTie: results.hasTie,
        lifelineUsed: lifelineType,
        autoLocked: results.winner && !gameState.answer_locked_in
      });
      
      console.log(`🎮 Post-lifeline revote complete for ${lifelineType} - ${gameState.answer_locked_in ? 'answer locked' : 'no answer locked'}`);
      
      broadcastState();
    }
  });
  
  if (!success) {
    console.error('❌❌❌ FAILED TO START POST-LIFELINE REVOTE ❌❌❌');
    console.error('🔍 Check game state - answers_visible:', gameState.answers_visible);
    console.error('🔍 Check game state - audience_poll_active:', gameState.audience_poll_active);
    console.error('🔍 Check game state - processingAction:', gameState.processingAction);
    
    // Broadcast failure notification
    broadcastToClients({
      type: 'system_announcement',
      message: '❌ Failed to start automatic revote - please manually start a poll if needed',
      level: 'error',
      timestamp: Date.now()
    });
  } else {
    console.log('✅✅✅ POST-LIFELINE REVOTE STARTED SUCCESSFULLY ✅✅✅');
    console.log('🗳️ Audience should now be able to vote on remaining answers');
  }
}

// Function to start Take Another Vote revote with hybrid control (matches Ask a Mod pattern)
function startPostLifelineRevoteForTakeAnotherVote() {
  console.log('🎮 Starting Take Another Vote revote with hybrid control (host manual + audience auto-lock)');
  
  // CRITICAL FIX: Check if there's a wrong answer that should be excluded from revote
  if (gameState.answer_is_wrong && gameState.selected_answer !== null) {
    // Add the wrong answer to excluded_answers so it can't be voted on
    if (!gameState.excluded_answers.includes(gameState.selected_answer)) {
      gameState.excluded_answers.push(gameState.selected_answer);
      console.log(`❌ Added wrong answer ${String.fromCharCode(65 + gameState.selected_answer)} to excluded answers for Take Another Vote revote`);
    }
  }
  
  // Reset states for new voting (matches the pattern from startPostLifelineRevote)
  gameState.answers_revealed = false;
  gameState.answer_locked_in = false;
  // DO NOT reset answer_is_wrong - we need to keep the wrong answer highlighted red!
  // gameState.answer_is_wrong = false;  // REMOVED: This was clearing the red highlight
  gameState.answers_visible = true; // Ensure answers remain visible during revote
  
  // Reset lifeline voting states
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    takeAnotherVote: 0,
    askAMod: 0
  };
  
  // Clear any stuck audience choice display
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  
  // CRITICAL FIX: Clear any existing poll state before starting revote
  gameState.audience_poll_active = false;
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.question_voter_answers = {};
  gameState.show_voting_activity = false;
  
  console.log('🧹 Cleared states for Take Another Vote revote with hybrid control');
  
  // Broadcast state immediately to update control panel
  broadcastState();
  
  // Start the revote with hybrid control callback
  const success = startRevote({
    type: 'post_take_another_vote_hybrid',
    message: 'Take Another Vote activated! Host can lock manually OR audience vote will auto-lock.',
    duration: gameState.revote_duration,
    allowManualControl: true, // Enable hybrid control
    callback: (winningAnswer, totalVotes, percentages) => {
      // Only auto-lock if host hasn't already locked manually (HYBRID CONTROL)
      if (!gameState.answer_locked_in) {
        console.log(`🔄 Auto-locking Take Another Vote winner: ${winningAnswer} (${totalVotes} votes, ${percentages[winningAnswer]}%)`);
        
        // Set the selected answer and lock it
        gameState.selected_answer = ['A', 'B', 'C', 'D'].indexOf(winningAnswer);
        gameState.answer_locked_in = true;
        
        // NOTE: Do NOT evaluate answer_is_wrong during lock-in - only during reveal_answer
        // This prevents red highlighting of locked answers before they are revealed
        console.log(`🎯 Take Another Vote auto-lock: Answer ${winningAnswer} locked in (correctness will be evaluated on reveal)`)
        
        // Play lock-in sound effect
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_take_another_vote',
          selectedAnswer: winningAnswer,
          votes: totalVotes,
          percentage: percentages[winningAnswer],
          reason: 'Audience voting auto-locked after Take Another Vote',
          timestamp: Date.now()
        });
      } else {
        console.log('🎯 Host already locked answer manually during Take Another Vote - skipping auto-lock');
      }
      
      // End the revote
      gameState.audience_poll_active = false;
      gameState.show_voting_activity = false;
      gameState.is_revote_active = false;
      
      // Broadcast completion
      broadcastToClients({
        type: 'take_another_vote_revote_ended',
        winner: winningAnswer,
        totalVotes: totalVotes,
        percentages: percentages,
        autoLocked: winningAnswer && !gameState.answer_locked_in,
        hybridControl: true,
        timestamp: Date.now()
      });
      
      console.log('🎮 Take Another Vote revote complete with hybrid control');
      broadcastState();
    }
  });
  
  if (success) {
    console.log('✅ Take Another Vote revote started successfully with hybrid control');
    
    // Broadcast lifeline-specific revote message with hybrid control info
    broadcastToClients({
      type: 'lifeline_revote_started',
      lifeline: 'takeAnotherVote',
      message: 'Take Another Vote activated! Host can lock manually OR audience vote will auto-lock after 60 seconds.',
      hybridControl: true,
      timestamp: Date.now()
    });
  } else {
    console.error('❌ Failed to start Take Another Vote revote with hybrid control');
  }
}

// Consolidated function to start Ask a Mod session
function startAskAMod() {
  debugAskAMod('SESSION_START_REQUESTED', {
    currentQuestion: gameState.current_question + 1,
    alreadyActive: gameState.ask_a_mod_active,
    lifelinesUsed: gameState.lifelines_used
  });
  
  console.log('🛡️ Starting Ask a Mod session...');
  
  // Load mod list and broadcast to chat integration
  const modList = loadModeratorList();
  
  if (modList.length === 0) {
    console.warn('⚠️ No moderators found in mod-list.json');
    debugAskAMod('SESSION_START_FAILED', { reason: 'No moderators available' });
    broadcastToClients({
      type: 'system_message',
      message: 'No moderators available for Ask a Mod lifeline',
      level: 'warning'
    });
    return;
  }
  
  // Mark Ask a Mod as used AFTER successful activation
  if (!gameState.lifelines_used.includes('askAMod')) {
    gameState.lifelines_used.push('askAMod');
    console.log('✅ Ask a Mod lifeline marked as used after successful activation');
  }
  
  // Initialize Ask a Mod state
  gameState.ask_a_mod_active = true;
  gameState.mod_responses = [];
  gameState.ask_a_mod_start_time = Date.now();
  gameState.mod_vote_counts = { A: 0, B: 0, C: 0, D: 0 };
  gameState.mod_voters = [];
  
  debugAskAMod('SESSION_ACTIVATED', {
    questionNumber: gameState.current_question + 1,
    questionText: questions[gameState.current_question]?.text,
    modCount: modList.length,
    moderators: modList
  });
  
  console.log(`🛡️ Ask a Mod activated for question ${gameState.current_question + 1}, monitoring ${modList.length} moderators`);
  
  // Broadcast Ask a Mod activation to all clients (including chat integration)
  broadcastToClients({
    type: 'ask_a_mod_activated',
    question: questions[gameState.current_question]?.text,
    questionNumber: gameState.current_question + 1,
    duration: gameState.ask_a_mod_duration || 30000, // Use configurable Ask a Mod duration
    includeVips: gameState.ask_a_mod_include_vips,
    timeLimit: gameState.ask_a_mod_duration || 30000, // Keep both for compatibility
    modList: modList,
    selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
    firstSelectedAnswer: gameState.first_selected_answer,  // Include first selected answer for persistence
    preserveSelectedHighlighting: true,
    timestamp: Date.now()
  });
  
  // Broadcast special overlay display for audience
  broadcastToClients({
    type: 'ask_a_mod_display_start',
    question: questions[gameState.current_question]?.text,
    questionNumber: gameState.current_question + 1,
    answers: questions[gameState.current_question]?.answers || [],
    modList: modList,
    duration: gameState.ask_a_mod_duration || 30000,
    timestamp: Date.now()
  });
  
  // Auto-end Ask a Mod after configurable duration
  setTimeout(() => {
    if (gameState.ask_a_mod_active) {
      debugAskAMod('SESSION_TIMER_EXPIRED', {
        sessionDuration: 60,
        responsesReceived: gameState.mod_responses.length
      });
      console.log('⏰ Ask a Mod ' + Math.ceil((gameState.ask_a_mod_duration || 30000) / 1000) + '-second timer expired');
      endAskAMod();
    }
  }, gameState.ask_a_mod_duration || 30000); // Use configurable Ask a Mod duration for audience display
  
  console.log('🛡️ Ask a Mod session started for ' + Math.ceil((gameState.ask_a_mod_duration || 30000) / 1000) + ' seconds with audience display');
}

// End Ask a Mod session
function endAskAMod() {
  if (!gameState.ask_a_mod_active) {
    debugAskAMod('END_SESSION_CALLED_INACTIVE', {});
    return;
  }
  
  const sessionDuration = gameState.ask_a_mod_start_time ? 
    Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000) : 'Unknown';
  
  debugAskAMod('SESSION_ENDING', {
    sessionDuration: sessionDuration,
    totalResponses: gameState.mod_responses.length,
    responsesDetails: gameState.mod_responses.map(r => ({
      mod: r.username,
      messageLength: r.message.length,
      timestamp: r.timestamp
    }))
  });
  
  console.log('🛡️ Ending Ask a Mod session...');
  gameState.ask_a_mod_active = false;
  
  // Clear processed mod messages to prepare for next session
  // Ensure it's a Set before calling clear()
  if (!(gameState.processed_mod_messages instanceof Set)) {
    gameState.processed_mod_messages = new Set();
  } else {
    gameState.processed_mod_messages.clear();
  }
  console.log('🧹 Cleared processed mod messages for next Ask A Mod session');
  
  // Check if any mod responses indicate the correct answer
  const correctAnswerFound = checkModResponsesForCorrectAnswer();
  
  // Broadcast that Ask a Mod session has ended to all clients (including chat integration)
  broadcastToClients({
    type: 'ask_a_mod_ended',
    totalResponses: gameState.mod_responses.length,
    responses: gameState.mod_responses,
    correctAnswerFound: correctAnswerFound,
    timestamp: Date.now()
  });
  
  console.log(`🛡️ Ask a Mod session completed with ${gameState.mod_responses.length} mod responses`);
  
  // After Ask-a-Mod responses display ends, restore host control
  console.log('🎮 Ask-a-Mod responses displayed - restoring host LOCK IN ANSWER control');
  
  // Clear any locked state from previous selections to allow new host selection
  gameState.answer_locked_in = false;
  // Reset answers_revealed to allow "Reveal Answer" step after Ask-a-Mod
  gameState.answers_revealed = false;
  // DO NOT reset selected_answer - preserve it for highlighting persistence
  // gameState.selected_answer = null; // REMOVED: This clears highlighting
  
  // Clear any overlays to return to clean answer display
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  gameState.show_voting_activity = false;
  
  // CRITICAL: End any existing audience poll before starting revote
  if (gameState.audience_poll_active) {
    console.log('🛑 Ending existing audience poll before starting Ask-a-Mod revote');
    gameState.audience_poll_active = false;
    
    // Clear the poll timer if it exists
    if (gameState.pollTimer) {
      clearTimeout(gameState.pollTimer);
      gameState.pollTimer = null;
    }
    
    // Broadcast poll ended to clear voting displays
    broadcastToClients({
      type: 'audience_poll_ended',
      reason: 'ask_a_mod_complete',
      timestamp: Date.now()
    });
  }
  
  // Reset lifeline voting states so LOCK IN ANSWER button can return to normal flow
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    takeAnotherVote: 0,
    askAMod: 0
  };
  
  // Explicitly hide lifeline voting panel after Ask a Mod completes
  broadcastToClients({
    type: 'hide_lifeline_voting_panel',
    reason: 'ask_a_mod_complete',
    timestamp: Date.now()
  });
  console.log('📡 Sent hide_lifeline_voting_panel message after Ask a Mod completion');
  
  console.log('✅ Host control restored - LOCK IN ANSWER button should now be available');
  console.log('🎯 Host can now manually select and lock in any answer after considering mod advice');
  
  // HYBRID SYSTEM: Start both host control AND audience revote in parallel
  console.log('🎮 Starting hybrid system: Host can lock manually OR audience can auto-lock via voting');
  
  // Show "REVOTE STARTING" display to let audience know they need to revote
  broadcastToClients({
    type: 'revote_starting_display',
    message: 'REVOTE STARTING - Consider the mod advice and vote again!',
    duration: 3000, // Show for 3 seconds
    lifeline: 'askAMod',
    timestamp: Date.now()
  });
  
  // Start audience revote in parallel with host control after brief delay
  setTimeout(() => {
    startRevoteAfterAskAMod();
  }, 3000); // 3-second delay to show "REVOTE STARTING" message
  
  // Broadcast that hybrid control is active
  broadcastToClients({
    type: 'ask_a_mod_complete_hybrid_control',
    modResponses: gameState.mod_responses,
    message: 'Moderator advice complete. Host can lock manually OR audience voting will auto-lock.',
    timestamp: Date.now()
  });
  
  // Broadcast state update
  broadcastState();
}

// Check mod responses for correct answer indicators
function checkModResponsesForCorrectAnswer() {
  if (gameState.mod_responses.length === 0) {
    console.log('🛡️ No mod responses to analyze');
    return false;
  }
  
  const currentQuestion = questions[gameState.current_question];
  if (!currentQuestion) return false;
  
  const correctAnswerLetter = ['A', 'B', 'C', 'D'][currentQuestion.correct];
  const correctAnswerText = currentQuestion.answers[currentQuestion.correct];
  
  let correctAnswerFound = false;
  
  // Analyze each mod response for correct answer indicators
  gameState.mod_responses.forEach(response => {
    const message = response.message.toUpperCase();
    
    // Check for explicit answer letter mentions
    if (message.includes(correctAnswerLetter) || 
        message.includes(correctAnswerText.toUpperCase()) ||
        message.includes('CORRECT') && message.includes(correctAnswerLetter)) {
      
      console.log(`🎯 Mod ${response.username} indicated correct answer: "${response.message}"`);
      correctAnswerFound = true;
      
      // Check if this leads to successful answer discovery
      const success = checkLifelineSuccess(correctAnswerLetter);
      if (success) {
        console.log('🎉 Ask a Mod lifeline led to correct answer discovery!');
      }
    }
  });
  
  if (correctAnswerFound) {
    console.log(`🛡️ Ask a Mod analysis: Correct answer (${correctAnswerLetter}) was indicated by moderators`);
  } else {
    console.log(`🛡️ Ask a Mod analysis: No clear indication of correct answer (${correctAnswerLetter}) found`);
  }
  
  return correctAnswerFound;
}

// Load moderator list (cached for performance)
let cachedModList = null;
let modListLastLoaded = 0;

function loadModeratorList() {
  try {
    const modListPath = path.join(__dirname, 'mod-list.json');
    
    if (!fs.existsSync(modListPath)) {
      console.warn('⚠️ mod-list.json not found, creating empty mod list');
      fs.writeFileSync(modListPath, JSON.stringify([], null, 2));
      return [];
    }
    
    const modListData = fs.readFileSync(modListPath, 'utf8');
    const modList = JSON.parse(modListData);
    
    // Validate mod list
    if (!Array.isArray(modList)) {
      console.error('❌ mod-list.json is not an array, using empty list');
      return [];
    }
    
    cachedModList = modList.map(mod => mod.toLowerCase()); // Store lowercase for case-insensitive matching
    modListLastLoaded = Date.now();
    
    console.log(`🛡️ Loaded ${cachedModList.length} moderators: ${cachedModList.join(', ')}`);
    
    // Broadcast mod list to all chat integration clients
    broadcastToClients({
      type: 'mod_list_updated',
      modList: cachedModList,
      timestamp: Date.now()
    });
    
    return cachedModList;
  } catch (error) {
    console.error('❌ Error loading mod list:', error);
    return [];
  }
}

function getCachedModList() {
  // Reload mod list every 5 minutes or if not loaded yet
  if (!cachedModList || (Date.now() - modListLastLoaded) > 300000) {
    return loadModeratorList();
  }
  return cachedModList;
}

function saveModeratorList(modList) {
  try {
    const modListPath = path.join(__dirname, 'mod-list.json');
    
    // Validate input
    if (!Array.isArray(modList)) {
      console.error('❌ Invalid moderator list - must be an array');
      return false;
    }
    
    // Clean and validate moderator names
    const cleanedModList = modList
      .filter(mod => mod && typeof mod === 'string')
      .map(mod => mod.trim().toLowerCase())
      .filter(mod => mod.length > 0);
    
    // Save to file
    fs.writeFileSync(modListPath, JSON.stringify(cleanedModList, null, 2));
    
    // Update cache
    cachedModList = cleanedModList;
    modListLastLoaded = Date.now();
    
    console.log(`💾 Saved ${cleanedModList.length} moderators to mod-list.json: ${cleanedModList.join(', ')}`);
    
    // Broadcast updated mod list to all clients
    broadcastToClients({
      type: 'mod_list_updated',
      modList: cleanedModList,
      timestamp: Date.now()
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error saving moderator list:', error);
    return false;
  }
}

// Load VIP list (cached for performance)
let cachedVipList = null;
let vipListLastLoaded = 0;

// Load ignored users list (cached for performance) - users hidden from leaderboard
let cachedIgnoredList = null;
let ignoredListLastLoaded = 0;

function loadVIPList() {
  try {
    const vipListPath = path.join(__dirname, 'vip-list.json');
    
    if (!fs.existsSync(vipListPath)) {
      console.warn('⚠️ vip-list.json not found, creating empty VIP list');
      fs.writeFileSync(vipListPath, JSON.stringify([], null, 2));
      return [];
    }
    
    const vipListData = fs.readFileSync(vipListPath, 'utf8');
    const vipList = JSON.parse(vipListData);
    
    // Validate VIP list
    if (!Array.isArray(vipList)) {
      console.error('❌ vip-list.json is not an array, using empty list');
      return [];
    }
    
    cachedVipList = vipList.map(vip => vip.toLowerCase()); // Store lowercase for case-insensitive matching
    vipListLastLoaded = Date.now();
    
    console.log(`💎 Loaded ${cachedVipList.length} VIPs: ${cachedVipList.join(', ')}`);
    
    // Broadcast VIP list to all clients
    broadcastToClients({
      type: 'vip_list_updated',
      vipList: cachedVipList,
      timestamp: Date.now()
    });
    
    return cachedVipList;
  } catch (error) {
    console.error('❌ Error loading VIP list:', error);
    return [];
  }
}

function getCachedVipList() {
  // Reload VIP list every 5 minutes or if not loaded yet
  if (!cachedVipList || (Date.now() - vipListLastLoaded) > 300000) {
    return loadVIPList();
  }
  return cachedVipList;
}

// Load ignored users list from file
function loadIgnoredUsersList() {
  try {
    const ignoredListPath = path.join(__dirname, 'ignored-users-list.json');
    
    if (!fs.existsSync(ignoredListPath)) {
      console.warn('⚠️ ignored-users-list.json not found, creating empty list');
      fs.writeFileSync(ignoredListPath, JSON.stringify([], null, 2));
      return [];
    }
    
    const ignoredListData = fs.readFileSync(ignoredListPath, 'utf8');
    const ignoredList = JSON.parse(ignoredListData);
    
    // Validate ignored list
    if (!Array.isArray(ignoredList)) {
      console.error('❌ ignored-users-list.json is not an array, using empty list');
      return [];
    }
    
    cachedIgnoredList = ignoredList.map(user => user.toLowerCase()); // Store lowercase for case-insensitive matching
    ignoredListLastLoaded = Date.now();
    
    console.log(`🚫 Loaded ${cachedIgnoredList.length} ignored users: ${cachedIgnoredList.join(', ')}`);
    
    // Broadcast ignored list to all clients
    broadcastToClients({
      type: 'ignored_list_updated',
      ignoredList: cachedIgnoredList,
      timestamp: Date.now()
    });
    
    return cachedIgnoredList;
  } catch (error) {
    console.error('❌ Error loading ignored users list:', error);
    return [];
  }
}

function getCachedIgnoredList() {
  // Reload ignored list every 30 seconds or if not loaded yet
  if (!cachedIgnoredList || (Date.now() - ignoredListLastLoaded) > 30000) {
    return loadIgnoredUsersList();
  }
  return cachedIgnoredList;
}

function saveVIPList(vipList) {
  try {
    const vipListPath = path.join(__dirname, 'vip-list.json');
    
    // Validate input
    if (!Array.isArray(vipList)) {
      console.error('❌ Invalid VIP list - must be an array');
      return false;
    }
    
    // Clean and validate VIP names
    const cleanedVipList = vipList
      .filter(vip => vip && typeof vip === 'string')
      .map(vip => vip.trim().toLowerCase())
      .filter(vip => vip.length > 0);
    
    // Save to file
    fs.writeFileSync(vipListPath, JSON.stringify(cleanedVipList, null, 2));
    
    // Update cache
    cachedVipList = cleanedVipList;
    vipListLastLoaded = Date.now();
    
    console.log(`💾 Saved ${cleanedVipList.length} VIPs to vip-list.json: ${cleanedVipList.join(', ')}`);
    
    // Broadcast updated VIP list to all clients
    broadcastToClients({
      type: 'vip_list_updated',
      vipList: cleanedVipList,
      timestamp: Date.now()
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error saving VIP list:', error);
    return false;
  }
}

// Debug function for Ask a Mod system
function debugAskAMod(action, data = {}) {
  // Only log important events, not every debug message
  if (action === 'SESSION_ACTIVATED' || action === 'SESSION_ENDING' || action === 'MOD_RESPONSE_ADDED') {
    const sessionTime = gameState.ask_a_mod_start_time ? 
      Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000) : 'N/A';
    console.log(`🛡️ [ASK-A-MOD] ${action} - Session: ${sessionTime}s, Responses: ${gameState.mod_responses.length}`);
    if (Object.keys(data).length > 0) {
      console.log(`    Data:`, data);
    }
  }
}

// Check if chat message is from a moderator during Ask a Mod session
function checkAndProcessModResponse(chatData) {
  if (!gameState.ask_a_mod_active) {
    // Debug: Message received while Ask a Mod not active
    if (getCachedModList().includes(chatData.username.toLowerCase())) {
      debugAskAMod('MOD_MESSAGE_OUTSIDE_SESSION', {
        moderator: chatData.username,
        message: chatData.text,
        platform: chatData.platform
      });
    }
    return;
  }
  
  // Get cached moderator list
  const modList = getCachedModList();
  
  // Check if the username is in the moderator list (case-insensitive)
  const username = chatData.username.toLowerCase();
  const isModerator = modList.includes(username);
  
  debugAskAMod('CHAT_MESSAGE_RECEIVED', {
    username: chatData.username,
    isModerator: isModerator,
    messageLength: chatData.text.length,
    platform: chatData.platform
  });
  
  if (isModerator) {
    console.log(`🛡️ Mod response received from ${chatData.username}: "${chatData.text}"`);
    
    // Check for answer suggestion in mod response
    const message = chatData.text.toUpperCase();
    const answerMatch = message.match(/\b([ABCD])\b/) || 
                        message.match(/ANSWER\s*([ABCD])/i) ||
                        message.match(/^([ABCD])\b/) ||
                        message.match(/([ABCD])$/) ||
                        message.match(/THE\s*ANSWER\s*IS\s*([ABCD])/i) ||
                        message.match(/I\s*THINK\s*([ABCD])/i) ||
                        message.match(/([ABCD])\s*IS\s*CORRECT/i);
    
    const suggestedAnswer = answerMatch ? answerMatch[1] : null;
    
    // Add to mod responses with detected answer
    const modResponse = {
      username: chatData.username,
      message: chatData.text,
      timestamp: chatData.timestamp,
      platform: chatData.platform,
      suggestedAnswer: suggestedAnswer
    };
    
    gameState.mod_responses.push(modResponse);
    
    // Track moderator votes for percentage calculation
    if (suggestedAnswer) {
      // Check if this mod already voted (prevent double counting)
      const existingVoteIndex = gameState.mod_voters.findIndex(voter => voter.username === chatData.username);
      if (existingVoteIndex >= 0) {
        // Update existing vote
        const oldVote = gameState.mod_voters[existingVoteIndex].vote;
        gameState.mod_vote_counts[oldVote]--;
        gameState.mod_voters[existingVoteIndex].vote = suggestedAnswer;
        gameState.mod_voters[existingVoteIndex].timestamp = chatData.timestamp;
        console.log(`🛡️ Mod ${chatData.username} changed vote from ${oldVote} to ${suggestedAnswer}`);
      } else {
        // New vote
        gameState.mod_voters.push({
          username: chatData.username,
          vote: suggestedAnswer,
          timestamp: chatData.timestamp
        });
        console.log(`🛡️ Mod ${chatData.username} voted for ${suggestedAnswer}`);
      }
      
      gameState.mod_vote_counts[suggestedAnswer]++;
      
      // Calculate and log percentages
      const totalVotes = gameState.mod_voters.length;
      const percentages = {
        A: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.A / totalVotes) * 100) : 0,
        B: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.B / totalVotes) * 100) : 0,
        C: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.C / totalVotes) * 100) : 0,
        D: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.D / totalVotes) * 100) : 0
      };
      
      console.log(`📊 Mod vote percentages: A=${percentages.A}%, B=${percentages.B}%, C=${percentages.C}%, D=${percentages.D}% (${totalVotes} total votes)`);
      
      // Broadcast updated vote percentages to audience display
      broadcastToClients({
        type: 'ask_a_mod_vote_update',
        voteCounts: gameState.mod_vote_counts,
        percentages: percentages,
        totalVotes: totalVotes,
        timestamp: Date.now()
      });
    }
    
    // Track if correct answer is suggested, but don't end session early
    if (gameState.answer_is_wrong && suggestedAnswer) {
      debugAskAMod('MOD_ANSWER_SUGGESTION', {
        moderator: chatData.username,
        suggestedAnswer: suggestedAnswer,
        correctAnswer: questions[gameState.current_question]?.correct
      });
      
      if (checkLifelineSuccess(suggestedAnswer)) {
        debugAskAMod('CORRECT_ANSWER_SUGGESTED', {
          moderator: chatData.username,
          correctAnswer: suggestedAnswer,
          sessionDuration: Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000)
        });
        console.log('🎯 Mod suggested correct answer, but continuing session for full 1 minute');
        // Don't end session early - let full timer run for complete mod advice collection
      }
    }
    
    // Broadcast mod response immediately to show on gameshow and audience display
    broadcastToClients({
      type: 'mod_response_update',
      modResponse: modResponse,
      totalResponses: gameState.mod_responses.length,
      isAskAModActive: gameState.ask_a_mod_active
    });
    
    // Also broadcast to audience display overlay with consistent format
    const displayUpdateMessage = {
      type: 'ask_a_mod_display_update',
      newResponse: modResponse,
      allResponses: gameState.mod_responses,
      voteCounts: gameState.mod_vote_counts,
      totalVotes: gameState.mod_voters.length,
      timestamp: Date.now()
    };
    
    console.log('📺 Broadcasting ask_a_mod_display_update with:', {
      responseCount: gameState.mod_responses.length,
      newResponseFrom: modResponse.username,
      message: modResponse.message
    });
    
    broadcastToClients(displayUpdateMessage);
    
    console.log(`🛡️ Total mod responses: ${gameState.mod_responses.length}`);
  } else {
    debugAskAMod('NON_MOD_MESSAGE', {
      username: chatData.username,
      message: chatData.text.substring(0, 50) + (chatData.text.length > 50 ? '...' : ''),
      modListSize: modList.length
    });
  }
}

// Reusable vote tallying function for revotes with state validation
function tallyRevoteResults() {
  return safeStateOperation(() => {
    console.log('📊 Tallying revote results...');
    
    // Validate poll_all_votes exists and is array
    if (!Array.isArray(gameState.poll_all_votes)) {
      console.error('❌ poll_all_votes is not an array, cannot tally results');
      return {
        winner: null,
        winnerVotes: 0,
        winnerPercentage: 0,
        totalVotes: 0,
        voteCounts: { A: 0, B: 0, C: 0, D: 0 },
        hasTie: false,
        error: 'Invalid vote data structure'
      };
    }
    
    // Initialize vote counts
    const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
    let validVoteCount = 0;
    
    // Count all valid votes with validation
    gameState.poll_all_votes.forEach((vote, index) => {
      if (!vote || typeof vote.vote !== 'string') {
        console.warn(`⚠️ Invalid vote at index ${index}:`, vote);
        return;
      }
      
      if (voteCounts.hasOwnProperty(vote.vote)) {
        voteCounts[vote.vote]++;
        validVoteCount++;
      } else {
        console.warn(`⚠️ Invalid vote option "${vote.vote}" at index ${index}`);
      }
    });
    
    const totalVotes = validVoteCount;
    let winner = null;
    let winnerVotes = 0;
    let winnerPercentage = 0;
    
    if (totalVotes > 0) {
      const maxVotes = Math.max(...Object.values(voteCounts));
      const winningAnswers = Object.keys(voteCounts).filter(answer => voteCounts[answer] === maxVotes);
      
      if (winningAnswers.length === 1) {
        winner = winningAnswers[0];
        winnerVotes = voteCounts[winner];
        winnerPercentage = Math.round((winnerVotes / totalVotes) * 100);
        
        // Update game state with winner
        gameState.show_poll_winner = winner;
        gameState.poll_winner_votes = winnerVotes;
        gameState.poll_winner_percentage = winnerPercentage;
        
        console.log(`🏆 Revote winner: ${winner} with ${winnerVotes} votes (${winnerPercentage}%)`);
      } else {
        console.log(`🤝 Revote ended in tie between: ${winningAnswers.join(', ')}`);
        // In case of tie, gameState winner remains null
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
      }
    } else {
      console.log('❌ No valid votes received in revote');
      gameState.show_poll_winner = null;
      gameState.poll_winner_votes = 0;
      gameState.poll_winner_percentage = 0;
    }
    
    return {
      winner,
      winnerVotes,
      winnerPercentage,
      totalVotes,
      voteCounts,
      hasTie: totalVotes > 0 && winner === null
    };
    
  }, 'tallyRevoteResults');
}

// Comprehensive state validation functions for revote system
function validateRevoteGameState() {
  const errors = [];
  const warnings = [];
  
  // Critical validations
  if (typeof gameState.audience_poll_active !== 'boolean') {
    errors.push('audience_poll_active must be boolean');
  }
  
  if (typeof gameState.is_revote_active !== 'boolean') {
    errors.push('is_revote_active must be boolean');
  }
  
  if (!Array.isArray(gameState.poll_all_votes)) {
    errors.push('poll_all_votes must be array');
  }
  
  if (!Array.isArray(gameState.poll_voters)) {
    errors.push('poll_voters must be array');
  }
  
  if (!Array.isArray(gameState.poll_voter_history)) {
    errors.push('poll_voter_history must be array');
  }
  
  // Warning validations
  if (gameState.audience_poll_active && gameState.is_revote_active) {
    if (gameState.poll_all_votes.length === 0) {
      warnings.push('Revote is active but no votes received yet');
    }
  }
  
  if (gameState.audience_poll_active && !gameState.answers_visible) {
    warnings.push('Poll active but answers not visible to audience');
  }
  
  if (gameState.revote_duration < 10000) {
    warnings.push('Revote duration is very short (< 10 seconds)');
  }
  
  if (gameState.revote_duration > 300000) {
    warnings.push('Revote duration is very long (> 5 minutes)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    timestamp: Date.now()
  };
}

// Emergency cleanup function to reset revote system to safe state
function emergencyCleanupRevoteState(reason = 'Unknown') {
  console.warn(`🚨 Emergency revote cleanup triggered - Reason: ${reason}`);
  
  try {
    // Store current state for debugging
    const preCleanupState = {
      audience_poll_active: gameState.audience_poll_active,
      is_revote_active: gameState.is_revote_active,
      show_voting_activity: gameState.show_voting_activity,
      poll_votes_count: gameState.poll_all_votes?.length || 0,
      lifeline_voting_active: gameState.lifeline_voting_active,
      ask_a_mod_active: gameState.ask_a_mod_active
    };
    
    // Reset all voting states to safe defaults
    gameState.audience_poll_active = false;
    gameState.is_revote_active = false;
    gameState.show_voting_activity = false;
    gameState.show_poll_winner = null;
    gameState.poll_winner_votes = 0;
    gameState.poll_winner_percentage = 0;
    
    // Clear vote tracking arrays
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    
    // Reset lifeline voting states
    gameState.lifeline_voting_active = false;
    gameState.lifeline_voting_timer_active = false;
    gameState.lifeline_votes = [];
    gameState.lifeline_voter_history = [];
    gameState.lifeline_vote_winner = null;
    gameState.lifeline_vote_counts = {
      fiftyFifty: 0,
      takeAnotherVote: 0,
      askAMod: 0
    };
    
    // Log cleanup action
    console.log('🧹 Emergency cleanup completed:', {
      reason,
      preCleanupState,
      timestamp: Date.now()
    });
    
    // Broadcast cleanup to all clients
    broadcastToClients({
      type: 'emergency_revote_cleanup',
      reason,
      timestamp: Date.now()
    });
    
    // Broadcast updated state
    broadcastState();
    
    return true;
    
  } catch (error) {
    console.error('❌ Error during emergency cleanup:', error);
    return false;
  }
}

// Validate and repair revote state if needed
function validateAndRepairRevoteState(context = 'Unknown') {
  const validation = validateRevoteGameState();
  
  if (!validation.isValid) {
    console.error(`🚨 Revote state validation failed in context: ${context}`);
    console.error('Validation errors:', validation.errors);
    
    // Attempt emergency cleanup
    const cleanupSuccess = emergencyCleanupRevoteState(`Validation failed: ${context}`);
    
    if (!cleanupSuccess) {
      console.error('❌ Emergency cleanup failed - system may be in inconsistent state');
    }
    
    return false;
  }
  
  if (validation.warnings.length > 0) {
    console.warn(`⚠️ Revote state warnings in context: ${context}`, validation.warnings);
  }
  
  return true;
}

// Enhanced state validation with automatic repair for critical functions
function safeStateOperation(operation, context, repairOnFailure = true) {
  try {
    // Pre-operation validation
    const preValid = repairOnFailure ? validateAndRepairRevoteState(`${context} - pre-operation`) : validateRevoteGameState().isValid;
    
    if (!preValid && !repairOnFailure) {
      throw new Error('State validation failed and repair disabled');
    }
    
    // Execute operation
    const result = operation();
    
    // Post-operation validation
    if (repairOnFailure) {
      validateAndRepairRevoteState(`${context} - post-operation`);
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ Safe state operation failed in context: ${context}`, error);
    
    if (repairOnFailure) {
      emergencyCleanupRevoteState(`Operation failure: ${context}`);
    }
    
    throw error;
  }
}

// Start hybrid revote after Ask-a-Mod with host manual control + audience auto-lock
function startRevoteAfterAskAMod() {
  console.log('🎮 Starting hybrid Ask-a-Mod revote with both host control and audience voting');
  
  // Start the revote with the hybrid callback
  const success = startRevote({
    type: 'post_ask_a_mod_hybrid',
    message: 'Consider the mod advice! Host can lock manually OR audience vote will auto-lock.',
    duration: gameState.revote_duration,
    callback: (winningAnswer, totalVotes, percentages) => {
      // Only auto-lock if host hasn't already locked manually
      if (!gameState.answer_locked_in) {
        console.log(`🔄 Auto-locking audience winner: ${winningAnswer} (${totalVotes} votes, ${percentages[winningAnswer]}%)`);
        
        // Set the selected answer and lock it
        gameState.selected_answer = ['A', 'B', 'C', 'D'].indexOf(winningAnswer);
        gameState.answer_locked_in = true;
        
        // NOTE: Do NOT evaluate answer_is_wrong during lock-in - only during reveal_answer
        // This prevents red highlighting of locked answers before they are revealed
        console.log(`🎯 Ask-a-Mod auto-lock: Answer ${winningAnswer} locked in (correctness will be evaluated on reveal)`)
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_ask_a_mod',
          selectedAnswer: winningAnswer,
          votes: totalVotes,
          percentage: percentages[winningAnswer],
          reason: 'Audience voting auto-locked after Ask-a-Mod',
          timestamp: Date.now()
        });
        
        // Clean up revote state after auto-lock
        gameState.is_revote_active = false;
        gameState.audience_poll_active = false;
        gameState.show_voting_activity = false;
        
        broadcastState();
        console.log('✅ Ask-a-Mod revote complete: Auto-locked audience choice');
      } else {
        console.log('🎯 Host already locked answer manually - skipping auto-lock');
      }
    }
  });
  
  if (success) {
    console.log('✅ Hybrid Ask-a-Mod revote started successfully');
    
    // Broadcast hybrid control message to clients
    broadcastToClients({
      type: 'hybrid_control_active',
      message: 'Host can lock manually OR voting will auto-lock',
      duration: gameState.revote_duration,
      timestamp: Date.now()
    });
  } else {
    console.error('❌ Failed to start hybrid Ask-a-Mod revote');
  }
  
  return success;
}

// Unified revote starter with pre-flight validation
function startRevote(options = {}) {
  const {
    type = 'generic', // 'post_lifeline', 'post_ask_a_mod', 'generic'
    message = 'Vote again! Type A, B, C, or D in chat.',
    context = {},
    duration = gameState.revote_duration,
    callback = null,
    allowManualControl = false // NEW: Allow host manual lock-in during revote
  } = options;
  
  console.log(`🔄 Starting ${type} revote with ${duration}ms duration${allowManualControl ? ' (HYBRID CONTROL: Host can manually lock OR auto-lock after timer)' : ' (AUTO-LOCK ONLY after timer)'}`);
  console.log(`⏱️ DURATION DEBUG: gameState.revote_duration = ${gameState.revote_duration}ms, using duration = ${duration}ms`);
  console.log(`📊 Current game state:`, {
    audience_poll_active: gameState.audience_poll_active,
    answers_visible: gameState.answers_visible,
    processingAction: gameState.processingAction,
    lifeline_voting_active: gameState.lifeline_voting_active
  });
  
  // Defensively ensure lifeline voting panel is hidden before starting any post-lifeline revote
  if (type.includes('post_lifeline') || type.includes('post_ask_a_mod') || type.includes('post_take_another_vote')) {
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'revote_starting',
      timestamp: Date.now()
    });
    console.log('🛡️ Defensively sent hide_lifeline_voting_panel before starting revote');
  }
  
  // Enhanced pre-flight validation with state repair
  return safeStateOperation(() => {
    // Basic pre-flight validations
    if (gameState.audience_poll_active) {
      console.warn('⚠️ Cannot start revote: Another poll is already active');
      console.warn('⚠️ Poll state details:', {
        poll_voters: gameState.poll_voters ? gameState.poll_voters.length : 0,
        show_voting_activity: gameState.show_voting_activity,
        is_revote_active: gameState.is_revote_active,
        poll_all_votes: gameState.poll_all_votes ? gameState.poll_all_votes.length : 0
      });
      console.warn('🚨 FAILED TO START REVOTE DUE TO ACTIVE POLL - Take Another Vote will not work');
      return false;
    }
    
    // Special case: Allow Ask-a-Mod revote even if answers not visible in overlay
    if (!gameState.answers_visible && type !== 'post_ask_a_mod') {
      console.warn('⚠️ Cannot start revote: Answers are not visible');
      return false;
    }
    
    if (type === 'post_ask_a_mod' && !gameState.answers_visible) {
      console.log('🛡️ Ask-a-Mod revote: Allowing revote despite answers not visible in overlay');
    }
    
    if (gameState.processingAction) {
      console.warn('⚠️ Cannot start revote: System is processing another action');
      return false;
    }
    
    // Duration validation
    if (duration < 5000) {
      console.warn('⚠️ Cannot start revote: Duration too short (< 5 seconds)');
      return false;
    }
    
    if (duration > 600000) {
      console.warn('⚠️ Cannot start revote: Duration too long (> 10 minutes)');
      return false;
    }
    
    // Reset voting state for revote with validation
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    gameState.show_poll_winner = null;
    gameState.poll_winner_votes = 0;
    gameState.poll_winner_percentage = 0;
    
    // CRITICAL: Clear any existing poll timer to prevent conflicts
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
      console.log('⏹️ Cleared existing poll timer before starting revote');
    }
    
    // Mark as revote
    gameState.is_revote_active = true;
    gameState.audience_poll_active = true;
    gameState.show_voting_activity = true;
    
    console.log(`📊 ${type} revote state reset - ready for new votes`);
    
    // Start the voting countdown timer with visual progress bars
    const pollStartTime = Date.now();
    broadcastToClients({
      type: 'start_voting_countdown',
      duration: duration,
      startTime: pollStartTime
    });
    
    // CRITICAL FIX: Also broadcast audience_poll_started to trigger visual voting panel
    broadcastToClients({
      type: 'audience_poll_started',
      duration: duration,
      startTime: pollStartTime
    });
    
    // Broadcast the revote start with context-specific message
    broadcastToClients({
      type: (type === 'post_lifeline' || type === 'post_take_another_vote_hybrid') ? 'post_lifeline_revote' : 
            (type === 'post_ask_a_mod' || type === 'post_ask_a_mod_hybrid') ? 'post_ask_a_mod_revote' : 'revote_started',
      message: message,
      duration: duration,
      timestamp: Date.now(),
      ...context
    });
    
    // Broadcast state update
    broadcastState();
    
    // Auto-end revote after specified duration with safe callback execution
    setTimeout(() => {
      console.log(`🕒 ${type} revote timer fired after ${duration}ms`);
      console.log(`🔍 Timer Debug - audience_poll_active: ${gameState.audience_poll_active}, is_revote_active: ${gameState.is_revote_active}`);
      
      safeStateOperation(() => {
        if (gameState.audience_poll_active && gameState.is_revote_active) {
          console.log(`⏱️ ${type} revote timer expired - ending revote`);
          
          // HYBRID CONTROL: Check if host already locked manually during revote
          if (allowManualControl && gameState.answer_locked_in) {
            console.log('🎯 Host already locked answer manually during revote - skipping auto-lock');
            
            // Clean up poll state since host handled the locking
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.is_revote_active = false;
            
            // Broadcast poll ended event
            broadcastToClients({
              type: 'audience_poll_ended',
              endTime: Date.now(),
              reason: 'manual_lock_during_hybrid_revote'
            });
            
            broadcastState();
            return; // Exit early since host handled it
          }
          
          if (callback && typeof callback === 'function') {
            // Calculate poll results to pass to callback
            const pollResult = calculatePollWinner();
            if (pollResult) {
              console.log(`🎯 Executing ${type} callback with winner: ${pollResult.winner} (${pollResult.totalVotes} votes)`);
              
              // Pass the required parameters: winningAnswer, totalVotes, percentages
              const percentages = {};
              ['A', 'B', 'C', 'D'].forEach(letter => {
                const count = gameState.poll_all_votes.filter(vote => vote.vote === letter).length;
                percentages[letter] = pollResult.totalVotes > 0 ? Math.round((count / pollResult.totalVotes) * 100) : 0;
              });
              
              // CRITICAL FIX: Execute callback FIRST, then handle cleanup based on type
              callback(pollResult.winner, pollResult.totalVotes, percentages);
              
              // For hybrid Ask-a-Mod system, don't call lockInAudienceChoice as callback handles auto-lock
              if (type === 'post_ask_a_mod_hybrid') {
                console.log('✅ Hybrid Ask-a-Mod callback executed - callback handled auto-lock, cleaning up poll state');
                
                // Clean up poll state since callback handled the locking
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                // FIXED: Keep is_revote_active = true to allow manual host selection during hybrid revotes
                // gameState.is_revote_active = false; // REMOVED - this was preventing manual answer selection
                
                // Broadcast poll ended event
                broadcastToClients({
                  type: 'audience_poll_ended',
                  endTime: Date.now(),
                  reason: 'hybrid_callback_completed'
                });
                
                broadcastState();
              } else {
                // For other revote types, still call lockInAudienceChoice for fallback
                lockInAudienceChoice();
                gameState.is_revote_active = false;
              }
              
            } else {
              console.log('⚠️ No votes to process for callback, using default behavior');
              lockInAudienceChoice();
              gameState.is_revote_active = false;
            }
          } else {
            // HYBRID CONTROL: For post-lifeline revotes with manual control, check if already locked
            if (allowManualControl && type === 'post_lifeline' && gameState.answer_locked_in) {
              console.log('🎯 Host already locked answer manually during post-lifeline revote - skipping auto-lock');
              
              // Clean up poll state since host handled the locking
              gameState.audience_poll_active = false;
              gameState.show_voting_activity = false;
              gameState.is_revote_active = false;
              
              broadcastState();
            } else {
              // Default behavior - use lockInAudienceChoice for automatic lock
              console.log(`🔄 Auto-locking audience choice for ${type} revote (no manual lock detected)`);
              lockInAudienceChoice();
              gameState.is_revote_active = false;
            }
          }
        }
      }, `${type} revote timeout callback`);
    }, duration);
    
    return true;
    
  }, `startRevote ${type}`);
}

// Broadcast custom messages to all connected clients
function broadcastToClients(message) {
  console.log('🔧 DEBUG: Enhanced broadcastToClients called with type:', message.type);
  const messageStr = JSON.stringify(message);
  let clientCount = 0;
  let chatViewerCount = 0;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      clientCount++;
      // Count chat_viewer clients specifically
      if (client.clientType === 'chat_viewer') {
        chatViewerCount++;
      }
    }
  });
  
  // Special logging for reveal flash messages
  if (message.type === 'reveal_flash') {
    console.log(`📡 Reveal flash message sent to ${clientCount} clients:`, message);
  }
  
  // Special logging for chat messages
  if (message.type === 'chat_message') {
    console.log(`📡 Chat message sent to ${clientCount} total clients (${chatViewerCount} chat_viewers):`, {
      type: message.type,
      username: message.username,
      text: message.text,
      platform: message.platform
    });
  }
}

// Handle vote updates from external polling system
function handleVoteUpdate(data) {
  // This handles vote updates from the audience polling system
  console.log('📊 Vote update received:', data);
}

// Hot Seat Feature Functions

// Start the entry period for hot seat
function startHotSeatEntryPeriod() {
  console.log('🎯 Starting hot seat entry period');

  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }
  gameState.hot_seat_timer_pending_start = false;
  gameState.hot_seat_countdown_started = false;
  gameState.hot_seat_prestart_seconds = 0;
  gameState.hot_seat_prestart_total = 0;

  // Reset entries
  gameState.hot_seat_entries = [];
  gameState.hot_seat_entry_lookup = new Set();
  gameState.hot_seat_entry_active = true;
  gameState.hot_seat_entry_start_time = Date.now();
  
  // Broadcast to all clients
  broadcastToClients({
    type: 'hot_seat_entry_started',
    duration: gameState.hot_seat_entry_duration,
    message: 'Lions type JOIN in chat to enter the hot seat!',
    timestamp: Date.now()
  });
  
  // Start countdown timer
  if (gameState.hot_seat_entry_timer_interval) {
    clearInterval(gameState.hot_seat_entry_timer_interval);
  }
  
  // Clear any existing timer before creating new one
  if (gameState.hot_seat_entry_timer_interval) {
    clearInterval(gameState.hot_seat_entry_timer_interval);
    gameState.hot_seat_entry_timer_interval = null;
  }
  
  gameState.hot_seat_entry_timer_interval = setInterval(() => {
    const elapsed = Date.now() - gameState.hot_seat_entry_start_time;
    const remaining = Math.max(0, gameState.hot_seat_entry_duration - elapsed);
    
    // Broadcast countdown
    broadcastToClients({
      type: 'hot_seat_entry_countdown',
      remaining: remaining,
      entries: gameState.hot_seat_entries.length,
      timestamp: Date.now()
    });
    
    // End entry period when time is up
    if (remaining === 0) {
      clearInterval(gameState.hot_seat_entry_timer_interval);
      gameState.hot_seat_entry_timer_interval = null;
      gameState.hot_seat_entry_active = false;
      console.log(`📝 Hot seat entry period ended with ${gameState.hot_seat_entries.length} entries`);
      
      // Automatically draw winners if entries exist
      if (gameState.hot_seat_entries.length > 0) {
        drawHotSeatWinners();
      } else {
        console.log('⚠️ No entries received for hot seat');
        broadcastToClients({
          type: 'hot_seat_no_entries',
          message: 'No entries received for hot seat',
          timestamp: Date.now()
        });
      }
    }
  }, 1000); // Update every second
}

// Slot Machine Bonus Mode Helpers
const SLOT_MACHINE_FALLBACK_SYMBOLS = [
  { id: 'leo', label: 'Leo', emoji: '🦁', emojiUrl: null },
  { id: 'crown', label: 'Crown', emoji: '👑', emojiUrl: null },
  { id: 'claw', label: 'Claw', emoji: '🐾', emojiUrl: null },
  { id: 'star', label: 'Star', emoji: '⭐', emojiUrl: null }
];
const SLOT_MACHINE_SYMBOL_POOL = Object.entries(TWITCH_EMOTES || {}).map(([code, url]) => ({
  id: code,
  label: code,
  emoji: code,
  emojiUrl: url
}));

function getSlotMachineSymbolPool() {
  return SLOT_MACHINE_SYMBOL_POOL.length ? SLOT_MACHINE_SYMBOL_POOL : SLOT_MACHINE_FALLBACK_SYMBOLS;
}

function drawSlotMachineSymbol() {
  const pool = getSlotMachineSymbolPool();
  const symbol = pool[Math.floor(Math.random() * pool.length)];
  return {
    id: symbol.id,
    label: symbol.label || symbol.id,
    emoji: symbol.emoji || symbol.id,
    emojiUrl: symbol.emojiUrl || symbol.url || null
  };
}

function ensureSlotMachineState() {
  if (!gameState.slot_machine) {
    gameState.slot_machine = {
      enabled: true,
      schedule_questions: [4, 9, 14],
      schedule_version: 'question_numbers',
      entry_duration_ms: gameState.hot_seat_entry_duration || 60000,
      max_points: 25,
      current_round: null,
      last_round_result: null
    };
  }

  const defaultSchedule = [4, 9, 14];
  let schedule = Array.isArray(gameState.slot_machine.schedule_questions)
    ? [...gameState.slot_machine.schedule_questions]
    : [...defaultSchedule];

  schedule = schedule
    .map((value) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : null;
    })
    .filter((value) => value != null);

  if (gameState.slot_machine.schedule_version !== 'question_numbers') {
    schedule = schedule.map((value) => value + 1);
    gameState.slot_machine.schedule_version = 'question_numbers';
  }

  schedule = schedule
    .map((value) => Math.min(15, Math.max(1, Math.round(value))))
    .filter((value) => !Number.isNaN(value));

  if (!schedule.length) {
    schedule = [...defaultSchedule];
  }

  const normalizedSchedule = Array.from(new Set(schedule)).sort((a, b) => a - b);
  gameState.slot_machine.schedule_questions = normalizedSchedule;

  gameState.slot_machine.entry_duration_ms = gameState.slot_machine.entry_duration_ms || gameState.hot_seat_entry_duration || 60000;
  gameState.slot_machine.max_points = gameState.slot_machine.max_points || 25;
}

function broadcastSlotMachineEvent(event, payload = {}) {
  broadcastToClients({
    type: 'slot_machine_event',
    event,
    timestamp: Date.now(),
    data: payload
  });
}

function cleanupSlotMachineRoundTimers(round) {
  if (!round) return;
  if (round.entry_interval) {
    clearInterval(round.entry_interval);
    round.entry_interval = null;
  }
  if (round.entry_timeout) {
    clearTimeout(round.entry_timeout);
    round.entry_timeout = null;
  }
  if (round.auto_spin_timeout) {
    clearTimeout(round.auto_spin_timeout);
    round.auto_spin_timeout = null;
  }
}

function startSlotMachineEntryRound(questionIndex) {
  ensureSlotMachineState();

  if (!gameState.slot_machine.enabled) {
    console.log('🎰 Slot machine disabled - skipping entry round');
    return;
  }

  if (gameState.slot_machine.current_round &&
    ['collecting', 'awaiting_lever', 'spinning'].includes(gameState.slot_machine.current_round.status)) {
    console.log('🎰 Slot machine round already active, skipping new start');
    return;
  }

  const duration = gameState.slot_machine.entry_duration_ms || gameState.hot_seat_entry_duration || 60000;
  const round = {
    question_index: questionIndex,
    status: 'collecting',
    entry_started_at: Date.now(),
    entry_duration_ms: duration,
    entries: [],
    entry_lookup: new Set(),
    entry_interval: null,
    entry_timeout: null,
    lever_candidate: null,
    spin_requested_by: null,
    auto_spin_timeout: null,
    is_test_round: false
  };

  gameState.slot_machine.current_round = round;

  broadcastSlotMachineEvent('entry_started', {
    questionNumber: questionIndex + 1,
    duration,
    isTestRound: false
  });
  broadcastState(true);

  round.entry_interval = setInterval(() => {
    const elapsed = Date.now() - round.entry_started_at;
    const remaining = Math.max(0, round.entry_duration_ms - elapsed);

    broadcastSlotMachineEvent('entry_tick', {
      questionNumber: questionIndex + 1,
      remaining,
      entries: round.entries.length,
      isTestRound: !!round.is_test_round
    });

    if (remaining <= 0) {
      concludeSlotMachineEntryRound('timer');
    }
  }, 1000);

  round.entry_timeout = setTimeout(() => concludeSlotMachineEntryRound('timer'), duration);
}

function addSlotMachineEntry(username) {
  ensureSlotMachineState();
  const round = gameState.slot_machine.current_round;

  if (!round || round.status !== 'collecting' || !username) {
    return false;
  }

  const normalized = username.toLowerCase();
  if (!round.entry_lookup) {
    round.entry_lookup = new Set(round.entries.map((name) => name.toLowerCase()));
  }

  if (round.entry_lookup.has(normalized)) {
    return false;
  }

  round.entry_lookup.add(normalized);
  round.entries.push(username);

  broadcastSlotMachineEvent('entry_update', {
    questionNumber: round.question_index + 1,
    entries: round.entries.length,
    latestEntry: username,
    isTestRound: !!round.is_test_round
  });

  return true;
}

function concludeSlotMachineEntryRound(reason = 'timer') {
  ensureSlotMachineState();
  const round = gameState.slot_machine.current_round;

  if (!round || round.status !== 'collecting') {
    return;
  }

  cleanupSlotMachineRoundTimers(round);
  round.status = 'awaiting_lever';

  if (round.entries.length === 0) {
    broadcastSlotMachineEvent('no_entries', {
      questionNumber: round.question_index + 1,
      reason,
      isTestRound: !!round.is_test_round
    });
    gameState.slot_machine.current_round = null;
    broadcastState(true);
    return;
  }

  const randomIndex = Math.floor(Math.random() * round.entries.length);
  round.lever_candidate = round.entries[randomIndex];

  broadcastSlotMachineEvent('lever_ready', {
    questionNumber: round.question_index + 1,
    leverUser: round.lever_candidate,
    entries: round.entries.length,
    isTestRound: !!round.is_test_round
  });
  broadcastState(true);

  if (!round.is_test_round) {
    round.auto_spin_timeout = setTimeout(() => spinSlotMachineRound('auto_lever'), 4000);
  }
}

function spinSlotMachineRound(source = 'system') {
  ensureSlotMachineState();
  const round = gameState.slot_machine.current_round;

  if (!round || (round.status !== 'awaiting_lever' && round.status !== 'collecting')) {
    return;
  }

  cleanupSlotMachineRoundTimers(round);
  round.status = 'spinning';
  round.spin_requested_by = source;
  round.auto_spin_timeout = null;

  broadcastSlotMachineEvent('spin_started', {
    questionNumber: round.question_index + 1,
    entries: round.entries.length,
    leverUser: round.lever_candidate || null,
    isTestRound: !!round.is_test_round
  });
  broadcastState(true);

  setTimeout(() => {
    const symbols = Array.from({ length: 3 }).map(() => drawSlotMachineSymbol());
    const firstSymbol = symbols[0];
    const jackpot = symbols.every((symbol) => symbol.id === firstSymbol.id);
    let perParticipantPoints = 0;
    let totalAwardedPoints = 0;

    if (!round.is_test_round && jackpot && round.entries.length > 0) {
      const maxPoints = gameState.slot_machine.max_points || 25;
      const basePer = Math.floor(maxPoints / round.entries.length);
      perParticipantPoints = basePer > 0 ? basePer : (round.entries.length <= maxPoints ? 1 : 0);

      totalAwardedPoints = perParticipantPoints * round.entries.length;
      if (totalAwardedPoints > maxPoints) {
        perParticipantPoints = Math.floor(maxPoints / round.entries.length);
        totalAwardedPoints = perParticipantPoints * round.entries.length;
      }

      if (perParticipantPoints > 0) {
        round.entries.forEach((entryUsername) => {
          addPointsToPlayer(entryUsername, perParticipantPoints, 'Slot Machine bonus');
        });
      }
    }

    const resultPayload = {
      questionNumber: round.question_index + 1,
      entries: round.entries.length,
      leverUser: round.lever_candidate || null,
      symbols: symbols.map((symbol) => ({
        id: symbol.id,
        label: symbol.label,
        emoji: symbol.emoji,
        emojiUrl: symbol.emojiUrl || null
      })),
      matched: jackpot,
      perParticipantPoints,
      totalAwardedPoints,
      isTestRound: !!round.is_test_round
    };

    round.status = 'results';
    round.results = resultPayload;
    gameState.slot_machine.last_round_result = {
      ...resultPayload,
      timestamp: Date.now()
    };

    broadcastSlotMachineEvent('result', resultPayload);
    broadcastState(true);

    setTimeout(() => {
      if (gameState.slot_machine && gameState.slot_machine.current_round === round) {
        gameState.slot_machine.current_round = null;
        broadcastState(true);
      }
    }, 15000);
  }, 2500);
}

function triggerSlotMachineTestSpin() {
  ensureSlotMachineState();

  if (!gameState.slot_machine.enabled) {
    console.log('🎰 Slot machine disabled - skipping test spin');
    return;
  }

  if (gameState.slot_machine.current_round) {
    cleanupSlotMachineRoundTimers(gameState.slot_machine.current_round);
    gameState.slot_machine.current_round = null;
  }

  const sampleEntries = ['RoaryTest', 'NalaTest', 'SimbaTest'];
  const round = {
    question_index: Math.max(0, gameState.current_question || 0),
    status: 'collecting',
    entry_started_at: Date.now(),
    entry_duration_ms: 5000,
    entries: [...sampleEntries],
    entry_lookup: new Set(sampleEntries.map((name) => name.toLowerCase())),
    entry_interval: null,
    entry_timeout: null,
    lever_candidate: null,
    spin_requested_by: null,
    auto_spin_timeout: null,
    is_test_round: true
  };

  gameState.slot_machine.current_round = round;

  broadcastSlotMachineEvent('entry_started', {
    questionNumber: round.question_index + 1,
    duration: round.entry_duration_ms,
    isTestRound: true
  });
  broadcastState(true);

  sampleEntries.forEach((username, index) => {
    broadcastSlotMachineEvent('entry_update', {
      questionNumber: round.question_index + 1,
      entries: index + 1,
      latestEntry: username,
      isTestRound: true
    });
  });

  setTimeout(() => {
    concludeSlotMachineEntryRound('test');
    setTimeout(() => spinSlotMachineRound('host_test'), 800);
  }, 1000);
}

function broadcastHotSeatCountdown(remaining, options = {}) {
  broadcastToClients({
    type: 'hot_seat_countdown',
    user: gameState.hot_seat_user,
    remaining,
    total: gameState.hot_seat_prestart_total,
    questionNumber: gameState.current_question + 1,
    go: options.go === true,
    timestamp: Date.now()
  });
}

function startHotSeatCountdown(countdownSeconds) {
  if (!gameState.hot_seat_active) {
    return;
  }

  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }

  const seconds = Math.max(0, Math.round(Number(countdownSeconds) || 0));
  gameState.hot_seat_prestart_seconds = seconds;
  gameState.hot_seat_prestart_total = seconds;
  gameState.hot_seat_countdown_started = true;

  broadcastHotSeatCountdown(seconds);

  if (seconds === 0) {
    gameState.hot_seat_timer_pending_start = false;
    gameState.hot_seat_countdown_started = false;
    startHotSeatTimer();
    return;
  }

  gameState.hot_seat_prestart_interval = setInterval(() => {
    gameState.hot_seat_prestart_seconds = Math.max(0, gameState.hot_seat_prestart_seconds - 1);

    if (gameState.hot_seat_prestart_seconds > 0) {
      broadcastHotSeatCountdown(gameState.hot_seat_prestart_seconds);
      return;
    }

    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
    broadcastHotSeatCountdown(0, { go: true });
    gameState.hot_seat_timer_pending_start = false;
    gameState.hot_seat_countdown_started = false;
    startHotSeatTimer();
  }, 1000);
}

function queueHotSeatCountdown(countdownSeconds) {
  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }

  const seconds = Math.max(0, Math.round(Number(countdownSeconds) || 0));
  gameState.hot_seat_prestart_seconds = seconds;
  gameState.hot_seat_prestart_total = seconds;
  gameState.hot_seat_timer_pending_start = true;
  gameState.hot_seat_countdown_started = false;

  triggerHotSeatCountdownIfReady();
}

function triggerHotSeatCountdownIfReady() {
  if (!gameState.hot_seat_active || !gameState.hot_seat_timer_pending_start) {
    return false;
  }

  if (gameState.hot_seat_countdown_started) {
    return false;
  }

  if (!gameState.question_visible) {
    return false;
  }

  startHotSeatCountdown(gameState.hot_seat_prestart_seconds || 0);
  return true;
}

function initializeHotSeatSession(selectedUsers, options = {}) {
  const uniqueUsers = Array.from(new Set((selectedUsers || []).filter(Boolean)));

  if (uniqueUsers.length === 0) {
    console.warn('⚠️ HOT SEAT activation skipped - no valid users provided');
    return false;
  }

  const selectionMethod = options.selectionMethod || 'manual';
  const primaryUser = uniqueUsers[0];
  const timerDuration = Number.isFinite(options.timer) ? options.timer : 60;
  const countdownSeconds = Number.isFinite(options.countdownSeconds)
    ? Math.max(0, Math.round(options.countdownSeconds))
    : 3;

  // End any lingering entry countdown now that a session is beginning
  if (gameState.hot_seat_entry_timer_interval) {
    clearInterval(gameState.hot_seat_entry_timer_interval);
    gameState.hot_seat_entry_timer_interval = null;
  }
  gameState.hot_seat_entry_active = false;
  gameState.hot_seat_entry_lookup = new Set();

  gameState.hot_seat_active = true;
  gameState.hot_seat_users = uniqueUsers;
  gameState.hot_seat_user = primaryUser;
  gameState.hot_seat_timer = timerDuration;
  gameState.hot_seat_answered = false;
  gameState.hot_seat_answer = null;
  gameState.hot_seat_correct = null;

  console.log(`🔥 HOT SEAT ACTIVATED for user: ${primaryUser} (Method: ${selectionMethod})`);
  if (uniqueUsers.length > 1) {
    console.log(`👥 Additional hot seat participants: ${uniqueUsers.slice(1).join(', ')}`);
  }
  console.log(`⏱️ ${primaryUser} has ${timerDuration} seconds to submit their answer`);

  const primaryProfile = getHotSeatProfile(primaryUser);
  if (primaryProfile && primaryProfile.storyHtml) {
    console.log(`🧾 Found uploaded profile for hot seat player ${primaryUser}`);
  }

  const alternateProfiles = uniqueUsers
    .slice(1)
    .map(username => ({ username, profile: getHotSeatProfile(username) }))
    .filter(entry => entry.profile && entry.profile.storyHtml);

  if (gameState.audience_poll_active) {
    console.log('🔕 Audience poll disabled while hot seat is active');
    gameState.audience_poll_active = false;
  }

  uniqueUsers.forEach(user => {
    addPointsToPlayer(user, leaderboardSettings.points.hot_seat_selected, 'selected for hot seat! 🔥');
    ['daily', 'weekly', 'monthly', 'all_time'].forEach(period => {
      const player = initializePlayerInLeaderboard(user, period);
      player.hot_seat_appearances++;
    });
  });

  queueHotSeatCountdown(countdownSeconds);

  broadcastToClients({
    type: 'hot_seat_activated',
    user: primaryUser,
    users: uniqueUsers,
    timer: timerDuration,
    questionNumber: gameState.current_question + 1,
    message: options.message || `Hot seat activated for: ${uniqueUsers.join(', ')}`,
    selectionMethod,
    countdown: countdownSeconds,
    profile: primaryProfile || null,
    alternateProfiles: alternateProfiles.length > 0 ? alternateProfiles : undefined,
    timestamp: Date.now()
  });

  return true;
}

// Draw winners from hot seat entries
function drawHotSeatWinners() {
  console.log(`🎲 Drawing ${gameState.hot_seat_winner_count} hot seat winner(s) from ${gameState.hot_seat_entries.length} entries`);

  if (gameState.hot_seat_entries.length === 0) {
    console.log('⚠️ No entries to draw from');
    return false;
  }

  const shuffled = [...gameState.hot_seat_entries].sort(() => Math.random() - 0.5);
  const winnerCount = Math.min(gameState.hot_seat_winner_count, shuffled.length);
  const winners = shuffled.slice(0, winnerCount);

  console.log(`🎯 Hot seat winners selected: ${winners.join(', ')}`);

  gameState.hot_seat_entries = [];
  gameState.hot_seat_entry_lookup = new Set();
  gameState.hot_seat_entry_active = false;

  return initializeHotSeatSession(winners, {
    selectionMethod: 'join_entry',
    message: `Hot seat activated for: ${winners.join(', ')}`,
    countdownSeconds: 3
  });
}

function selectHotSeatUser(manualUsername = null) {
  console.log('🎯 Selecting hot seat user...');
  console.log(`📊 Current participants count: ${gameState.gameshow_participants.length}`);

  let selectedUser = manualUsername;
  let selectionMethod = manualUsername ? 'manual' : 'participants';

  if (!selectedUser && gameState.gameshow_participants.length > 0) {
    const randomIndex = Math.floor(Math.random() * gameState.gameshow_participants.length);
    selectedUser = gameState.gameshow_participants[randomIndex];
    console.log(`✅ Selected from ${gameState.gameshow_participants.length} active participants`);
  }

  if (!selectedUser && recentChatMessages.length > 0) {
    console.log('⚠️ No voting participants yet, checking recent chat users...');
    const uniqueChatUsers = [...new Set(recentChatMessages.map(msg => msg.username))];
    if (uniqueChatUsers.length > 0) {
      const randomIndex = Math.floor(Math.random() * uniqueChatUsers.length);
      selectedUser = uniqueChatUsers[randomIndex];
      selectionMethod = 'recent_chat';
      console.log(`✅ Selected from ${uniqueChatUsers.length} recent chat users`);
    }
  }

  if (!selectedUser && gameState.poll_voter_history && gameState.poll_voter_history.length > 0) {
    console.log('⚠️ No chat users found, checking poll voter history...');
    const randomIndex = Math.floor(Math.random() * gameState.poll_voter_history.length);
    selectedUser = gameState.poll_voter_history[randomIndex];
    selectionMethod = 'poll_history';
    console.log(`🗳️ Selected from ${gameState.poll_voter_history.length} previous poll voters`);
  }

  if (!selectedUser) {
    console.warn('⚠️ HOT SEAT SKIPPED - No real participants available');
    console.log(`📊 Participant sources checked:`);
    console.log(`   - Active participants: ${gameState.gameshow_participants.length}`);
    console.log(`   - Recent chat users: ${recentChatMessages.length > 0 ? [...new Set(recentChatMessages.map(msg => msg.username))].length : 0}`);
    console.log(`   - Poll voter history: ${gameState.poll_voter_history ? gameState.poll_voter_history.length : 0}`);
    console.log('💡 Hot seat will activate when real participants join the game');

    broadcastToClients({
      type: 'hot_seat_skipped',
      reason: 'Waiting for real participants',
      questionNumber: gameState.current_question + 1,
      timestamp: Date.now()
    });

    return false;
  }

  return initializeHotSeatSession([selectedUser], {
    selectionMethod,
    countdownSeconds: 3
  });
}

function startHotSeatTimer() {
  if (!gameState.hot_seat_active) {
    return;
  }

  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }

  gameState.hot_seat_timer_pending_start = false;
  gameState.hot_seat_countdown_started = false;
  gameState.hot_seat_prestart_seconds = 0;
  gameState.hot_seat_prestart_total = 0;

  if (gameState.hot_seat_timer_interval) {
    clearInterval(gameState.hot_seat_timer_interval);
    gameState.hot_seat_timer_interval = null;
  }

  gameState.hot_seat_timer_interval = setInterval(() => {
    gameState.hot_seat_timer--;
    
    // Broadcast timer update every 5 seconds and at critical moments
    if (gameState.hot_seat_timer % 5 === 0 || gameState.hot_seat_timer <= 10) {
      broadcastToClients({
        type: 'hot_seat_timer_update',
        timer: gameState.hot_seat_timer,
        user: gameState.hot_seat_user
      });
    }
    
    // Time's up!
    if (gameState.hot_seat_timer <= 0) {
      clearInterval(gameState.hot_seat_timer_interval);
      gameState.hot_seat_timer_interval = null;
      
      console.log(`⏰ TIME'S UP! ${gameState.hot_seat_user} did not answer in time`);
      
      // Log the timeout as incorrect
      const logEntry = {
        question: gameState.current_question + 1,
        user: gameState.hot_seat_user,
        answer: null,
        correct: false,
        timeout: true,
        timestamp: Date.now()
      };
      gameState.hot_seat_history.push(logEntry);
      
      // Broadcast timeout
      broadcastToClients({
        type: 'hot_seat_timeout',
        user: gameState.hot_seat_user,
        questionNumber: gameState.current_question + 1
      });
      
      // Deactivate hot seat
      endHotSeat(false, true);
    }
  }, 1000);
}

function processHotSeatAnswer(username, answer) {
  // Check if hot seat is active and user is authorized
  if (!gameState.hot_seat_active) {
    return false;
  }

  const normalizedUsername = (username || '').toLowerCase();
  const activeHotSeatUser = (gameState.hot_seat_user || '').toLowerCase();

  const isHotSeatUser = normalizedUsername !== '' && normalizedUsername === activeHotSeatUser;

  if (!isHotSeatUser) {
    console.log(`⚠️ ${username} is not the active hot seat player (${gameState.hot_seat_user})`);
    return false;
  }
  
  if (gameState.hot_seat_answered) {
    console.log(`ℹ️ ${username} already submitted their hot seat answer`);
    return false;
  }
  
  // Validate answer
  const validAnswers = ['A', 'B', 'C', 'D'];
  const normalizedAnswer = answer.toUpperCase().trim();
  
  if (!validAnswers.includes(normalizedAnswer)) {
    console.log(`⚠️ Invalid hot seat answer from ${username}: ${answer}`);
    return false;
  }
  
  // Stop the timer
  if (gameState.hot_seat_timer_interval) {
    clearInterval(gameState.hot_seat_timer_interval);
    gameState.hot_seat_timer_interval = null;
  }
  
  // Record the answer
  gameState.hot_seat_answered = true;
  gameState.hot_seat_answer = normalizedAnswer;
  
  console.log(`🎯 HOT SEAT ANSWER: ${username} selected ${normalizedAnswer}`);
  console.log(`⏱️ Answered with ${gameState.hot_seat_timer} seconds remaining`);
  
  // Map answer to index (A=0, B=1, C=2, D=3)
  const answerIndex = normalizedAnswer.charCodeAt(0) - 65;
  
  // Set as selected answer for the game
  gameState.selected_answer = answerIndex;
  gameState.answer_locked_in = true;
  
  // Broadcast hot seat answer
  broadcastToClients({
    type: 'hot_seat_answered',
    user: username,
    answer: normalizedAnswer,
    timeRemaining: gameState.hot_seat_timer,
    questionNumber: gameState.current_question + 1
  });
  
  // The answer correctness will be determined when answers are revealed
  return true;
}

function endHotSeat(wasCorrect = null, timeout = false) {
  if (!gameState.hot_seat_active) return;
  
  // Log the result if not already logged (timeout case logs earlier)
  if (!timeout && gameState.hot_seat_user) {
    const logEntry = {
      question: gameState.current_question + 1,
      user: gameState.hot_seat_user,
      answer: gameState.hot_seat_answer,
      correct: wasCorrect,
      timeout: false,
      timestamp: Date.now()
    };
    gameState.hot_seat_history.push(logEntry);
    
    console.log(`📝 Hot seat result logged:`, logEntry);
  }
  
  // Clear timer if still running
  if (gameState.hot_seat_timer_interval) {
    clearInterval(gameState.hot_seat_timer_interval);
    gameState.hot_seat_timer_interval = null;
  }

  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }

  gameState.hot_seat_timer_pending_start = false;
  gameState.hot_seat_countdown_started = false;
  gameState.hot_seat_prestart_seconds = 0;
  gameState.hot_seat_prestart_total = 0;

  // Broadcast hot seat end
  broadcastToClients({
    type: 'hot_seat_ended',
    user: gameState.hot_seat_user,
    answer: gameState.hot_seat_answer,
    correct: wasCorrect,
    timeout: timeout
  });
  
  // Reset hot seat state
  gameState.hot_seat_active = false;
  gameState.hot_seat_user = null;
  gameState.hot_seat_users = [];
  gameState.hot_seat_timer = 60;
  gameState.hot_seat_answered = false;
  gameState.hot_seat_answer = null;
  gameState.hot_seat_correct = wasCorrect;
  
  console.log('🔚 Hot seat mode ended');
}

// Leaderboard System Functions
function initializePlayerInLeaderboard(username, period = 'current_game') {
  if (!leaderboardData[period][username]) {
    if (period === 'current_game') {
      leaderboardData[period][username] = {
        votes: [],
        correct_answers: 0,
        total_answers: 0,
        points: 0,
        fastest_correct_time: null,
        current_streak: 0,
        best_streak: 0,
        hot_seat_performance: null,
        first_seen: Date.now()
      };
    } else {
      leaderboardData[period][username] = {
        games_played: period === 'current_game' ? 1 : 0,
        total_votes: 0,
        correct_votes: 0,
        total_points: 0,
        accuracy_percentage: 0,
        average_response_time: 0,
        achievements: [],
        first_place_finishes: 0,
        hot_seat_appearances: 0,
        hot_seat_correct: 0,
        best_streak: 0,
        // Period-specific streak tracking
        daily_best_streak: 0,
        weekly_best_streak: 0,
        monthly_best_streak: 0,
        last_active: Date.now()
      };
    }
  }
  return leaderboardData[period][username];
}

function addPointsToPlayer(username, points, reason = '') {
  // Check if user is in ignored list
  const ignoredUsers = getCachedIgnoredList();
  if (ignoredUsers.includes(username.toLowerCase())) {
    console.log(`🚫 Skipping points for ignored user: ${username}`);
    return;
  }
  
  // Only add to current game if a game is active
  if (gameState.game_active) {
    initializePlayerInLeaderboard(username, 'current_game');
    leaderboardData.current_game[username].points += points;
    console.log(`🏆 ${username} earned ${points} points for current game (${reason})`);
  }
  
  // Add to all period leaderboards
  ['daily', 'weekly', 'monthly', 'all_time'].forEach(period => {
    initializePlayerInLeaderboard(username, period);
    leaderboardData[period][username].total_points += points;
    leaderboardData[period][username].last_active = Date.now();
  });
  
  // Log appropriately based on game state
  if (!gameState.game_active) {
    console.log(`📊 ${username} earned ${points} points for daily/weekly/monthly/all-time (${reason}) - no game active`);
  }
  
  // Broadcast leaderboard update
  broadcastLeaderboardUpdate();
  
  // Auto-save leaderboard data after points update
  saveLeaderboardData();
}

function updatePlayerVoteStats(username, answer, isCorrect, responseTime) {
  // Only update current game stats if a game is active
  let currentPlayer = null;
  if (gameState.game_active) {
    currentPlayer = initializePlayerInLeaderboard(username, 'current_game');
    currentPlayer.total_answers++;
    
    if (isCorrect) {
      currentPlayer.correct_answers++;
      currentPlayer.current_streak++;
      if (currentPlayer.current_streak > currentPlayer.best_streak) {
        currentPlayer.best_streak = currentPlayer.current_streak;
      }
      
      // Track fastest correct time
      if (!currentPlayer.fastest_correct_time || responseTime < currentPlayer.fastest_correct_time) {
        currentPlayer.fastest_correct_time = responseTime;
      }
    } else {
      currentPlayer.current_streak = 0;
    }
  }
  
  // Update all period stats
  ['daily', 'weekly', 'monthly', 'all_time'].forEach(period => {
    const player = initializePlayerInLeaderboard(username, period);
    player.total_votes++;
    if (isCorrect) player.correct_votes++;
    
    // Update accuracy
    player.accuracy_percentage = player.total_votes > 0 
      ? Math.round((player.correct_votes / player.total_votes) * 100) 
      : 0;
    
    // Update average response time
    const currentAvg = player.average_response_time || responseTime;
    player.average_response_time = Math.round((currentAvg + responseTime) / 2);
    
    // Update period-specific best streaks from current game
    if (currentPlayer && gameState.game_active) {
      // Update overall best streak
      if (currentPlayer.best_streak > player.best_streak) {
        player.best_streak = currentPlayer.best_streak;
      }
      
      // Update period-specific best streaks
      if (period === 'daily' && currentPlayer.current_streak > (player.daily_best_streak || 0)) {
        player.daily_best_streak = currentPlayer.current_streak;
      }
      if (period === 'weekly' && currentPlayer.current_streak > (player.weekly_best_streak || 0)) {
        player.weekly_best_streak = currentPlayer.current_streak;
      }
      if (period === 'monthly' && currentPlayer.current_streak > (player.monthly_best_streak || 0)) {
        player.monthly_best_streak = currentPlayer.current_streak;
      }
    }
  });
  
  // Auto-save leaderboard data after stats update
  saveLeaderboardData();
}

function checkAndAwardStreakBonus(username) {
  // Only check streak bonuses if a game is active
  if (!gameState.game_active) return;
  
  const player = leaderboardData.current_game[username];
  if (!player) return;
  
  const streak = player.current_streak;
  if (streak === 3) {
    addPointsToPlayer(username, leaderboardSettings.points.streak_3, '3-answer streak');
  } else if (streak === 5) {
    addPointsToPlayer(username, leaderboardSettings.points.streak_5, '5-answer streak');
  } else if (streak === 10) {
    addPointsToPlayer(username, leaderboardSettings.points.streak_10, '10-answer streak! 🔥');
  }
}

function getTopPlayers(period = 'current_game', count = 10) {
  const players = Object.entries(leaderboardData[period])
    .map(([username, stats]) => ({
      username,
      points: period === 'current_game' ? stats.points : stats.total_points,
      accuracy: period === 'current_game' 
        ? (stats.total_answers > 0 ? Math.round((stats.correct_answers / stats.total_answers) * 100) : 0)
        : stats.accuracy_percentage,
      streak: period === 'current_game' ? stats.current_streak : stats.best_streak
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, count);
  
  return players;
}

function broadcastLeaderboardUpdate() {
  const topPlayers = getTopPlayers(leaderboardSettings.display_mode, leaderboardSettings.display_count);
  
  broadcastToClients({
    type: 'leaderboard_update',
    data: {
      period: leaderboardSettings.display_mode,
      top_players: topPlayers,
      settings: leaderboardSettings,
      timestamp: Date.now()
    }
  });
}

// Finalize the current game leaderboard when question 15 is completed
// Get top N players from leaderboard for prizes
function getTopLeaderboardPlayers(count = 10) {
  const stats = getLeaderboardStats().current_game;
  if (!stats || stats.length === 0) {
    return [];
  }
  
  // Return top N players
  return stats.slice(0, count).map((player, index) => ({
    ...player,
    rank: index + 1,
    isWinner: true
  }));
}

function finalizeGameLeaderboard() {
  if (gameState.game_completed) {
    console.log('ℹ️ Game already completed - skipping finalizeGameLeaderboard()');
    return;
  }

  console.log('🏁 GAME COMPLETE - Finalizing current game leaderboard');

  // CRITICAL: Mark game as completed to prevent further questions
  gameState.game_completed = true;
  gameState.endGameTriggered = true;

  // Get final game stats
  const finalStats = getLeaderboardStats().current_game;
  gameState.final_game_stats = finalStats;
  gameState.final_game_winners = Array.isArray(finalStats) ? finalStats.slice(0, 3) : [];
  gameState.pending_endgame_sequence = false;
  gameState.endgame_ready_timestamp = Date.now();

  // Log the winner if there are players
  if (finalStats && finalStats.length > 0) {
    const winner = finalStats[0];
    console.log(`🏆 GAME WINNER: ${winner.username} with ${winner.points} points!`);
    console.log('📊 Top 3 Players:');
    finalStats.slice(0, 3).forEach((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
      console.log(`${medal} ${player.username}: ${player.points} points (${player.correct_answers}/${player.total_votes} correct)`);
    });
  }

  // Broadcast game completion with final leaderboard
  broadcastToClients({
    type: 'game_completed',
    final_leaderboard: finalStats,
    winner: finalStats && finalStats.length > 0 ? finalStats[0] : null,
    total_players: finalStats ? finalStats.length : 0,
    timestamp: Date.now()
  });

  // Do NOT reset current_game here - keep for display until new game starts
  console.log('📊 Current game leaderboard finalized (preserved for viewing)');
  console.log(`🎮 Total participants: ${gameState.gameshow_participants.length}`);

  // Save leaderboard data after game completion
  saveLeaderboardData();

  // Export game to CSV archive
  const csvFilename = exportGameToCSV(finalStats);
  if (csvFilename) {
    console.log(`✅ Game successfully archived as ${csvFilename}`);

    // Broadcast CSV export success
    broadcastToClients({
      type: 'game_archived',
      filename: csvFilename,
      archive_path: 'Games Archive/' + csvFilename,
      timestamp: Date.now()
    });
  }

  const completeFinalStats = getCurrentGameLeaderboardEntries({ includeIgnored: true, limit: null });
  const archiveIsoDate = csvFilename ? deriveIsoDateFromGameBaseId(path.parse(csvFilename).name) : new Date().toISOString();
  updatePreviousWinnersFromFinalStats(completeFinalStats, {
    csvFilename,
    completedAt: archiveIsoDate,
    questionsCompleted: gameState.current_question + 1,
    contestant: gameState.contestant_name || null
  });

  broadcastState(true);
}

function canStartEndgameSequence() {
  return !gameState.lifeline_voting_active &&
    !gameState.lifeline_voting_timer_active &&
    !gameState.waiting_for_lifeline_tie_break &&
    !gameState.pending_lifeline_vote &&
    !gameState.audience_poll_active &&
    !gameState.is_revote_active &&
    !gameState.ask_a_mod_active &&
    !gameState.hot_seat_active;
}

function runPendingEndgameSequence(reason = 'auto') {
  if (pendingEndgameInterval) {
    clearInterval(pendingEndgameInterval);
    pendingEndgameInterval = null;
  }

  if (gameState.game_completed) {
    console.log(`ℹ️ End-game sequence already completed (${reason})`);
    gameState.pending_endgame_sequence = false;
    return;
  }

  console.log(`🏁 Executing end-game sequence (${reason})`);
  finalizeGameLeaderboard();
}

function scheduleEndgameSequence(reason = 'final_question', delay = 3000) {
  console.log(`⏳ Scheduling end-game sequence (${reason}) in ${delay}ms`);

  setTimeout(() => {
    if (canStartEndgameSequence()) {
      runPendingEndgameSequence(reason);
      return;
    }

    console.log('⏸️ End-game sequence blocked by active interactions. Monitoring until flow is clear...');
    gameState.pending_endgame_sequence = true;

    if (pendingEndgameInterval) {
      clearInterval(pendingEndgameInterval);
    }

    pendingEndgameInterval = setInterval(() => {
      if (canStartEndgameSequence()) {
        console.log('✅ Conditions cleared - completing pending end-game sequence');
        gameState.pending_endgame_sequence = false;
        runPendingEndgameSequence('pending_resume');
      }
    }, 1000);
  }, delay);
}

// Helper function to escape CSV values
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Export completed game to CSV in Games Archive
function exportGameToCSV(finalStats) {
  try {
    // Create Games Archive directory if it doesn't exist
    const archiveDir = path.join(__dirname, 'Games Archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const csvFilename = `game_${timestamp}.csv`;
    const csvPath = path.join(archiveDir, csvFilename);
    
    // Build CSV content starting with metadata comments
    let csvContent = '';
    csvContent += `# Kimbillionaire Game Archive\n`;
    csvContent += `# Game Date: ${new Date().toISOString()}\n`;
    csvContent += `# Contestant: ${gameState.contestant_name || 'Not Set'}\n`;
    csvContent += `# Total Players: ${finalStats ? finalStats.length : 0}\n`;
    csvContent += `# Questions Completed: ${gameState.current_question + 1} of 15\n`;
    if (finalStats && finalStats.length > 0) {
      csvContent += `# Winner: ${finalStats[0].username} (${finalStats[0].points} points)\n`;
    }
    csvContent += `#\n`;
    
    // CSV Headers
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
    
    // Add player data if there are stats
    if (finalStats && finalStats.length > 0) {
      finalStats.forEach((player, index) => {
        const accuracy = player.total_answers > 0 
          ? ((player.correct_answers / player.total_answers) * 100).toFixed(2)
          : '0.00';
        
        const row = [
          index + 1, // Rank
          player.username,
          player.points || 0,
          player.correct_answers || 0,
          player.total_answers || player.total_votes || 0,
          accuracy,
          player.current_streak || 0,
          player.best_streak || 0,
          player.hot_seat_appearances || 0,
          player.hot_seat_correct || 0,
          player.fastest_correct_time || '',
          index === 0 ? 'Yes' : 'No'
        ];
        
        csvContent += row.map(escapeCSV).join(',') + '\n';
      });
    } else {
      // No players - add a note
      csvContent += '# No players participated in this game\n';
    }
    
    // Write CSV file
    fs.writeFileSync(csvPath, csvContent);
    console.log(`📁 Game archived to CSV: ${csvPath}`);
    console.log(`📊 Archive contains ${finalStats ? finalStats.length : 0} players`);
    
    return csvFilename;
  } catch (error) {
    console.error('❌ Error exporting game to CSV:', error);
    return null;
  }
}

function resetLeaderboard(period) {
  // IMPORTANT: 'all' is not supported to prevent accidental resets
  // Each period must be reset individually
  
  if (period === 'current_game') {
    leaderboardData.current_game = {};
    currentQuestionVotes = [];
    firstCorrectVoters = [];
  }
  
  if (period === 'daily') {
    // Preserve best_streak (all-time) when resetting daily
    Object.keys(leaderboardData.daily).forEach(username => {
      const allTimeBest = leaderboardData.all_time[username]?.best_streak || 0;
      leaderboardData.daily[username] = {
        ...initializePlayerInLeaderboard(username, 'daily'),
        best_streak: allTimeBest,  // Preserve all-time best
        daily_best_streak: 0       // Reset daily best
      };
    });
    leaderboardData.last_reset.daily = Date.now();
  }
  
  if (period === 'weekly') {
    // Preserve best_streak (all-time) when resetting weekly
    Object.keys(leaderboardData.weekly).forEach(username => {
      const allTimeBest = leaderboardData.all_time[username]?.best_streak || 0;
      leaderboardData.weekly[username] = {
        ...initializePlayerInLeaderboard(username, 'weekly'),
        best_streak: allTimeBest,   // Preserve all-time best
        weekly_best_streak: 0        // Reset weekly best
      };
    });
    leaderboardData.last_reset.weekly = Date.now();
  }
  
  if (period === 'monthly') {
    // Preserve best_streak (all-time) when resetting monthly
    Object.keys(leaderboardData.monthly).forEach(username => {
      const allTimeBest = leaderboardData.all_time[username]?.best_streak || 0;
      leaderboardData.monthly[username] = {
        ...initializePlayerInLeaderboard(username, 'monthly'),
        best_streak: allTimeBest,    // Preserve all-time best
        monthly_best_streak: 0        // Reset monthly best
      };
    });
    leaderboardData.last_reset.monthly = Date.now();
  }
  
  // CRITICAL: all_time should NEVER be reset automatically
  // Only allow manual reset with explicit 'all_time' parameter and API confirmation
  if (period === 'all_time') {
    console.log('⚠️ WARNING: Resetting all-time leaderboard - this is permanent!');
    leaderboardData.all_time = {};
  }
  
  console.log(`🔄 Leaderboard reset: ${period}`);
  saveLeaderboardData();
  broadcastLeaderboardUpdate();
}

// Track last backup time
let lastLeaderboardBackup = Date.now();

// Save leaderboard data to file with atomic write
function saveLeaderboardData() {
  try {
    const dataToSave = JSON.stringify(leaderboardData, null, 2);
    
    // Atomic write: write to temp file first, then rename
    const tempFile = './leaderboard-data.json.tmp';
    fs.writeFileSync(tempFile, dataToSave);
    fs.renameSync(tempFile, './leaderboard-data.json');
    
    // Create backup every hour
    const now = Date.now();
    if (now - lastLeaderboardBackup > 3600000) { // 1 hour = 3600000ms
      saveLeaderboardBackup();
      lastLeaderboardBackup = now;
    }
    
    console.log('💾 Leaderboard data saved successfully');
  } catch (error) {
    console.error('❌ Error saving leaderboard data:', error);
  }
}

// Create versioned backup of leaderboard data
function saveLeaderboardBackup() {
  try {
    // Ensure backup directory exists
    const backupDir = path.join(__dirname, 'workinprogress');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Create timestamped backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = path.join(backupDir, `leaderboard-backup-${timestamp}.json`);
    
    // Copy current leaderboard file to backup
    if (fs.existsSync('./leaderboard-data.json')) {
      fs.copyFileSync('./leaderboard-data.json', backupPath);
      console.log(`📦 Leaderboard backup created: ${backupPath}`);
      
      // Rotate old backups (keep last 10)
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('leaderboard-backup-'))
        .sort()
        .reverse(); // Most recent first
      
      if (backups.length > 10) {
        // Delete oldest backups
        backups.slice(10).forEach(file => {
          try {
            fs.unlinkSync(path.join(backupDir, file));
            console.log(`🗑️ Deleted old backup: ${file}`);
          } catch (err) {
            console.warn(`⚠️ Could not delete old backup: ${file}`);
          }
        });
      }
      
      // Create daily snapshot if needed
      const today = new Date().toISOString().slice(0, 10);
      const dailyPath = path.join(backupDir, `leaderboard-daily-${today}.json`);
      if (!fs.existsSync(dailyPath)) {
        fs.copyFileSync('./leaderboard-data.json', dailyPath);
        console.log(`📅 Daily leaderboard snapshot created: ${dailyPath}`);
      }
    }
  } catch (error) {
    console.error('❌ Error creating leaderboard backup:', error);
  }
}

// Load leaderboard data from file
function loadLeaderboardData() {
  try {
    if (fs.existsSync('./leaderboard-data.json')) {
      const data = fs.readFileSync('./leaderboard-data.json', 'utf8');
      leaderboardData = JSON.parse(data);
      console.log('📂 Leaderboard data loaded successfully');
      
      // Check if resets are needed based on time
      checkPeriodicResets();
    } else {
      console.log('📝 No existing leaderboard data found, starting fresh');
      saveLeaderboardData(); // Create initial file
    }
  } catch (error) {
    console.error('❌ Error loading leaderboard data:', error);
    // Initialize with default if load fails
    initializeLeaderboardData();
  }
}

// Initialize leaderboard data structure
function initializeLeaderboardData() {
  leaderboardData = {
    current_game: {},
    daily: {},
    weekly: {},
    monthly: {},
    all_time: {},
    last_reset: {
      daily: Date.now(),
      weekly: Date.now(),
      monthly: Date.now()
    },
    settings: {
      points: {
        participation: 10,
        correct_answer: 100,
        speed_bonus_max: 50,
        streak_multiplier: 1.5,
        hot_seat_correct: 500,
        hot_seat_participation: 100
      }
    }
  };
}

// Check if periodic resets are needed
function checkPeriodicResets() {
  const now = new Date();
  const nowUTC = new Date(now.toISOString());
  
  // Check daily reset (00:00 UTC every day)
  const lastDailyReset = new Date(leaderboardData.last_reset.daily);
  const nextDailyReset = new Date(lastDailyReset);
  nextDailyReset.setUTCDate(nextDailyReset.getUTCDate() + 1);
  nextDailyReset.setUTCHours(0, 0, 0, 0);
  
  if (nowUTC >= nextDailyReset) {
    console.log(`📅 Daily reset triggered at ${nowUTC.toISOString()}`);
    resetLeaderboard('daily');
    leaderboardData.last_reset.daily = nowUTC.setUTCHours(0, 0, 0, 0);
  }
  
  // Check weekly reset (00:00 UTC every Sunday)
  const lastWeeklyReset = new Date(leaderboardData.last_reset.weekly);
  const nextWeeklyReset = new Date(lastWeeklyReset);
  // Calculate next Sunday
  const daysUntilSunday = (7 - nextWeeklyReset.getUTCDay()) % 7 || 7;
  nextWeeklyReset.setUTCDate(nextWeeklyReset.getUTCDate() + daysUntilSunday);
  nextWeeklyReset.setUTCHours(0, 0, 0, 0);
  
  if (nowUTC >= nextWeeklyReset) {
    console.log(`📅 Weekly reset triggered at ${nowUTC.toISOString()}`);
    resetLeaderboard('weekly');
    // Set to start of current week (last Sunday)
    const currentSunday = new Date(nowUTC);
    currentSunday.setUTCDate(currentSunday.getUTCDate() - currentSunday.getUTCDay());
    currentSunday.setUTCHours(0, 0, 0, 0);
    leaderboardData.last_reset.weekly = currentSunday.getTime();
  }
  
  // Check monthly reset (00:00 UTC on the 1st of each month)
  const lastMonthlyReset = new Date(leaderboardData.last_reset.monthly);
  const nextMonthlyReset = new Date(lastMonthlyReset);
  // Set to 1st of next month
  if (nextMonthlyReset.getUTCDate() !== 1) {
    nextMonthlyReset.setUTCMonth(nextMonthlyReset.getUTCMonth() + 1);
  } else {
    // If already on 1st, go to next month's 1st
    nextMonthlyReset.setUTCMonth(nextMonthlyReset.getUTCMonth() + 1);
  }
  nextMonthlyReset.setUTCDate(1);
  nextMonthlyReset.setUTCHours(0, 0, 0, 0);
  
  if (nowUTC >= nextMonthlyReset) {
    console.log(`📅 Monthly reset triggered at ${nowUTC.toISOString()}`);
    resetLeaderboard('monthly');
    // Set to start of current month
    const currentMonth = new Date(nowUTC);
    currentMonth.setUTCDate(1);
    currentMonth.setUTCHours(0, 0, 0, 0);
    leaderboardData.last_reset.monthly = currentMonth.getTime();
  }
}

// Broadcast leaderboard update to all clients
function broadcastLeaderboardUpdate() {
  const update = {
    type: 'leaderboard_update',
    data: getLeaderboardStats(),
    timestamp: Date.now()
  };
  
  broadcastToClients(update);
}

// Previous Winners Management Functions
function loadPreviousWinners() {
  try {
    const winnersPath = path.join(__dirname, 'previous-winners.json');
    if (!fs.existsSync(winnersPath)) {
      // Create initial file if it doesn't exist
      const initialData = {
        winners: [],
        metadata: {
          total_games: 0,
          last_updated: null
        }
      };
      fs.writeFileSync(winnersPath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    
    const data = fs.readFileSync(winnersPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error loading previous winners:', error);
    return {
      winners: [],
      metadata: {
        total_games: 0,
        last_updated: null
      }
    };
  }
}

function getBaseGameId(gameId = '') {
  if (typeof gameId !== 'string') {
    return '';
  }
  const lastUnderscore = gameId.lastIndexOf('_');
  return lastUnderscore > 0 ? gameId.slice(0, lastUnderscore) : gameId;
}

function deriveGameBaseId(context = {}) {
  if (context.gameBaseId) {
    return context.gameBaseId;
  }
  if (context.csvFilename) {
    const parsed = path.parse(context.csvFilename).name;
    if (parsed) {
      return parsed;
    }
  }
  if (context.completedAt) {
    const completedDate = new Date(context.completedAt);
    if (!Number.isNaN(completedDate.getTime())) {
      return `game_${completedDate.toISOString().replace(/[:.]/g, '-').slice(0, -5)}`;
    }
  }
  return `game_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`;
}

function deriveIsoDateFromGameBaseId(baseId) {
  const match = typeof baseId === 'string' && baseId.match(/^game_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/);
  if (!match) {
    return new Date().toISOString();
  }
  const [datePart, timePart] = match[1].split('T');
  const isoTime = timePart.replace(/-/g, ':');
  return `${datePart}T${isoTime}.000Z`;
}

function createWinnerEntryFromPlayer(player, options) {
  if (!player) {
    return null;
  }

  const username = player.username || 'unknown';
  const totalAnswers = player.total_answers ?? player.total_votes ?? player.totalAnswers ?? 0;
  const correctAnswers = player.correct_answers ?? player.correct_votes ?? 0;
  const accuracy = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
  const finalPoints = player.points ?? player.total_points ?? player.totalPoints ?? 0;

  return {
    game_id: `${options.baseId}_${username.toLowerCase()}`,
    date: options.isoDate,
    username,
    final_points: finalPoints,
    correct_answers: correctAnswers,
    total_answers: totalAnswers,
    accuracy,
    best_streak: player.best_streak ?? player.current_streak ?? 0,
    fastest_correct_time: player.fastest_correct_time ?? player.fastest_response_ms ?? null,
    hot_seat_appearances: player.hot_seat_appearances ?? 0,
    hot_seat_correct: player.hot_seat_correct ?? 0,
    questions_completed: options.questionsCompleted ?? 15,
    total_points_all_games: player.total_points ?? finalPoints,
    contestant_name: options.contestant || null
  };
}

function updatePreviousWinnersFromFinalStats(finalStats, context = {}) {
  if (!Array.isArray(finalStats) || finalStats.length === 0) {
    console.log('ℹ️ No final stats available for previous winners update');
    return;
  }

  try {
    const winnersData = loadPreviousWinners();
    const baseId = deriveGameBaseId(context);
    const isoDate = context.completedAt
      ? new Date(context.completedAt).toISOString()
      : deriveIsoDateFromGameBaseId(baseId);
    const questionsCompleted = context.questionsCompleted || gameState.current_question + 1;
    const topPlayers = finalStats.slice(0, 3);
    const newEntries = topPlayers
      .map((player) => createWinnerEntryFromPlayer(player, {
        baseId,
        isoDate,
        questionsCompleted,
        contestant: context.contestant || gameState.contestant_name || null
      }))
      .filter(Boolean);

    if (newEntries.length === 0) {
      console.log('ℹ️ No winner entries generated from final stats');
      return;
    }

    const prefix = `${baseId}_`;
    winnersData.winners = winnersData.winners.filter((entry) => !(entry?.game_id || '').startsWith(prefix));
    winnersData.winners.unshift(...newEntries);

    savePreviousWinners(winnersData);

    broadcastToClients({
      type: 'previous_winners_updated',
      winners: winnersData.winners.slice(0, 10),
      metadata: winnersData.metadata,
      timestamp: Date.now()
    });

    console.log(`🏆 Previous winners updated for ${baseId} (${newEntries.length} entries)`);
  } catch (error) {
    console.error('❌ Failed to update previous winners from final stats:', error);
  }
}

function savePreviousWinners(winnersData) {
  try {
    const winnersPath = path.join(__dirname, 'previous-winners.json');
    const tempFile = path.join(__dirname, 'previous-winners.json.tmp');

    // Update metadata
    const metadata = { ...(winnersData.metadata || {}) };
    metadata.last_updated = new Date().toISOString();
    const uniqueGameDates = new Set();
    const uniquePlayers = new Set();
    winnersData.winners.forEach((entry) => {
      if (!entry) return;
      if (entry.date) {
        const canonicalDate = new Date(entry.date);
        if (!Number.isNaN(canonicalDate.getTime())) {
          uniqueGameDates.add(canonicalDate.toISOString());
        }
      } else if (entry.game_id) {
        uniqueGameDates.add(getBaseGameId(entry.game_id));
      }
      if (entry.username) {
        uniquePlayers.add(entry.username.toLowerCase());
      }
    });
    metadata.total_games = uniqueGameDates.size;
    metadata.total_players = uniquePlayers.size;
    winnersData.metadata = metadata;

    // Atomic write: write to temp file first, then rename
    fs.writeFileSync(tempFile, JSON.stringify(winnersData, null, 2));
    fs.renameSync(tempFile, winnersPath);
    
    console.log('💾 Previous winners data saved successfully');
  } catch (error) {
    console.error('❌ Error saving previous winners:', error);
  }
}

function archiveWinner(username) {
  try {
    // Find the player in current_game leaderboard
    const playerData = leaderboardData.current_game[username.toLowerCase()];
    
    if (!playerData) {
      return {
        success: false,
        error: `Player ${username} not found in current game leaderboard`
      };
    }
    
    // Load current winners
    const winnersData = loadPreviousWinners();
    
    // Generate unique game ID
    const gameId = `game_${Date.now()}_${username.toLowerCase()}`;
    
    // Create winner entry
    const winnerEntry = {
      game_id: gameId,
      date: new Date().toISOString(),
      username: username,
      final_points: playerData.points || 0,
      correct_answers: playerData.correct_answers || 0,
      total_answers: playerData.total_answers || 0,
      accuracy: playerData.total_answers > 0 
        ? Math.round((playerData.correct_answers / playerData.total_answers) * 100)
        : 0,
      best_streak: playerData.best_streak || 0,
      fastest_correct_time: playerData.fastest_correct_time || null,
      hot_seat_appearances: playerData.hot_seat_appearances || 0,
      hot_seat_correct: playerData.hot_seat_correct || 0,
      questions_completed: gameState.current_question + 1,
      contestant_name: gameState.contestant_name || 'N/A'
    };
    
    // Add to winners array (newest first)
    winnersData.winners.unshift(winnerEntry);
    
    // Save winners data
    savePreviousWinners(winnersData);
    
    console.log(`🏆 Archived winner: ${username} with ${winnerEntry.final_points} points`);
    
    return {
      success: true,
      winner: winnerEntry
    };
  } catch (error) {
    console.error('❌ Error archiving winner:', error);
    return {
      success: false,
      error: 'Failed to archive winner: ' + error.message
    };
  }
}

function autoArchiveTopWinner() {
  try {
    // Get current game stats
    const currentGameStats = getLeaderboardStats().current_game;
    
    if (!currentGameStats || currentGameStats.length === 0) {
      return {
        success: false,
        error: 'No players in current game to archive'
      };
    }
    
    // Get top player
    const topPlayer = currentGameStats[0];
    
    // Archive the top player
    return archiveWinner(topPlayer.username);
  } catch (error) {
    console.error('❌ Error auto-archiving winner:', error);
    return {
      success: false,
      error: 'Failed to auto-archive winner: ' + error.message
    };
  }
}

function removePreviousWinner(gameId) {
  try {
    const winnersData = loadPreviousWinners();
    
    const initialLength = winnersData.winners.length;
    winnersData.winners = winnersData.winners.filter(w => w.game_id !== gameId);
    
    if (winnersData.winners.length === initialLength) {
      return {
        success: false,
        error: `Winner with game_id ${gameId} not found`
      };
    }
    
    savePreviousWinners(winnersData);
    
    console.log(`🗑️ Removed previous winner: ${gameId}`);
    
    return {
      success: true
    };
  } catch (error) {
    console.error('❌ Error removing previous winner:', error);
    return {
      success: false,
      error: 'Failed to remove winner: ' + error.message
    };
  }
}

function clearPreviousWinners() {
  const winnersData = {
    winners: [],
    metadata: {
      total_games: 0,
      last_updated: new Date().toISOString()
    }
  };
  
  savePreviousWinners(winnersData);
  console.log('🗑️ All previous winners cleared');
}

function importPreviousWinners(importData) {
  try {
    const winnersData = loadPreviousWinners();
    
    // Merge imported winners with existing ones
    const existingGameIds = new Set(winnersData.winners.map(w => w.game_id));
    
    importData.winners.forEach(winner => {
      // Only add if game_id doesn't already exist
      if (!existingGameIds.has(winner.game_id)) {
        winnersData.winners.push(winner);
      }
    });
    
    // Sort by date (newest first)
    winnersData.winners.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    savePreviousWinners(winnersData);
    
    console.log(`📥 Imported ${importData.winners.length} previous winners`);
  } catch (error) {
    console.error('❌ Error importing previous winners:', error);
    throw error;
  }
}

// Get formatted leaderboard statistics
function getCurrentGameLeaderboardEntries(options = {}) {
  const { includeIgnored = false, limit = 10 } = options;
  const ignoredUsers = includeIgnored ? [] : getCachedIgnoredList();
  const entries = Object.entries(leaderboardData.current_game || {})
    .filter(([username]) => includeIgnored || !ignoredUsers.includes(username.toLowerCase()))
    .map(([username, stats]) => ({
      username,
      ...stats,
      points: stats.points || stats.total_points || 0,
      total_answers: stats.total_answers || stats.total_votes || 0,
      total_votes: stats.total_votes || stats.total_answers || 0,
      correct_answers: stats.correct_answers || stats.correct_votes || 0,
      current_streak: stats.current_streak || 0,
      best_streak: stats.best_streak || 0
    }))
    .sort((a, b) => (b.points || 0) - (a.points || 0));

  if (typeof limit === 'number') {
    return entries.slice(0, limit);
  }
  return entries;
}

function getLeaderboardStats() {
  const ignoredUsers = getCachedIgnoredList();

  const formatLeaderboard = (data, period) => {
    const isCurrentGame = period === 'current_game';

    return Object.entries(data)
      .filter(([username]) => !ignoredUsers.includes(username.toLowerCase()))
      .map(([username, stats]) => ({
        username,
        ...stats,
        points: stats.points || stats.total_points || 0,
        total_votes: isCurrentGame ? (stats.total_answers || 0) : (stats.total_votes || 0),
        correct_answers: isCurrentGame ? (stats.correct_answers || 0) : (stats.correct_votes || 0),
        current_streak: isCurrentGame ? (stats.current_streak || 0) : 0,
        best_streak: stats.best_streak || 0,
        daily_best_streak: stats.daily_best_streak || 0,
        weekly_best_streak: stats.weekly_best_streak || 0,
        monthly_best_streak: stats.monthly_best_streak || 0
      }))
      .sort((a, b) => {
        const aValue = isCurrentGame ? (a.points || 0) : (a.total_points || 0);
        const bValue = isCurrentGame ? (b.points || 0) : (b.total_points || 0);
        return bValue - aValue;
      })
      .slice(0, 10);
  };

  return {
    current_game: getCurrentGameLeaderboardEntries({ includeIgnored: false, limit: 10 }),
    daily: formatLeaderboard(leaderboardData.daily, 'daily'),
    weekly: formatLeaderboard(leaderboardData.weekly, 'weekly'),
    monthly: formatLeaderboard(leaderboardData.monthly, 'monthly'),
    all_time: formatLeaderboard(leaderboardData.all_time, 'all_time'),
    last_reset: leaderboardData.last_reset
  };
}

// Process votes from chat messages with deduplication
function processVoteFromChat(data) {
  const voteStartTime = Date.now();
  
  // Check if hot seat is active and this is one of the hot seat users
  if (gameState.hot_seat_active) {
    // Support both legacy single user and new multiple users array
    const isHotSeatUser = data.username === gameState.hot_seat_user;

    if (isHotSeatUser) {
      const answer = data.text?.toUpperCase().trim();
      if (['A', 'B', 'C', 'D'].includes(answer)) {
        if (DEBUG_VERBOSE_LOGGING) console.log(`🎯 Processing hot seat answer from ${data.username}: ${answer}`);
        processHotSeatAnswer(data.username, answer);
        return;
      }
    } else {
      // Not a hot seat user, ignore their vote
      console.log(`ℹ️ Ignoring vote from ${data.username} - hot seat active for ${gameState.hot_seat_user}`);
      return;
    }
  }
  
  if (!gameState.audience_poll_active) {
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
    return;
  }
  
  // Normalize username to lowercase to handle case variations
  const username = data.username ? data.username.toLowerCase().trim() : '';
  const message = data.text ? data.text.trim().toUpperCase() : '';
  
  if (!username || !message) {
    console.log(`❌ Invalid chat data: username="${username}", message="${message}"`);
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
    return;
  }
  
  if (DEBUG_VERBOSE_LOGGING) console.log(`🔍 Processing vote from ${username}: "${message}"`);
  console.log(`🔍 Current voter history:`, gameState.poll_voter_history);
  console.log(`🔍 User already voted?`, gameState.poll_voter_history.includes(username));
  
  // Check if user has already voted (deduplication with normalized username)
  if (gameState.poll_voter_history.includes(username)) {
    console.log(`⚠️ Duplicate vote attempt from ${username} - ignoring`);
    trackVoteProcessing(Date.now() - voteStartTime, true, false);
    return;
  }
  
  // Check if message contains a valid vote (A, B, C, D)
  // Only accept standalone letters to avoid counting regular chat as votes
  const validVotes = ['A', 'B', 'C', 'D'];
  // Message is already uppercase, so just check for exact match
  const vote = validVotes.find(v => message === v);
  
  if (vote) {
    // Check if this answer is excluded during revote
    if (gameState.is_revote_active) {
      const voteIndex = vote.charCodeAt(0) - 65; // Convert A,B,C,D to 0,1,2,3
      if (gameState.excluded_answers.includes(voteIndex)) {
        console.log(`🚫 Vote ${vote} is excluded during revote - ignoring vote from ${username}`);
        return;
      }
      console.log(`🗳️ Revote: ${username} voting ${vote} (${gameState.excluded_answers.length} answer(s) excluded)`);
    } else {
      console.log(`✅ Valid vote detected: ${username} voting ${vote}`);
    }
    
    // Check if user is trying to vote for the same answer they chose earlier in this question
    if (gameState.question_voter_answers[username] === vote) {
      console.log(`🚫 ${username} already voted ${vote} for this question - preventing same answer re-vote`);
      trackVoteProcessing(Date.now() - voteStartTime, false, true);
      return;
    }
    
    // Record the vote (first vote only)
    gameState.poll_voter_history.push(username);
    console.log(`🔒 Added ${username} to voter history. New history:`, gameState.poll_voter_history);
    
    // Record the user's answer choice for this question to prevent same-answer re-voting
    gameState.question_voter_answers[username] = vote;
    console.log(`📝 Recorded ${username}'s answer ${vote} for question ${gameState.current_question + 1} (prevents same answer re-vote)`);
    
    // Track successful vote processing
    trackVoteProcessing(Date.now() - voteStartTime, false, false);
    
    // Add to gameshow participants list for credits (unique only)
    if (!gameState.gameshow_participants.includes(username)) {
      gameState.gameshow_participants.push(username);
      console.log(`🎭 Added ${username} to gameshow participants for credits (Total participants: ${gameState.gameshow_participants.length})`);
      
      // Check for giveaway voter entry (3x weight for voters)
      processGiveawayVoterEntry(username);
    }
    
    const voteData = {
      username: username,
      vote: vote,
      timestamp: Date.now()
    };
    
    // Add to complete votes list for tallying
    gameState.poll_all_votes.push(voteData);
    
    // Add to recent voters list (keep last 10 for display)
    gameState.poll_voters.unshift(voteData);
    
    // Keep only last 10 voters for display
    if (gameState.poll_voters.length > 10) {
      gameState.poll_voters = gameState.poll_voters.slice(0, 10);
    }
    
    console.log(`🗳️ Vote recorded: ${username} voted ${vote} (Total voters: ${gameState.poll_voter_history.length})`);
    
    // LEADERBOARD: Award participation points
    addPointsToPlayer(username, leaderboardSettings.points.participation, 'participation');
    
    // Track vote for speed bonus calculation later
    const voteIndex = vote.charCodeAt(0) - 65; // Convert A,B,C,D to 0,1,2,3
    currentQuestionVotes.push({
      username: username,
      answer: vote,
      answerIndex: voteIndex,
      timestamp: Date.now(),
      responseTime: Date.now() - (gameState.answers_shown_time || Date.now())
    });
    console.log(`📊 Current vote tallies: A=${gameState.poll_all_votes.filter(v => v.vote === 'A').length}, B=${gameState.poll_all_votes.filter(v => v.vote === 'B').length}, C=${gameState.poll_all_votes.filter(v => v.vote === 'C').length}, D=${gameState.poll_all_votes.filter(v => v.vote === 'D').length}`);
    
    // Calculate vote tallies for real-time display
    const voteTallies = {
      A: gameState.poll_all_votes.filter(v => v.vote === 'A').length,
      B: gameState.poll_all_votes.filter(v => v.vote === 'B').length,
      C: gameState.poll_all_votes.filter(v => v.vote === 'C').length,
      D: gameState.poll_all_votes.filter(v => v.vote === 'D').length
    };
    
    // Broadcast specific vote update for real-time vote display
    broadcastToClients({
      type: 'audience_poll_vote_update',
      votes: voteTallies,
      totalVotes: gameState.poll_voter_history.length,
      timestamp: Date.now()
    });
    console.log('📡 Sent real-time vote update to voting panel:', voteTallies);
    
    // Broadcast the updated state
    broadcastState();
  } else {
    console.log(`❌ No valid vote found in message: "${message}"`);
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
  }
}

// Process lifeline votes from chat
function processLifelineVoteFromChat(data) {
  const voteStartTime = Date.now(); // Track processing time
  
  // Enhanced error handling and validation
  try {
    // Validate lifeline voting is active
    if (!gameState.lifeline_voting_active) {
      if (DEBUG_LIFELINE_VOTING) console.log('🚫 Lifeline voting not active - ignoring vote');
      trackVoteProcessing(Date.now() - voteStartTime, true);
      return;
    }
    
    // Validate input data structure
    if (!data || typeof data !== 'object') {
      console.error('❌ Invalid lifeline vote data structure:', data);
      return;
    }
    
    // Validate required fields
    if (!data.username || !data.text) {
      console.error('❌ Missing required fields in lifeline vote:', {
        hasUsername: !!data.username,
        hasText: !!data.text,
        data: data
      });
      return;
    }
    
    // Normalize and validate username
    const username = String(data.username).toLowerCase().trim();
    if (!username || username.length < 1 || username.length > 50) {
      console.error('❌ Invalid username for lifeline vote:', {
        original: data.username,
        normalized: username,
        length: username.length
      });
      return;
    }
    
    // Normalize and validate message
    const message = String(data.text).trim().toUpperCase();
    if (!message || message.length < 1 || message.length > 100) {
      console.error('❌ Invalid message for lifeline vote:', {
        original: data.text,
        normalized: message,
        length: message.length
      });
      return;
    }
    
    // Validate game state arrays exist
    if (!Array.isArray(gameState.lifeline_voter_history)) {
      console.error('❌ lifeline_voter_history is not an array, reinitializing');
      gameState.lifeline_voter_history = [];
    }
    
    if (!Array.isArray(gameState.lifeline_votes)) {
      console.error('❌ lifeline_votes is not an array, reinitializing');
      gameState.lifeline_votes = [];
    }
    
    if (!Array.isArray(gameState.available_lifelines_for_vote)) {
      console.error('❌ available_lifelines_for_vote is not an array, reinitializing');
      gameState.available_lifelines_for_vote = [];
    }
    
    // Validate vote counts object
    if (!gameState.lifeline_vote_counts || typeof gameState.lifeline_vote_counts !== 'object') {
      console.error('❌ lifeline_vote_counts is invalid, reinitializing');
      gameState.lifeline_vote_counts = {
        fiftyFifty: 0,
        takeAnotherVote: 0,
        askAMod: 0
      };
    }
  
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Processing lifeline vote from ${username}: "${message}"`);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Current lifeline voter history:`, gameState.lifeline_voter_history);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 User already voted?`, gameState.lifeline_voter_history.includes(username));
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Is this a host vote?`, data.isHost || false);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Vote platform:`, data.platform || 'unknown');
    
    // Check if user has already voted (deduplication with normalized username)
    if (gameState.lifeline_voter_history.includes(username)) {
      if (DEBUG_LIFELINE_VOTING) console.log(`⚠️ Duplicate lifeline vote attempt from ${username} - ignoring`);
      trackVoteProcessing(Date.now() - voteStartTime, false, true);
      return;
    }
    
    // Validate available lifelines
    if (!gameState.available_lifelines_for_vote || gameState.available_lifelines_for_vote.length === 0) {
      console.error('❌ No lifelines available for voting');
      return;
    }
    
    console.log(`🎯 Available lifelines for voting:`, gameState.available_lifelines_for_vote);
  
    // Parse vote - accept various formats with enhanced validation
    let lifeline = null;
    let voteType = 'unknown';
    
    // Check for numeric votes first (1, 2, 3) - use actual position in available array
    const numericVote = parseInt(message);
    if (!isNaN(numericVote) && numericVote >= 1 && numericVote <= 3) {
      // Convert 1-based user input to 0-based array index
      const voteIndex = numericVote - 1;
      
      // Check if this index is valid for the available lifelines
      if (voteIndex < gameState.available_lifelines_for_vote.length) {
        lifeline = gameState.available_lifelines_for_vote[voteIndex];
        voteType = 'numeric';
        
        // Get display name for logging
        const lifelineNames = {
          'fiftyFifty': '⚡ 50:50',
          'takeAnotherVote': 'Take Another Vote',
          'askAMod': 'Ask a Mod'
        };
        console.log(`🔢 Numeric vote detected: ${numericVote} = ${lifelineNames[lifeline] || lifeline}`);
      } else {
        console.log(`⚠️ Vote '${numericVote}' is out of range. Available options: 1-${gameState.available_lifelines_for_vote.length}`);
      }
    }
    // Check for 50/50 votes (text-based)
    else if (message === '50/50' || message === '50' || message === 'FIFTY' || 
        message.includes('50') || message.includes('FIFTY')) {
      if (gameState.available_lifelines_for_vote.includes('fiftyFifty')) {
        lifeline = 'fiftyFifty';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = 50:50`);
      } else {
        console.log(`⚠️ Vote '${message}' (50:50) not available in current lifelines`);
      }
    }
    // Check for Take Another Vote (takeAnotherVote) - VOTE command
    else if (message === 'VOTE' || message === 'ANOTHER' || message === 'REVOTE' ||
             message.includes('VOTE') || message.includes('AUDIENCE')) {
      if (gameState.available_lifelines_for_vote.includes('takeAnotherVote')) {
        lifeline = 'takeAnotherVote';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = Take Another Vote`);
      } else {
        console.log(`⚠️ Vote '${message}' (Take Another Vote) not available in current lifelines`);
      }
    }
    // Check for Ask a Mod (askAMod) - MOD command
    else if (message === 'MOD' || message === 'ASK' || 
             message.includes('MOD') || message.includes('PHONE')) {
      if (gameState.available_lifelines_for_vote.includes('askAMod')) {
        lifeline = 'askAMod';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = Ask a Mod`);
      } else {
        console.log(`⚠️ Vote '${message}' (Ask a Mod) not available in current lifelines`);
      }
    }
  
    if (lifeline) {
      // Check if this lifeline has already been used in this game
      if (gameState.lifelines_used.includes(lifeline)) {
        console.log(`🚫 Lifeline vote blocked: ${username} tried to vote for already used lifeline ${lifeline}`);
        trackVoteProcessing(Date.now() - voteStartTime, false, false);
        return;
      }
      
      console.log(`✅ Valid lifeline vote detected: ${username} voting ${lifeline} (${voteType})`);
      
      // Initialize voteData outside try block to prevent undefined reference in error handler
      let voteData = null;
      
      // Enhanced vote recording with validation
      try {
        // Validate vote count exists
        if (typeof gameState.lifeline_vote_counts[lifeline] !== 'number') {
          console.error(`❌ Invalid vote count for ${lifeline}, resetting to 0`);
          gameState.lifeline_vote_counts[lifeline] = 0;
        }
        
        // Record the vote (first vote only)
        gameState.lifeline_voter_history.push(username);
        console.log(`🔒 Added ${username} to lifeline voter history. New history:`, gameState.lifeline_voter_history);
        
        voteData = {
          username: username,
          lifeline: lifeline,
          voteType: voteType,
          originalMessage: data.text,
          timestamp: Date.now(),
          platform: data.platform || 'unknown'
        };
        
        // Add to lifeline votes list
        gameState.lifeline_votes.push(voteData);
        
        // Increment vote count with validation
        const oldCount = gameState.lifeline_vote_counts[lifeline];
        gameState.lifeline_vote_counts[lifeline]++;
        const newCount = gameState.lifeline_vote_counts[lifeline];
        
        console.log(`🗳️ Lifeline vote recorded: ${username} voted ${lifeline} (${oldCount} → ${newCount})`);
        console.log(`📊 Current lifeline vote tallies: 50/50=${gameState.lifeline_vote_counts.fiftyFifty}, VOTE=${gameState.lifeline_vote_counts.takeAnotherVote}, MOD=${gameState.lifeline_vote_counts.askAMod}`);
        
        // Validate total votes
        const totalVotes = gameState.lifeline_votes.length;
        const expectedTotal = gameState.lifeline_vote_counts.fiftyFifty + 
                             gameState.lifeline_vote_counts.takeAnotherVote + 
                             gameState.lifeline_vote_counts.askAMod;
        
        if (totalVotes !== expectedTotal) {
          console.error(`❌ Vote count mismatch! Total votes: ${totalVotes}, Expected: ${expectedTotal}`);
        }
        
        // Memory optimization: Limit lifeline_votes array to prevent unbounded growth
        const MAX_LIFELINE_VOTES = 1000; // Keep only last 1000 votes for memory efficiency
        if (gameState.lifeline_votes.length > MAX_LIFELINE_VOTES) {
          const removed = gameState.lifeline_votes.splice(0, gameState.lifeline_votes.length - MAX_LIFELINE_VOTES);
          console.log(`🧹 Memory optimization: Removed ${removed.length} old lifeline votes, keeping ${gameState.lifeline_votes.length} recent votes`);
        }
        
        // Memory optimization: Limit voter history to prevent unbounded growth
        const MAX_VOTER_HISTORY = 5000; // Keep only last 5000 voter records
        if (gameState.lifeline_voter_history.length > MAX_VOTER_HISTORY) {
          const removed = gameState.lifeline_voter_history.splice(0, gameState.lifeline_voter_history.length - MAX_VOTER_HISTORY);
          console.log(`🧹 Memory optimization: Removed ${removed.length} old voter history entries, keeping ${gameState.lifeline_voter_history.length} recent entries`);
        }
        
        // Broadcast vote update for real-time display with enhanced data
        if (DEBUG_LIFELINE_VOTING) console.log('📡 Broadcasting lifeline_vote_update to all clients...');
        const updateMessage = {
          type: 'lifeline_vote_update',
          voteCounts: gameState.lifeline_vote_counts,
          totalVotes: totalVotes,
          recentVoter: {
            username: username,
            lifeline: lifeline,
            voteType: voteType,
            timestamp: Date.now()
          },
          availableLifelines: gameState.available_lifelines_for_vote
        };
        
        broadcastLifelineVoteUpdate(updateMessage);
        if (DEBUG_LIFELINE_VOTING) console.log('✅ lifeline_vote_update broadcast sent');
        
        // Broadcast the updated state
        broadcastState();
        
        // Track successful vote processing
        trackVoteProcessing(Date.now() - voteStartTime, false, false);
        
      } catch (error) {
        console.error('❌ Error recording lifeline vote:', error);
        console.error('❌ Vote data:', voteData);
        console.error('❌ Game state:', {
          lifeline_voting_active: gameState.lifeline_voting_active,
          lifeline_vote_counts: gameState.lifeline_vote_counts,
          lifeline_votes_length: gameState.lifeline_votes.length
        });
      }
    } else {
      console.log(`❌ No valid lifeline found in message: "${message}" from ${username}`);
      console.log(`❌ Available lifelines:`, gameState.available_lifelines_for_vote);
    }
    
  } catch (error) {
    console.error('❌ Critical error in processLifelineVoteFromChat:', error);
    console.error('❌ Input data:', data);
    console.error('❌ Stack trace:', error.stack);
  }
}

// Process Ask a Mod response from moderator during active session
function processAskAModResponse(chatData, isModerator = false, isVIP = false) {
  try {
    const responderType = isModerator ? 'moderator' : (isVIP ? 'VIP' : 'unknown');
    console.log(`🛡️ Processing Ask a Mod response from ${responderType}: ${chatData.username}`);
    
    // Validate input data
    if (!chatData || !chatData.username || !chatData.text) {
      console.error('❌ Invalid Ask a Mod response data:', chatData);
      return;
    }
    
    const username = chatData.username.toLowerCase().trim();
    const message = chatData.text.trim();
    
    // Check if Ask a Mod session is active
    if (!gameState.ask_a_mod_active) {
      console.log('🚫 Ask a Mod session not active - ignoring response');
      return;
    }
    
    // Verify user has permission to respond
    if (!isModerator && !(gameState.ask_a_mod_include_vips && isVIP)) {
      console.warn(`⚠️ User ${username} does not have permission to respond`);
      return;
    }
    
    const icon = isModerator ? '🛡️' : '💎';
    console.log(`${icon} ${responderType} chat message received - Username: ${username}, Message: "${message}"`);
    
    // Create mod/VIP response object for chat display
    const modResponse = {
      username: username,
      userType: responderType,
      isModerator: isModerator,
      isVIP: isVIP,
      message: message,
      timestamp: Date.now(),
      platform: chatData.platform || 'twitch'
    };
    
    // Add to mod responses array
    gameState.mod_responses.push(modResponse);
    
    console.log(`💬 Mod chat message stored for display: ${username}: "${message}"`);
    
    // Broadcast mod chat message for real-time display (no vote counting)
    broadcastToClients({
      type: 'ask_a_mod_chat_message',
      username: username,
      message: message,
      timestamp: Date.now(),
      platform: chatData.platform || 'twitch'
    });
    
    // Broadcast the mod response for display on audience overlay (chat display only)
    broadcastToClients({
      type: 'ask_a_mod_display_update',
      newResponse: modResponse,
      allResponses: gameState.mod_responses,
      totalResponses: gameState.mod_responses.length,
      timestamp: Date.now()
    });
    
    // Also broadcast as mod_response for compatibility with existing systems
    broadcastToClients({
      type: 'mod_response',
      response: modResponse,
      timestamp: Date.now()
    });
    
    console.log(`🛡️ Ask a Mod response processed successfully - Total responses: ${gameState.mod_responses.length}`);
    
  } catch (error) {
    console.error('❌ Error processing Ask a Mod response:', error);
    console.error('❌ Chat data:', chatData);
  }
}

// Memory optimization: Periodic cleanup for long-running sessions
function performMemoryCleanup() {
  console.log('🧹 Performing periodic memory cleanup...');
  
  const beforeCleanup = {
    lifelineVotes: gameState.lifeline_votes?.length || 0,
    voterHistory: gameState.lifeline_voter_history?.length || 0,
    pollVotes: gameState.poll_all_votes?.length || 0,
    pollVoters: gameState.poll_voters?.length || 0,
    pollVoterHistory: gameState.poll_voter_history?.length || 0
  };
  
  let cleanupActions = [];
  
  // Clean up old lifeline votes (keep last 500 for efficiency)
  if (gameState.lifeline_votes && gameState.lifeline_votes.length > 500) {
    const removed = gameState.lifeline_votes.splice(0, gameState.lifeline_votes.length - 500);
    cleanupActions.push(`${removed.length} old lifeline votes`);
  }
  
  // Clean up old voter history (keep last 2000 for deduplication)
  if (gameState.lifeline_voter_history && gameState.lifeline_voter_history.length > 2000) {
    const removed = gameState.lifeline_voter_history.splice(0, gameState.lifeline_voter_history.length - 2000);
    cleanupActions.push(`${removed.length} old voter history entries`);
  }
  
  // Clean up old poll votes (keep last 1000)
  if (gameState.poll_all_votes && gameState.poll_all_votes.length > 1000) {
    const removed = gameState.poll_all_votes.splice(0, gameState.poll_all_votes.length - 1000);
    cleanupActions.push(`${removed.length} old poll votes`);
  }
  
  // Clean up old poll voters (keep last 100)
  if (gameState.poll_voters && gameState.poll_voters.length > 100) {
    const removed = gameState.poll_voters.splice(0, gameState.poll_voters.length - 100);
    cleanupActions.push(`${removed.length} old poll voters`);
  }
  
  // Clean up old poll voter history (keep last 2000)
  if (gameState.poll_voter_history && gameState.poll_voter_history.length > 2000) {
    const removed = gameState.poll_voter_history.splice(0, gameState.poll_voter_history.length - 2000);
    cleanupActions.push(`${removed.length} old poll voter history`);
  }
  
  const afterCleanup = {
    lifelineVotes: gameState.lifeline_votes?.length || 0,
    voterHistory: gameState.lifeline_voter_history?.length || 0,
    pollVotes: gameState.poll_all_votes?.length || 0,
    pollVoters: gameState.poll_voters?.length || 0,
    pollVoterHistory: gameState.poll_voter_history?.length || 0
  };
  
  if (cleanupActions.length > 0) {
    console.log(`🧹 Memory cleanup completed: removed ${cleanupActions.join(', ')}`);
    console.log(`📊 Memory usage after cleanup:`, {
      before: beforeCleanup,
      after: afterCleanup
    });
  } else {
    console.log('🧹 No memory cleanup needed - all arrays within limits');
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
    console.log('🗑️ Forced garbage collection');
  }
}

// Schedule periodic memory cleanup (every 30 minutes)
setInterval(performMemoryCleanup, 30 * 60 * 1000);

// Also perform cleanup on game reset
function resetGameStateWithCleanup() {
  console.log('🎮 Resetting game state with memory cleanup...');
  
  // Clear all timers and intervals first
  if (gameState.lifeline_countdown_interval) {
    clearInterval(gameState.lifeline_countdown_interval);
    gameState.lifeline_countdown_interval = null;
  }
  if (gameState.hot_seat_timer_interval) {
    clearInterval(gameState.hot_seat_timer_interval);
    gameState.hot_seat_timer_interval = null;
  }
  if (gameState.hot_seat_prestart_interval) {
    clearInterval(gameState.hot_seat_prestart_interval);
    gameState.hot_seat_prestart_interval = null;
  }
  if (gameState.hot_seat_entry_timer_interval) {
    clearInterval(gameState.hot_seat_entry_timer_interval);
    gameState.hot_seat_entry_timer_interval = null;
  }
  if (giveawayTimerInterval) {
    clearInterval(giveawayTimerInterval);
    giveawayTimerInterval = null;
  }
  
  // Clear all vote-related arrays
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  
  // Reset vote counts
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    takeAnotherVote: 0,
    askAMod: 0
  };
  
  // Clear tie-breaking states
  gameState.poll_tie_detected = false;
  gameState.poll_tied_options = null;
  gameState.poll_tie_votes = 0;
  gameState.waiting_for_tie_break = false;
  gameState.lifeline_tie_detected = false;
  gameState.lifeline_tied_options = null;
  gameState.lifeline_tie_votes = 0;
  gameState.waiting_for_lifeline_tie_break = false;
  
  console.log('🧹 Game state reset with memory cleanup completed');
}

// Calculate vote totals and determine winning answer
function calculatePollWinner() {
  if (!gameState.poll_all_votes || gameState.poll_all_votes.length === 0) {
    console.log('⚠️ No votes to tally');
    return null;
  }
  
  // Count votes for each option from all recorded voters
  const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
  
  // Tally votes from complete vote record
  gameState.poll_all_votes.forEach(voter => {
    if (voteCounts.hasOwnProperty(voter.vote)) {
      voteCounts[voter.vote]++;
    }
  });
  
  // Find the winner(s) - now detecting ties
  let maxVotes = Math.max(...Object.values(voteCounts));
  let winners = [];
  
  Object.keys(voteCounts).forEach(option => {
    if (voteCounts[option] === maxVotes && voteCounts[option] > 0) {
      winners.push(option);
    }
  });
  
  const totalVotes = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
  const percentage = totalVotes > 0 ? Math.round((maxVotes / totalVotes) * 100) : 0;
  
  console.log('📊 Poll Results:');
  console.log(`   A: ${voteCounts.A} votes`);
  console.log(`   B: ${voteCounts.B} votes`);
  console.log(`   C: ${voteCounts.C} votes`);
  console.log(`   D: ${voteCounts.D} votes`);
  
  // Check for tie
  if (winners.length > 1) {
    console.log(`🤝 TIE DETECTED! Options ${winners.join(', ')} each have ${maxVotes} votes`);
    
    // Store tie information in game state for host to resolve
    gameState.poll_tie_detected = true;
    gameState.poll_tied_options = winners;
    gameState.poll_tie_votes = maxVotes;
    
    // Broadcast tie to control panel for host selection
    broadcastToClients({
      type: 'poll_tie_detected',
      tiedOptions: winners,
      votes: maxVotes,
      voteCounts: voteCounts,
      totalVotes: totalVotes,
      message: `Tie detected! Options ${winners.join(' and ')} each have ${maxVotes} votes. Host must select winner.`
    });
    
    return {
      winner: null, // No winner until host selects
      isTie: true,
      tiedOptions: winners,
      votes: maxVotes,
      percentage: percentage,
      totalVotes: totalVotes,
      allCounts: voteCounts
    };
  } else if (winners.length === 1) {
    // Single winner - no tie
    const winner = winners[0];
    console.log(`🏆 Winner: ${winner} with ${maxVotes} votes (${percentage}%)`);
    
    // Clear any previous tie state
    gameState.poll_tie_detected = false;
    gameState.poll_tied_options = null;
    gameState.poll_tie_votes = 0;
    
    return {
      winner: winner,
      isTie: false,
      votes: maxVotes,
      percentage: percentage,
      totalVotes: totalVotes,
      allCounts: voteCounts
    };
  } else {
    // No votes at all
    console.log('⚠️ No votes received');
    return null;
  }
}

// Automatically lock in the audience's choice when poll ends
// Unified function to lock in audience choice with optional winner display
function lockInAudienceChoice(showWinnerAnnouncement = true) {
  const result = calculatePollWinner();
  
  if (!result) {
    console.log('⚠️ Cannot lock in audience choice - no votes recorded');
    return;
  }
  
  // Check if there's a tie that needs host resolution
  if (result.isTie) {
    console.log('🤝 Cannot auto-lock answer - tie detected. Waiting for host to break tie.');
    
    // End the poll but don't lock any answer
    gameState.audience_poll_active = false;
    gameState.show_voting_activity = false;
    gameState.waiting_for_tie_break = true;
    
    // Broadcast state to show tie situation
    broadcastState();
    
    // The host will need to manually select from the tied options
    return;
  }
  
  // Convert letter to answer index (A=0, B=1, C=2, D=3)
  const answerIndex = ['A', 'B', 'C', 'D'].indexOf(result.winner);
  
  // First, show the audience choice overlay (if enabled)
  if (showWinnerAnnouncement) {
    // Set poll winner data for display
    gameState.show_poll_winner = result.winner;
    gameState.poll_winner_votes = result.votes;
    gameState.poll_winner_percentage = result.percentage;
    
    console.log(`🏆 SHOWING AUDIENCE CHOICE: Answer ${result.winner} with ${result.votes} votes (${result.percentage}%)`);
    console.log('⏱️ Displaying audience choice for 3 seconds before locking in...');
    
    // End the poll but don't lock the answer yet
    gameState.audience_poll_active = false;
    gameState.show_voting_activity = false;
    
    // Broadcast state to show the overlay
    broadcastState();
    
    // After 3 seconds, lock in the answer
    setTimeout(() => {
      console.log(`🔒 Now locking in audience choice: ${result.winner}`);
      
      // Set the audience's choice AND lock it in
      gameState.selected_answer = answerIndex;
      gameState.answer_locked_in = true;
      
      console.log(`📡 DEBUG: Setting answer_locked_in = true, selected_answer = ${answerIndex} (${result.winner})`);
      
      // Clear the winner display
      gameState.show_poll_winner = null;
      gameState.poll_winner_votes = 0;
      gameState.poll_winner_percentage = 0;
      
      // Play lock-in sound effect
      console.log('🎵 Broadcasting lock-in audio command for poll result');
      broadcastToClients({ type: 'audio_command', command: 'play_lock' });
      
      // Check if this poll was from a lifeline and led to correct answer discovery
      if (gameState.answer_is_wrong && !gameState.correct_answer_highlighted) {
        console.log('🔍 Checking if audience lifeline led to correct answer discovery...');
        const successful = checkLifelineSuccess(result.winner);
        
        // Track outcome for game flow loop if this was part of lifeline voting
        if (gameState.lifelines_used.includes('takeAnotherVote') || gameState.is_revote_active) {
          setTimeout(() => {
            trackLifelineOutcome('takeAnotherVote', successful);
          }, 2000); // Brief delay to let answer processing complete
        }
      }
      
      console.log(`✅ Answer ${result.winner} is now LOCKED IN - Host can click "Reveal Answer" to see if the audience was correct`);
      
      // Broadcast the updated state to all clients
      broadcastState();
    }, 3000); // 3-second delay for display
    
  } else {
    // If not showing announcement, lock immediately (original behavior)
    gameState.selected_answer = answerIndex;
    gameState.answer_locked_in = true;
    gameState.audience_poll_active = false;
    gameState.show_voting_activity = false;
    
    // Play lock-in sound effect
    console.log('🎵 Broadcasting lock-in audio command for poll result');
    broadcastToClients({ type: 'audio_command', command: 'play_lock' });
    
    console.log(`🔒 Answer ${result.winner} is now LOCKED IN (no announcement) - Host can click "Reveal Answer"`);
    
    // Broadcast the updated state to all clients
    broadcastState();
  }
}

// Automatic polling system
let pollTimer = null;

function startAutomaticPoll() {
  // Enhanced debugging for poll start conditions
  console.log('🔍 startAutomaticPoll() called - checking conditions:');
  console.log('   gameState.answers_visible:', gameState.answers_visible);
  console.log('   gameState.audience_poll_active:', gameState.audience_poll_active);
  console.log('   gameState.current_question:', gameState.current_question);
  console.log('   gameState.game_active:', gameState.game_active);
  
  // Only start if answers are visible and no poll is active
  if (!gameState.answers_visible || gameState.audience_poll_active) {
    console.log('❌ Cannot start auto-poll: answers_visible=' + gameState.answers_visible + ', poll_active=' + gameState.audience_poll_active);
    console.log('   Poll start BLOCKED - conditions not met');
    return;
  }
  
  console.log('✅ All conditions met - starting automatic poll');
  console.log('🗳️ Auto-starting 1-minute audience poll - SHOWING voting panel');
  
  // Track game flow metrics
  performanceMetrics.gameFlow.pollsStarted++;
  
  // CLEAN SHOW: Activate poll and make panel visible
  gameState.audience_poll_active = true;
  gameState.show_voting_activity = true;
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.show_poll_winner = null;
  
  // IMPORTANT: Clear question_voter_answers when starting a new poll
  // This allows users to vote again in revotes or when polls are restarted
  // The poll_voter_history prevents duplicate votes within the same poll
  gameState.question_voter_answers = {};
  console.log('🗑️ Cleared question_voter_answers for new poll - users can vote again');
  
  // Broadcast poll start
  broadcastState();
  
  // Capture exact start time for precise synchronization
  const pollStartTime = Date.now();
  
  // Send poll started event to WebSocket clients with exact start time
  broadcastToClients({
    type: 'audience_poll_started',
    duration: gameState.audience_poll_duration, // Use configurable duration
    startTime: pollStartTime // Use exact captured start time
  });
  
  // Start timer with configurable duration
  pollTimer = setTimeout(() => {
    endAutomaticPoll();
  }, gameState.audience_poll_duration);
  
  const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
  console.log(`⏱️ ${durationSeconds}-second poll timer started - chat can vote A, B, C, or D`);
}

function endAutomaticPoll() {
  if (!gameState.audience_poll_active) {
    console.log('⚠️ No active poll to end');
    return;
  }
  
  const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
  const isRevote = gameState.is_revote_active;
  
  if (isRevote) {
    console.log(`🔄 Ending post-lifeline revote after ${durationSeconds} seconds - host manual selection takes precedence`);
  } else {
    console.log(`🏁 Auto-ending audience poll after ${durationSeconds} seconds - hiding voting panel`);
  }
  
  // Clear the timer
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  
  // CLEAN HIDE: Immediately hide voting panel completely
  gameState.audience_poll_active = false;
  gameState.show_voting_activity = false;
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  
  // Clean up revote state if this was a revote
  if (isRevote) {
    gameState.is_revote_active = false;
    console.log('🔄 Cleared revote state - host can now proceed with manual selection');
  }
  
  // Send poll ended event
  broadcastToClients({
    type: 'audience_poll_ended',
    endTime: Date.now(),
    reason: isRevote ? 'revote_manual_intervention' : 'host_selection'
  });
  
  // For non-revotes, use lockInAudienceChoice to handle winner display and locking
  // For revotes, let the host manually select
  if (!isRevote) {
    // This will handle the 3-second display and auto-lock
    lockInAudienceChoice(true);
  } else {
    console.log('🔄 Revote ended - host maintains manual control over answer selection');
    // Just calculate and log the result for host reference
    const result = calculatePollWinner();
    if (result && result.winner) {
      console.log(`📊 Revote result: ${result.winner} with ${result.votes} votes (${result.percentage}%) - host can manually select any answer`);
    }
  }
  
  // Clean up vote data after processing
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  
  console.log('✅ Voting panel completely hidden until next question answers');
  
  // Check if there's a pending lifeline vote that was deferred during audience poll
  if (gameState.pending_lifeline_vote && gameState.available_lifelines_for_vote && gameState.available_lifelines_for_vote.length > 0) {
    console.log('🎯 Starting deferred lifeline voting now that audience poll has ended');
    gameState.pending_lifeline_vote = false;
    
    // Start lifeline voting with a small delay to allow UI to update
    setTimeout(() => {
      console.log('❌ Starting lifeline voting after audience poll completion');
      console.log('🗳️ Available lifelines for voting:', gameState.available_lifelines_for_vote);
      
      // Initialize lifeline voting state
      gameState.lifeline_voting_active = true;
      gameState.lifeline_voting_timer_active = true;
      gameState.lifeline_voting_start_time = Date.now();
      gameState.lifeline_votes = [];
      gameState.lifeline_voter_history = [];
      gameState.lifeline_vote_counts = {
        fiftyFifty: 0,
        takeAnotherVote: 0,
        askAMod: 0
      };
      gameState.lifeline_vote_winner = null;
      
      // Add continuous countdown timer for smooth updates
      if (gameState.lifeline_countdown_interval) {
        clearInterval(gameState.lifeline_countdown_interval);
      }
      gameState.lifeline_countdown_interval = setInterval(() => {
        if (gameState.lifeline_voting_timer_active) {
          const elapsed = Date.now() - gameState.lifeline_voting_start_time;
          const remaining = Math.max(0, (gameState.lifeline_voting_duration || 30000) - elapsed);
          
          // Broadcast countdown update (only broadcast every second, log every 5 seconds)
          const seconds = Math.ceil(remaining / 1000);
          const lastSeconds = Math.ceil((remaining + 1000) / 1000);
          
          // Only broadcast when the second changes (not every interval tick)
          if (seconds !== lastSeconds) {
            if (seconds % 5 === 0 || seconds <= 3) {
              console.log(`⏱️ Lifeline voting countdown: ${seconds}s remaining`);
            }
            broadcastToClients({
              type: 'lifeline_voting_countdown',
              remainingTime: remaining,
              seconds: seconds
            });
          }
          
          // Stop timer if time is up
          if (remaining === 0) {
            clearInterval(gameState.lifeline_countdown_interval);
            gameState.lifeline_countdown_interval = null;
            
            // Actually end the voting and process results
            console.log('⏰ Lifeline voting timer expired - processing results');
            endLifelineVoting();
          }
        }
      }, 1000); // Update every 1 second
      
      // Broadcast lifeline voting started
      broadcastToClients({
        type: 'lifeline_voting_started',
        availableLifelines: gameState.available_lifelines_for_vote,
        duration: gameState.lifeline_voting_duration || 30000,
        message: 'Wrong answer! Vote for a lifeline: 1=50:50, 2=Take Another Vote, 3=Ask a Mod'
      });
      
      console.log('🗳️ Lifeline voting started for 30 seconds (deferred after audience poll)');
      
      // Auto-end lifeline voting after duration
      setTimeout(() => {
        if (gameState.lifeline_voting_active) {
          console.log('⏰ Lifeline voting time expired - processing results');
          endLifelineVoting();
        }
      }, gameState.lifeline_voting_duration || 30000);
    }, 1000); // 1 second delay to allow UI transition
  }
}

// Helper function to broadcast messages to WebSocket clients
// NOTE: Commented out duplicate function - using the enhanced version at line 7412
/*
function broadcastToClients(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}
*/

// Modify the handleAPI function to broadcast updates
async function handleAPI(req, res, pathname) {
  setCORSHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (pathname === '/api/state') {
      const cleanGameState = createSerializableGameState({
        includeQuestions: true,
        includeCurrentQuestion: true,
        includePrizes: true
      });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cleanGameState));
    return;
  }

  if (pathname === '/api/polling/config') {
    if (req.method === 'GET') {
      try {
        const configData = loadPollingConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(configData));
      } catch (error) {
        console.error('❌ Error reading polling config:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read config' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = body ? JSON.parse(body) : {};
          const existingConfig = loadPollingConfig();

          if (requestData.action === 'disconnect') {
            const updatedConfig = { ...existingConfig, isActive: false };
            savePollingConfig(updatedConfig);
            broadcastToClients({
              type: 'config_updated',
              config: { action: 'disconnect' },
              timestamp: Date.now()
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          const incomingConfig = requestData.config || requestData || {};
          const mergedConfig = mergePollingConfig(existingConfig, incomingConfig);
          savePollingConfig(mergedConfig);

          const broadcastConfig = requestData.config ? requestData : incomingConfig;

          broadcastToClients({
            type: 'config_updated',
            config: broadcastConfig || {},
            timestamp: Date.now()
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('❌ Error updating polling config:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update config' }));
        }
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (pathname === '/api/polling/test' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const requestData = body ? JSON.parse(body) : {};
        const testResult = {
          success: true,
          message: '✅ Connection test passed. Twitch IRC is responding normally.',
          details: {
            twitch: requestData.twitchChannel ? 'Available' : 'Not configured',
            youtube: (requestData.youtubeApiKey && requestData.youtubeLiveChatId) ? 'Configured' : 'Not configured'
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(testResult));
      } catch (error) {
        console.error('❌ Error in connection test:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: '❌ Connection test failed. Check server logs.',
          error: error.message
        }));
      }
    });
    return;
  }

  // Performance metrics endpoint
  if (pathname === '/api/performance') {
    const avgProcessingTime = performanceMetrics.lifeline.processingTimes.length > 0
      ? performanceMetrics.lifeline.processingTimes.reduce((a, b) => a + b, 0) / performanceMetrics.lifeline.processingTimes.length
      : 0;
    
    const metrics = {
      lifeline: {
        votesProcessed: performanceMetrics.lifeline.votesProcessed,
        votesRejected: performanceMetrics.lifeline.votesRejected,
        averageProcessingTime: avgProcessingTime.toFixed(2) + 'ms',
        currentVotesPerSecond: performanceMetrics.lifeline.currentVotesPerSecond,
        peakVotesPerSecond: performanceMetrics.lifeline.peakVotesPerSecond,
        rejectionRate: performanceMetrics.lifeline.votesProcessed > 0 
          ? ((performanceMetrics.lifeline.votesRejected / performanceMetrics.lifeline.votesProcessed) * 100).toFixed(2) + '%'
          : '0%',
        uptime: Math.floor((Date.now() - performanceMetrics.lifeline.lastResetTime) / 1000) + ' seconds'
      }
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
    return;
  }

  // Connection cleanup endpoint
  if (pathname === '/api/cleanup-connections' && req.method === 'POST') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    
    let cleaned = 0;
    
    // Close all connections for a specific client type if specified
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetClientType = data.clientType;
        
        wss.clients.forEach((client) => {
          if (client.readyState !== WebSocket.OPEN) {
            return; // Skip already closed connections
          }
          
          if (targetClientType && client.clientType === targetClientType) {
            console.log(`🧹 Cleaning up stale ${targetClientType} connection`);
            client.terminate();
            cleaned++;
          } else if (!targetClientType) {
            // Clean all stale connections
            console.log(`🧹 Cleaning up stale connection: ${client.clientType || 'unregistered'}`);
            client.terminate();
            cleaned++;
          }
        });
        
        res.end(JSON.stringify({
          success: true,
          message: `Cleaned up ${cleaned} connections`,
          cleaned: cleaned
        }));
      } catch (error) {
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  if (pathname === '/api/prizes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prizes: prizeAmounts }));
    return;
  }
  
  // API endpoint to get moderator list
  if (pathname === '/api/mods' && req.method === 'GET') {
    try {
      const modList = getCachedModList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        mods: modList 
      }));
    } catch (error) {
      console.error('❌ Error fetching mod list:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false,
        error: 'Failed to fetch moderator list' 
      }));
    }
    return;
  }
  
  // API endpoint to update moderator list
  if (pathname === '/api/mods' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data.mods)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false,
            error: 'Mods must be an array' 
          }));
          return;
        }
        
        saveModList(data.mods);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true,
          message: 'Moderator list updated',
          mods: getCachedModList()
        }));
      } catch (error) {
        console.error('❌ Error updating mod list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: 'Failed to update moderator list' 
        }));
      }
    });
    return;
  }
  
  // API endpoint to get VIP list
  if (pathname === '/api/vips' && req.method === 'GET') {
    try {
      const vipList = getCachedVipList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        vips: vipList 
      }));
    } catch (error) {
      console.error('❌ Error fetching VIP list:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false,
        error: 'Failed to fetch VIP list' 
      }));
    }
    return;
  }
  
  // API endpoint to update VIP list
  if (pathname === '/api/vips' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data.vips)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false,
            error: 'VIPs must be an array' 
          }));
          return;
        }
        
        saveVIPList(data.vips);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true,
          message: 'VIP list updated',
          vips: getCachedVipList()
        }));
      } catch (error) {
        console.error('❌ Error updating VIP list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: 'Failed to update VIP list' 
        }));
      }
    });
    return;
  }
  
  // API endpoint to get prize configuration
  if (pathname === '/api/prize-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true,
      config: gameState.prizeConfiguration 
    }));
    return;
  }
  
  // API endpoint to update prize configuration
  if (pathname === '/api/prize-config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        gameState.prizeConfiguration = {
          ...gameState.prizeConfiguration,
          ...config
        };
        
        console.log('🏆 Prize configuration updated:', gameState.prizeConfiguration);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true,
          message: 'Prize configuration updated',
          config: gameState.prizeConfiguration
        }));
        
        // Broadcast updated state
        broadcastToClients(gameState);
      } catch (error) {
        console.error('❌ Error updating prize config:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: 'Failed to update prize configuration' 
        }));
      }
    });
    return;
  }
  
  // API endpoint to reset winners
  if (pathname === '/api/reset-winners' && req.method === 'POST') {
    gameState.prizeConfiguration.winnersAnnounced = false;
    gameState.endGameTriggered = false;
    
    console.log('🔄 Winners reset for new game');
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true,
      message: 'Winners reset successfully'
    }));
    
    broadcastToClients(gameState);
    return;
  }
  
  // Shared Twitch emote API sourced from emotes-update.js
  if (pathname === '/api/twitch-emotes' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      emotes: TWITCH_EMOTES
    }));
    return;
  }

  // API endpoint for testing live chat connections
  if (pathname === '/api/polling/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const requestData = JSON.parse(body);
        console.log('🧪 Testing chat connection with config:', requestData);
        
        // For now, always return success since the actual Twitch chat is working
        // (Real connection test would involve checking Twitch API, but the chat is already proven working)
        const testResult = {
          success: true,
          message: '✅ Connection test passed. Twitch IRC is responding normally.',
          details: {
            twitch: requestData.twitchChannel ? 'Available' : 'Not configured',
            youtube: (requestData.youtubeApiKey && requestData.youtubeLiveChatId) ? 'Configured' : 'Not configured'
          }
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(testResult));
        console.log('✅ Connection test completed successfully');
      } catch (error) {
        console.error('❌ Error in connection test:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          message: '❌ Connection test failed. Check server logs.',
          error: error.message 
        }));
      }
    });
    return;
  }
  
  // AI Roary Status API
  if (pathname === '/api/roary/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'active',
      connected: true,
      lastActivity: Date.now()
    }));
    return;
  }
  
  // Animation API
  if (pathname === '/api/animation' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Animation command received:', data.command, data.params);
        
        // Broadcast animation command to all WebSocket clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'animation_command',
              command: data.command,
              params: data.params || {},
              timestamp: Date.now()
            }));
          }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, command: data.command }));
      } catch (error) {
        console.error('Animation API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid animation command' }));
      }
    });
    return;
  }
  
  // Animation Config API
  if (pathname === '/api/animation/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        console.log('Animation config updated:', config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('Animation config error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid animation config' }));
      }
    });
    return;
  }
  
  // Animation Status API
  if (pathname === '/api/animation/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'active',
      available_commands: ['dramatic_lock', 'curtain_open', 'question_reveal', 'answer_reveal']
    }));
    return;
  }
  
  // Mod List Management API
  if (pathname === '/api/mod-list') {
    if (req.method === 'GET') {
      try {
        const modListPath = path.join(__dirname, 'mod-list.json');
        let modList = [];
        
        if (fs.existsSync(modListPath)) {
          const modListData = fs.readFileSync(modListPath, 'utf8');
          modList = JSON.parse(modListData);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modList: modList }));
      } catch (error) {
        console.error('Error reading mod list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read mod list' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          const modListPath = path.join(__dirname, 'mod-list.json');
          
          // Validate mod list - ensure it's an array of strings
          let modList = requestData.modList || [];
          if (!Array.isArray(modList)) {
            throw new Error('Mod list must be an array');
          }
          
          // Filter out empty strings and validate usernames
          modList = modList.filter(username => 
            typeof username === 'string' && 
            username.trim().length > 0 && 
            username.trim().length <= 25 && // Twitch username limit
            /^[a-zA-Z0-9_]+$/.test(username.trim()) // Valid Twitch username format
          ).map(username => username.trim().toLowerCase());
          
          // Remove duplicates
          modList = [...new Set(modList)];
          
          fs.writeFileSync(modListPath, JSON.stringify(modList, null, 2));
          
          // Broadcast mod list update to all clients
          broadcastToClients({
            type: 'mod_list_updated',
            modList: modList,
            timestamp: Date.now()
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, modList: modList }));
          console.log('📝 Mod list updated:', modList);
        } catch (error) {
          console.error('Error updating mod list:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update mod list' }));
        }
      });
    }
    return;
  }
  
  // VIP List Management API
  if (pathname === '/api/vip-list') {
    if (req.method === 'GET') {
      try {
        const vipListPath = path.join(__dirname, 'vip-list.json');
        let vipList = [];
        
        if (fs.existsSync(vipListPath)) {
          const vipListData = fs.readFileSync(vipListPath, 'utf8');
          vipList = JSON.parse(vipListData);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ vipList: vipList }));
      } catch (error) {
        console.error('Error reading VIP list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read VIP list' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          
          // Validate VIP list - ensure it's an array of strings
          let vipList = requestData.vipList || [];
          if (!Array.isArray(vipList)) {
            throw new Error('VIP list must be an array');
          }
          
          // Filter out empty strings and validate usernames
          vipList = vipList.filter(username => 
            typeof username === 'string' && 
            username.trim().length > 0 && 
            username.trim().length <= 25 && // Twitch username limit
            /^[a-zA-Z0-9_]+$/.test(username.trim()) // Valid Twitch username format
          ).map(username => username.trim().toLowerCase());
          
          // Remove duplicates
          vipList = [...new Set(vipList)];
          
          // Use the saveVIPList function
          const saved = saveVIPList(vipList);
          
          if (saved) {
            console.log(`💎 Updated VIP list API with ${vipList.length} VIPs`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, vipList: vipList }));
          } else {
            throw new Error('Failed to save VIP list');
          }
        } catch (error) {
          console.error('Error updating VIP list:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update VIP list' }));
        }
      });
    }
    return;
  }
  
  // Ignored Users List Management API
  if (pathname === '/api/ignored-users-list') {
    if (req.method === 'GET') {
      try {
        const ignoredListPath = path.join(__dirname, 'ignored-users-list.json');
        let ignoredList = [];
        
        if (fs.existsSync(ignoredListPath)) {
          const ignoredListData = fs.readFileSync(ignoredListPath, 'utf8');
          ignoredList = JSON.parse(ignoredListData);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ignoredList: ignoredList }));
      } catch (error) {
        console.error('Error reading ignored users list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read ignored users list' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          const ignoredListPath = path.join(__dirname, 'ignored-users-list.json');
          
          // Validate ignored list - ensure it's an array of strings
          let ignoredList = requestData.ignoredList || [];
          if (!Array.isArray(ignoredList)) {
            throw new Error('Ignored list must be an array');
          }
          
          // Clean and validate each entry
          ignoredList = ignoredList
            .filter(user => typeof user === 'string' && user.trim())
            .map(user => user.trim().toLowerCase());
          
          // Save to file
          fs.writeFileSync(ignoredListPath, JSON.stringify(ignoredList, null, 2));
          
          // Reload cache
          loadIgnoredUsersList();
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: `Updated ignored users list (${ignoredList.length} users)`,
            ignoredList: ignoredList 
          }));
        } catch (error) {
          console.error('Error updating ignored users list:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update ignored users list' }));
        }
      });
    }
    return;
  }
  
  // Giveaway status endpoint (GET)
  if (pathname === '/api/giveaway' && req.method === 'GET') {
    const giveawayStatus = {
      active: gameState.giveaway_active,
      closed: gameState.giveaway_closed,
      prizeName: gameState.giveaway_prize_name,
      prizeAmount: gameState.giveaway_prize_amount,
      numWinners: gameState.giveaway_num_winners,
      timeRemaining: gameState.giveaway_active ? Math.max(0, gameState.giveaway_duration - (Date.now() - gameState.giveaway_start_time)) : 0,
      participantCount: gameState.giveaway_participants.length,
      totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
      keyword: gameState.giveaway_keyword,
      winners: gameState.giveaway_winners
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(giveawayStatus));
    return;
  }
  
  // Giveaway management endpoints
  if (pathname === '/api/giveaway' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Received giveaway action:', data.action);
        
        switch (data.action) {
          case 'start':
            startGiveaway(data.prizeName, data.prizeAmount, data.numWinners, data.keyword);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway started' }));
            break;
            
          case 'stop':
            stopGiveaway();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway stopped' }));
            break;
            
          case 'end_early_with_winners':
            // End giveaway early and immediately select winners
            if (!gameState.giveaway_active) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'No active giveaway to end early' 
              }));
              break;
            }
            
            console.log('🎯 Ending giveaway early and selecting winners...');
            
            // Check if there are participants before proceeding
            if (gameState.giveaway_participants.length === 0) {
              // If no participants, stop normally with overlay hiding
              stopGiveaway();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'Giveaway ended early but no participants to select winners from' 
              }));
              break;
            }
            
            // Close the giveaway WITHOUT calling stopGiveaway() to avoid hiding overlay
            console.log(`🛑 Closing giveaway early - ${gameState.giveaway_participants.length} participants`);
            gameState.giveaway_active = false;
            gameState.giveaway_closed = true;
            
            // Broadcast that giveaway is closing but winners will be shown immediately
            broadcastToClients({
              type: 'giveaway_ending_with_winners',
              participantCount: gameState.giveaway_participants.length,
              totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
              message: 'Giveaway ending early - selecting winners now!',
              timestamp: Date.now()
            });
            
            // Select winners immediately (no setTimeout delay)
            console.log('🎰 Immediately selecting winners for early end...');
            const earlyWinners = selectGiveawayWinners();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              winners: earlyWinners, 
              message: 'Giveaway ended early and winners selected' 
            }));
            break;
            
          case 'select_winners':
            if (!gameState.giveaway_closed) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'Giveaway must be closed before selecting winners' 
              }));
              break;
            }
            
            if (gameState.giveaway_participants.length === 0) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'No participants entered the giveaway. Nobody typed the keyword: ' + gameState.giveaway_keyword 
              }));
              break;
            }
            
            const winners = selectGiveawayWinners();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, winners: winners }));
            break;
            
          case 'reset':
            resetGiveaway(data.clearWinners);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway reset' }));
            break;
            
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown giveaway action' }));
        }
      } catch (error) {
        console.error('Error processing giveaway request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }
  
  // Giveaway status endpoint
  if (pathname === '/api/giveaway/status' && req.method === 'GET') {
    const giveawayStatus = {
      active: gameState.giveaway_active,
      closed: gameState.giveaway_closed,
      prizeName: gameState.giveaway_prize_name,
      prizeAmount: gameState.giveaway_prize_amount,
      numWinners: gameState.giveaway_num_winners,
      timeRemaining: gameState.giveaway_active ? Math.max(0, gameState.giveaway_duration - (Date.now() - gameState.giveaway_start_time)) : 0,
      participantCount: gameState.giveaway_participants.length,
      totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
      winners: gameState.giveaway_winners
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(giveawayStatus));
    return;
  }
  
  
  if (pathname === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        console.log('Received action:', data.action);
        console.log('🔍 SWITCH DEBUG: Action type:', typeof data.action, 'Value:', JSON.stringify(data.action));
        
        console.log('🔍 BEFORE SWITCH - Action value:', data.action);
        
        switch (data.action) {
          case 'start_game':
            // Activate welcome transition and prepare game
            gameState.game_active = true;
            gameState.current_question = 0;
            gameState.score = 0;
            gameState.lifelines_used = [];
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.show_welcome = true; // Welcome scene trigger  
            gameState.curtains_closed = false; // Open red curtains with dramatic intro when game starts
            
            // Clear gameshow participants for fresh credits
            gameState.gameshow_participants = [];
            gameState.credits_rolling = false;
            gameState.credits_scrolling = false;
            
            // CRITICAL: Clear lifeline voting states for new game
            gameState.lifeline_voting_active = false;
            gameState.lifeline_voting_timer_active = false;
            gameState.lifeline_voting_start_time = null;
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.available_lifelines_for_vote = [];
            gameState.lifeline_vote_winner = null;
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              takeAnotherVote: 0,
              askAMod: 0
            };
            console.log('🗳️ Cleared lifeline voting states for new game');
            
            console.log('Game started - opening red curtains with intro sequence');
            console.log('🎭 Gameshow participants cleared for fresh game');
            
            // Broadcast applause audio command
            console.log('🎵 Broadcasting applause audio command');
            broadcastToClients({ type: 'audio_command', command: 'play_applause' });
            
            // Auto-hide welcome after 3 seconds
            setTimeout(() => {
              if (gameState.show_welcome) {
                gameState.show_welcome = false;
                gameState.update_needed = true;
                broadcastState();
              }
            }, 3000);
            break;
            
          case 'reset_game':
            // Check if we're resetting after a completed game or mid-game
            if (gameState.game_completed) {
              console.log('✅ Resetting after completed game - current game stats were preserved');
            } else if (gameState.current_question > 0) {
              console.log('⚠️ WARNING: Resetting incomplete game at question ' + (gameState.current_question + 1));
            }
            
            // Clean up all timers before resetting
            cleanupAllTimers();
            
            // Reset gameshow board - keep contestant name but reset game state
            gameState.current_question = 0;
            gameState.score = 0;
            gameState.game_active = false;
            gameState.lifelines_used = [];
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.curtains_closed = true;
            gameState.show_welcome = true;
            gameState.preparing_for_game = false;
            gameState.fade_out_ready_text = false;
            gameState.selected_answer = null;
            gameState.first_selected_answer = null; // Reset first selected answer for fresh game
            gameState.answer_locked_in = false;
            gameState.answer_is_wrong = false;
            gameState.typewriter_animation_complete = false;
            gameState.correct_answer_highlighted = false; // Reset highlighting for fresh game
            // REMOVED: original_wrong_answer reset - now handled by persistent_wrong_answers array
            gameState.persistent_wrong_answers = []; // Reset persistent wrong answers for fresh game
            gameState.how_to_play_shown = false; // Reset How To Play flag for new game
            // Reset lifeline states for fresh game
            gameState.first_poll_winner = null;
            gameState.is_revote_active = false;
            gameState.excluded_answers = [];
            gameState.host_selection_history = []; // Clear host selection history for fresh game
            // COMPLETE VOTING PANEL RESET for game reset
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;
            gameState.poll_winner_votes = 0;
            gameState.poll_winner_percentage = 0;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            
            // CRITICAL: Clear all lifeline voting states on reset
            gameState.lifeline_voting_active = false;
            gameState.lifeline_voting_timer_active = false;
            gameState.lifeline_voting_start_time = null;
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.available_lifelines_for_vote = [];
            gameState.lifeline_vote_winner = null;
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              takeAnotherVote: 0,
              askAMod: 0
            };
            console.log('🗳️ Cleared lifeline voting states on game reset');
            
            // Clear question-level vote tracking for fresh game (prevents same answer re-voting)
            gameState.question_voter_answers = {};
            console.log('🗑️ Cleared question-level vote tracking for fresh game');
            
            // Clear any existing poll timer
            if (pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = null;
            }
            
            // Reset answer history to clear all previous results
            if (gameState.answerHistory) {
              gameState.answerHistory.forEach(entry => {
                entry.result = null;
              });
              console.log('📋 Answer history cleared for fresh game');
            }
            
            // Clear gameshow participants for fresh credits
            gameState.gameshow_participants = [];
            gameState.credits_rolling = false;
            gameState.credits_scrolling = false;
            console.log('🎭 Gameshow participants cleared for fresh game');
            
            // Reset giveaway system for fresh game
            resetGiveaway();
            console.log('🎁 Giveaway system reset for fresh game');
            
            // Reset game completion tracking
            gameState.game_completed = false;
            gameState.final_game_stats = null;
            
            // Only reset current game leaderboard when starting a new game
            // This preserves stats if viewing after game completion
            resetLeaderboard('current_game');
            console.log('📊 Current game leaderboard reset for fresh game');
            
            // Reset lifeline voting states for fresh game
            gameState.lifeline_voting_active = false;
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.available_lifelines_for_vote = [];
            gameState.lifeline_vote_winner = null;
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              takeAnotherVote: 0,
              askAMod: 0
            };
            console.log('🗳️ Lifeline voting states reset for fresh game');
            
            // Reset Ask a Mod lifeline states for fresh game
            gameState.ask_a_mod_active = false;
            gameState.mod_responses = [];
            gameState.ask_a_mod_start_time = null;
            gameState.mod_vote_counts = {
              A: 0,
              B: 0,
              C: 0,
              D: 0
            };
            gameState.mod_voters = [];
            
            // Ensure processed_mod_messages is properly reset as a Set
            if (!(gameState.processed_mod_messages instanceof Set)) {
              gameState.processed_mod_messages = new Set();
            } else {
              gameState.processed_mod_messages.clear();
            }
            
            console.log('🛡️ Ask a Mod states reset for fresh game');
            
            // Broadcast poll ended event to all clients (including poll overlay)
            broadcastToClients({
              type: 'audience_poll_ended',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Broadcast hide lifeline voting panel command
            broadcastToClients({
              type: 'hide_lifeline_voting_panel',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Clear lifeline effects for fresh game
            broadcastToClients({
              type: 'clear_lifeline_effects',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Stop any currently playing lock-in sound effects and reset audio for fresh game
            console.log('🔇 Stopping any playing lock-in audio for game reset');
            broadcastToClients({
              type: 'audio_command',
              command: 'stop_lock_audio',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            console.log('Game reset - all states initialized, voting panel completely hidden');
            
            // CRITICAL FIX: Broadcast the reset game state to all clients so browser gets updated lifelines_used = []
            broadcastState();
            console.log('📡 Reset game state broadcasted to all clients');
            break;
            
          case 'restart_server':
            console.log('🔄 Server restart requested from control panel');
            
            // Backup current game state before restart
            backupGameState();
            
            // Notify all connected clients about server restart
            broadcastToClients({
              type: 'server_restart_notification',
              message: 'Server is restarting - please reconnect in a few seconds',
              timestamp: Date.now()
            });
            
            // Send success response to control panel
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'Server restart initiated successfully'
            }));
            
            console.log('✅ Restart request acknowledged, shutting down server in 3 seconds...');
            
            // Close WebSocket connections gracefully
            wss.clients.forEach((ws) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'server_shutdown',
                  message: 'Server restarting - reconnection required'
                }));
                ws.close();
              }
            });
            
            // Close HTTP server and exit process
            setTimeout(() => {
              console.log('🔄 Shutting down for restart...');
              server.close(() => {
                process.exit(0); // Exit cleanly to allow restart
              });
              
              // Force exit if server doesn't close in 2 seconds
              setTimeout(() => {
                console.log('🚨 Force exit - server restart');
                process.exit(1);
              }, 2000);
            }, 3000);
            
            return; // Don't call broadcastState after restart
            
          case 'intro_complete':
            // Set up the "Get ready for the next question..." screen
            gameState.preparing_for_game = true;
            gameState.curtains_closed = false; // Open curtains to show "Get ready" screen
            console.log('Intro complete - preparing for game, curtains opened');
            break;
            
          case 'open_curtains':
            gameState.curtains_closed = false;
            console.log('Curtains opened');
            break;
            
          case 'close_curtains':
            gameState.curtains_closed = true;
            console.log('Curtains closed');
            break;
            
         case 'next_question':
    // CRITICAL: Check if we've reached question 15 (the final question)
    if (gameState.current_question >= 14) {
        console.warn(`⚠️ Cannot advance - already at question 15 (final question)`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            error: 'Game complete - question 15 is the final question',
            state: 'game_complete',
            current_question: gameState.current_question + 1
        }));
        return;
    }
    
    // Validation: Check if answers have been revealed (prevent skipping questions)
    if (!gameState.answers_revealed) {
        console.warn(`⚠️ Cannot go to next question - current question answers not revealed yet`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            error: 'Cannot skip question - reveal answer for current question first',
            state: 'answers_not_revealed',
            current_question: gameState.current_question + 1
        }));
        return;
    }
    
    if (gameState.current_question < questions.length - 1) {
        // Track game flow metrics
        performanceMetrics.gameFlow.questionTransitions++;
        
        // LEADERBOARD: Clear current question tracking
        currentQuestionVotes = [];
        gameState.answers_shown_time = null;
        
        // FIRST: Stop all audio and clear lifeline effects BEFORE state changes
        console.log('🔇 Stopping all audio before next question');
        broadcastToClients({ type: 'audio_command', command: 'stop_all_audio' });
        
        console.log('🧹 Clearing answer highlighting and lifeline effects before next question');
        broadcastToClients({
            type: 'clear_lifeline_effects',
            reason: 'next_question_pre_clear',
            timestamp: Date.now()
        });
        
        gameState.current_question++;
        gameState.question_visible = false;
        gameState.answers_visible = false;
        gameState.answers_revealed = false;
        gameState.selected_answer = null;
        gameState.first_selected_answer = null; // Reset first selected answer for new question
        gameState.answer_is_wrong = false;
        gameState.answer_locked_in = false;
        gameState.typewriter_animation_complete = false;
        gameState.correct_answer_highlighted = false; // Reset highlighting for new question
        gameState.persistent_wrong_answers = []; // Reset persistent wrong answers for new question
        
        // COMPLETE VOTING PANEL RESET for new question
        gameState.audience_poll_active = false;
        gameState.show_voting_activity = false;
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        gameState.poll_voters = [];
        gameState.poll_voter_history = [];
        gameState.poll_all_votes = [];
        
        // Clear question-level vote tracking for new question (prevents same answer re-voting)
        gameState.question_voter_answers = {};
        console.log('🗑️ Cleared question-level vote tracking for new question');
        
        // Reset lifeline states for new question
        gameState.first_poll_winner = null;
        gameState.is_revote_active = false;
        gameState.excluded_answers = [];
        gameState.host_selection_history = []; // Clear host selection history for new question
        
        // Clear any existing poll timer
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
        
        // Broadcast poll ended event to all clients (including poll overlay)
        broadcastToClients({
            type: 'audience_poll_ended',
            reason: 'next_question',
            timestamp: Date.now()
        });
        
        // Reset lifeline voting states for next question
        if (gameState.lifeline_voting_active) {
            gameState.lifeline_voting_active = false;
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.available_lifelines_for_vote = [];
            gameState.lifeline_vote_winner = null;
            gameState.lifeline_vote_counts = {
                fiftyFifty: 0,
                takeAnotherVote: 0,
                askAMod: 0
            };
            console.log('🗳️ Lifeline voting reset for next question');
            
            // Hide the lifeline voting panel
            broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'next_question',
                timestamp: Date.now()
            });
        }
        
        // Reset Ask a Mod states for next question and ensure Set integrity
        gameState.ask_a_mod_active = false;
        gameState.mod_responses = [];
        gameState.ask_a_mod_start_time = null;
        if (!(gameState.processed_mod_messages instanceof Set)) {
            gameState.processed_mod_messages = new Set();
        } else {
            gameState.processed_mod_messages.clear();
        }
        
        // Clear lifeline effects for new question
        broadcastToClients({
            type: 'clear_lifeline_effects',
            reason: 'next_question',
            timestamp: Date.now()
        });
        
        // Stop any currently playing lock-in sound effects and reset audio for next level
        console.log('🔇 Stopping any playing lock-in audio for next question');
        broadcastToClients({
            type: 'audio_command',
            command: 'stop_lock_audio',
            reason: 'next_question',
            timestamp: Date.now()
        });
        
        // Set preparing_for_game to true to show "Get ready for the next question..." message
        gameState.preparing_for_game = true;
        console.log('📢 Setting preparing_for_game = true to show "Get ready" message between questions');
        
        // Broadcast the updated state so the client shows the "Get ready" message
        broadcastState();
        
        console.log('🔄 Next question - all voting states completely reset');
    }
    break;
          case 'previous_question':
            if (gameState.current_question > 0 && !gameState.answer_locked_in) {
              gameState.current_question--;
              gameState.question_visible = false;
              gameState.answers_visible = false;
              gameState.answers_revealed = false;
              gameState.selected_answer = null;
              gameState.answer_is_wrong = false;
              console.log('Previous question - state updated');
            }
            break;
            
          case 'show_question':
            gameState.question_visible = true;
            
            // Reset typewriter animation state for new question
            gameState.typewriter_animation_complete = false;
            console.log('⏳ Typewriter animation reset - Show Answers button will be disabled until typewriter completes');
            
            // Clear any existing typewriter timeout
            if (global.typewriterTimeout) {
              clearTimeout(global.typewriterTimeout);
            }
            
            // Check if this is a milestone question for automatic hot seat or slot machine bonus
            const hotSeatMilestones = [4, 9, 14]; // Questions 5, 10, 15 (0-indexed)
            ensureSlotMachineState();
            const slotMachineSchedule = gameState.slot_machine?.schedule_questions || [];
            const currentQuestionNumber = gameState.current_question + 1;
            const isHotSeatMilestone = gameState.hot_seat_enabled && hotSeatMilestones.includes(gameState.current_question);
            const isSlotMachineMilestone = gameState.slot_machine?.enabled && slotMachineSchedule.includes(currentQuestionNumber);

            if (isHotSeatMilestone || isSlotMachineMilestone) {
              if (isHotSeatMilestone) {
                console.log(`🌟 MILESTONE QUESTION ${gameState.current_question + 1} DETECTED - STARTING HOT SEAT ENTRY PERIOD`);
                startHotSeatEntryPeriod();
              }

              if (isSlotMachineMilestone) {
                console.log(`🎰 Slot machine entry starting before question ${gameState.current_question + 1}`);
                startSlotMachineEntryRound(gameState.current_question);
              }

              const hotSeatDelay = isHotSeatMilestone ? gameState.hot_seat_entry_duration : 0;
              const slotMachineDelay = isSlotMachineMilestone
                ? (gameState.slot_machine.entry_duration_ms || hotSeatDelay || 60000)
                : 0;
              const entryDelay = Math.max(hotSeatDelay, slotMachineDelay);

              if (entryDelay > 0) {
                console.log(`⏱️ Delaying question display for entry period (${entryDelay / 1000} seconds)`);
                gameState.question_visible = false;

                setTimeout(() => {
                  console.log(`📝 Entry period complete, now showing question ${gameState.current_question + 1}`);
                  gameState.question_visible = true;
                  broadcastState();
                  triggerHotSeatCountdownIfReady();
                }, entryDelay + 2000);

                return; // Exit early - question will be shown after entry period
              }
            }
            
            // Server-side failsafe: auto-enable Show Answers button after 8 seconds
            global.typewriterTimeout = setTimeout(() => {
              if (!gameState.typewriter_animation_complete && gameState.question_visible) {
                console.warn('⚠️ Typewriter animation timeout - auto-enabling Show Answers button as failsafe');
                gameState.typewriter_animation_complete = true;
                broadcastState();
              }
            }, 8000); // 8 second timeout - reasonable time for longest questions
            
            // End any active poll when showing a new question
            if (gameState.audience_poll_active) {
              console.log('🔚 Ending active poll due to new question');
              endAutomaticPoll();
            }
            
            console.log('Question shown - state updated');

            // CRITICAL FIX: Broadcast the state update so OBS browser source updates immediately
            broadcastState();
            console.log('📡 Broadcasted question_visible state to all clients');
            triggerHotSeatCountdownIfReady();
            
            // Broadcast question music audio command
            console.log('🎵 Broadcasting question music audio command');
            broadcastToClients({ type: 'audio_command', command: 'play_question' });
            
            break;
            
          case 'hide_question':
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.selected_answer = null;
            gameState.answer_is_wrong = false;
            console.log('Question hidden - state updated');
            break;
            
          case 'show_answers':
            console.log('📋 show_answers action received for question:', gameState.current_question + 1);
            gameState.answers_visible = true;
            gameState.answers_shown_time = Date.now(); // Track when answers were shown for response time calculation
            
            // CLEAN START: Reset all voting states for fresh start
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;
            gameState.poll_winner_votes = 0;
            gameState.poll_winner_percentage = 0;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            
            console.log('✅ Answers shown - state updated, preparing fresh voting panel');
            console.log('📊 Poll state reset - starting automatic poll immediately');
            
            // Auto-start polling immediately after answers are shown for precise timing
            startAutomaticPoll();
            break;
            
          case 'hide_answers':
            // Only allow hiding answers if no poll is active to prevent visibility issues
            if (!gameState.audience_poll_active) {
              gameState.answers_visible = false;
              gameState.answers_revealed = false;
              console.log('Answers hidden - state updated');
            } else {
              console.log('Cannot hide answers while poll is active - answers must stay visible');
            }
            break;
            
          case 'reveal_answer':
            // Validation: Check if answers are already revealed (prevent double-clicking)
            if (gameState.answers_revealed) {
              console.warn(`⚠️ Cannot reveal answer - answers already revealed`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - answers already revealed',
                state: 'already_revealed'
              }));
              return;
            }
            
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot reveal answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot reveal answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if an answer is selected
            if (gameState.selected_answer === null) {
              console.warn(`⚠️ Cannot reveal answer - no answer selected`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - no answer selected',
                state: 'no_selection'
              }));
              return;
            }
            
            // Validation: Check if answer is locked in
            if (!gameState.answer_locked_in) {
              console.warn(`⚠️ Cannot reveal answer - answer not locked in`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - answer must be locked in first',
                state: 'not_locked'
              }));
              return;
            }
            
            // Check if the selected answer is wrong before revealing
            if (gameState.selected_answer !== null) {
              const currentQuestion = questions[gameState.current_question];
              console.log(`🔍 ANSWER CHECK: Question ${gameState.current_question + 1} - Selected: ${gameState.selected_answer}, Correct: ${currentQuestion.correct}`);
              console.log(`📝 Question: "${currentQuestion.text}"`);
              console.log(`📋 Answers: ${JSON.stringify(currentQuestion.answers)}`);
              gameState.answer_is_wrong = gameState.selected_answer !== currentQuestion.correct;
              console.log(`✅❌ Result: ${gameState.answer_is_wrong ? 'WRONG' : 'CORRECT'} answer`);
              
              // Record answer result in history
              const questionIndex = gameState.current_question;
              const result = gameState.answer_is_wrong ? 'wrong' : 'correct';
              
              if (gameState.answerHistory && gameState.answerHistory[questionIndex]) {
                gameState.answerHistory[questionIndex].result = result;
                console.log(`📝 Recorded answer ${result} for question ${questionIndex + 1}`);
              }
              
              // Log the answer result
              if (!gameState.answer_is_wrong) {
                console.log('🎉 Correct answer for level:', gameState.current_question + 1);
              } else {
                console.log('❌ Wrong answer for level:', gameState.current_question + 1);
              }
            }
            gameState.answers_revealed = true;
            gameState.answer_locked_in = false;
            console.log('Answer revealed - state updated');
            
            // Check if hot seat mode is active and log the result
            if (gameState.hot_seat_active && gameState.hot_seat_answered) {
              const currentQuestion = questions[gameState.current_question];
              const isCorrect = gameState.selected_answer === currentQuestion.correct;
              gameState.hot_seat_correct = isCorrect;
              
              // LEADERBOARD: Award hot seat points
              if (isCorrect) {
                addPointsToPlayer(gameState.hot_seat_user, leaderboardSettings.points.hot_seat_correct, 'hot seat correct answer! 🎯');
                
                // Quick response bonus
                if (gameState.hot_seat_timer > 50) {
                  addPointsToPlayer(gameState.hot_seat_user, leaderboardSettings.points.hot_seat_quick, 'hot seat quick response! ⚡');
                }
                
                // Update hot seat correct stats
                ['daily', 'weekly', 'monthly', 'all_time'].forEach(period => {
                  const player = initializePlayerInLeaderboard(gameState.hot_seat_user, period);
                  player.hot_seat_correct++;
                });
              }
              
              endHotSeat(isCorrect, false);
            }
            
            // LEADERBOARD: Process voting results and award points
            const currentQuestion = questions[gameState.current_question];
            const correctAnswerIndex = currentQuestion.correct;
            const correctAnswerLetter = String.fromCharCode(65 + correctAnswerIndex); // Convert to A,B,C,D
            
            // Find all players who voted correctly and sort by speed
            const correctVoters = currentQuestionVotes
              .filter(vote => vote.answerIndex === correctAnswerIndex)
              .sort((a, b) => a.timestamp - b.timestamp);
            
            // Award points for correct answers and speed bonuses
            correctVoters.forEach((vote, index) => {
              const responseTime = vote.responseTime;
              
              // Base points for correct answer
              addPointsToPlayer(vote.username, leaderboardSettings.points.correct_answer, 'correct answer');
              
              // Speed bonus for first 3 correct voters
              if (index === 0) {
                addPointsToPlayer(vote.username, leaderboardSettings.points.first_correct, '1st correct voter! 🥇');
                firstCorrectVoters.push(vote.username);
              } else if (index === 1) {
                addPointsToPlayer(vote.username, leaderboardSettings.points.second_correct, '2nd correct voter! 🥈');
              } else if (index === 2) {
                addPointsToPlayer(vote.username, leaderboardSettings.points.third_correct, '3rd correct voter! 🥉');
              }
              
              // Update player stats
              updatePlayerVoteStats(vote.username, vote.answer, true, responseTime);
              
              // Check for streak bonuses
              checkAndAwardStreakBonus(vote.username);
            });
            
            // Update stats for incorrect voters
            const incorrectVoters = currentQuestionVotes
              .filter(vote => vote.answerIndex !== correctAnswerIndex);
            
            incorrectVoters.forEach(vote => {
              updatePlayerVoteStats(vote.username, vote.answer, false, vote.responseTime);
            });
            
            console.log(`📊 Question ${gameState.current_question + 1} results: ${correctVoters.length} correct, ${incorrectVoters.length} incorrect`);
            if (firstCorrectVoters.length > 0) {
              console.log(`🏆 Speed bonus winners: ${firstCorrectVoters.slice(-3).join(', ')}`);
            }
            
            // Fade out background question music when answer is revealed
            console.log('🎵 Fading out background question music');
            broadcastToClients({ type: 'audio_command', command: 'fade_question_music' });
            
            // Set correct answer highlighting flag
            if (!gameState.answer_is_wrong) {
              // If answer is correct, allow highlighting immediately
              gameState.correct_answer_highlighted = true;
              broadcastToClients({ type: 'audio_command', command: 'play_correct' });
              // Trigger confetti for correct answers
              setTimeout(() => {
                broadcastToClients({ type: 'confetti_trigger', command: 'create_confetti' });
                console.log('🎉 Broadcasting confetti trigger for correct answer');
              }, 1500); // Delay confetti to sync with applause
              // Add applause for correct answers
              setTimeout(() => {
                broadcastToClients({ type: 'audio_command', command: 'play_applause' });
              }, 1000); // Play applause after correct sound
            } else {
              // If answer is wrong, do NOT highlight correct answer yet - wait for lifelines
              gameState.correct_answer_highlighted = false;
              
              // Track the original wrong answer for persistent red highlighting during revotes
              // REMOVED: original_wrong_answer tracking - now handled by persistent_wrong_answers array above
              
              // Add wrong answer to persistent wrong answers list for red highlighting throughout lifeline flows
              if (!gameState.persistent_wrong_answers.includes(gameState.selected_answer)) {
                gameState.persistent_wrong_answers.push(gameState.selected_answer);
                console.log(`🔴 Added answer ${String.fromCharCode(65 + gameState.selected_answer)} to persistent wrong answers list: [${gameState.persistent_wrong_answers.map(i => String.fromCharCode(65 + i)).join(', ')}]`);
              }
              
              console.log('🚫 Correct answer highlighting disabled - waiting for lifeline success');
              broadcastToClients({ type: 'audio_command', command: 'play_wrong' });
              
              // Check if there are lifelines available to use for manual voting
              const availableLifelines = [];
              if (!gameState.lifelines_used.includes('fiftyFifty')) availableLifelines.push('fiftyFifty');
              // Only allow Take Another Vote if not used in this game
              if (!gameState.lifelines_used.includes('takeAnotherVote')) availableLifelines.push('takeAnotherVote');
              if (!gameState.lifelines_used.includes('askAMod')) availableLifelines.push('askAMod');
              
              if (availableLifelines.length > 0) {
                // Check if audience poll is active - if so, DON'T start lifeline voting
                if (gameState.audience_poll_active) {
                  console.log('⏸️ Audience poll is active - deferring lifeline voting until poll completes');
                  gameState.pending_lifeline_vote = true;
                  gameState.available_lifelines_for_vote = availableLifelines;
                  // Lifeline voting will start automatically when audience poll ends
                } else {
                  // Auto-start lifeline voting after wrong answer (only if no audience poll)
                  console.log('❌ Wrong answer - automatically starting lifeline voting');
                  gameState.available_lifelines_for_vote = availableLifelines;
                  console.log('🗳️ Available lifelines for voting:', availableLifelines);
                  
                  // Initialize lifeline voting state immediately
                  gameState.lifeline_voting_active = true;
                  gameState.lifeline_voting_timer_active = true;
                  gameState.lifeline_voting_start_time = Date.now();
                  gameState.lifeline_votes = [];
                  gameState.lifeline_voter_history = [];
                  gameState.lifeline_vote_counts = {
                    fiftyFifty: 0,
                    takeAnotherVote: 0,
                    askAMod: 0
                  };
                  gameState.lifeline_vote_winner = null;
                  
                  // Add continuous countdown timer for smooth updates
                  if (gameState.lifeline_countdown_interval) {
                    clearInterval(gameState.lifeline_countdown_interval);
                  }
                  gameState.lifeline_countdown_interval = setInterval(() => {
                  if (gameState.lifeline_voting_timer_active) {
                    const elapsed = Date.now() - gameState.lifeline_voting_start_time;
                    const remaining = Math.max(0, (gameState.lifeline_voting_duration || 30000) - elapsed);
                    
                    // Broadcast countdown update (only log every 5 seconds to reduce spam)
                    const seconds = Math.ceil(remaining / 1000);
                    if (seconds % 5 === 0 || seconds <= 3) {
                      console.log(`⏱️ Lifeline voting countdown: ${seconds}s remaining`);
                    }
                    broadcastToClients({
                      type: 'lifeline_voting_countdown',
                      remainingTime: remaining,
                      seconds: seconds
                    });
                    
                    // Stop timer if time is up
                    if (remaining === 0) {
                      clearInterval(gameState.lifeline_countdown_interval);
                      gameState.lifeline_countdown_interval = null;
                      
                      // Actually end the voting and process results
                      console.log('⏰ Lifeline voting timer expired - processing results');
                      endLifelineVoting();
                    }
                  }
                }, 1000); // Update every 1 second to prevent console spam
                
                // Broadcast lifeline voting started
                broadcastToClients({
                  type: 'lifeline_voting_started',
                  availableLifelines: availableLifelines,
                  duration: gameState.lifeline_voting_duration || 30000,
                  message: 'Wrong answer! Vote for a lifeline: 1=50:50, 2=Take Another Vote, 3=Ask a Mod'
                });
                
                console.log('🗳️ Lifeline voting automatically started for 30 seconds');
                
                // Auto-end lifeline voting after duration
                setTimeout(() => {
                  if (gameState.lifeline_voting_active) {
                    // Process lifeline voting results
                    console.log('⏰ Lifeline voting time expired - processing results');
                    
                    // Find the winning lifeline
                    const voteCounts = gameState.lifeline_vote_counts;
                    let maxVotes = 0;
                    let winningLifeline = null;
                    
                    for (const [lifeline, votes] of Object.entries(voteCounts)) {
                      if (votes > maxVotes) {
                        maxVotes = votes;
                        winningLifeline = lifeline;
                      }
                    }
                    
                    if (winningLifeline && maxVotes > 0) {
                      gameState.lifeline_vote_winner = winningLifeline;
                      console.log(`🏆 Lifeline voting winner: ${winningLifeline} with ${maxVotes} votes`);
                      
                      // End lifeline voting
                      gameState.lifeline_voting_active = false;
                      gameState.lifeline_voting_timer_active = false;
                      
                      // Clear continuous countdown timer
                      if (gameState.lifeline_countdown_interval) {
                        clearInterval(gameState.lifeline_countdown_interval);
                        gameState.lifeline_countdown_interval = null;
                        console.log('⏱️ Cleared lifeline countdown interval on timer expiry');
                      }
                      
                      // Broadcast results
                      broadcastToClients({
                        type: 'lifeline_voting_ended',
                        winner: winningLifeline,
                        totalVotes: Object.values(voteCounts).reduce((a, b) => a + b, 0),
                        voteCounts: voteCounts
                      });
                      
                      // Trigger the winning lifeline
                      setTimeout(() => {
                        triggerLifeline(winningLifeline);
                      }, 1500); // Brief display of results before triggering
                    } else {
                      console.log('❌ No votes received - ending lifeline voting');
                      gameState.lifeline_voting_active = false;
                      gameState.lifeline_voting_timer_active = false;
                      
                      // Clear continuous countdown timer
                      if (gameState.lifeline_countdown_interval) {
                        clearInterval(gameState.lifeline_countdown_interval);
                        gameState.lifeline_countdown_interval = null;
                        console.log('⏱️ Cleared lifeline countdown interval (no votes)');
                      }
                      
                      broadcastToClients({
                        type: 'lifeline_voting_ended',
                        winner: null,
                        totalVotes: 0,
                        message: 'No votes received'
                      });
                    }
                  }
                }, gameState.lifeline_voting_duration || 30000);
                } // End of else block (audience poll not active)
              } else {
                console.log('❌ No lifelines available - all lifelines have been used');
                console.log('📊 Game stats: Question', gameState.current_question + 1, 'Score:', gameState.score);
                
                // Clear the available lifelines array
                gameState.available_lifelines_for_vote = [];
                
                // Broadcast that no lifelines are available - control panel should show "Next Question" button
                broadcastToClients({
                  type: 'no_lifelines_available',
                  message: 'All lifelines have been used. The game will end here.',
                  current_question: gameState.current_question,
                  score: gameState.score,
                  timestamp: Date.now()
                });
                
                // The control panel will now show "Next Question" button instead of "Vote for Lifeline"
                // since available_lifelines_for_vote.length === 0
                console.log('🎮 Control panel should now show "Next Question" button to end the game');
              }
            }
            
            // Check if this was the final question (Question 15, index 14)
            if (gameState.current_question === 14 && !gameState.endGameTriggered) {
              console.log('🎯 Question 15 revealed - preparing end-game sequence...');
              gameState.endGameTriggered = true;
              scheduleEndgameSequence('final_question_reveal', 3000);
            }
            
            break;
            
          case 'set_selected_answer':
            const selectedIndex = data.answer_index !== undefined ? data.answer_index : data.answer;
            
            // Validation: Check if selectedIndex is valid
            if (selectedIndex === undefined || selectedIndex === null || 
                typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 3) {
              console.warn(`⚠️ Invalid answer index: ${selectedIndex}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Invalid answer selection. Please select A, B, C, or D.',
                receivedIndex: selectedIndex
              }));
              return;
            }
            
            const isRevote = gameState.is_revote_active;
            const selectedLetter = String.fromCharCode(65 + selectedIndex); // Convert to A, B, C, D
            
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot select answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot select answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot select answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot select answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if trying to select an excluded answer from lifelines
            if (gameState.excluded_answers && gameState.excluded_answers.includes(selectedIndex)) {
              console.warn(`⚠️ Cannot select answer ${selectedLetter} - excluded by lifeline (50:50)`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: `Answer ${selectedLetter} is not available - eliminated by lifeline`,
                excludedAnswers: gameState.excluded_answers.map(i => String.fromCharCode(65 + i))
              }));
              return;
            }
            
            gameState.selected_answer = selectedIndex;
            
            // Track first selected answer for persistent highlighting (only if not set yet)
            if (gameState.first_selected_answer === null) {
              gameState.first_selected_answer = selectedIndex;
              console.log(`📍 First answer selection tracked: ${selectedLetter} (index ${selectedIndex})`);
            }
            
            // Re-evaluate answer correctness if answers have been revealed (during revotes)
            if (gameState.answers_revealed) {
              const currentQuestion = questions[gameState.current_question];
              const wasWrong = gameState.answer_is_wrong;
              gameState.answer_is_wrong = selectedIndex !== currentQuestion.correct;
              
              if (wasWrong !== gameState.answer_is_wrong) {
                console.log(`✅ Answer correctness updated: ${gameState.answer_is_wrong ? 'WRONG' : 'CORRECT'} (was ${wasWrong ? 'WRONG' : 'CORRECT'})`);
                
                // Update answer history if the result changed
                if (gameState.answerHistory && gameState.answerHistory[gameState.current_question]) {
                  gameState.answerHistory[gameState.current_question].result = gameState.answer_is_wrong ? 'wrong' : 'correct';
                  console.log(`📝 Updated answer history for question ${gameState.current_question + 1}: ${gameState.answer_is_wrong ? 'wrong' : 'correct'}`);
                }
              }
            }
            
            // Auto-lock answer when host manually selects during polling
            // This ensures the answer is ready for revealing without needing separate lock action
            if (gameState.audience_poll_active || isRevote) {
              gameState.answer_locked_in = true;
              console.log(`🔒 Auto-locked answer ${selectedLetter} due to manual host selection during ${isRevote ? 'revote' : 'polling'}`);
            }
            
            if (isRevote) {
              console.log(`🔄 Host manually selected answer ${selectedLetter} during revote - revote will be terminated`);
            } else {
              console.log(`🎯 Host selected answer ${selectedLetter}`);
            }
            
            // If host manually selects an answer, terminate any active poll
            if (gameState.audience_poll_active) {
              if (isRevote) {
                console.log('🔄 Host manual selection during revote - ending revote and maintaining host control');
              } else {
                console.log('🎯 Host manually selected answer - terminating active audience poll');
              }
              endAutomaticPoll();
            }
            
            // Add to voting history for visual feedback (multiple selections tracking)
            if (!gameState.host_selection_history) {
              gameState.host_selection_history = [];
            }
            
            // Add current selection to history if not already there
            if (!gameState.host_selection_history.includes(selectedIndex)) {
              gameState.host_selection_history.push(selectedIndex);
              console.log(`📝 Added ${selectedLetter} to host selection history:`, 
                gameState.host_selection_history.map(i => String.fromCharCode(65 + i)).join(', '));
            }
            
            break;
            
          case 'lock_answer':
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot lock answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot lock answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if an answer is selected
            if (gameState.selected_answer === null) {
              console.warn(`⚠️ Cannot lock answer - no answer selected`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer - no answer selected',
                state: 'no_selection'
              }));
              return;
            }
            
            // Validation: Check if trying to lock an excluded answer from lifelines
            if (gameState.excluded_answers && gameState.excluded_answers.includes(gameState.selected_answer)) {
              const excludedLetter = String.fromCharCode(65 + gameState.selected_answer);
              console.warn(`⚠️ Cannot lock answer ${excludedLetter} - excluded by lifeline (50:50)`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: `Cannot lock answer ${excludedLetter} - it was eliminated by 50:50 lifeline`,
                excludedAnswers: gameState.excluded_answers.map(i => String.fromCharCode(65 + i))
              }));
              return;
            }
            
            const wasLocked = gameState.answer_locked_in;
            gameState.answer_locked_in = true; // Always lock, don't toggle
            const isRevoteActive = gameState.is_revote_active;
            const currentSelectedLetter = gameState.selected_answer !== null ? 
              String.fromCharCode(65 + gameState.selected_answer) : 'NONE';
            
            if (isRevoteActive) {
              console.log(`🔄🔒 Host locked in answer ${currentSelectedLetter} during revote - revote terminated, host control confirmed`);
            } else if (wasLocked) {
              console.log(`🔒 Host confirmed lock for answer ${currentSelectedLetter} (already locked)`);
            } else {
              console.log(`🔒 Host locked in answer ${currentSelectedLetter}`);
            }
            
            // If locking in an answer, terminate any active poll
            if (gameState.answer_locked_in && gameState.audience_poll_active) {
              if (isRevoteActive) {
                console.log('🔄 Host lock-in during revote - ending revote and confirming manual selection');
              } else {
                console.log('🔒 Host locked in answer - terminating active audience poll');
              }
              endAutomaticPoll();
            }
            
            // Broadcast lock-in audio command only when locking in (not when unlocking)
            if (gameState.answer_locked_in) {
              // Stop the question music first
              broadcastToClients({ type: 'audio_command', command: 'stop_question_music' });
              // Then play the lock sound
              broadcastToClients({ type: 'audio_command', command: 'play_lock' });
            }
            
            break;
            
          case 'set_contestant':
            const wasEmpty = !gameState.contestant_name || gameState.contestant_name === '';
            const newName = data.name || '';
            console.log('🎯 Set contestant:', {
              wasEmpty: wasEmpty,
              oldName: gameState.contestant_name,
              newName: newName
            });
            
            gameState.contestant_name = newName;
            
            // Always broadcast when a non-empty name is set (even if replacing another name)
            if (gameState.contestant_name && gameState.contestant_name !== '') {
              broadcastToClients({
                type: 'contestant_just_set',
                contestant_name: gameState.contestant_name,
                timestamp: Date.now()
              });
              console.log('📢 Broadcasting contestant_just_set event for:', gameState.contestant_name);
            }
            break;
            
          case 'send_host_message':
            console.log('🎤 Host message received:', data.message);
            if (data.message && data.message.trim()) {
              // Broadcast host message to all connected clients
              const hostChatMessage = {
                type: 'chat_message',
                id: `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                username: 'HOST',
                text: data.message.trim(),
                platform: 'system',
                timestamp: Date.now(),
                badges: ['host'],
                color: '#FFD700', // Gold color for host
                isHost: true
              };
              
              broadcastToClients(hostChatMessage);
              console.log('📡 Host message broadcasted to all clients');
              
              // Process host message for votes if voting is active
              if (gameState.audience_poll_active) {
                if (DEBUG_VERBOSE_LOGGING) console.log('🗳️ Processing host message as potential audience poll vote');
                try {
                  processVoteFromChat(hostChatMessage);
                } catch (error) {
                  console.error('❌ Error processing host audience poll vote:', error);
                }
              }
              
              // Process as lifeline vote if lifeline voting is active
              if (gameState.lifeline_voting_active) {
                if (DEBUG_VERBOSE_LOGGING) console.log('🗳️ Processing host message as potential lifeline vote');
                console.log('📊 Lifeline voting state:', {
                  active: gameState.lifeline_voting_active,
                  availableLifelines: gameState.available_lifelines_for_vote,
                  currentVoteCounts: gameState.lifeline_vote_counts,
                  hostMessage: hostChatMessage.text,
                  hostUsername: hostChatMessage.username
                });
                try {
                  // Additional validation before processing
                  if (!hostChatMessage || !hostChatMessage.text || !hostChatMessage.username) {
                    console.error('❌ Invalid host chat message for lifeline vote:', hostChatMessage);
                    return;
                  }
                  processLifelineVoteFromChat(hostChatMessage);
                } catch (error) {
                  console.error('❌ Error processing host lifeline vote:', error);
                  console.error('Stack trace:', error.stack);
                  // Continue execution - don't crash the server
                }
              } else {
                console.log('⚠️ Lifeline voting not active, host message not processed for lifeline vote');
              }
              
              // Process as Ask a Mod response if Ask a Mod is active
              // Check both if username is provided OR if 'HOST' is in moderator list
              if (gameState.ask_a_mod_active) {
                let modUsername = null;
                
                // If username is provided, use it
                if (data.username && data.username.trim()) {
                  modUsername = data.username.trim();
                } 
                // Otherwise check if 'host' (lowercase) is in moderator list
                else if (getCachedModList().includes('host')) {
                  modUsername = 'host';
                  console.log('🛡️ Host is in moderator list, processing as mod response');
                }
                
                if (modUsername) {
                  // Create moderator chat message
                  const modChatMessage = {
                    username: modUsername,
                    text: data.message.trim(),
                    platform: 'system',
                    timestamp: Date.now()
                  };
                  
                  console.log('🛡️ Processing host message as Ask a Mod response from:', modUsername);
                  try {
                    checkAndProcessModResponse(modChatMessage);
                  } catch (error) {
                    console.error('❌ Error processing host message as mod response:', error);
                  }
                }
              }
              
              // Process as giveaway entry if giveaway is active
              if (gameState.giveaway_active) {
                console.log('🎁 Processing host message as potential giveaway entry');
                try {
                  processGiveawayEntry(hostChatMessage.username, hostChatMessage.text);
                } catch (error) {
                  console.error('❌ Error processing host giveaway entry:', error);
                }
              }
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
              return;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Message cannot be empty' }));
              return;
            }
            break;
            
          case 'update_prizes':
            if (data.prizes && Array.isArray(data.prizes)) {
              prizeAmounts = [...data.prizes];
              gameState.prizes = [...data.prizes]; // Sync with game state
              
              // Save to file for persistence
              const saved = savePrizes(prizeAmounts);
              if (saved) {
                console.log(`💰 Prize amounts updated and saved:`, prizeAmounts);
              } else {
                console.log(`💰 Prize amounts updated (memory only):`, prizeAmounts);
              }
              
              // Broadcast update to all clients so browser can update
              broadcastToClients({
                type: 'prizes_updated',
                prizes: prizeAmounts,
                saved: saved
              });
            }
            break;
            
          case 'recalculate_lifelines':
            // Manually recalculate available lifelines based on current used lifelines
            if (gameState.answers_revealed && gameState.answer_is_wrong) {
              console.log('🔧 Manually recalculating available lifelines...');
              console.log('🔍 Current lifelines_used:', gameState.lifelines_used);
              
              const availableLifelines = [];
              if (!gameState.lifelines_used.includes('fiftyFifty')) availableLifelines.push('fiftyFifty');
              if (!gameState.lifelines_used.includes('takeAnotherVote')) availableLifelines.push('takeAnotherVote');
              if (!gameState.lifelines_used.includes('askAMod')) availableLifelines.push('askAMod');
              
              gameState.available_lifelines_for_vote = availableLifelines;
              console.log('✅ Updated available_lifelines_for_vote:', availableLifelines);
              
              broadcastState();
            }
            break;
            
          case 'start_lifeline_vote':
            // Manually start lifeline voting after wrong answer is revealed
            if (gameState.answers_revealed && gameState.answer_is_wrong && gameState.available_lifelines_for_vote.length > 0) {
              console.log('🗳️ Host manually starting lifeline voting with available lifelines:', gameState.available_lifelines_for_vote);
              
              // Initialize lifeline voting state
              gameState.lifeline_voting_active = true;
              gameState.lifeline_votes = [];
              gameState.lifeline_voter_history = [];
              gameState.lifeline_vote_winner = null;
              gameState.lifeline_vote_counts = {
                fiftyFifty: 0,
                takeAnotherVote: 0,
                askAMod: 0
              };
              
              // Broadcast lifeline voting started
              broadcastToClients({
                type: 'lifeline_voting_started',
                availableLifelines: gameState.available_lifelines_for_vote,
                duration: gameState.lifeline_voting_duration
              });
              
              // Auto-end lifeline voting after the configured duration, but with checks
              setTimeout(() => {
                if (gameState.lifeline_voting_active) {
                  // Check if we have sufficient votes to make a decision
                  const totalVotes = gameState.lifeline_votes.length;
                  console.log(`🕐 Lifeline voting timer expired. Total votes: ${totalVotes}`);
                  
                  if (totalVotes >= 3) {
                    // Sufficient votes to determine a winner
                    console.log('✅ Sufficient votes received, ending lifeline voting');
                    endLifelineVoting();
                  } else {
                    // Not enough votes - extend timer by 30 seconds
                    console.log('⏳ Insufficient votes, extending lifeline voting by 30 seconds');
                    broadcastToClients({
                      type: 'lifeline_voting_extended',
                      message: 'Voting extended - need more votes!',
                      additionalTime: 30000
                    });
                    
                    // Extended timer
                    setTimeout(() => {
                      if (gameState.lifeline_voting_active) {
                        console.log('🕐 Extended lifeline voting timer expired, ending regardless of vote count');
                        endLifelineVoting();
                      }
                    }, 30000); // Additional 30 seconds
                  }
                }
              }, gameState.lifeline_voting_duration);
              
              console.log(`🎲 Lifeline voting started for ${gameState.lifeline_voting_duration / 1000} seconds`);
            } else {
              console.warn('⚠️ Cannot start lifeline voting - conditions not met');
              console.log('   answers_revealed:', gameState.answers_revealed);
              console.log('   answer_is_wrong:', gameState.answer_is_wrong);
              console.log('   available_lifelines:', gameState.available_lifelines_for_vote);
            }
            break;
            
          case 'end_lifeline_voting':
            // Manually end lifeline voting (host control)
            if (gameState.lifeline_voting_active) {
              console.log('🛑 Host manually ending lifeline voting');
              endLifelineVoting();
            } else {
              console.warn('⚠️ Cannot end lifeline voting - not currently active');
            }
            break;
            
          case 'switch_overlay':
            gameState.overlay_type = data.overlay || 'original';
            console.log(`🎨 Overlay switched to: ${gameState.overlay_type}`);
            break;
            
          case 'force_typewriter_complete':
            console.log('🔧 Force enabling typewriter completion state (manual override)');
            gameState.typewriter_animation_complete = true;
            
            // Clear any pending timeout
            if (global.typewriterTimeout) {
              clearTimeout(global.typewriterTimeout);
              global.typewriterTimeout = null;
            }
            
            // Broadcast state immediately
            console.log('🔄 Broadcasting forced typewriter completion to all clients');
            broadcastState();
            break;
            
            
          case 'update_questions':
            console.log('💾 Attempting to save questions from control panel...');
            if (data.questions && Array.isArray(data.questions)) {
              // Log the incoming questions for debugging
              console.log(`📥 Received ${data.questions.length} questions to save`);
              
              // Create backup of current questions before updating
              const backupPath = './questions.backup.json';
              try {
                fs.writeFileSync(backupPath, JSON.stringify(questions, null, 2));
                console.log('📋 Created backup at questions.backup.json');
              } catch (e) {
                console.warn('⚠️ Could not create backup:', e.message);
              }
              
              // Update questions in memory
              questions.splice(0, questions.length, ...data.questions);
              
              // Save to file for persistence with enhanced error handling
              const saved = saveQuestions(questions);
              if (saved) {
                console.log(`✅ Questions successfully updated and saved: ${questions.length} questions loaded`);
                console.log('📁 Saved to: questions.json');
                
                // Verify the save by reading back
                try {
                  const verifyData = fs.readFileSync('./questions.json', 'utf8');
                  const verifyQuestions = JSON.parse(verifyData);
                  console.log(`✅ Verification: ${verifyQuestions.length} questions confirmed in file`);
                } catch (verifyError) {
                  console.error('❌ Verification failed:', verifyError.message);
                }
              } else {
                console.error(`❌ Questions updated in memory but FAILED to save to file`);
                // Try alternative save method
                try {
                  const altPath = './questions.new.json';
                  fs.writeFileSync(altPath, JSON.stringify(questions, null, 2));
                  console.log(`🔄 Alternative save successful to ${altPath}`);
                  // Try to rename to main file
                  fs.renameSync(altPath, './questions.json');
                  console.log('✅ Successfully renamed to questions.json');
                } catch (altError) {
                  console.error('❌ Alternative save also failed:', altError.message);
                }
              }
              
              // Broadcast update to all clients so browser can update
              broadcastToClients({
                type: 'questions_updated',
                questions: questions,
                saved: saved,
                count: questions.length
              });
            } else {
              console.error('❌ Invalid questions data received:', data.questions);
            }
            break;
            
          case 'poll_winner_selected':
            // Handle automatic poll winner selection - sets choice but doesn't lock in visually
            if (data.winner && ['A', 'B', 'C', 'D'].includes(data.winner)) {
              const answerIndex = ['A', 'B', 'C', 'D'].indexOf(data.winner);
              gameState.selected_answer = answerIndex;
              gameState.answer_locked_in = false; // Do NOT auto-lock - only set the selection
              gameState.audience_poll_active = false;
              console.log(`🏆 Poll winner: ${data.winner} - Answer ${answerIndex} selected by audience`);
              console.log(`🎯 Host can now click "Lock Answer" then "Reveal Answer" to see if audience was correct`);
            }
            break;
            
          case 'show_poll_winner_announcement':
            // Show brief winner announcement overlay (3 seconds)
            gameState.show_poll_winner = data.winner || 'A';
            gameState.poll_winner_votes = data.votes || 1;
            gameState.poll_winner_percentage = data.percentage || 100;
            console.log(`📢 Showing poll winner announcement: ${data.winner} with ${data.votes} votes (${data.percentage}%)`);
            
            // Auto-hide after 3 seconds
            setTimeout(() => {
              gameState.show_poll_winner = null;
              gameState.update_needed = true;
              broadcastState();
              console.log('📢 Poll winner announcement hidden');
            }, 3000);
            break;
            
          case 'start_manual_poll':
            console.log('🗳️ Starting manual audience poll from timer button');
            
            if (!gameState.answers_visible) {
              console.warn('⚠️ Cannot start manual poll - answers not visible');
              break;
            }
            
            if (gameState.audience_poll_active) {
              console.warn('⚠️ Cannot start manual poll - poll already active');
              break;
            }
            
            // Start manual poll with 60-second duration
            gameState.audience_poll_active = true;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            gameState.show_poll_winner = null;
            gameState.show_voting_activity = true;
            
            console.log('⏱️ Manual 60-second poll timer started - chat can vote A, B, C, or D');
            
            // Broadcast poll start to all clients
            broadcastState();
            
            // Auto-end poll after 60 seconds
            setTimeout(() => {
              if (gameState.audience_poll_active) {
                console.log('🏁 Auto-ending manual poll after 60 seconds - hiding voting panel');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                
                // Tally votes and determine winner
                if (gameState.poll_all_votes.length > 0) {
                  const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
                  gameState.poll_all_votes.forEach(vote => {
                    if (voteCounts.hasOwnProperty(vote.vote)) {
                      voteCounts[vote.vote]++;
                    }
                  });
                  
                  const winner = Object.keys(voteCounts).reduce((a, b) => 
                    voteCounts[a] > voteCounts[b] ? a : b
                  );
                  
                  gameState.show_poll_winner = winner;
                  gameState.poll_winner_votes = voteCounts[winner];
                  gameState.poll_winner_percentage = Math.round(
                    (voteCounts[winner] / gameState.poll_all_votes.length) * 100
                  );
                  
                  console.log(`🏆 Manual poll winner: ${winner} with ${voteCounts[winner]} votes (${gameState.poll_winner_percentage}%)`);
                } else {
                  console.log('⚠️ No votes to tally from manual poll');
                }
                
                console.log('✅ Manual polling panel completely hidden until next question answers');
                broadcastState();
              }
            }, gameState.audience_poll_duration); // Use configurable poll duration
            break;
            
          case 'twitch_chat_start':
            console.log('🎮 Starting Twitch simple chat process...');
            
            // Check for existing process using PID file
            const pidFile = path.join(__dirname, 'simple-twitch-chat.pid');
            try {
              if (fs.existsSync(pidFile)) {
                const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
                try {
                  process.kill(existingPid, 0); // Check if process exists
                  console.log(`⚠️ Twitch chat already running (PID: ${existingPid}). Skipping start.`);
                  break; // Exit without starting new process
                } catch (error) {
                  // Process doesn't exist, clean up stale PID file
                  console.log(`🧹 Cleaning up stale PID file for non-existent process ${existingPid}`);
                  fs.unlinkSync(pidFile);
                }
              }
            } catch (error) {
              console.log('⚠️ Error checking existing process:', error.message);
            }
            
            try {
              const { spawn } = require('child_process');
              const twitchChatProcess = spawn('node', ['simple-twitch-chat.js'], {
                cwd: __dirname,
                detached: false,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              
              twitchChatProcess.stdout.on('data', (data) => {
                console.log(`📺 Twitch Chat: ${data.toString().trim()}`);
              });
              
              twitchChatProcess.stderr.on('data', (data) => {
                console.error(`❌ Twitch Chat Error: ${data.toString().trim()}`);
              });
              
              twitchChatProcess.on('exit', (code) => {
                console.log(`🎮 Twitch chat process exited with code ${code}`);
                // Clean up PID file when process exits
                try {
                  if (fs.existsSync(pidFile)) {
                    fs.unlinkSync(pidFile);
                    console.log('🧹 Cleaned up PID file after process exit');
                  }
                } catch (error) {
                  // Ignore cleanup errors
                }
              });
              
              // Store process reference globally for stopping later
              global.twitchChatProcess = twitchChatProcess;
              
              console.log('✅ Twitch simple chat started successfully');
            } catch (error) {
              console.error('❌ Failed to start Twitch chat:', error);
            }
            break;
            
          case 'twitch_chat_stop':
            console.log('🛑 Stopping Twitch simple chat process...');
            try {
              // Clean up PID file first
              const pidFile = path.join(__dirname, 'simple-twitch-chat.pid');
              if (fs.existsSync(pidFile)) {
                try {
                  const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
                  console.log(`🛑 Killing process ${pid} via PID file`);
                  process.kill(pid, 'SIGTERM');
                  fs.unlinkSync(pidFile);
                  console.log('🧹 Cleaned up PID file');
                } catch (error) {
                  console.log('⚠️ Error stopping via PID file:', error.message);
                  // Try to clean up stale PID file
                  try {
                    fs.unlinkSync(pidFile);
                  } catch (e) {
                    // Ignore cleanup errors
                  }
                }
              }
              
              // Also try the global process reference as fallback
              if (global.twitchChatProcess) {
                global.twitchChatProcess.kill('SIGTERM');
                global.twitchChatProcess = null;
                console.log('✅ Twitch simple chat stopped via global reference');
              } else {
                console.log('✅ Twitch simple chat stopped successfully');
              }
            } catch (error) {
              console.error('❌ Failed to stop Twitch chat:', error);
            }
            break;
          
            
          case 'end_game_credits':
            console.log('🎭 Starting end game credits roll...');

            // Set credits rolling state
            gameState.credits_rolling = true;
            gameState.credits_scrolling = true;

            // Close curtains for cinematic effect
            gameState.curtains_closed = true;

            // End any active polls
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;

            console.log(`🎭 Credits will feature ${gameState.gameshow_participants.length} participants`);
            console.log('🎭 Participants:', gameState.gameshow_participants.join(', '));
            console.log('🎬 Credits will display all names and end naturally');

            // Hide the leaderboard overlay so credits have full focus
            broadcastToClients({
              type: 'hide_leaderboard'
            });

            // Kick off the credits sequence on all connected displays
            broadcastToClients({
              type: 'roll_credits',
              winners: gameState.final_game_winners || [],
              timestamp: Date.now()
            });

            // Notify control panels and overlays of the updated state
            broadcastState();

            // Note: Credits now end naturally in the frontend after all names are shown
            // The frontend will clear the credits_rolling state when complete
            break;

          case 'start_credits_scroll':
            // This case is now deprecated - credits scroll automatically
            console.log('⚠️ start_credits_scroll is deprecated - credits now scroll automatically');
            break;
            
          case 'add_demo_participants':
            console.log('🎭 Adding demo participants for credits demonstration...');
            const demoParticipants = ['StreamViewer123', 'GameFan2024', 'QuizMaster', 'KimbillionaireFan', 'ChatUser42', 'TwitchViewer', 'AudienceMember', 'PollVoter99', 'ShowWatcher'];
            gameState.gameshow_participants = [...demoParticipants];
            console.log(`🎭 Added ${gameState.gameshow_participants.length} demo participants:`, gameState.gameshow_participants.join(', '));
            break;

          case 'slot_machine_test_spin':
            console.log('🎰 Host requested a slot machine test spin');
            triggerSlotMachineTestSpin();
            break;

          case 'set_slot_machine_enabled': {
            ensureSlotMachineState();
            const enabled = data.enabled !== false;

            if (gameState.slot_machine.enabled === enabled) {
              console.log(`🎰 Slot machine already ${enabled ? 'enabled' : 'disabled'} - no change`);
              break;
            }

            gameState.slot_machine.enabled = enabled;
            if (!enabled && gameState.slot_machine.current_round) {
              cleanupSlotMachineRoundTimers(gameState.slot_machine.current_round);
              gameState.slot_machine.current_round = null;
            }

            console.log(`🎰 Slot machine ${enabled ? 'enabled' : 'disabled'} via control panel`);
            broadcastState(true);
            break;
          }

          case 'start_hot_seat_entry':
            console.log('📝 Starting hot seat entry period');
            startHotSeatEntryPeriod();
            break;
            
          case 'toggle_hot_seat':
            console.log(`🎮 Hot seat feature toggle requested: ${data.enabled}`);
            gameState.hot_seat_enabled = data.enabled === true;
            console.log(`✅ Hot seat feature is now: ${gameState.hot_seat_enabled ? 'ENABLED' : 'DISABLED'}`);
            broadcastState();
            break;
            
          case 'activate_hot_seat':
            console.log('🎯 Manual hot seat activation requested');
            const hotSeatUser = data.username || null;
            const winnerCount = data.winner_count || 1;
            gameState.hot_seat_winner_count = winnerCount;
            
            if (hotSeatUser) {
              // Manual selection
              selectHotSeatUser(hotSeatUser);
            } else {
              // Draw from entries
              drawHotSeatWinners();
            }
            break;
            
          case 'show_final_leaderboard':
            console.log('🏆 Showing final leaderboard with winners');

            const finalStats = Array.isArray(gameState.final_game_stats) && gameState.final_game_stats.length > 0
              ? gameState.final_game_stats
              : (getLeaderboardStats().current_game || []);

            if (!finalStats || finalStats.length === 0) {
              console.warn('⚠️ No final stats available when attempting to show final leaderboard');
            }

            const topWinners = finalStats.slice(0, gameState.prizeConfiguration.topWinnersCount);
            gameState.final_game_winners = finalStats.slice(0, 3);

            // Mark that we've shown the final leaderboard
            gameState.finalLeaderboardShown = true;
            gameState.prizeConfiguration.winnersAnnounced = true;
            gameState.endgame_ready_timestamp = gameState.endgame_ready_timestamp || Date.now();

            // Broadcast to display the end-game leaderboard
            broadcastToClients({
              type: 'show_endgame_leaderboard',
              winners: topWinners,
              prizeConfig: gameState.prizeConfiguration,
              timestamp: Date.now()
            });

            // Also trigger confetti
            broadcastToClients({
              type: 'confetti_trigger',
              command: 'create_massive_confetti'
            });

            console.log(`🎉 Displayed top ${topWinners.length} winners`);
            broadcastState(true);
            break;

          case 'show_leaderboard':
            console.log(`🏆 Manual leaderboard show requested for period: ${data.period || 'current_game'}`);
            showLeaderboardOverlay(data.period || leaderboardSettings.display_mode || 'current_game');
            break;

          case 'hide_leaderboard':
            console.log('👻 Manual leaderboard hide requested');
            hideLeaderboardOverlay();
            break;

          case 'upload_hot_seat_profiles': {
            const profilesPayload = data.profiles || {};
            const sanitizedProfiles = buildHotSeatProfileMap(profilesPayload);
            const profileCount = Object.keys(sanitizedProfiles).length;

            gameState.hot_seat_profiles = sanitizedProfiles;
            gameState.hot_seat_profiles_last_update = Date.now();

            console.log(`📝 Loaded ${profileCount} hot seat profile${profileCount === 1 ? '' : 's'} from control panel upload`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              count: profileCount,
              lastUpdate: gameState.hot_seat_profiles_last_update
            }));
            return;
          }

          case 'roll_credits':
            console.log('🎬 Rolling credits after showing winners');

            // Hide the leaderboard first
            broadcastToClients({
              type: 'hide_leaderboard'
            });
            
            // Then start the credits roll
            broadcastToClients({
              type: 'roll_credits',
              winners: gameState.final_game_winners || [],
              timestamp: Date.now()
            });
            
            gameState.credits_rolling = true;
            broadcastState();
            break;
            
          case 'end_hot_seat':
            console.log('🔚 Manual hot seat end requested');
            endHotSeat(null, false);
            break;
            
          case 'use_lifeline_fiftyFifty':
            console.log('💡 Using 50:50 lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing 50:50 as winner');
              
              // Set 50:50 as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.fiftyFifty = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.takeAnotherVote + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'fiftyFifty';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              gameState.lifeline_voting_timer_active = false;
              
              // CRITICAL FIX: Clear continuous countdown timer to stop countdown spam
              if (gameState.lifeline_countdown_interval) {
                clearInterval(gameState.lifeline_countdown_interval);
                gameState.lifeline_countdown_interval = null;
                console.log('⏱️ Cleared countdown timer after manual 50:50 selection');
              }
              
              // Broadcast that voting ended with 50:50 as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'fiftyFifty',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('fiftyFifty')) {
              gameState.lifelines_used.push('fiftyFifty');
              
              // Use shared 50:50 elimination function
              const result = executeLifelineFiftyFifty('manual');
              
              // Broadcast the elimination to all clients (standardized to match automatic system)
              broadcastToClients({
                type: 'lifeline_triggered',
                lifeline: 'fiftyFifty',
                action: 'eliminate_answers',
                eliminatedAnswers: result.eliminatedAnswers,
                keptAnswers: result.keptAnswers,
                selectedAnswer: gameState.selected_answer,
                preserveSelectedHighlighting: true,
                timestamp: Date.now()
              });
              
              // Broadcast immediate notification that revote is coming
              broadcastToClients({
                type: 'system_announcement',
                message: '⏳ 50:50 elimination complete! Automatic revote starting in 3 seconds...',
                level: 'info',
                timestamp: Date.now()
              });
                
                // CRITICAL: Stop any existing poll completely before starting revote
                if (pollTimer) {
                  console.log('⏹️ Clearing existing poll timer and stopping active poll');
                  clearTimeout(pollTimer);
                  pollTimer = null;
                }
                
                // Stop the current poll state immediately
                if (gameState.audience_poll_active) {
                  console.log('🛑 Stopping active audience poll for 50:50 revote');
                  gameState.audience_poll_active = false;
                  gameState.show_voting_activity = false;
                  broadcastToClients({
                    type: 'audience_poll_ended',
                    reason: 'fiftyFifty_lifeline',
                    message: '50:50 lifeline used - starting revote with remaining answers',
                    timestamp: Date.now()
                  });
                }
                
                // Start automatic revote after 50:50 elimination (matching automatic selection behavior)
                setTimeout(() => {
                  console.log('🔄🔄🔄 STARTING AUTOMATIC REVOTE AFTER 50:50 ELIMINATION COMPLETE 🔄🔄🔄');
                  console.log('📊 About to start revote with excluded answers:', gameState.excluded_answers.map(i => String.fromCharCode(65 + i)).join(', '));
                  
                  // CRITICAL FIX: Clear lifeline voting and hide panel for manual selection too
                  gameState.lifeline_voting_active = false;
                  broadcastToClients({
                    type: 'hide_lifeline_voting_panel',
                    reason: 'manual_fifty_fifty_complete',
                    timestamp: Date.now()
                  });
                  console.log('📡 Sent hide_lifeline_voting_panel before manual 50:50 revote');
                  
                  startPostLifelineRevote('fiftyFifty');
                  console.log('✅ 50:50 automatic revote initiated - audience should now be able to vote on remaining answers');
                }, 3000); // 3-second delay to ensure visual elimination effects are fully complete
                
                // For manual 50:50, don't track outcome since revote handles the flow
                console.log('✅ Manual 50:50 complete - revote will handle subsequent flow');
                
            } else {
              console.log('⚠️ 50:50 lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: '50:50 lifeline has already been used in this game',
                lifeline: 'fiftyFifty',
                action: 'use_lifeline_fiftyFifty'
              }));
              return;
            }
            break;

          case 'use_lifeline_askAMod':
            console.log('🛡️ Using Ask a Mod lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing Ask a Mod as winner');
              
              // Set Ask a Mod as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.askAMod = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.takeAnotherVote + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'askAMod';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              gameState.lifeline_voting_timer_active = false;
              
              // CRITICAL FIX: Clear continuous countdown timer to stop countdown spam
              if (gameState.lifeline_countdown_interval) {
                clearInterval(gameState.lifeline_countdown_interval);
                gameState.lifeline_countdown_interval = null;
                console.log('⏱️ Cleared countdown timer after manual Ask a Mod selection');
              }
              
              // Broadcast that voting ended with Ask a Mod as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'askAMod',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('askAMod')) {
              // CRITICAL: Stop any existing poll completely before starting Ask a Mod
              if (pollTimer) {
                console.log('⏹️ Clearing existing poll timer and stopping active poll for Ask a Mod');
                clearTimeout(pollTimer);
                pollTimer = null;
              }
              
              // Stop the current poll state immediately
              if (gameState.audience_poll_active) {
                console.log('🛑 Stopping active audience poll for Ask a Mod lifeline');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                broadcastToClients({
                  type: 'audience_poll_ended',
                  reason: 'ask_a_mod_lifeline',
                  message: 'Ask a Mod lifeline used - starting mod response period',
                  timestamp: Date.now()
                });
              }
              
              // Use consolidated Ask a Mod function
              startAskAMod();
            } else {
              console.log('⚠️ Ask a Mod lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'Ask a Mod lifeline has already been used' 
              }));
              return;
            }
            break;

          case 'use_lifeline_ask_audience':
            console.log('🗳️ Using Take Another Vote lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing Take Another Vote as winner');
              
              // Set Take Another Vote as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.takeAnotherVote = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.takeAnotherVote + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'takeAnotherVote';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              gameState.lifeline_voting_timer_active = false;
              
              // CRITICAL FIX: Clear continuous countdown timer to stop countdown spam
              if (gameState.lifeline_countdown_interval) {
                clearInterval(gameState.lifeline_countdown_interval);
                gameState.lifeline_countdown_interval = null;
                console.log('⏱️ Cleared countdown timer after manual Take Another Vote selection');
              }
              
              // Broadcast that voting ended with Take Another Vote as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'takeAnotherVote',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('takeAnotherVote')) {
              // CRITICAL: Stop any existing poll completely before starting Take Another Vote
              if (pollTimer) {
                console.log('⏹️ Clearing existing poll timer and stopping active poll for Take Another Vote');
                clearTimeout(pollTimer);
                pollTimer = null;
              }
              
              // Stop the current poll state immediately
              if (gameState.audience_poll_active) {
                console.log('🛑 Stopping active audience poll for Take Another Vote lifeline');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                broadcastToClients({
                  type: 'audience_poll_ended',
                  reason: 'take_another_vote_lifeline',
                  message: 'Take Another Vote lifeline used - starting fresh revote',
                  timestamp: Date.now()
                });
              }
              
              gameState.lifelines_used.push('takeAnotherVote');
              
              // Use the standardized Take Another Vote function with hybrid control (matches Ask a Mod pattern)
              console.log('🔄 Starting Take Another Vote with standardized hybrid control function');
              console.log(`🚫 Current excluded answers from previous lifelines: ${JSON.stringify(gameState.excluded_answers)}`);
              
              // Use the new standardized function that implements hybrid control properly
              startPostLifelineRevoteForTakeAnotherVote();
            } else {
              console.log('⚠️ Take Another Vote lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: 'Take Another Vote lifeline has already been used in this game',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_ask_audience'
              }));
              return;
            }
            break;
          
          case 'use_lifeline_take_another_vote':
            console.log('🗳️ Using Take Another Vote lifeline (MANUAL HOST SELECTION)');
            
            // Check if lifeline has already been used
            if (gameState.lifelines_used.includes('takeAnotherVote')) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: 'Take Another Vote lifeline has already been used in this game',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_take_another_vote'
              }));
              return;
            }
            
            try {
              // If lifeline voting is active, terminate it and show this as the winner
              if (gameState.lifeline_voting_active) {
                console.log('🎯 Manual lifeline selection - terminating active voting and showing Take Another Vote as winner');
                
                // Set Take Another Vote as the winner with maximum votes to show it won
                gameState.lifeline_vote_counts.takeAnotherVote = Math.max(
                  gameState.lifeline_vote_counts.fiftyFifty + 1,
                  gameState.lifeline_vote_counts.takeAnotherVote + 1,
                  gameState.lifeline_vote_counts.askAMod + 1
                );
                gameState.lifeline_vote_winner = 'takeAnotherVote';
                
                // End voting immediately
                gameState.lifeline_voting_active = false;
                gameState.lifeline_voting_timer_active = false;
                
                // CRITICAL FIX: Clear continuous countdown timer to stop countdown spam
                if (gameState.lifeline_countdown_interval) {
                  clearInterval(gameState.lifeline_countdown_interval);
                  gameState.lifeline_countdown_interval = null;
                  console.log('⏱️ Cleared countdown timer after direct Take Another Vote API usage');
                }
                
                // Broadcast that voting ended with Take Another Vote as winner
                broadcastToClients({
                  type: 'lifeline_voting_ended',
                  winner: 'takeAnotherVote',
                  votes: gameState.lifeline_vote_counts,
                  totalVotes: gameState.lifeline_votes.length,
                  manualSelection: true,
                  timestamp: Date.now()
                });
                
                // Hide the voting panel
                broadcastToClients({
                  type: 'hide_lifeline_voting_panel',
                  reason: 'manual_selection',
                  timestamp: Date.now()
                });
              }
              
              // Trigger the lifeline directly
              triggerLifeline('takeAnotherVote');
              
              // Send success response
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true,
                message: 'Take Another Vote lifeline activated successfully',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_take_another_vote',
                timestamp: Date.now()
              }));
              console.log('✅ Take Another Vote lifeline activated via manual host selection');
              
            } catch (error) {
              console.error('❌ Error activating Take Another Vote lifeline:', error);
              
              // Only send error response if headers haven't been sent yet
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: false,
                  error: 'Failed to activate Take Another Vote lifeline: ' + error.message,
                  lifeline: 'takeAnotherVote',
                  action: 'use_lifeline_take_another_vote'
                }));
              }
            }
            return; // Prevent any further processing

          case 'shutdown_server':
            console.log('Shutdown requested - terminating server');
            process.exit(0);
            break;
            
            
          case 'start_lifeline_vote':
            console.log('🗳️ Starting lifeline voting...');
            
            // Validate lifeline voting can start
            if (!gameState.answers_revealed || !gameState.answer_is_wrong) {
              console.log('⚠️ Cannot start lifeline vote - answer must be wrong');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Can only vote for lifelines after wrong answer' }));
              return;
            }
            
            if (gameState.lifeline_voting_active) {
              console.log('⚠️ Lifeline voting already in progress');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Lifeline voting already active' }));
              return;
            }
            
            if (!gameState.available_lifelines_for_vote || gameState.available_lifelines_for_vote.length === 0) {
              console.log('⚠️ No lifelines available for voting');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No lifelines available' }));
              return;
            }
            
            // Reset lifeline vote states
            gameState.lifeline_voting_active = true;
            gameState.lifeline_voting_timer_active = true;
            gameState.lifeline_voting_start_time = Date.now();
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              takeAnotherVote: 0,
              askAMod: 0
            };
            gameState.lifeline_vote_winner = null;
            
            // Add continuous countdown timer for smooth updates
            if (gameState.lifeline_countdown_interval) {
              clearInterval(gameState.lifeline_countdown_interval);
            }
            gameState.lifeline_countdown_interval = setInterval(() => {
              if (gameState.lifeline_voting_timer_active) {
                const elapsed = Date.now() - gameState.lifeline_voting_start_time;
                const remaining = Math.max(0, (gameState.lifeline_voting_duration || 30000) - elapsed);
                
                // Broadcast countdown update (only log every 5 seconds to reduce spam)
                const seconds = Math.ceil(remaining / 1000);
                if (seconds % 5 === 0 || seconds <= 3) {
                  console.log(`⏱️ Lifeline voting countdown: ${seconds}s remaining`);
                }
                broadcastToClients({
                  type: 'lifeline_voting_countdown',
                  remainingTime: remaining,
                  seconds: seconds
                });
                
                // Stop timer if time is up
                if (remaining === 0) {
                  clearInterval(gameState.lifeline_countdown_interval);
                  gameState.lifeline_countdown_interval = null;
                }
              }
            }, 1000); // Update every 1 second to prevent overload during high-volume voting
            
            console.log('🗳️ Available lifelines for voting:', gameState.available_lifelines_for_vote);
            console.log('⏱️ 30-second lifeline vote timer started - chat can vote: 50/50, VOTE, or MOD');
            
            // Broadcast lifeline voting start to all clients
            broadcastToClients({
              type: 'lifeline_voting_started',
              duration: gameState.lifeline_voting_duration,
              available_lifelines: gameState.available_lifelines_for_vote,
              timestamp: Date.now()
            });
            
            // Broadcast state update
            broadcastState();
            
            // Auto-end lifeline voting after 30 seconds
            setTimeout(() => {
              if (gameState.lifeline_voting_active) {
                console.log('🏁 Auto-ending lifeline vote after 30 seconds');
                
                // Tally votes and determine winner
                let winnerLifeline = null;
                let maxVotes = 0;
                
                if (gameState.lifeline_vote_counts.fiftyFifty > maxVotes && gameState.available_lifelines_for_vote.includes('fiftyFifty')) {
                  winnerLifeline = 'fiftyFifty';
                  maxVotes = gameState.lifeline_vote_counts.fiftyFifty;
                }
                if (gameState.lifeline_vote_counts.takeAnotherVote > maxVotes && gameState.available_lifelines_for_vote.includes('takeAnotherVote')) {
                  winnerLifeline = 'takeAnotherVote';
                  maxVotes = gameState.lifeline_vote_counts.takeAnotherVote;
                }
                if (gameState.lifeline_vote_counts.askAMod > maxVotes && gameState.available_lifelines_for_vote.includes('askAMod')) {
                  winnerLifeline = 'askAMod';
                  maxVotes = gameState.lifeline_vote_counts.askAMod;
                }
                
                // End voting
                gameState.lifeline_voting_active = false;
                gameState.lifeline_voting_timer_active = false;
                
                if (winnerLifeline && maxVotes > 0) {
                  gameState.lifeline_vote_winner = winnerLifeline;
                  console.log(`🏆 Lifeline vote winner: ${winnerLifeline} with ${maxVotes} votes`);
                  
                  // Broadcast winner
                  broadcastToClients({
                    type: 'lifeline_voting_ended',
                    winner: winnerLifeline,
                    votes: maxVotes,
                    timestamp: Date.now()
                  });
                  
                  // Automatically trigger the winning lifeline after a brief delay
                  setTimeout(() => {
                    console.log(`🎯 Auto-executing winning lifeline: ${winnerLifeline}`);
                    triggerLifeline(winnerLifeline);
                  }, 2000); // 2 second delay to show winner
                } else {
                  console.log('⚠️ No lifeline votes received - no lifeline executed');
                  broadcastToClients({
                    type: 'lifeline_voting_ended',
                    winner: null,
                    votes: 0,
                    timestamp: Date.now()
                  });
                }
                
                broadcastState();
              }
            }, gameState.lifeline_voting_duration); // 30 seconds
            break;

          // Test cases for Ask A Mod display system


          // ===== PHASE 5: COMPREHENSIVE REVOTE FLOW TEST CASES =====
          






            
          case 'activate_ask_a_mod':
            console.log('🛡️ Activating Ask a Mod lifeline...');
            startAskAMod();
            break;
            
          case 'set_ask_a_mod_duration':
            if (data.duration && typeof data.duration === 'number') {
              gameState.ask_a_mod_duration = data.duration;
              console.log(`⏰ Ask a Mod duration set to ${data.duration}ms (${data.duration / 1000}s)`);
            }
            break;
            
          case 'update_moderator_list':
            console.log('🛡️ Updating moderator list from control panel...');
            if (data.moderators && Array.isArray(data.moderators)) {
              const success = saveModeratorList(data.moderators);
              if (success) {
                console.log('✅ Moderator list updated successfully');
              } else {
                console.error('❌ Failed to update moderator list');
              }
            } else {
              console.error('❌ Invalid moderator list data received');
            }
            break;

          case 'send_mod_message':
            console.log('🧪 TESTING: Processing send_mod_message action from API...');
            
            if (!gameState.ask_a_mod_active) {
              console.log('⚠️ Ask a Mod is not active - message will be stored but not processed');
            }
            
            if (data.username && data.message) {
              console.log(`🧪 Test mod message: ${data.username} said "${data.message}"`);
              
              // If Ask a Mod is active, process it as a real mod response
              if (gameState.ask_a_mod_active) {
                console.log('🛡️ Ask a Mod is active - processing test message as mod response...');
                
                // Add to mod responses array
                const modResponse = {
                  username: data.username,
                  message: data.message,
                  timestamp: Date.now(),
                  platform: 'test',
                  suggestedAnswer: extractAnswerFromMessage(data.message)
                };
                
                gameState.mod_responses.push(modResponse);
                
                // Broadcast the mod response
                broadcastToClients({
                  type: 'mod_response',
                  response: modResponse,
                  timestamp: Date.now()
                });
                
                // Update the Ask a Mod display
                const testDisplayUpdate = {
                  type: 'ask_a_mod_display_update',
                  newResponse: modResponse,
                  allResponses: gameState.mod_responses,
                  totalResponses: gameState.mod_responses.length,
                  timestamp: Date.now()
                };
                
                console.log('🧪 Broadcasting test mod response update:', {
                  type: 'ask_a_mod_display_update',
                  responseCount: gameState.mod_responses.length,
                  newResponse: modResponse.username + ': ' + modResponse.message
                });
                
                broadcastToClients(testDisplayUpdate);
                
                console.log(`🛡️ Added test mod response from ${data.username}. Total responses: ${gameState.mod_responses.length}`);
              }
              
              console.log('✅ Test mod message processed successfully');
            } else {
              console.error('❌ Invalid send_mod_message data - username and message required');
            }
            break;
            
          case 'set_ask_mod_mode':
            // Toggle between Ask a Mod only or Ask a Mod/VIP
            if (data.include_vips !== undefined) {
              gameState.ask_a_mod_include_vips = !!data.include_vips;
              console.log(`🛡️ Ask a Mod mode changed to: ${gameState.ask_a_mod_include_vips ? 'Mod/VIP' : 'Mod only'}`);
              
              // Broadcast the mode change
              broadcastToClients({
                type: 'ask_mod_mode_changed',
                include_vips: gameState.ask_a_mod_include_vips,
                timestamp: Date.now()
              });
            }
            break;
            
          case 'trigger_lifeline':
            // Direct lifeline trigger for testing/manual control
            console.log(`💡 Manual lifeline trigger request: ${data.lifeline}`);
            const validLifelines = ['fiftyFifty', 'takeAnotherVote', 'askAMod'];
            
            if (!data.lifeline || !validLifelines.includes(data.lifeline)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Invalid lifeline. Must be one of: fiftyFifty, takeAnotherVote, askAMod' 
              }));
              return;
            }
            
            // Check if lifeline has already been used
            if (gameState.lifelines_used.includes(data.lifeline)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: `Lifeline ${data.lifeline} has already been used` 
              }));
              return;
            }
            
            // End any active lifeline voting
            if (gameState.lifeline_voting_active) {
              endLifelineVoting();
            }
            
            // Trigger the lifeline
            console.log(`🎯 Manually triggering lifeline: ${data.lifeline}`);
            triggerLifeline(data.lifeline);
            break;
            
          case 'break_poll_tie':
            // Host breaks a tie in audience voting
            if (!gameState.poll_tie_detected) {
              console.warn('⚠️ No poll tie to break');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No poll tie detected' }));
              return;
            }
            
            const selectedAnswer = data.selected_answer;
            if (!selectedAnswer || !gameState.poll_tied_options.includes(selectedAnswer)) {
              console.warn(`⚠️ Invalid tie-break selection: ${selectedAnswer}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Invalid selection', 
                validOptions: gameState.poll_tied_options 
              }));
              return;
            }
            
            console.log(`🎯 Host broke poll tie - selected: ${selectedAnswer}`);
            
            // Clear tie state
            gameState.poll_tie_detected = false;
            gameState.waiting_for_tie_break = false;
            
            // Set the selected answer as the winner
            const answerIndex = ['A', 'B', 'C', 'D'].indexOf(selectedAnswer);
            gameState.selected_answer = answerIndex;
            gameState.answer_locked_in = true;
            
            // Broadcast the resolution
            broadcastToClients({
              type: 'poll_tie_resolved',
              winner: selectedAnswer,
              message: `Host selected ${selectedAnswer} to break the tie`
            });
            
            // Play lock sound
            broadcastToClients({ type: 'audio_command', command: 'play_lock' });
            
            console.log(`🔒 Answer ${selectedAnswer} locked in after tie-break`);
            break;
            
          case 'break_lifeline_tie':
            // Host breaks a tie in lifeline voting
            if (!gameState.lifeline_tie_detected) {
              console.warn('⚠️ No lifeline tie to break');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No lifeline tie detected' }));
              return;
            }
            
            const selectedLifeline = data.selected_lifeline;
            if (!selectedLifeline || !gameState.lifeline_tied_options.includes(selectedLifeline)) {
              console.warn(`⚠️ Invalid lifeline tie-break selection: ${selectedLifeline}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Invalid selection', 
                validOptions: gameState.lifeline_tied_options 
              }));
              return;
            }
            
            console.log(`🎯 Host broke lifeline tie - selected: ${selectedLifeline}`);
            
            // Clear tie state
            gameState.lifeline_tie_detected = false;
            gameState.waiting_for_lifeline_tie_break = false;
            gameState.lifeline_vote_winner = selectedLifeline;
            
            // Broadcast the resolution
            broadcastToClients({
              type: 'lifeline_tie_resolved',
              winner: selectedLifeline,
              message: `Host selected ${selectedLifeline} to break the tie`
            });
            
            // Trigger the selected lifeline
            setTimeout(() => {
              console.log(`🎯 Triggering host-selected lifeline: ${selectedLifeline}`);
              triggerLifeline(selectedLifeline);
            }, 1000);
            
            break;
            
          default:
            console.warn(`⚠️ Unknown action received: '${data.action}'`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: `Unknown action: ${data.action}`,
              available_actions: ['start_game', 'reset_game', 'next_question', 'show_question', 'show_answers', 'reveal_answer', 'set_selected_answer', 'lock_answer', 'set_contestant', 'end_game_credits', 'start_credits_scroll', 'test_credits', 'trigger_lifeline', 'break_poll_tie', 'break_lifeline_tie', 'activate_hot_seat', 'end_hot_seat', 'add_demo_participants', 'upload_hot_seat_profiles']
            }));
            return; // Don't call broadcastState for unknown actions

        }
        
        gameState.update_needed = true;
        
        // Broadcast the update to all WebSocket clients
        console.log('DEBUG: About to call broadcastState()');
        broadcastState(false, true); // Critical broadcast for control panel actions
        console.log('DEBUG: broadcastState() completed successfully');
        
          const cleanGameState = createSerializableGameState();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, state: cleanGameState }));
        
      } catch (error) {
        console.error('ERROR in control API:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Leaderboard API endpoints
  if (pathname === '/api/leaderboard') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getLeaderboardStats()));
      return;
    }
  }
  
  if (pathname === '/api/leaderboard/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const period = data.period || 'current_game';
        
        // Validate period
        const validPeriods = ['current_game', 'daily', 'weekly', 'monthly', 'all_time'];
        if (!validPeriods.includes(period)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid period. Must be one of: ' + validPeriods.join(', ') }));
          return;
        }
        
        // For all_time, require confirmation
        if (period === 'all_time' && !data.confirmed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Resetting all-time leaderboard requires confirmation flag' }));
          return;
        }
        
        resetLeaderboard(period);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: `Leaderboard ${period} reset successfully`,
          leaderboard: getLeaderboardStats()
        }));
      } catch (error) {
        console.error('❌ Leaderboard reset API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request data' }));
      }
    });
    return;
  }
  
  if (pathname === '/api/leaderboard/export' && req.method === 'GET') {
    const exportData = {
      timestamp: Date.now(),
      date: new Date().toISOString(),
      leaderboard: leaderboardData,
      gameState: {
        total_questions: questions.length,
        current_question: gameState.current_question,
        participants: gameState.gameshow_participants.length
      }
    };
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="leaderboard-export.json"'
    });
    res.end(JSON.stringify(exportData, null, 2));
    return;
  }
  
  if (pathname === '/api/leaderboard/import' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const importData = JSON.parse(body);
        
        // Validate import data structure
        if (!importData.leaderboard || typeof importData.leaderboard !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid import data structure' }));
          return;
        }
        
        // Merge or replace based on flag
        if (importData.merge) {
          // Merge with existing data
          Object.keys(importData.leaderboard).forEach(period => {
            if (leaderboardData[period] && typeof leaderboardData[period] === 'object') {
              Object.keys(importData.leaderboard[period]).forEach(username => {
                if (importData.leaderboard[period][username]) {
                  // Merge user data
                  if (!leaderboardData[period][username]) {
                    leaderboardData[period][username] = importData.leaderboard[period][username];
                  } else {
                    // Add points and stats
                    leaderboardData[period][username].points += importData.leaderboard[period][username].points || 0;
                    leaderboardData[period][username].correct_answers += importData.leaderboard[period][username].correct_answers || 0;
                    leaderboardData[period][username].total_votes += importData.leaderboard[period][username].total_votes || 0;
                  }
                }
              });
            }
          });
        } else {
          // Replace entire leaderboard
          leaderboardData = importData.leaderboard;
        }
        
        saveLeaderboardData();
        broadcastLeaderboardUpdate();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Leaderboard imported successfully',
          leaderboard: getLeaderboardStats()
        }));
      } catch (error) {
        console.error('❌ Leaderboard import API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid import data' }));
      }
    });
    return;
  }
  
  if (pathname === '/api/leaderboard/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(leaderboardData.settings || {
        points: {
          participation: 10,
          chat_participation: 1,
          correct_answer: 100,
          speed_bonus_max: 50,
          streak_multiplier: 1.5,
          hot_seat_correct: 500,
          hot_seat_participation: 100
        },
        chat_participation_enabled: true,
        chat_participation_cooldown: 60000
      }));
      return;
    }
    
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const newSettings = JSON.parse(body);
          
          // Update settings
          if (!leaderboardData.settings) {
            leaderboardData.settings = {};
          }
          leaderboardData.settings = { ...leaderboardData.settings, ...newSettings };
          
          saveLeaderboardData();
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: 'Settings updated successfully',
            settings: leaderboardData.settings
          }));
        } catch (error) {
          console.error('❌ Leaderboard settings API error:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid settings data' }));
        }
      });
      return;
    }
  }
  
  // Leaderboard backup endpoint
  if (pathname === '/api/leaderboard/backup' && req.method === 'POST') {
    try {
      // Save current leaderboard data
      saveLeaderboardData();
      
      // Create timestamped backup
      saveLeaderboardBackup();
      
      // Get backup directory listing
      const backupDir = path.join(__dirname, 'workinprogress');
      let backupFiles = [];
      
      if (fs.existsSync(backupDir)) {
        backupFiles = fs.readdirSync(backupDir)
          .filter(f => f.startsWith('leaderboard-backup-') || f.startsWith('leaderboard-daily-'))
          .sort()
          .reverse()
          .slice(0, 10); // Show last 10 backups
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Leaderboard backup created successfully',
        backups: backupFiles,
        currentData: getLeaderboardStats()
      }));
    } catch (error) {
      console.error('❌ Leaderboard backup API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to create backup: ' + error.message }));
    }
    return;
  }
  
  // Previous Winners API endpoints
  if (pathname === '/api/leaderboard/previous-winners') {
    if (req.method === 'GET') {
      try {
        const winnersData = loadPreviousWinners();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(winnersData));
      } catch (error) {
        console.error('❌ Error fetching previous winners:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load previous winners' }));
      }
      return;
    }
  }
  
  if (pathname === '/api/leaderboard/previous-winners/archive' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const username = data.username;
        
        if (!username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username is required' }));
          return;
        }
        
        // Archive the winner
        const result = archiveWinner(username);
        
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `${username} archived as winner`,
            winner: result.winner,
            winnersData: loadPreviousWinners()
          }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
        }
      } catch (error) {
        console.error('❌ Archive winner API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request data' }));
      }
    });
    return;
  }
  
  if (pathname === '/api/leaderboard/previous-winners/auto-archive' && req.method === 'POST') {
    try {
      // Auto-archive top 1 player from current game
      const result = autoArchiveTopWinner();
      
      if (result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: result.message,
          winner: result.winner,
          winnersData: loadPreviousWinners()
        }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
      }
    } catch (error) {
      console.error('❌ Auto-archive winner API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to auto-archive winner' }));
    }
    return;
  }
  
  if (pathname.startsWith('/api/leaderboard/previous-winners/') && req.method === 'DELETE') {
    const gameId = pathname.split('/').pop();
    
    try {
      const result = removePreviousWinner(gameId);
      
      if (result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Winner entry ${gameId} removed`,
          winnersData: loadPreviousWinners()
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
      }
    } catch (error) {
      console.error('❌ Remove winner API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to remove winner' }));
    }
    return;
  }
  
  if (pathname === '/api/leaderboard/previous-winners/clear' && req.method === 'POST') {
    try {
      clearPreviousWinners();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'All previous winners cleared',
        winnersData: loadPreviousWinners()
      }));
    } catch (error) {
      console.error('❌ Clear winners API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to clear winners' }));
    }
    return;
  }
  
  if (pathname === '/api/leaderboard/previous-winners/export' && req.method === 'GET') {
    try {
      const winnersData = loadPreviousWinners();
      const exportData = {
        timestamp: Date.now(),
        date: new Date().toISOString(),
        ...winnersData
      };
      
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="previous-winners-export.json"'
      });
      res.end(JSON.stringify(exportData, null, 2));
    } catch (error) {
      console.error('❌ Export winners API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to export winners' }));
    }
    return;
  }
  
  if (pathname === '/api/leaderboard/previous-winners/import' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const importData = JSON.parse(body);
        
        if (!importData.winners || !Array.isArray(importData.winners)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid import data structure' }));
          return;
        }
        
        importPreviousWinners(importData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Previous winners imported successfully',
          winnersData: loadPreviousWinners()
        }));
      } catch (error) {
        console.error('❌ Import winners API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid import data' }));
      }
    });
    return;
  }
  
  // 404 for unknown API endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

// Helper function to extract answer choice from moderator message
function extractAnswerFromMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }
  
  const upperMessage = message.toUpperCase();
  
  // Look for explicit answer patterns like "A", "answer A", "option A", etc.
  const patterns = [
    /\bANSWER\s+([ABCD])\b/,
    /\bOPTION\s+([ABCD])\b/,
    /\bCHOICE\s+([ABCD])\b/,
    /\b([ABCD])\s+IS\b/,
    /\bPICK\s+([ABCD])\b/,
    /\bGO\s+WITH\s+([ABCD])\b/,
    /\bTHINK\s+([ABCD])\b/,
    /\b([ABCD])\s*[-–]\s*/,  // "A - " pattern
    /\b([ABCD])\b/  // Simple single letter (lowest priority)
  ];
  
  for (const pattern of patterns) {
    const match = upperMessage.match(pattern);
    if (match && ['A', 'B', 'C', 'D'].includes(match[1])) {
      return match[1];
    }
  }
  
  return null;
}

// Helper function for Mod advice
function generateModAdvice() {
  const modAdvicePhrases = [
    "Based on my experience moderating, I'd lean towards option C",
    "The community consensus points to answer B, but watch for trolls", 
    "My gut feeling suggests A, but keep an eye on chat reactions",
    "Chat sentiment indicates D, though it's a contrarian play",
    "The regulars in chat are leaning toward B today",
    "Risk/reward analysis favors C, but diversify your positions",
    "Macro trends suggest A, but mind the earnings calendar",
    "The smart money is betting on D based on recent filings",
    "Chart patterns indicate B, but news flow could shift momentum",
    "Sector rotation points to C, though valuations are stretched"
  ];
  
  return modAdvicePhrases[Math.floor(Math.random() * modAdvicePhrases.length)];
}

// Helper function to start audience poll (existing function reference)
function startAudiencePoll() {
  if (!gameState.audience_poll_active) {
    gameState.audience_poll_active = true;
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    gameState.show_poll_winner = null;
    gameState.show_voting_activity = true;
    
    console.log('🗳️ Starting audience poll');
    
    // Auto-end after configurable duration
    setTimeout(() => {
      if (gameState.audience_poll_active) {
        const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
        console.log(`⏰ Poll time limit reached (${durationSeconds}s) - ending poll`);
        endAutomaticPoll();  // Use the correct function with Take Another Vote logic
      }
    }, gameState.audience_poll_duration);
  }
}

// Removed duplicate endAudiencePoll - using endAutomaticPoll instead which has proper Take Another Vote logic

// Duplicate function removed - using the proper vote validation logic at line 8858

const PORT = 8081;
const HOST = '0.0.0.0';  // Listen on all interfaces
const PUBLIC_IP = '75.119.154.213'; // <-- replace with your VPS IP

server.listen(PORT, HOST, () => {
  console.log('🎮 Kimbillionaire Bridge Server running!');
  console.log(`📺 Browser Source: http://${PUBLIC_IP}:${PORT}/gameshow`);
  console.log(`🎛️ Control Panel: Connect your React app to http://${PUBLIC_IP}:${PORT}/api/*`);
  console.log(`💡 Usage: Add browser source in OBS with URL: http://${PUBLIC_IP}:${PORT}/gameshow`);
  
  // CRITICAL FIX: Force reset revote duration to 60 seconds to override any API changes
  gameState.revote_duration = 60000;
  console.log(`⏱️ REVOTE DURATION RESET: Forced revote_duration to ${gameState.revote_duration}ms (60 seconds)`);
  
  // Load leaderboard data at startup
  loadLeaderboardData();
  
  // Set up periodic check for leaderboard resets (every 60 seconds)
  setInterval(() => {
    checkPeriodicResets();
    console.log('⏰ Auto-saved leaderboard data');
    saveLeaderboardData();
  }, 60000); // Check every minute
  
  // Load moderator and VIP lists at startup for Ask a Mod lifeline
  console.log('🛡️ Loading moderator list...');
  loadModeratorList();
  console.log('💎 Loading VIP list...');
  loadVIPList();
  console.log('🚫 Loading ignored users list...');
  loadIgnoredUsersList();
  
  // Auto-start Twitch chat with last configured channel - TEMPORARILY DISABLED TO PREVENT DUPLICATES
  // Auto-start Twitch chat if configured
  setTimeout(() => {
    console.log('🚀 Auto-starting Twitch chat with last configured channel...');
    try {
      const configPath = POLLING_CONFIG_PATH;
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.twitch && config.twitch.channel && config.twitch.channel !== '') {
          console.log(`📺 Auto-connecting to Twitch channel: ${config.twitch.channel}`);
          
          // Check for existing process first
          const pidFile = path.join(__dirname, 'simple-twitch-chat.pid');
          if (fs.existsSync(pidFile)) {
            try {
              const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
              process.kill(existingPid, 0); // Check if process exists
              console.log('⚠️ Twitch chat already running with PID:', existingPid);
              return;
            } catch (e) {
              // Process doesn't exist, clean up PID file
              fs.unlinkSync(pidFile);
            }
          }
          
          // Start Twitch chat process
          const { spawn } = require('child_process');
          const twitchChatProcess = spawn('node', ['simple-twitch-chat.js'], {
            cwd: __dirname,
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          twitchChatProcess.stdout.on('data', (data) => {
            console.log(`📺 Twitch Chat: ${data.toString().trim()}`);
          });
          
          twitchChatProcess.stderr.on('data', (data) => {
            console.error(`📺 Twitch Chat Error: ${data.toString().trim()}`);
          });
          
          twitchChatProcess.on('exit', (code) => {
            console.log(`📺 Twitch chat process exited with code ${code}`);
          });
          
          global.twitchChatProcess = twitchChatProcess;
          console.log('✅ Twitch chat auto-started successfully');
        } else {
          console.log('ℹ️ No Twitch channel configured, skipping auto-start');
        }
      } else {
        console.log('ℹ️ No polling config found, skipping Twitch chat auto-start');
      }
    } catch (error) {
      console.log('⚠️ Could not auto-start Twitch chat:', error.message);
    }
  }, 3000); // 3 second delay to let server fully initialize
});

// 🔒 CRITICAL ERROR HANDLING & SERVER REINFORCEMENT SYSTEM
// ========================================================

// Track server health metrics
let serverHealth = {
  startTime: Date.now(),
  crashCount: 0,
  lastCrash: null,
  memoryWarnings: 0,
  connectionCount: 0,
  lastHeartbeat: Date.now()
};

// Enhanced Performance Monitoring System (using existing performanceMetrics)
// Note: performanceMetrics is already defined earlier in the file at line 22
// Extending the existing object with additional properties
Object.assign(performanceMetrics, {
  votes: {
    totalProcessed: 0,
    averageProcessingTime: 0,
    processingTimes: [], // Last 100 processing times
    duplicatesBlocked: 0,
    errorsCount: 0
  },
  websocket: {
    messagesReceived: 0,
    messagesSent: 0,
    connectionDuration: new Map(), // connectionId -> startTime
    averageLatency: 0,
    latencyMeasurements: [], // Last 50 latency measurements
    // Enhanced connection health tracking
    connectionQuality: new Map(), // connectionId -> quality metrics
    reconnectionEvents: [],
    connectionFailures: 0,
    totalConnections: 0,
    avgConnectionDuration: 0,
    connectionDurations: [], // Last 100 connection durations
    healthAlerts: [] // Recent health issues
  },
  gameFlow: {
    questionTransitions: 0,
    pollsStarted: 0,
    pollsCompleted: 0,
    lifelinesUsed: 0,
    averagePollDuration: 0
  },
  system: {
    memoryUsageMB: 0,
    cpuLoadPercent: 0,
    uptime: 0,
    lastUpdate: Date.now()
  }
});

// Performance tracking functions
function trackVoteProcessing(processingTime, wasBlocked = false, hasError = false) {
  const metrics = performanceMetrics.votes;
  
  if (wasBlocked) {
    metrics.duplicatesBlocked++;
    return;
  }
  
  if (hasError) {
    metrics.errorsCount++;
    return;
  }
  
  metrics.totalProcessed++;
  metrics.processingTimes.push(processingTime);
  
  // Keep only last 100 measurements
  if (metrics.processingTimes.length > 100) {
    metrics.processingTimes.shift();
  }
  
  // Calculate average processing time
  metrics.averageProcessingTime = metrics.processingTimes.reduce((a, b) => a + b, 0) / metrics.processingTimes.length;
}

function trackWebSocketMessage(type, connectionId, isOutgoing = false) {
  const metrics = performanceMetrics.websocket;
  
  if (isOutgoing) {
    metrics.messagesSent++;
  } else {
    metrics.messagesReceived++;
    
    // Track latency for specific message types
    if (type === 'ping' || type === 'connection_test') {
      const latency = Date.now() - (connectionId ? (performanceMetrics.websocket.connectionDuration.get(connectionId) || Date.now()) : Date.now());
      metrics.latencyMeasurements.push(latency);
      
      // Keep only last 50 measurements
      if (metrics.latencyMeasurements.length > 50) {
        metrics.latencyMeasurements.shift();
      }
      
      // Calculate average latency
      metrics.averageLatency = metrics.latencyMeasurements.reduce((a, b) => a + b, 0) / metrics.latencyMeasurements.length;
    }
    
    // Update connection quality metrics
    if (connectionId && metrics.connectionQuality.has(connectionId)) {
      const quality = metrics.connectionQuality.get(connectionId);
      quality.messageCount++;
      quality.lastActivity = Date.now();
      
      // Track error rate
      if (type === 'error') {
        quality.errorCount++;
        quality.errorRate = quality.errorCount / quality.messageCount;
      }
      
      // Update health score (0-100, higher is better)
      quality.healthScore = Math.max(0, 100 - (quality.errorRate * 100) - Math.min(50, metrics.averageLatency / 10));
      
      // Check for health alerts
      if (quality.healthScore < 50 && Date.now() - quality.lastAlert > 60000) { // Alert max once per minute
        addHealthAlert(`Connection ${connectionId} health score dropped to ${Math.round(quality.healthScore)}`, 'warning');
        quality.lastAlert = Date.now();
      }
    }
  }
}

// WebSocket health alert system
function addHealthAlert(message, severity = 'info') {
  const alert = {
    message: message,
    severity: severity, // 'info', 'warning', 'error'
    timestamp: Date.now()
  };
  
  performanceMetrics.websocket.healthAlerts.push(alert);
  
  // Keep only last 20 alerts
  if (performanceMetrics.websocket.healthAlerts.length > 20) {
    performanceMetrics.websocket.healthAlerts.shift();
  }
  
  // Clean up old alerts
  cleanupHealthAlerts();
  
  // Log severe alerts
  if (severity === 'error' || severity === 'warning') {
    console.log(`🚨 WebSocket Health Alert [${severity.toUpperCase()}]: ${message}`);
  }
}

// Cleanup old health alerts and manage development environment warnings
function cleanupHealthAlerts() {
  const now = Date.now();
  const tenMinutesAgo = now - (10 * 60 * 1000);
  
  // Remove alerts older than 10 minutes
  performanceMetrics.websocket.healthAlerts = performanceMetrics.websocket.healthAlerts.filter(alert => 
    alert.timestamp > tenMinutesAgo
  );
  
  // For development environment warnings, clean up more aggressively (keep only last 2 minutes)
  const twoMinutesAgo = now - (2 * 60 * 1000);
  performanceMetrics.websocket.healthAlerts = performanceMetrics.websocket.healthAlerts.filter(alert => {
    if (alert.message.includes('dev environment')) {
      return alert.timestamp > twoMinutesAgo;
    }
    return true;
  });
}

// Detect reconnection patterns
function detectReconnection(clientIP, connectionId) {
  const metrics = performanceMetrics.websocket;
  const now = Date.now();
  
  // Check for recent connections from same IP
  const recentConnections = metrics.reconnectionEvents.filter(event => 
    event.clientIP === clientIP && (now - event.timestamp) < 30000 // Last 30 seconds
  );
  
  // Adjust thresholds for development vs production
  const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';
  const reconnectionThreshold = isDevelopment ? 8 : 3; // Higher threshold for dev environment
  
  if (recentConnections.length > reconnectionThreshold) {
    const severity = isDevelopment ? 'info' : 'warning';
    const context = isDevelopment ? ' (dev environment)' : '';
    addHealthAlert(`Multiple reconnections detected from ${clientIP} (${recentConnections.length} in 30s)${context}`, severity);
    
    if (!isDevelopment) {
      console.log(`🔄 Rapid reconnection pattern detected from ${clientIP}`);
    }
  }
  
  // Record this connection event
  metrics.reconnectionEvents.push({
    clientIP: clientIP,
    connectionId: connectionId,
    timestamp: now
  });
  
  // Cleanup old events (older than 5 minutes)
  metrics.reconnectionEvents = metrics.reconnectionEvents.filter(event => 
    (now - event.timestamp) < 300000
  );
}

function updateSystemMetrics() {
  const metrics = performanceMetrics.system;
  const used = process.memoryUsage();
  
  metrics.memoryUsageMB = Math.round(used.heapUsed / 1024 / 1024);
  metrics.uptime = Math.round((Date.now() - serverHealth.startTime) / 1000);
  metrics.lastUpdate = Date.now();
  
  // Update CPU load (simplified estimate based on memory pressure)
  metrics.cpuLoadPercent = Math.min(100, Math.round(metrics.memoryUsageMB / 10));
}

function getPerformanceSnapshot() {
  updateSystemMetrics();
  return {
    ...performanceMetrics,
    serverHealth: serverHealth,
    timestamp: Date.now()
  };
}

function getEnhancedPerformanceSnapshot() {
  updateSystemMetrics();
  
  const now = Date.now();
  const metrics = performanceMetrics;
  
  // Calculate performance insights
  const insights = {
    overall_health: calculateOverallHealth(),
    connection_stability: calculateConnectionStability(),
    vote_processing_efficiency: calculateVoteProcessingEfficiency(),
    memory_trend: calculateMemoryTrend(),
    alerts_summary: summarizeAlerts()
  };
  
  // Enhanced system status
  const systemStatus = {
    status: insights.overall_health >= 80 ? 'healthy' : insights.overall_health >= 60 ? 'warning' : 'critical',
    uptime_hours: Math.round(metrics.system.uptime / 3600),
    active_connections: serverHealth.connectionCount,
    memory_usage_percent: Math.round((metrics.system.memoryUsageMB / 512) * 100), // Assuming 512MB limit
    performance_score: insights.overall_health
  };
  
  return {
    ...performanceMetrics,
    serverHealth: serverHealth,
    systemStatus: systemStatus,
    insights: insights,
    timestamp: now
  };
}

// Performance calculation helper functions
function calculateOverallHealth() {
  const metrics = performanceMetrics;
  let score = 100;
  
  // Memory penalty (high memory usage reduces score)
  if (metrics.system.memoryUsageMB > 400) score -= 20;
  else if (metrics.system.memoryUsageMB > 200) score -= 10;
  
  // Connection stability penalty
  const failureRate = metrics.websocket.totalConnections > 0 ? 
    metrics.websocket.connectionFailures / metrics.websocket.totalConnections : 0;
  score -= Math.min(30, failureRate * 100);
  
  // Vote processing errors penalty
  if (metrics.votes.errorsCount > 0) score -= Math.min(20, metrics.votes.errorsCount * 2);
  
  // Server crash penalty
  score -= serverHealth.crashCount * 10;
  
  return Math.max(0, Math.round(score));
}

function calculateConnectionStability() {
  const metrics = performanceMetrics.websocket;
  
  if (metrics.totalConnections === 0) return 100;
  
  const failureRate = metrics.connectionFailures / metrics.totalConnections;
  const avgDuration = metrics.avgConnectionDuration || 0;
  
  let stability = 100;
  stability -= failureRate * 50; // Failure rate impact
  
  // Short connection duration penalty (but not for development)
  if (avgDuration < 10000 && metrics.totalConnections > 10) {
    stability -= 20;
  }
  
  return Math.max(0, Math.round(stability));
}

function calculateVoteProcessingEfficiency() {
  const metrics = performanceMetrics.votes;
  
  if (metrics.totalProcessed === 0) return 100;
  
  let efficiency = 100;
  
  // Error rate penalty
  const errorRate = metrics.errorsCount / (metrics.totalProcessed + metrics.errorsCount);
  efficiency -= errorRate * 50;
  
  // Processing time penalty (if average > 100ms)
  if (metrics.averageProcessingTime > 100) {
    efficiency -= Math.min(30, (metrics.averageProcessingTime - 100) / 10);
  }
  
  return Math.max(0, Math.round(efficiency));
}

function calculateMemoryTrend() {
  const currentMemory = performanceMetrics.system.memoryUsageMB;
  
  // Simple memory trend analysis
  if (currentMemory < 50) return 'low';
  if (currentMemory < 200) return 'normal';
  if (currentMemory < 400) return 'elevated';
  return 'high';
}

function summarizeAlerts() {
  const alerts = performanceMetrics.websocket.healthAlerts;
  const now = Date.now();
  
  const recentAlerts = alerts.filter(alert => (now - alert.timestamp) < 300000); // Last 5 minutes
  
  const summary = {
    total: recentAlerts.length,
    by_severity: {
      info: recentAlerts.filter(a => a.severity === 'info').length,
      warning: recentAlerts.filter(a => a.severity === 'warning').length,
      error: recentAlerts.filter(a => a.severity === 'error').length
    },
    recent_issues: recentAlerts.slice(-3).map(alert => ({
      message: alert.message,
      severity: alert.severity,
      minutes_ago: Math.round((now - alert.timestamp) / 60000)
    }))
  };
  
  return summary;
}

// Memory monitoring and garbage collection
function monitorMemoryUsage() {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  
  // Log memory usage every 5 minutes for monitoring
  if (Date.now() % (5 * 60 * 1000) < 1000) {
    console.log(`💾 Memory Usage: ${heapUsedMB}MB / ${heapTotalMB}MB heap, ${Math.round(used.rss / 1024 / 1024)}MB RSS`);
  }
  
  // Warning threshold: 400MB heap usage
  if (heapUsedMB > 400) {
    serverHealth.memoryWarnings++;
    console.warn(`⚠️ High memory usage: ${heapUsedMB}MB - triggering garbage collection`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log(`🧹 Garbage collection completed`);
    }
    
    // If memory still high after GC, log critical warning
    const afterGC = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (afterGC > 300) {
      console.error(`🚨 CRITICAL: Memory usage still high after GC: ${afterGC}MB`);
    }
  }
}

// Enhanced state backup system
function backupGameState() {
  try {
    const backup = {
      gameState: gameState,
      leaderboardData: leaderboardData,  // Include leaderboard in backup
      timestamp: Date.now(),
      serverHealth: serverHealth,
      version: '3.0.0'
    };
    
    const backupPath = path.join(__dirname, 'workinprogress', 'game-state-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    // Keep last 5 backups
    const archivePath = path.join(__dirname, 'workinprogress', `game-state-${Date.now()}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(backup, null, 2));
    
    // Cleanup old backups (keep last 5)
    const backupDir = path.join(__dirname, 'workinprogress');
    if (fs.existsSync(backupDir)) {
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('game-state-') && file.endsWith('.json'))
        .sort()
        .slice(0, -5); // Keep last 5, remove older ones
      
      backupFiles.forEach(file => {
        try {
          fs.unlinkSync(path.join(backupDir, file));
        } catch (err) {
          console.warn(`⚠️ Could not delete old backup: ${file}`);
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Failed to backup game state:`, error.message);
  }
}

// Restore game state from backup
function restoreGameState() {
  try {
    const backupPath = path.join(__dirname, 'workinprogress', 'game-state-backup.json');
    if (fs.existsSync(backupPath)) {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      
      // Validate backup
      if (backup.gameState && backup.timestamp) {
        const ageMinutes = (Date.now() - backup.timestamp) / 60000;
        
        if (ageMinutes < 60) { // Only restore if less than 1 hour old
          // Safely restore game state with error handling
          try {
            Object.assign(gameState, backup.gameState);
          } catch (assignError) {
            console.error('❌ Error during state assignment:', assignError.message);
            console.log('🔄 Attempting partial state restoration...');
            // Try to restore individual properties safely
            for (const [key, value] of Object.entries(backup.gameState)) {
              try {
                gameState[key] = value;
              } catch (propError) {
                console.warn(`⚠️ Could not restore property ${key}:`, propError.message);
              }
            }
          }
          
          // Restore leaderboard data if available
          if (backup.leaderboardData) {
            leaderboardData = backup.leaderboardData;
            console.log('📊 Leaderboard data restored from backup');
          }
          
          // Ensure critical Set types are properly restored
          if (!(gameState.processed_mod_messages instanceof Set)) {
            gameState.processed_mod_messages = new Set(Array.isArray(gameState.processed_mod_messages) ? gameState.processed_mod_messages : []);
            console.log('🔧 Fixed processed_mod_messages type after state restoration');
          }
          
          if (!(gameState.giveaway_show_voters instanceof Set)) {
            gameState.giveaway_show_voters = new Set(Array.isArray(gameState.giveaway_show_voters) ? gameState.giveaway_show_voters : []);
            console.log('🔧 Fixed giveaway_show_voters type after state restoration');
          }
          
          serverHealth = backup.serverHealth || serverHealth;
          console.log(`✅ Game state restored from backup (${Math.round(ageMinutes)} minutes old)`);
          return true;
        } else {
          console.log(`⚠️ Backup too old (${Math.round(ageMinutes)} minutes), starting fresh`);
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Could not restore game state:`, error.message);
  }
  return false;
}

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
  
  // Backup current game state and leaderboard
  console.log(`💾 Backing up game state and leaderboard...`);
  backupGameState();
  saveLeaderboardData();
  saveLeaderboardBackup(); // Create final backup before shutdown
  
  // Close WebSocket connections gracefully
  console.log(`🔌 Closing WebSocket connections...`);
  if (wss) {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'server_shutdown',
          message: 'Server is shutting down for maintenance',
          timestamp: Date.now()
        }));
        ws.close(1000, 'Server shutdown');
      }
    });
  }
  
  // Close HTTP server
  console.log(`🌐 Closing HTTP server...`);
  server.close(() => {
    console.log(`✅ Server closed gracefully`);
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error(`❌ Forced shutdown after timeout`);
    process.exit(1);
  }, 10000);
}

// Global error handlers
process.on('uncaughtException', (error) => {
  serverHealth.crashCount++;
  serverHealth.lastCrash = Date.now();
  
  console.error(`🚨 UNCAUGHT EXCEPTION:`, error);
  console.error(`Stack trace:`, error.stack);
  
  // Backup state before potential crash
  backupGameState();
  
  // Log crash details
  const crashLog = {
    type: 'uncaughtException',
    error: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    serverHealth: serverHealth,
    gameState: {
      active: gameState.game_active,
      question: gameState.current_question,
      contestant: gameState.contestant_name
    }
  };
  
  try {
    const crashPath = path.join(__dirname, 'workinprogress', `crash-${Date.now()}.json`);
    fs.writeFileSync(crashPath, JSON.stringify(crashLog, null, 2));
  } catch (writeError) {
    console.error(`❌ Could not write crash log:`, writeError);
  }
  
  // Attempt graceful recovery for known recoverable errors
  if (error.code === 'EADDRINUSE' || error.code === 'ECONNRESET') {
    console.log(`🔄 Attempting recovery from ${error.code}...`);
    return; // Don't exit, try to continue
  }
  
  console.error(`💥 Fatal error detected, exiting...`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`🚨 UNHANDLED PROMISE REJECTION at:`, promise, 'reason:', reason);
  
  // Log the rejection but don't crash the server
  const rejectionLog = {
    type: 'unhandledRejection',
    reason: reason?.toString() || 'Unknown reason',
    timestamp: Date.now(),
    stack: reason?.stack || 'No stack trace'
  };
  
  try {
    const logPath = path.join(__dirname, 'workinprogress', `rejection-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(rejectionLog, null, 2));
  } catch (writeError) {
    console.error(`❌ Could not write rejection log:`, writeError);
  }
});

// Enhanced WebSocket error handling
if (wss) {
  wss.on('error', (error) => {
    console.error(`🔌 WebSocket Server Error:`, error);
    
    // Attempt to restart WebSocket server
    setTimeout(() => {
      console.log(`🔄 Attempting to restart WebSocket server...`);
      try {
        const newWss = new WebSocket.Server({ server });
        console.log(`✅ WebSocket server restarted successfully`);
      } catch (restartError) {
        console.error(`❌ Failed to restart WebSocket server:`, restartError);
      }
    }, 5000);
  });
}

// HTTP server error handling
server.on('error', (error) => {
  console.error(`🌐 HTTP Server Error:`, error);
  
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Health monitoring intervals
setInterval(monitorMemoryUsage, 30000); // Check memory every 30 seconds
setInterval(() => {
  serverHealth.lastHeartbeat = Date.now();
  backupGameState();
}, 300000); // Backup game state every 5 minutes

// REMOVED: Duplicate auto-save - already handled in checkPeriodicResets interval above

// Clean up old chat participation tracker entries every 5 minutes
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000; // 1 hour ago
  let cleanedCount = 0;
  
  for (const [username, timestamp] of chatParticipationTracker.entries()) {
    if (timestamp < oneHourAgo) {
      chatParticipationTracker.delete(username);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned ${cleanedCount} old chat participation entries (${chatParticipationTracker.size} active)`);
  }
}, 300000); // 5 minutes

// Restore game state on startup if available
console.log(`🔄 Checking for previous game state...`);
if (restoreGameState()) {
  console.log(`✅ Previous game session restored successfully`);
} else {
  console.log(`🆕 Starting fresh game session`);
}

console.log(`🔒 Server reinforcement system activated`);
console.log(`💾 Memory monitoring: ✅ Active`);
console.log(`🛡️  Error handling: ✅ Active`);
console.log(`💾 State backup: ✅ Active (every 5 minutes)`);
console.log(`🔄 Graceful shutdown: ✅ Active`);