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

// Debug flag for lifeline voting - set to false in production for performance
const DEBUG_LIFELINE_VOTING = false; // Enable only when debugging voting issues

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
  answerHistory: [],  // Track answer results for each question: {questionIndex: 0, result: 'correct'|'wrong'|null}
  typewriter_animation_complete: false,  // Track if typewriter animation has completed
  gameshow_participants: [], // Array of unique usernames who voted during this gameshow
  credits_rolling: false,    // Flag for credits display state  
  credits_scrolling: false,  // Flag for credits scrolling animation
  // Lifeline states
  first_poll_winner: null,   // Track which answer won the first poll for revote system
  is_revote_active: false,   // Flag for "Take Another Vote" revote system
  excluded_answers: [],      // Array of answer indices excluded in revote
  // Lifeline voting states for audience help when answer is wrong
  lifeline_voting_active: false,     // Flag for lifeline voting mode
  lifeline_votes: [],                // Array of lifeline votes: {username, lifeline, timestamp}
  lifeline_voter_history: [],        // Track who has voted to prevent duplicates
  available_lifelines_for_vote: [],  // Array of available lifelines (not used yet)
  lifeline_vote_winner: null,        // Winning lifeline after vote (fiftyFifty, askAudience, askAMod)
  lifeline_vote_counts: {            // Vote counts for each lifeline
    fiftyFifty: 0,
    askAudience: 0,
    askAMod: 0
  },
  // Ask a Mod lifeline states
  ask_a_mod_active: false,           // Flag for Ask a Mod active period
  mod_responses: [],                 // Array of mod responses: {username, message, timestamp}
  ask_a_mod_start_time: null,        // Timestamp when Ask a Mod started
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
  // Mod message deduplication tracking
  processed_mod_messages: new Set(),       // Track processed moderator messages to prevent duplicates (format: "username:timestamp:message")
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
  giveaway_show_voters: new Set()           // Track users who voted during the show for 3x weight bonus
};

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

// Twitch Emote Definitions mirror the production list
const TWITCH_EMOTES = require('../emotes-update.js');

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
function startGiveawayTimer() {
  // Clear any existing timer
  if (giveawayTimerInterval) {
    clearInterval(giveawayTimerInterval);
  }
  
  // Send timer updates every second
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
  
  // Serve browser source with dynamic overlay selection
  if (pathname === '/gameshow' || pathname === '/browser-source') {
    // Serve the new static HTML file instead of embedded content
    const filePath = path.join(__dirname, 'static', 'gameshow.html');
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Gameshow HTML file not found:', filePath);
        res.writeHead(500);
        res.end('Gameshow HTML file not found');
        return;
      }
      
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache', // Don't cache for development
        'Access-Control-Allow-Origin': '*' // Allow cross-origin for OBS
      });
      res.end(data);
      console.log('🎮 Served gameshow HTML from static files');
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
  
  // Static file serving for extracted content
  if (pathname.startsWith('/static/')) {
    const filePath = path.join(__dirname, 'static', pathname.substring('/static/'.length));
    
    try {
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
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
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
      return;
    } catch (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
  }

  // Handle requests to root - redirect to /gameshow
  if (pathname === '/') {
    res.writeHead(302, { 'Location': '/gameshow' });
    res.end();
    return;
  }
  
  // Default 404 for any other requests
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>404 - Page Not Found</h1></body></html>');
});

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
