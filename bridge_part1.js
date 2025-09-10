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

// Twitch Emote Definitions for chat display
const TWITCH_EMOTES = {
  // Original emotes from first list
  'k1m6aClipit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c6a0b28a6a5548c8b64698444174173a/default/dark/2.0',
  'k1m6aChef': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_24c6bfc0497a4c96892cf3c3bc01fe48/default/dark/2.0',
  'k1m6aCo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5b17cf73d7d5417aa8f37b8bb9f6e0fe/default/dark/2.0',
  'k1m6aHappyJam': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1e21c9ad16cf4ffa8f8e73df44d4e58f/default/dark/2.0',
  'k1m6aHorse': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ef95fef0a0d74e6db614d4dac82b8f5f/default/dark/2.0',
  'k1m6aHotel': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f3e5e68ba91c4fb3beeaaa69ad14e51f/default/dark/2.0',
  'k1m6aLove': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_767294f4fbf14deaa65487efb5e11b55/default/dark/2.0',
  'k1m6aJam': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e849d7766e9e4293a881e75f8139552c/default/dark/2.0',
  'k1m6aLul': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_04f3c7fe0428460e855cbd6a62aa8b07/default/dark/2.0',
  'k1m6aBaby': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e36e16f7e6304e949de83f92e4e7d8bb/default/dark/2.0',
  'k1m6aLeech': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b40ba59b36084f7db37e88c0b4fce24f/default/dark/2.0',
  'k1m6aSteer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7f852081c9a14efe9bde161c4359a528/default/dark/2.0',
  'k1m6aKk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2e32b96c8e77461c857c0e90de1f9d4f/default/dark/2.0',
  'k1m6aTrain': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4cf670d5fa8242ebab89a6ab5c616771/default/dark/2.0',
  'k1m6aDj': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8cf31502415443788a03fe3aefc1a7af/default/dark/2.0',
  'k1m6aBlock': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_45bbf656cd1c42e3ab9d2bb614dc6b2e/default/dark/2.0',
  'k1m6aPalmtree': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a1dfffa070c6420d9b673b3b1f1f0acf/default/dark/2.0',
  'k1m6aPizza': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ab88a0dbf28c486d8e079e23e973e83f/default/dark/2.0',
  'k1m6aSunshine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e1f21e4e7fea439a9b36f0ba02b0e7ee/default/dark/2.0',
  'k1m6aPsgjuice': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ea0ac815167448e7a1cafde20fe93427/default/dark/2.0',
  'k1m6aSmile': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3fea13ba7b5e455a93cc959dfb0e0c86/default/dark/2.0',
  'k1m6aGlizz': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b1a067c85b2349ffa1e1b6e39f8e4bc6/default/dark/2.0',
  'k1m6aChin': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cae4cf9b3de842b995f5ba982f7bb370/default/dark/2.0',
  'k1m6aNoshot': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e06de7c832b0440b8f96ba067b9fbb96/default/dark/2.0',
  'k1m6aSalute': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b6e561b15bb1485683e3bdb862204b49/default/dark/3.0',
  'k1m6aShotty': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f30f82c8e6de4b2e92797ab59f2df36e/default/dark/2.0',
  'k1m6aMonkey': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d91f03c0cc35425db3cf7f8b83025595/default/dark/2.0',
  'k1m6aShiba': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_63c1e5f3b8ca4c72827297e6f03bb53e/default/dark/2.0',
  'k1m6aSpray': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1cf332c5e73b45e18d23f95c1c6cf2f5/default/dark/2.0',
  'k1m6aRice': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_78ae7cdf89814354a09a50be08d9ea22/default/dark/2.0',
  'k1m6aBowl': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f1322c73e93a4bb08897fb50802e0cd2/default/dark/2.0',
  'k1m6aWine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1a0b4c33bb92417e855dc8cdb06d46da/default/dark/2.0',
  'k1m6aCheer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d1ae4b977a2c40b5b6f8acef7fa17cd1/default/dark/2.0',
  'k1m6aChew': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b3a97a6dea0e415993b5b666e5f69e95/default/dark/2.0',
  'k1m6aDrop': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_83e1e1e0b09e46ed89802d98dc1c00ce/default/dark/2.0',
  'k1m6aGreenscreen': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_30dcf8de63fb4b9fb891bbaf95cca80a/default/dark/2.0',
  'k1m6aStupid': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_96c07f1a9c96426bbfdf1e1bc4f99c04/default/dark/2.0',
  'k1m6aLongbeach': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_9e012ced913a412a9cbfb973d8e5b3a7/default/dark/2.0',
  'k1m6aNotb': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_24a1a1d0b2f64b659ca09b6e88d09fb1/default/dark/2.0',
  'k1m6aMatcha': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3b26cf9fbe9f4bc58a860f7f5f616ef7/default/dark/2.0',
  'k1m6aLetcook': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dbe732bb16254bb7876caf1b6b1c14f1/default/dark/2.0',
  'k1m6aMuni': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f3c5f4f2bf9848b4851e5c7d30c10f76/default/dark/2.0',
  'k1m6aFb': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_97b2b18b37e9485099ad7c12a8fa47f5/default/dark/2.0',
  'k1m6aRamen': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1b2b93f1cf6543b495e969f51e6fda31/default/dark/2.0',
  'k1m6aSoju': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7090e951f6a14bc5b7ef2e5ea37dc970/default/dark/2.0',
  'k1m6aIce': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ee70fe2c3e5948e09d973f4dd6c614f0/default/dark/2.0',
  'k1m6aEarl': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2f2c957e3a2d4eb7849fc6e26fa2ec4b/default/dark/2.0',
  'k1m6aCoomer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e088b65bb2cf472d9b4e6a52d616e6fa/default/dark/2.0',
  'k1m6aFunkycoomer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_fd7ee96c00ef4063825f9b48eceeed66/default/dark/2.0',
  'k1m6aObo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4fefa69bb6db469097eeb8bb99987c2a/default/dark/2.0',
  'k1m6aOk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d63f079b08ee4dffbc44e73dcff2b10f/default/dark/2.0',
  'k1m6aSnore': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f26e1f8b15ad49c7afd18c89abaab22f/default/dark/2.0',
  'k1m6aRun': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3b0ad39b67fa4c57ac7f4f87f2cc2b4f/default/dark/2.0',
  'k1m6aCake': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d7f0b4e5aa174fc3a19e646c4c8aa48f/default/dark/2.0',
  'k1m6aEgg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e2a7e67a7e914c97a9bb646d8e7c62e3/default/dark/2.0',
  'k1m6aJj': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7a9f670b0cf54b5c9cf6f7b5ad0a4f42/default/dark/2.0',
  'k1m6aFrog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_fad59febe61647e099b1e81e1fdb8a8f/default/dark/2.0',
  'k1m6aHeart': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d088de4a03514f59a566f0ad97de0595/default/dark/2.0',
  'k1m6aChamp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dca4c5f1b0b943c7849d5a85fb6c2dcc/default/dark/2.0',
  'k1m6aBoom': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_aff4b7cb58094f6fb95f95e2bdf3f7f8/default/dark/2.0',
  'k1m6aSick': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c4e3c7c67c2a495198ea9cc982e31dd7/default/dark/2.0',
  'k1m6aFr': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e1cf1c28f98d49c6bfba50c80ee82b5f/default/dark/2.0',
  'k1m6aFrr': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1e25e5c8eeb04e839d34c1b0ea58a6a5/default/dark/2.0',
  'k1m6aPink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b0e35b17a63d4dd78ac1cf6d14f9cf5e/default/dark/2.0',
  'k1m6aReally': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_66f27cd5cf764bb2ad4e8d52bfa3c9ba/default/dark/2.0',
  'k1m6aStand': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_96f1e74bb7fc4d42ad842a9c0e7fb1e9/default/dark/2.0',
  'k1m6aShip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a860feac7bff4e7587e6e8bb2b6aac68/default/dark/2.0',
  'k1m6aWoody': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_67feaf4b70224bc4adff7db8b893bf37/default/dark/2.0',
  'k1m6aWiggle': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b1bf32c01cf146ba83da3b4b8c5ced17/default/dark/2.0',
  'k1m6aWink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4b1c6e88c6254c129ed64e4ea3b69e1b/default/dark/2.0',
  'k1m6aWow': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f7ef5bfe0c3942c89f35f2a6b9c42c7e/default/dark/2.0',
  'k1m6aZen': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4896b4cd0b26433abc0f09bb04a72de1/default/dark/2.0',
  // Additional emotes from updated list
  'k1m6aCarried': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_68877ffd62914c0baf656683a56885e3/default/dark/2.0',
  'k1m6aBonk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_6d4a3720c4ca4553a9f7d09ecc228d1c/default/dark/2.0',
  'k1m6aBlind': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_008fc17538c54d7baf69325b406d421b/default/dark/2.0',
  'k1m6aBlade': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d4688e604455438e990eda8bfe386621/default/dark/2.0',
  'k1m6aBan': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a09c3654c25f4a9194ac04951e867285/default/dark/2.0',
  'k1m6aAstronaut': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c261a2bf5aef4f20a05876f12acfde0b/default/dark/2.0',
  'k1m6a1010': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8948832ab3834d34bd62ade32a697858/default/dark/2.0',
  'k1m6aCrab': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5bcd86cb8351436c84a5a90927e91d2a/default/dark/2.0',
  'k1m6aCozy': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_10002a6ae9cc4f50a5ca94949ca4a096/default/dark/2.0',
  'k1m6aCopium': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5eca88a8751f4a04b5882b70304e4053/default/dark/2.0',
  'k1m6aCool': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_19d1d2370d7e49d08926d9c40f1cf699/default/dark/2.0',
  'k1m6aConfused': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1d50d00f2a1444f4a4952f3aaf562ede/default/dark/2.0',
  'k1m6aCoffeesip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_116a23cc11734b41b27f6f922b62f630/default/dark/2.0',
  'k1m6aCoffee': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_413469c842154f72853b651c6db8c0f4/default/dark/2.0',
  'k1m6aClown': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b289f3411b9b4ccc862385d4d20c26a0/default/dark/2.0',
  'k1m6aDerp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_681daf912abc479980401475f6b9c082/default/dark/2.0',
  'k1m6aDevil': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a370f93b4f9744989b2ab2d357dd061c/default/dark/2.0',
  'k1m6aDoit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f6971cbe0867419085814dd09ba3ee2f/default/dark/2.0',
  'k1m6aFacepalm': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5db4850780504895ab219bdcd03339ab/default/dark/2.0',
  'k1m6aFail': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0435ef9b206b459aae88657265db15a8/default/dark/2.0',
  'k1m6aFine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e9eaecce2b094260b0f4b39bc95b70d0/default/dark/2.0',
  'k1m6aFlower': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_9440e8eae9e44659b39c3380007b05cd/default/dark/2.0',
  'k1m6aGasm': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_26ae96c88de64ecab0f5deab4643caff/default/dark/2.0',
  'k1m6aGasp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8ee142074d2f41429ffc803ff890a290/default/dark/2.0',
  'k1m6aGg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_6d97ed643b5a4e19a7ce156a02dede7c/default/dark/2.0',
  'k1m6aGhost': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ec96872a82c34e32bf3d9729647ed717/default/dark/2.0',
  'k1m6aGift': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b0b9ae66f2b74b6fbdab36669ab9a25e/default/dark/2.0',
  'k1m6aGrinch': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4dea8452193446d3bc8abe1ae9d79095/default/dark/2.0',
  'k1m6aHotdog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3dd3518f01584e1b89401adebc037035/default/dark/2.0',
  'k1m6aHug': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2650294ab5c14ad789210a5002178c6b/default/dark/2.0',
  'k1m6aHydrate': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c1b78e615a1e4cf9b84566d1e00eebd2/default/dark/2.0',
  'k1m6aHype': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8aa322d7459e4f86aa65fef5fe5880fb/default/dark/2.0',
  'k1m6aJason': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_85afabbfc15e49c69c9064ae5b8bd6bd/default/dark/2.0',
  'k1m6aKekw': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_48b672a057f74de0b953f7004c66d8b9/default/dark/2.0',
  'k1m6aL': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a383d8c68a0444dd8e2bf1b9ee0b3c30/default/dark/2.0',
  'k1m6aLearn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_95fb44fddcaf48069e02f4ef5d84ff82/default/dark/2.0',
  'k1m6aLettuce': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_33109ae4e55d45838bf0895d226a8a8c/default/dark/2.0',
  'k1m6aLurk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dbcaac379c324382b41b6fbc716f3966/default/dark/2.0',
  'k1m6aMod': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ca20669eb3d9410dbe6907d3fb427fd5/default/dark/2.0',
  'k1m6aMoney': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e84f0755bec84b8da286011bcf9503d1/default/dark/2.0',
  'k1m6aNo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e555a2b5667e4a73bc55f163ff1a6fc9/default/dark/2.0',
  'k1m6aPat': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_300ed456269c49928bc5d0db072a9c95/default/dark/2.0',
  'k1m6aPew': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d763ee290c774744a6b006754ae6b52b/default/dark/2.0',
  'k1m6aPixel': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cc583397b8d14507af71592fc3b15c2b/default/dark/2.0',
  'k1m6aPog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_03b9318aa256404590085b7aad65eb82/default/dark/2.0',
  'k1m6aPopcorn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_bfdfdcf6304e4ec4a4890449601cc0ba/default/dark/2.0'
};

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
