// Kimbillionaire Gameshow Client-Side JavaScript
// Extracted from bridge-server.js for code refactoring

// Configuration and initial state
const API_BASE = '';
let currentState = {};
// Note: questions and prizeAmounts are loaded dynamically from the server
let questions = []; // Will be loaded from API
let prizeAmounts = []; // Will be loaded from API

// Pro Tips for display in info panel
const proTips = [
    "💡 Pro Tip: Type A, B, C, or D in chat to vote for your answer!",
    "💡 Pro Tip: The audience is usually right - trust the majority!",
    "💡 Pro Tip: 50:50 eliminates two wrong answers instantly!",
    "💡 Pro Tip: Take Another Vote gives you a second chance with the audience!",
    "💡 Pro Tip: Ask a Mod gets help from experienced moderators!",
    "💡 Pro Tip: Collect a prize with every correct answer!",
    "💡 Pro Tip: Prizes increase in value as questions get harder!",
    "💡 Pro Tip: You keep all prizes won, even if you get one wrong!",
    "💡 Pro Tip: Work together in chat to find the right answer!",
    "💡 Pro Tip: Vote quickly - the timer doesn't stop!",
    "💡 Pro Tip: Press H to toggle the How to Play panel!",
    "💡 Pro Tip: Lifelines can save you on tough questions!",
    "💡 Pro Tip: Each lifeline can only be used once per game!",
    "💡 Pro Tip: The final question wins the grand prize!",
    "💡 Pro Tip: Stay calm under pressure - think before you lock!"
];

let currentTipIndex = 0;
let tipRotationInterval = null;

// Track answer states for voting display
let eliminatedAnswers = []; // Answers eliminated by 50:50 lifeline
let previousWrongAnswers = []; // Wrong answers tried in current question
let currentQuestionAnswerStates = {
    A: 'available', // available, eliminated, wrong, locked
    B: 'available',
    C: 'available',
    D: 'available'
};

// Game Tips System
const gameTips = [
    { icon: "💡", title: "VOTING TIP", message: "Type A, B, C, or D in chat to vote!", details: "Your vote counts during audience polls - make your voice heard!" },
    { icon: "🏆", title: "PRIZE LADDER", message: "15 Questions to $1 Million!", details: "Each correct answer moves you closer to the grand prize!" },
    { icon: "🛡️", title: "LIFELINES", message: "Three Lifelines Available", details: "⚡ 50:50 • Take Another Vote • Ask the Mods" },
    { icon: "⚡", title: "50:50 LIFELINE", message: "Eliminates Two Wrong Answers", details: "Type '1' when lifeline voting starts to choose 50:50!" },
    { icon: "🔄", title: "TAKE ANOTHER VOTE", message: "Get a Second Chance", details: "Type '2' to vote for another audience poll!" },
    { icon: "🛡️", title: "ASK THE MODS", message: "Expert Advice from Mods", details: "Type '3' to get help from our expert moderators!" },
    { icon: "📊", title: "AUDIENCE POWER", message: "Your Vote Matters!", details: "The audience collectively decides the answer - majority wins!" },
    { icon: "⏱️", title: "VOTING TIME", message: "60 Seconds to Vote", details: "Polls run for 1 minute - vote quickly to be counted!" },
    { icon: "🎯", title: "MILESTONE PRIZES", message: "Safety Nets at $1,000 and $32,000", details: "Reach these levels to guarantee minimum winnings!" },
    { icon: "💰", title: "PRIZE PROGRESSION", message: "Questions Get Harder", details: "Higher prizes mean tougher questions - stay sharp!" },
    { icon: "🎮", title: "STAY ENGAGED", message: "Watch for Voting Prompts", details: "The host will activate polls - be ready to participate!" },
    { icon: "🌟", title: "PERFECT GAME", message: "15 Correct = $1 Million!", details: "Can you help achieve the ultimate victory?" },
    { icon: "📱", title: "CHAT PARTICIPATION", message: "Use Chat to Play Along", details: "Type your answers when voting is active!" },
    { icon: "🎲", title: "STRATEGY TIP", message: "Save Lifelines for Harder Questions", details: "Lifelines are more valuable in later rounds!" },
    { icon: "👥", title: "COMMUNITY GAME", message: "Work Together to Win", details: "Combine knowledge with other viewers for success!" }
];

// Note: currentTipIndex and tipRotationInterval already declared above

// Load questions from server API
async function loadQuestions() {
    try {
        const response = await fetch('/api/questions');
        if (response.ok) {
            const data = await response.json();
            questions = data || [];
            console.log('📚 Loaded questions:', questions.length, 'questions');
            return true;
        } else {
            console.error('❌ Failed to load questions:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ Error loading questions:', error);
        return false;
    }
}

// Load prize amounts from server API
async function loadPrizeAmounts() {
    try {
        const response = await fetch('/api/prizes');
        if (response.ok) {
            const data = await response.json();
            prizeAmounts = data.prizes || [];
            console.log('💰 Loaded prize amounts:', prizeAmounts.length, 'levels');
            return true;
        } else {
            console.error('❌ Failed to load prizes:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ Error loading prizes:', error);
        return false;
    }
}

// WebSocket connection management
let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000;
let heartbeatInterval = null;
let lastHeartbeat = Date.now();
let missedHeartbeats = 0;

// Audio system
let audioSystem = null;

// Game elements
let isAnimating = false;
let pollTimer = null;
// Data loading management
let dataLoaded = false;  // Track if questions and prizes are loaded
let queuedStateUpdates = [];  // Queue for state updates that arrive before data loads
let countdownInterval = null;

// Initialize the gameshow when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🎮 Initializing Kimbillionaire gameshow...');
    
    // Load questions first
    console.log('📚 Loading questions from server...');
    const questionsLoaded = await loadQuestions();
    if (!questionsLoaded) {
        console.warn('⚠️ Could not load questions - questions may not display correctly');
    }
    
    // Load prize amounts
    console.log('💰 Loading prize amounts from server...');
    const prizesLoaded = await loadPrizeAmounts();
    if (!prizesLoaded) {
        console.warn('⚠️ Could not load prizes - money ladder may not display correctly');
    }
    
    // Mark data as loaded even if partially failed - we have fallback data
    // This ensures the display updates dynamically instead of staying static
    if (questionsLoaded || prizesLoaded) {
        console.log('✅ Data loading complete (questions:', questionsLoaded, ', prizes:', prizesLoaded, ')');
    } else {
        console.warn('⚠️ Neither questions nor prizes loaded, but continuing with fallback data');
    }
    
    // Always set dataLoaded to true so updates aren't blocked
    dataLoaded = true;
    console.log('🔓 Data loaded flag set - display updates enabled');
    
    // Fetch current state
    try {
        const response = await fetch('/api/state');
        if (response.ok) {
            const state = await response.json();
            currentState = state;
            console.log('🎮 Initial state loaded:', state);
            
            // If prizes are in the state, use them (fallback for when API fails)
            if (state.prizes && state.prizes.length > 0 && prizeAmounts.length === 0) {
                prizeAmounts = state.prizes;
                console.log('💰 Loaded prizes from game state:', prizeAmounts.length, 'levels');
            }
            
            // If questions are in the state, use them (fallback for when API fails)
            if (state.questions && state.questions.length > 0 && questions.length === 0) {
                questions = state.questions;
                console.log('📚 Loaded questions from game state:', questions.length, 'questions');
            }
            
            // Don't call individual update functions here - updateDisplay will handle it
        }
    } catch (error) {
        console.error('❌ Error loading initial state:', error);
    }
    
    // Process any queued state updates that arrived before data was loaded
    if (queuedStateUpdates.length > 0) {
        console.log(`📦 Processing ${queuedStateUpdates.length} queued state updates`);
        queuedStateUpdates.forEach(state => {
            console.log('🔄 Applying queued state update');
            currentState = state;
            updateDisplay(state);
        });
        queuedStateUpdates = [];  // Clear the queue
    }
    
    // Initialize audio system
    audioSystem = new GameshowAudioSystem();
    
    // Connect to WebSocket
    connectWebSocket();
    
    // FORCE QUESTION AREA TO BE VISIBLE AND SHOW WELCOME MESSAGE
    // This needs to happen BEFORE updateDisplay to ensure it's not overridden
    console.log('🎮 Forcing welcome message on initialization');
    const questionEl = document.getElementById('question-text');
    if (questionEl && !currentState.contestant_name && !currentState.game_active) {
        questionEl.textContent = 'Welcome to Kimbillionaire!';
        questionEl.style.fontSize = '32px';
        questionEl.style.opacity = '1';
        questionEl.style.display = 'block';
    }
    
    // Initial display update with all loaded data
    console.log('📊 Initial display update with loaded data');
    updateDisplay(currentState);
    
    // Don't show How to Play panel on initial load - only when contestant is newly set
    
    // Detect "stuck state" - when game/contestant state is invalid but nothing is showing
    // This happens when server has persisted state from a previous session
    console.log('🔍 Checking for stuck state:', {
        game_active: currentState.game_active,
        contestant_name: currentState.contestant_name,
        question_visible: currentState.question_visible,
        answers_visible: currentState.answers_visible,
        preparing_for_game: currentState.preparing_for_game
    });
    
    // Two types of stuck states:
    // 1. Game is active but nothing is showing
    // 2. Contestant exists but game isn't active and nothing is showing
    const nothingShowing = !currentState.question_visible && 
                          !currentState.answers_visible && 
                          !currentState.preparing_for_game;
    
    const isStuckWithActiveGame = currentState.game_active && nothingShowing;
    const isStuckWithContestant = currentState.contestant_name && !currentState.game_active && nothingShowing;
    
    if (isStuckWithActiveGame || isStuckWithContestant) {
        console.log('⚠️ Detected stuck state:', {
            activeGame: isStuckWithActiveGame,
            contestantNoGame: isStuckWithContestant
        });
        console.log('🎮 Forcing welcome message despite invalid game state');
        
        const questionEl = document.getElementById('question-text');
        if (questionEl) {
            questionEl.textContent = 'Welcome to Kimbillionaire!';
            questionEl.style.fontSize = '32px';
            questionEl.style.opacity = '1';
            questionEl.style.display = 'block';
            console.log('✅ Welcome message forced to display in stuck state');
        }
    }
    
    // Let CSS handle initial info area display
    console.log('🔧 Info area will use CSS defaults for display');
    // Removed forced display styles to prevent grid conflicts
    
    // Start game tips rotation if appropriate
    setTimeout(() => {
        // Give time for initial state to load
        console.log('🔍 DEBUG: Initial state check - currentState:', currentState);
        if (shouldShowTips(currentState)) {
            console.log('💡 Starting initial game tips rotation');
            startTipsRotation();
            // updateDisplay will handle info panel update
        } else {
            console.log('⚠️ DEBUG: Not showing tips initially');
            // updateDisplay will handle info panel update
        }
    }, 500);
    
    console.log('✅ Gameshow initialization complete');
    
    // Removed aggressive periodic visibility enforcer to prevent grid layout conflicts
});

// WebSocket connection function
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = function(event) {
            console.log('✅ WebSocket connected');
            reconnectAttempts = 0;
            reconnectDelay = 1000;
            missedHeartbeats = 0;
            
            // Register as browser source client
            ws.send(JSON.stringify({
                type: 'register',
                client: 'browser_source'
            }));
            console.log('📝 Registered as browser_source client');
            
            // Start heartbeat mechanism
            startHeartbeat();
            
            // Try to recover state from localStorage
            try {
                const savedState = localStorage.getItem('gameshow_last_state');
                if (savedState) {
                    const state = JSON.parse(savedState);
                    console.log('💾 Recovering from saved state');
                    handleWebSocketMessage({ type: 'state', ...state });
                }
            } catch (e) {
                console.warn('Could not recover from localStorage:', e);
            }
        };
        
        ws.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error);
            }
        };
        
        ws.onclose = function(event) {
            console.log('🔌 WebSocket disconnected:', event.code, event.reason);
            stopHeartbeat();
            scheduleReconnect();
        };
        
        ws.onerror = function(error) {
            console.error('❌ WebSocket error:', error);
        };
        
    } catch (error) {
        console.error('❌ Error creating WebSocket connection:', error);
        scheduleReconnect();
    }
}

// Schedule WebSocket reconnection
function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        console.error('❌ Maximum reconnection attempts reached');
        return;
    }
    
    reconnectAttempts++;
    
    console.log(`🔄 Scheduling reconnection attempt ${reconnectAttempts} in ${reconnectDelay}ms`);
    
    setTimeout(() => {
        connectWebSocket();
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); // Max 30 seconds
    }, reconnectDelay);
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    console.log('📨 Received message:', message.type);
    
    // Reset heartbeat on any message
    lastHeartbeat = Date.now();
    missedHeartbeats = 0;
    
    switch (message.type) {
        case 'pong':
            // Server responded to ping
            console.log('💓 Heartbeat pong received');
            return; // Don't process further
        case 'state':
            const previousContestant = currentState.contestant_name;
            const previousGameActive = currentState.game_active;
            
            // Check if this is a full sync from late connection
            if (message.fullSync) {
                console.log('🔄 Received full state sync after connection');
                // Store in localStorage for recovery
                try {
                    localStorage.setItem('gameshow_last_state', JSON.stringify(message));
                } catch (e) {
                    console.warn('Could not save state to localStorage:', e);
                }
            }
            
            console.log('📊 State update received:', {
                previousContestant: previousContestant,
                newContestant: message.data?.contestant_name || message.contestant_name,
                gameActive: message.data?.game_active || message.game_active,
                fullSync: message.fullSync || false
            });
            
            currentState = message.data || message;
            
            // Show How to Play panel ONLY when contestant is newly set (and game not active)
            if (currentState.contestant_name && !currentState.game_active) {
                // Only show if contestant was JUST set (wasn't set before)
                if (!previousContestant && currentState.contestant_name) {
                    console.log('📖 Contestant newly set and game not active - showing How to Play panel');
                    showHowToPlay();
                } else {
                    console.log('📖 How to Play conditions not met:', {
                        hasContestant: !!currentState.contestant_name,
                        wasEmpty: !previousContestant,
                        gameNotActive: !currentState.game_active
                    });
                }
            }
            
            // Hide How to Play panel when game starts
            if (currentState.game_active && !previousGameActive) {
                console.log('🎮 Game started - hiding How to Play panel');
                hideHowToPlay();
            }
            
            // Also hide if contestant is cleared
            if (!currentState.contestant_name && previousContestant) {
                console.log('📖 Contestant cleared - hiding How to Play panel');
                hideHowToPlay();
            }
            
            // Handle credits display
            if (currentState.credits_rolling) {
                console.log('🎬 Credits rolling state detected');
                if (!currentState.credits_displayed) {
                    showCredits(currentState.gameshow_participants || []);
                    currentState.credits_displayed = true;
                }
            } else if (!currentState.credits_rolling && currentState.credits_displayed) {
                hideCredits();
                currentState.credits_displayed = false;
            }
            
            // CRITICAL FIX: Always update info panel when state changes
            updateInfoPanel(currentState);
            console.log('📊 Updated info panel from state message');
            
            // Update audience choice display when poll winner is shown
            updateAudienceChoiceDisplay(currentState);
            
            // If prizes are in the state and we don't have them yet, load them
            if (currentState.prizes && currentState.prizes.length > 0 && prizeAmounts.length === 0) {
                prizeAmounts = currentState.prizes;
                console.log('💰 Loaded prizes from WebSocket state:', prizeAmounts.length, 'levels');
            }
            
            // Check if data is loaded before updating display
            if (!dataLoaded) {
                console.log('⏳ Data not loaded yet, queueing state update');
                queuedStateUpdates.push(currentState);
            } else {
                updateDisplay(currentState);
                // Update answer states based on game state
                if (currentState.eliminated_answers) {
                    eliminatedAnswers = currentState.eliminated_answers;
                    updateAnswerStates('eliminated', eliminatedAnswers);
                }
                if (currentState.answer_is_wrong && currentState.selected_answer !== null) {
                    // Track the wrong answer if it's not already tracked
                    const wrongAnswer = ['A', 'B', 'C', 'D'][currentState.selected_answer];
                    if (!previousWrongAnswers.includes(wrongAnswer)) {
                        previousWrongAnswers.push(wrongAnswer);
                        updateAnswerStates('wrong', [wrongAnswer]);
                    }
                }
            }
            break;
        case 'game_state':
            const prevContestant = currentState.contestant_name;
            const prevGameActive = currentState.game_active;
            
            currentState = message;
            console.log('📡 Received game_state update:', {
                audience_poll_active: currentState.audience_poll_active,
                lifeline_voting_active: currentState.lifeline_voting_active,
                is_revote_active: currentState.is_revote_active,
                answers_visible: currentState.answers_visible
            });
            
            // Show How to Play panel ONLY when contestant is newly set (and game not active)
            if (currentState.contestant_name && !currentState.game_active) {
                // Only show if contestant was JUST set (wasn't set before)
                if (!prevContestant && currentState.contestant_name) {
                    console.log('📖 Contestant newly set and game not active - showing How to Play panel');
                    showHowToPlay();
                }
            }
            
            // Hide How to Play panel when game starts
            if (currentState.game_active && !prevGameActive) {
                console.log('🎮 Game started - hiding How to Play panel');
                hideHowToPlay();
            }
            
            // Also hide if contestant is cleared
            if (!currentState.contestant_name && prevContestant) {
                console.log('📖 Contestant cleared - hiding How to Play panel');
                hideHowToPlay();
            }
            
            // Handle credits display
            if (currentState.credits_rolling) {
                console.log('🎬 Credits rolling state detected');
                if (!currentState.credits_displayed) {
                    showCredits(currentState.gameshow_participants || []);
                    currentState.credits_displayed = true;
                }
            } else if (!currentState.credits_rolling && currentState.credits_displayed) {
                hideCredits();
                currentState.credits_displayed = false;
            }
            
            // CRITICAL FIX: Always update info panel when game state changes
            updateInfoPanel(currentState);
            console.log('📊 Updated info panel from game_state message');
            
            // Update audience choice display when poll winner is shown
            updateAudienceChoiceDisplay(currentState);
            
            // If prizes are in the state and we don't have them yet, load them
            if (currentState.prizes && currentState.prizes.length > 0 && prizeAmounts.length === 0) {
                prizeAmounts = currentState.prizes;
                console.log('💰 Loaded prizes from game_state:', prizeAmounts.length, 'levels');
            }
            
            // Check if data is loaded before updating display
            if (!dataLoaded) {
                console.log('⏳ Data not loaded yet, queueing game_state update');
                queuedStateUpdates.push(currentState);
            } else {
                updateDisplay(currentState);
            }
            // Update answer states based on game state
            if (currentState.eliminated_answers) {
                eliminatedAnswers = currentState.eliminated_answers;
                updateAnswerStates('eliminated', eliminatedAnswers);
            }
            if (currentState.answer_is_wrong && currentState.selected_answer !== null) {
                // Track the wrong answer if it's not already tracked
                const wrongAnswer = ['A', 'B', 'C', 'D'][currentState.selected_answer];
                if (!previousWrongAnswers.includes(wrongAnswer)) {
                    previousWrongAnswers.push(wrongAnswer);
                    updateAnswerStates('wrong', [wrongAnswer]);
                }
            }
            break;
            
        case 'audio_command':
            if (audioSystem) {
                audioSystem.handleCommand(message.command);
            }
            break;
            
        case 'audience_poll_started':
            handlePollStarted(message);
            break;
            
        case 'poll_update':
            handlePollUpdate(message);
            break;
            
        case 'audience_poll_ended':
            handlePollEnded(message);
            break;
            
        case 'lifeline_vote_update':
            handleLifelineVoteUpdate(message);
            break;
            
        case 'audience_poll_vote_update':
            handleAudiencePollVoteUpdate(message);
            break;
            
        case 'lifeline_voting_started':
            handleLifelineVotingStarted(message);
            break;
            
        case 'post_lifeline_revote':
            handlePostLifelineRevote(message);
            break;
            
        case 'post_ask_a_mod_revote':
            handlePostAskAModRevote(message);
            break;
            
        case 'giveaway_overlay':
            handleGiveawayOverlay(message);
            break;
            
        case 'chat_message':
            handleChatMessage(message);
            break;
            
        case 'roary_speech':
            handleRoarySpeech(message);
            break;
            
        case 'confetti':
        case 'confetti_trigger':
            triggerConfetti();
            break;
            
        case 'contestant_just_set':
            // Handle explicit contestant set event
            console.log('📖 Contestant just set event received:', message.contestant_name);
            // Always show How to Play panel when contestant is set (unless game is active)
            if (!currentState || !currentState.game_active) {
                console.log('📖 Showing How to Play panel for newly set contestant:', message.contestant_name);
                showHowToPlay();
            } else {
                console.log('📖 NOT showing How to Play - game is active:', currentState.game_active);
            }
            break;
            
        case 'lifeline_voting_countdown':
            handleLifelineVotingCountdown(message);
            break;
            
        case 'lifeline_voting_ended':
            handleLifelineVotingEnded(message);
            break;
            
        case 'hide_lifeline_voting_panel':
            handleHideLifelineVotingPanel(message);
            break;
            
        case 'reset_game':
        case 'game_reset':
            // Hide all voting displays when game resets
            console.log('🔄 Game reset - hiding all voting displays');
            const integratedVoting = document.getElementById('integrated-voting');
            if (integratedVoting) {
                integratedVoting.style.display = 'none';
            }
            const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
            if (lifelineVotingPanel) {
                lifelineVotingPanel.classList.add('hidden');
            }
            break;
            
        case 'prizes_updated':
            console.log('💰 Prizes updated from server');
            if (message.prizes && Array.isArray(message.prizes)) {
                prizeAmounts = message.prizes;
                console.log('💰 Updated prize amounts:', prizeAmounts.length, 'levels');
                // Update money ladder display with new prizes
                updateMoneyLadder(currentState);
            }
            break;
            
        case 'force_enable_answers':
            // Force enable answers button when browser source connects late
            console.log('🎯 Received force_enable_answers:', message.reason);
            const questionTextEl = document.getElementById('question-text');
            if (questionTextEl) {
                questionTextEl.dataset.animationInProgress = 'false';
            }
            // Send typewriter complete to enable answers
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'typewriter_complete',
                    timestamp: Date.now(),
                    forced: true
                }));
            }
            break;
            
        case 'clear_lifeline_effects':
            // Clear all answer states when moving to next question
            console.log('🔄 Clearing answer states for new question');
            eliminatedAnswers = [];
            previousWrongAnswers = [];
            currentQuestionAnswerStates = {
                A: 'available',
                B: 'available',
                C: 'available',
                D: 'available'
            };
            
            // Clear voting panel highlighting from previous question
            const voteOptions = document.querySelectorAll('.vote-option-integrated');
            voteOptions.forEach(option => {
                option.classList.remove('eliminated', 'previously-wrong', 'leading');
                // Clear any status text
                const statusEl = option.querySelector('.vote-status');
                if (statusEl) {
                    statusEl.textContent = '';
                }
            });
            console.log('🧹 Cleared voting panel highlighting for new question');
            
            // CRITICAL FIX: Clear ALL styles applied by 50:50 lifeline
            const letters = ['A', 'B', 'C', 'D'];
            letters.forEach(letter => {
                const answerEl = document.getElementById(`answer-${letter}`);
                if (answerEl) {
                    // Clear all elimination styles
                    answerEl.style.display = '';
                    answerEl.style.opacity = '';
                    answerEl.style.filter = '';
                    answerEl.style.pointerEvents = '';
                    answerEl.classList.remove('eliminated');
                    answerEl.classList.remove('wrong');
                    answerEl.classList.remove('correct');
                    
                    // Clear text decoration from answer text
                    const textEl = answerEl.querySelector('.answer-text');
                    if (textEl) {
                        textEl.style.textDecoration = '';
                        textEl.style.textDecorationColor = '';
                        textEl.style.textDecorationThickness = '';
                    }
                    
                    console.log(`✅ Cleared all lifeline effects from answer ${letter}`);
                }
            });
            
            // Update the voting display if it's visible
            if (isVotingActive) {
                updateIntegratedVoting();
            }
            break;
            
        case 'lifeline_triggered':
            // Handle 50:50 lifeline elimination
            if (message.lifeline === 'fiftyFifty' && message.eliminatedAnswers) {
                console.log('🎯 50:50 lifeline: Eliminating answers', message.eliminatedAnswers);
                // Convert indices to letters for display
                const eliminatedLetters = message.eliminatedAnswers.map(index => ['A', 'B', 'C', 'D'][index]);
                console.log('🚫 Converting eliminated indices', message.eliminatedAnswers, 'to letters', eliminatedLetters);
                eliminatedAnswers = message.eliminatedAnswers;
                updateAnswerStates('eliminated', eliminatedLetters);
            }
            // Handle Take Another Vote lifeline
            else if (message.lifeline === 'takeAnotherVote') {
                console.log('🗳️ Take Another Vote lifeline activated');
                console.log('🔄 Preserving selected answer highlighting:', message.preserveSelectedHighlighting);
                // The actual revote will be triggered by lifeline_revote_started or post_lifeline_revote messages
            }
            // Handle Ask a Mod lifeline
            else if (message.lifeline === 'askAMod') {
                console.log('🛡️ Ask a Mod lifeline activated');
                console.log('🔄 Starting mod response collection phase');
                // The mod response phase will be managed by ask_a_mod_started and related messages
            }
            break;
            
        case 'lifeline_revote_started':
            console.log('🔄 Lifeline revote started:', message.lifeline);
            if (message.lifeline === 'takeAnotherVote') {
                console.log('🗳️ Take Another Vote revote active - hybrid control mode');
                console.log('🎯 Message:', message.message);
            }
            break;
            
        case 'ask_a_mod_started':
        case 'ask_a_mod_activated':
            console.log('🛡️ Ask a Mod session started');
            console.log('📝 Duration:', message.duration, 'ms');
            console.log('🛡️ Waiting for moderator responses...');
            
            // Update current state
            if (!currentState) currentState = {};
            currentState.ask_a_mod_active = true;
            currentState.ask_a_mod_start_time = message.startTime || Date.now();
            currentState.ask_a_mod_duration = message.duration || 30000;
            currentState.ask_a_mod_include_vips = message.includeVips || false;
            
            // Show the mod response panel
            showModResponsePanel();
            break;
            
        case 'ask_a_mod_display_update':
            console.log('🛡️ Ask a Mod display update received');
            // Only call handleAskAModDisplayUpdate once - it handles both new and all responses
            handleAskAModDisplayUpdate(message);
            break;
            
        case 'ask_a_mod_ended':
            console.log('🛡️ Ask a Mod session ended');
            console.log('📊 Final responses collected:', message.totalResponses || 0);
            handleAskAModEnded(message);
            break;
            
        case 'post_lifeline_revote':
        case 'post_ask_a_mod_revote':
        case 'revote_started':
            console.log('🔄 Post-lifeline revote started');
            console.log('🎯 Message:', message.message);
            console.log('⏱️ Duration:', message.duration, 'ms');
            
            // CRITICAL FIX: Ensure lifeline voting is marked as inactive for revote
            currentState.lifeline_voting_active = false;
            currentState.is_revote_active = true;
            currentState.audience_poll_active = true;
            
            // Force hide the lifeline voting panel
            const votingPanel = document.getElementById('lifeline-voting-panel');
            if (votingPanel) {
                votingPanel.classList.add('hidden');
                console.log('✅ Force-hidden lifeline voting panel for revote');
            }
            
            // Update display to show revote
            updateInfoPanel(currentState);
            console.log('📊 Updated info panel for revote display');
            break;
            
        case 'answer_locked':
            // Track when an answer is locked
            if (message.answer) {
                updateAnswerStates('locked', [message.answer]);
            }
            break;
            
        case 'answer_revealed':
            // Track wrong answers during reveals
            if (message.isWrong && message.answer) {
                if (!previousWrongAnswers.includes(message.answer)) {
                    previousWrongAnswers.push(message.answer);
                    updateAnswerStates('wrong', [message.answer]);
                }
            }
            break;
            
        case 'revote_started':
            // During revote, maintain state of previously wrong answers
            console.log('🔄 Revote started - maintaining previous answer states');
            if (isVotingActive) {
                updateIntegratedVoting();
            }
            break;
            
        case 'mod_response_update':
            handleModResponseUpdate(message);
            break;
            
        // Removed duplicate ask_a_mod_display_update case - handled above
            
        case 'ask_a_mod_ended':
            handleAskAModEnded(message);
            break;
            
        case 'hot_seat_activated':
            handleHotSeatActivated(message);
            break;

        case 'hot_seat_profile_reveal_started':
            handleHotSeatProfileRevealStarted(message);
            break;

        case 'hot_seat_profile_countdown':
            handleHotSeatProfileCountdown(message);
            break;

        case 'hot_seat_profile_reveal_complete':
            handleHotSeatProfileRevealComplete(message);
            break;

        case 'hot_seat_entry_started':
            handleHotSeatEntryStarted(message);
            break;

        case 'hot_seat_entry_countdown':
            handleHotSeatEntryCountdown(message);
            break;

        case 'hot_seat_entry_update':
            handleHotSeatEntryUpdate(message);
            break;

        case 'hot_seat_no_entries':
            handleHotSeatNoEntries(message);
            break;

        case 'hot_seat_timer_update':
            handleHotSeatTimerUpdate(message);
            break;
            
        case 'hot_seat_answered':
            handleHotSeatAnswered(message);
            break;
            
        case 'hot_seat_timeout':
            handleHotSeatTimeout(message);
            break;
            
        case 'hot_seat_ended':
            handleHotSeatEnded(message);
            break;
            
        case 'leaderboard_update':
            handleLeaderboardUpdate(message);
            break;

        case 'show_leaderboard':
            showLeaderboard(message.period || 'current_game', message.data);
            break;
            
        case 'hide_leaderboard':
            hideLeaderboard();
            break;
            
        case 'show_endgame_leaderboard':
            showEndGameLeaderboard(message.winners, message.prizeConfig);
            break;
            
        case 'roll_credits':
            console.log('🎬 Received command to roll credits');
            startCreditsRoll();
            break;
            
        case 'confetti_trigger':
            if (message.command === 'create_massive_confetti') {
                createMassiveConfetti();
            }
            break;
            
        default:
            console.log('❓ Unknown message type:', message.type);
    }
}

// Gameshow Audio System Class
class GameshowAudioSystem {
    constructor() {
        this.applauseAudio = document.getElementById('applauseAudio');
        this.questionAudio = document.getElementById('questionAudio');
        this.tickAudio = document.getElementById('tickAudio');
        this.correctAudio = document.getElementById('correctAudio');
        this.wrongAudio = document.getElementById('wrongAudio');
        this.lockAudio = document.getElementById('lockAudio');
        
        this.setVolumes();
        console.log('🎵 Gameshow audio system initialized');
    }
    
    setVolumes() {
        if (this.applauseAudio) this.applauseAudio.volume = 0.8;
        if (this.questionAudio) this.questionAudio.volume = 0.6;
        if (this.tickAudio) this.tickAudio.volume = 0.4;
        if (this.correctAudio) this.correctAudio.volume = 0.7;
        if (this.wrongAudio) this.wrongAudio.volume = 0.7;
        if (this.lockAudio) this.lockAudio.volume = 0.6;
    }
    
    async playAudio(audioElement, filename) {
        if (!audioElement) return;
        
        try {
            audioElement.src = '/assets/audio/sfx/' + filename;
            audioElement.load();
            await audioElement.play();
            console.log('🎵 Playing audio:', filename);
        } catch (error) {
            console.error('❌ Failed to play audio:', filename, error);
        }
    }
    
    handleCommand(command) {
        switch (command) {
            case 'play_applause':
                this.playApplause();
                break;
            case 'play_question':
                this.playQuestion();
                break;
            case 'play_tick':
                this.playTick();
                break;
            case 'play_correct':
                this.playCorrect();
                break;
            case 'play_wrong':
                this.playWrong();
                break;
            case 'play_lock':
                this.playLockIn();
                break;
            case 'fade_question_music':
                this.fadeQuestionMusic();
                break;
            case 'stop_question_music':
                this.stopQuestionMusic();
                break;
            case 'stop_all_audio':
                this.stopAllAudio();
                break;
            default:
                console.warn('❓ Unknown audio command:', command);
        }
    }
    
    playApplause() { this.playAudio(this.applauseAudio, 'ApplauseSFX.wav'); }
    playQuestion() { this.playAudio(this.questionAudio, 'QuestionSFX.wav'); }
    playTick() { this.playAudio(this.tickAudio, 'tick.wav'); }
    playCorrect() { this.playAudio(this.correctAudio, 'correct.wav'); }
    playWrong() { this.playAudio(this.wrongAudio, 'wrong.wav'); }
    playLockIn() { this.playAudio(this.lockAudio, 'LockInAnswer.wav'); }
    
    fadeQuestionMusic() {
        if (!this.questionAudio) return;
        
        console.log('🎵 Fading out question music...');
        
        // Store original volume to restore later
        const originalVolume = 0.6;
        let currentVolume = this.questionAudio.volume;
        
        // Create smooth fade over 2 seconds
        const fadeInterval = setInterval(() => {
            currentVolume -= 0.02; // Decrease by 0.02 every 40ms (50 steps over 2 seconds)
            
            if (currentVolume <= 0) {
                currentVolume = 0;
                this.questionAudio.volume = 0;
                this.questionAudio.pause(); // Pause to save resources
                clearInterval(fadeInterval);
                console.log('🎵 Question music faded out completely');
            } else {
                this.questionAudio.volume = currentVolume;
            }
        }, 40); // Update every 40ms for smooth fade (25 updates per second)
        
        // Store the interval ID in case we need to cancel it
        this.fadeInterval = fadeInterval;
    }
    
    stopQuestionMusic() {
        if (!this.questionAudio) return;
        
        console.log('🛑 Stopping question music immediately');
        
        // Clear any ongoing fade
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
        
        // Stop the audio immediately
        this.questionAudio.pause();
        this.questionAudio.currentTime = 0;
        this.questionAudio.volume = 0.6; // Reset to default volume for next play
    }
    
    stopAllAudio() {
        console.log('🔇 Stopping all audio');
        
        // Clear any ongoing fade
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
        
        // Stop all audio elements
        const audioElements = [
            this.applauseAudio,
            this.questionAudio,
            this.tickAudio,
            this.correctAudio,
            this.wrongAudio,
            this.lockAudio
        ];
        
        audioElements.forEach(audio => {
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
            }
        });
        
        // Reset volumes to defaults
        this.setVolumes();
    }
}

// Update display based on game state
function updateDisplay(state) {
    if (!state) return;
    
    console.log('🖥️ Updating display for question:', state.current_question, 'game_active:', state.game_active);
    
    // Update question display
    try {
        updateQuestionDisplay(state);
    } catch (error) {
        console.error('❌ Error updating question display:', error);
    }
    
    // Update answers display
    try {
        updateAnswersDisplay(state);
    } catch (error) {
        console.error('❌ Error updating answers display:', error);
    }
    
    // Update money ladder
    try {
        updateMoneyLadder(state);
    } catch (error) {
        console.error('❌ Error updating money ladder:', error);
    }
    
    // Update lifelines
    try {
        updateLifelines(state);
    } catch (error) {
        console.error('❌ Error updating lifelines:', error);
    }
    
    // Update contestant info
    try {
        updateContestantInfo(state);
    } catch (error) {
        console.error('❌ Error updating contestant info:', error);
    }
    
    // Handle curtains
    try {
        updateCurtains(state);
    } catch (error) {
        console.error('❌ Error updating curtains:', error);
    }
    
    // Update info panel last to prevent it from blocking other updates
    try {
        updateInfoPanel(state);
    } catch (error) {
        console.error('❌ Error updating info panel:', error);
    }
}

// Update question display
function updateQuestionDisplay(state) {
    const questionEl = document.getElementById('question-text');
    const subtextEl = document.getElementById('question-subtext');
    
    if (!questionEl) return;
    
    // Only hide question during lifeline voting, not audience polls
    if (state.lifeline_voting_active) {
        questionEl.textContent = '';
        if (subtextEl) {
            subtextEl.classList.add('hidden');
            subtextEl.classList.remove('waiting-animation');
        }
        return; // Exit early during lifeline voting only
    }
    
    // Try to get question from state first (includes data from server), then fall back to local questions array
    const question = state.currentQuestionData || questions[state.current_question];
    
    if (state.question_visible && question) {
        
        if (subtextEl) {
            subtextEl.classList.add('hidden');
            subtextEl.classList.remove('waiting-animation');  // Clean up animation class
        }
        
        // Use typewriter effect for dramatic reveal
        if (!questionEl.dataset.currentQuestion || questionEl.dataset.currentQuestion !== question.text) {
            // New question detected - clear voting panel highlighting
            console.log('🆕 New question detected, clearing voting panel states');
            const voteOptions = document.querySelectorAll('.vote-option-integrated');
            voteOptions.forEach(option => {
                option.classList.remove('eliminated', 'previously-wrong', 'leading');
                // Clear any status text
                const statusEl = option.querySelector('.vote-status');
                if (statusEl) {
                    statusEl.textContent = '';
                }
            });
            
            // Reset answer states for new question
            eliminatedAnswers = [];
            previousWrongAnswers = [];
            currentQuestionAnswerStates = {
                A: 'available',
                B: 'available',
                C: 'available',
                D: 'available'
            };
            
            // Cancel any existing animation
            if (questionEl.dataset.animationInProgress === 'true') {
                console.log('⚠️ Cancelling existing typewriter animation');
                return; // Don't start a new animation if one is in progress
            }
            
            questionEl.dataset.currentQuestion = question.text;
            questionEl.dataset.animationInProgress = 'true';
            
            // Add fallback timer in case typewriter gets stuck
            let typewriterFallbackTimer = setTimeout(() => {
                console.log('⚠️ Typewriter fallback timer triggered - forcing completion');
                questionEl.textContent = question.text;
                questionEl.classList.remove('typing');
                questionEl.dataset.animationInProgress = 'false';
                
                // Send completion message
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'typewriter_complete',
                        timestamp: Date.now(),
                        fallback: true
                    }));
                    console.log('📡 Sent typewriter_complete (fallback) message to server');
                }
            }, 8000); // 8 second fallback for safety
            
            typewriterEffect(questionEl, question.text, 60).then(() => {
                // Clear fallback timer since animation completed normally
                clearTimeout(typewriterFallbackTimer);
                console.log('✅ Question typewriter effect completed');
                questionEl.dataset.animationInProgress = 'false';
                
                // Send message to server that typewriter animation is complete
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'typewriter_complete',
                        timestamp: Date.now()
                    }));
                    console.log('📡 Sent typewriter_complete message to server');
                }
            }).catch((error) => {
                console.error('❌ Typewriter animation error:', error);
                questionEl.dataset.animationInProgress = 'false';
                // Fallback: just show the text
                questionEl.textContent = question.text;
            });
        }
    } else if (state.preparing_for_game) {
        // Only show "Get ready" text if no voting is active
        if (subtextEl) {
            if (!state.audience_poll_active && !state.lifeline_voting_active) {
                subtextEl.textContent = 'Get ready for the next question';  // Remove ellipsis from text as CSS will add animated ones
                subtextEl.classList.remove('hidden');
                subtextEl.classList.add('waiting-animation');  // Add the animation class
            } else {
                // Hide subtext during voting
                subtextEl.classList.add('hidden');
                subtextEl.classList.remove('waiting-animation');
            }
        }
        questionEl.textContent = '';
        questionEl.dataset.currentQuestion = '';
    } else {
        // Check if we should show the welcome message
        // Show it when nothing else is being displayed (no question, no answers, not preparing)
        const shouldShowWelcome = !state.question_visible && 
                                 !state.answers_visible && 
                                 !state.preparing_for_game;
        
        if (shouldShowWelcome) {
            // Show default welcome message with pulsating glow
            console.log('🎮 Showing welcome message');
            questionEl.textContent = 'Welcome to Kimbillionaire!';
            questionEl.classList.add('welcome-message');  // Add pulsating glow animation
            questionEl.style.fontSize = '32px';  // Match question text size
            questionEl.style.opacity = '1';
            questionEl.style.display = 'block';  // Ensure it's visible
            if (subtextEl) {
                subtextEl.classList.add('hidden');
                subtextEl.classList.remove('waiting-animation');
            }
        } else {
            // Remove welcome message class when not showing welcome
            questionEl.classList.remove('welcome-message');
            if (subtextEl) {
                subtextEl.classList.add('hidden');
                subtextEl.classList.remove('waiting-animation');  // Clean up animation class
            }
            // Don't clear the question text here - let other states handle it
        }
    }
}

// Typewriter effect function with refresh handling
async function typewriterEffect(element, text, speed = 60) {
    return new Promise((resolve) => {
        // Check if we're already showing this text (page was refreshed)
        const animationKey = 'typewriter_' + text.substring(0, 20);
        const wasInProgress = sessionStorage.getItem(animationKey);
        
        // If animation was in progress and text matches, show immediately
        if (wasInProgress === text) {
            element.textContent = text;
            element.classList.remove('typing');
            console.log('⚡ Typewriter skipped - text already displayed from previous load');
            sessionStorage.removeItem(animationKey);
            resolve();
            return;
        }
        
        // Start fresh animation
        element.textContent = '';
        element.classList.add('typing');
        sessionStorage.setItem(animationKey, text);
        
        let charIndex = 0;
        let animationFrame = null;
        
        function typeNextChar() {
            if (charIndex < text.length) {
                element.textContent += text[charIndex];
                charIndex++;
                if (audioSystem && charIndex % 2 === 0) { // Play tick every 2nd character to reduce audio spam
                    audioSystem.playTick();
                }
                animationFrame = setTimeout(typeNextChar, speed);
            } else {
                // Animation complete - remove typing class and resolve
                element.classList.remove('typing');
                sessionStorage.removeItem(animationKey);
                // Small delay to ensure the last tick sound finishes
                setTimeout(() => {
                    console.log('⌨️ Typewriter animation and sound effects complete');
                    resolve();
                }, 100); // Small delay for last tick sound to finish
            }
        }
        
        // Store animation frame so it can be cancelled if needed
        element.dataset.animationFrame = animationFrame;
        typeNextChar();
    });
}

// Update answers display
function updateAnswersDisplay(state) {
    const letters = ['A', 'B', 'C', 'D'];
    
    // First ensure all answer elements are found
    letters.forEach((letter, index) => {
        const answerEl = document.getElementById(`answer-${letter}`);
        if (!answerEl) {
            console.warn(`⚠️ Answer element ${letter} not found`);
            return;
        }
        
        const textEl = answerEl.querySelector('.answer-text');
        if (!textEl) return;
        
        // CRITICAL FIX: Check if this answer is eliminated by 50:50 lifeline
        const isEliminated = currentQuestionAnswerStates[letter] === 'eliminated' || 
                           (state.eliminated_answers && state.eliminated_answers.includes(index)) ||
                           eliminatedAnswers.includes(letter) ||
                           eliminatedAnswers.includes(index);
        
        if (isEliminated) {
            console.log(`🚫 50:50 ELIMINATION: Dimming answer ${letter} (index ${index})`);
            // Dim out eliminated answers - they should still be visible but clearly not selectable
            answerEl.style.opacity = '0.3';
            answerEl.style.filter = 'grayscale(100%)';
            answerEl.style.pointerEvents = 'none';
            answerEl.classList.add('eliminated');
            // Add visual strikethrough or other effect to show it's eliminated
            const textEl = answerEl.querySelector('.answer-text');
            if (textEl) {
                textEl.style.textDecoration = 'line-through';
                textEl.style.textDecorationColor = 'rgba(255, 0, 0, 0.5)';
                textEl.style.textDecorationThickness = '3px';
            }
        } else {
            // Check if this is the already-selected wrong answer - it should NOT be cleared
            const isWrongAnswer = state.answer_is_wrong && state.selected_answer === index && state.answers_revealed;
            
            if (!isWrongAnswer) {
                // Only clear styles if this is NOT the wrong answer
                answerEl.style.display = '';
                answerEl.style.opacity = '';
                answerEl.style.filter = '';
                answerEl.style.pointerEvents = '';
                answerEl.classList.remove('eliminated');
                const textEl = answerEl.querySelector('.answer-text');
                if (textEl && !answerEl.classList.contains('wrong')) {
                    textEl.style.textDecoration = '';
                    textEl.style.textDecorationColor = '';
                    textEl.style.textDecorationThickness = '';
                }
            } else {
                // This is the wrong answer - keep it highlighted red but not eliminated
                console.log(`🔴 Preserving wrong answer styling for ${letter} during 50:50`);
                answerEl.classList.remove('eliminated'); // Not eliminated, just wrong
                answerEl.style.pointerEvents = 'none'; // Can't be selected again
            }
        }
        
        // Use fallback answers if questions not loaded yet
        // Try to get question from state first (includes data from server), then fall back to local questions array
        const question = state.currentQuestionData || questions[state.current_question];
        const questionsAvailable = question && question.answers;
        const fallbackAnswers = ['Option A', 'Option B', 'Option C', 'Option D'];
        
        if (state.answers_visible) {
            const questionToUse = questionsAvailable ? question : { answers: fallbackAnswers };
            
            // Check if we need to use staggered reveal (first time showing these answers)
            if (!answerEl.dataset.revealed || answerEl.dataset.revealed !== `question-${state.current_question}`) {
                // Initially hide for animation
                answerEl.style.opacity = '0';
                answerEl.style.transform = 'translateX(-50px)';
                answerEl.classList.remove('hidden'); // Remove hidden but keep invisible via opacity
                
                // Show each answer with increasing delay for dramatic effect
                setTimeout(() => {
                    textEl.textContent = questionToUse.answers[index] || fallbackAnswers[index];
                    answerEl.dataset.revealed = `question-${state.current_question}`;
                    
                    // Trigger animation
                    answerEl.style.transition = 'all 0.6s ease-out';
                    answerEl.style.opacity = '1';
                    answerEl.style.transform = 'translateX(0)';
                    answerEl.classList.add('answer-reveal');
                    
                    // Play tick sound for each answer reveal
                    if (audioSystem) {
                        audioSystem.playTick();
                    }
                }, index * 300); // 300ms delay between each answer (faster)
            } else {
                // Already revealed, just ensure visibility
                answerEl.classList.remove('hidden');
                answerEl.style.opacity = '1';
                answerEl.style.transform = 'translateX(0)';
                textEl.textContent = questionToUse.answers[index] || fallbackAnswers[index];
            }
        } else if (!state.answers_visible) {
            // Only hide if answers should explicitly not be visible
            answerEl.classList.add('hidden');
            // Clear all animation states when hiding answers
            if (answerEl.dataset.revealed) {
                answerEl.dataset.revealed = '';
                answerEl.classList.remove('answer-reveal');
                answerEl.style.transition = '';
                answerEl.style.opacity = '';
                answerEl.style.transform = '';
            }
        }
        
        // Handle selection highlighting
        if (state.selected_answer === index) {
            answerEl.classList.add('selected');
        } else {
            answerEl.classList.remove('selected');
        }
        
        // Handle locked answer glow
        if (state.answer_locked_in && state.selected_answer === index && !state.answers_revealed) {
            answerEl.classList.add('locked-glow');
        } else {
            answerEl.classList.remove('locked-glow');
        }
        
        // Handle revealed answers - only show correct answer if it was actually selected and correct
        if (state.answers_revealed) {
            const question = questions[state.current_question];
            if (question && index === question.correct && state.selected_answer === index && !state.answer_is_wrong) {
                // Only highlight correct answer green if it was selected AND the answer was right
                answerEl.classList.add('correct');
            } else if (state.selected_answer === index && state.answer_is_wrong) {
                // Highlight the selected wrong answer in red
                answerEl.classList.add('wrong-selected');
            }
        } 
        
        // CRITICAL FIX: Keep wrong answer highlighted even during lifelines and revotes
        if (state.selected_answer === index && state.answer_is_wrong && state.answers_revealed) {
            answerEl.classList.add('wrong-selected');
            console.log(`🔴 Keeping wrong answer ${['A', 'B', 'C', 'D'][index]} highlighted in red`);
        }
        
        // Only remove highlighting when moving to new question
        if (!state.answers_revealed && !state.answer_is_wrong) {
            answerEl.classList.remove('correct', 'wrong-selected');
        }
    });
}

// Update money ladder
function updateMoneyLadder(state) {
    const moneyLevels = document.getElementById('money-levels');
    if (!moneyLevels) {
        console.error('❌ Money levels container not found!');
        return;
    }
    
    // Use fallback prizes if none loaded yet
    const prizes = prizeAmounts && prizeAmounts.length > 0 ? prizeAmounts : 
                  (state && state.prizes && state.prizes.length > 0 ? state.prizes :
                  ['1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x V2 WHITE MUG',
                   '1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x V2 BLACK T-SHIRT',
                   '1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x GIFTED SUB', '1x V2 BLACK HOODIE']);
    
    // Update the current question number and prize display
    const prizeBadgeEl = document.getElementById('current-prize-badge');
    if (prizeBadgeEl) {
        const currentQuestionNum = state.current_question + 1;
        const currentPrize = prizes[state.current_question] || prizes[0];
        prizeBadgeEl.innerHTML = `Question <span id="current-question-number">${currentQuestionNum}</span> - ${currentPrize}`;
        console.log('📊 Updated question display to:', currentQuestionNum, '-', currentPrize);
    }
    
    console.log('💰 Updating money ladder with', prizes.length, 'prizes');
    
    try {
        moneyLevels.innerHTML = '';
    
    // FIXED: Use same ordering as control panel - reverse array and use correct indexing
    prizes.slice().reverse().forEach((amount, index) => {
        const level = document.createElement('div');
        level.className = 'money-level';
        
        // FIXED: Match control panel logic exactly - Level = 15 - index (for 15 prizes)
        const questionNumber = prizes.length - index;
        const content = document.createElement('div');
        content.className = 'money-level-content';
        
        const numberEl = document.createElement('span');
        numberEl.className = 'question-number';
        numberEl.textContent = questionNumber;
        
        const amountEl = document.createElement('span');
        amountEl.className = 'prize-amount';
        amountEl.textContent = amount;
        
        content.appendChild(numberEl);
        content.appendChild(amountEl);
        level.appendChild(content);
        
        // Add milestone styling for levels 5, 10, 15 (professional milestone styling)
        if (questionNumber === 5 || questionNumber === 10 || questionNumber === 15) {
            level.classList.add('milestone');
        }
        
        // Highlight current question
        if (questionNumber === state.current_question + 1) {
            level.classList.add('current');
        }
        
        // Mark completed questions with correct highlighting based on answer history
        if (questionNumber < state.current_question + 1 && state.answerHistory) {
            const answerRecord = state.answerHistory.find(record => record.questionIndex === questionNumber - 1);
            if (answerRecord && answerRecord.result === 'correct') {
                level.classList.add('achieved'); // Green for correct answers
            } else if (answerRecord && answerRecord.result === 'wrong') {
                level.classList.add('history-wrong'); // Red for wrong answers  
            } else {
                level.classList.add('achieved'); // Default to green for completed questions
            }
        }
        
        // Add milestone markers
        if (questionNumber === 5 || questionNumber === 10 || questionNumber === 15) {
            level.classList.add('milestone');
        }
        
        moneyLevels.appendChild(level);
    });
    } catch (error) {
        console.error('❌ Error populating money ladder:', error);
    }
}

// Update lifelines display
function updateLifelines(state) {
    const lifelines = ['fiftyFifty', 'takeAnotherVote', 'askAMod'];
    
    lifelines.forEach(lifeline => {
        // Map server lifeline identifiers to HTML element IDs
        const lifelineIdMap = {
            'fiftyFifty': 'lifeline-fifty-fifty',
            'takeAnotherVote': 'lifeline-take-another-vote', 
            'askAMod': 'lifeline-ask-a-mod'
        };
        
        const lifelineEl = document.getElementById(lifelineIdMap[lifeline]);
        if (!lifelineEl) return;
        
        if (state.lifelines_used && state.lifelines_used.includes(lifeline)) {
            lifelineEl.classList.add('used');
            
            // Add USED overlay text as separate element to avoid dimming
            let usedOverlay = lifelineEl.querySelector('.used-overlay');
            if (!usedOverlay) {
                usedOverlay = document.createElement('div');
                usedOverlay.className = 'used-overlay';
                usedOverlay.textContent = 'USED';
                lifelineEl.appendChild(usedOverlay);
            }
        } else {
            lifelineEl.classList.remove('used');
            
            // Remove USED overlay if exists
            const usedOverlay = lifelineEl.querySelector('.used-overlay');
            if (usedOverlay) {
                usedOverlay.remove();
            }
        }
    });
}

// Update contestant info
function updateContestantInfo(state) {
    const nameEl = document.getElementById('contestant-name');
    const scoreEl = document.getElementById('contestant-score');
    
    if (nameEl && state.contestant_name) {
        nameEl.textContent = state.contestant_name;
    }
    
    if (scoreEl && state.current_question !== undefined && prizeAmounts) {
        const currentPrize = prizeAmounts[state.current_question] || '$0';
        scoreEl.textContent = currentPrize;
    }
}

// Update curtains display
function updateCurtains(state) {
    const body = document.body;
    
    if (state.curtains_closed) {
        body.classList.remove('curtains-open');
    } else {
        body.classList.add('curtains-open');
    }
}

// Handle poll started
function handlePollStarted(message) {
    console.log('🗳️ Poll started:', message);
    
    // Clear any leftover highlights from previous questions
    const oldLeading = document.querySelectorAll('.leading');
    oldLeading.forEach(el => {
        el.classList.remove('leading');
        console.log('🧹 Cleared old leading highlight from:', el.id || el.className);
    });
    
    // Also clear any eliminated or wrong answer styling that shouldn't persist
    const voteOptions = document.querySelectorAll('.vote-option-integrated');
    voteOptions.forEach(option => {
        // Only clear if the answer states show this should be available
        const letter = option.id ? option.id.replace('integrated-vote-', '') : null;
        if (letter && currentQuestionAnswerStates[letter] === 'available') {
            option.classList.remove('eliminated', 'previously-wrong');
            const statusEl = option.querySelector('.vote-status');
            if (statusEl) {
                statusEl.textContent = '';
            }
        }
    });
    console.log('🧹 Cleared voting panel states for available answers');
    
    // Update current state to reflect poll is active
    if (!currentState) {
        currentState = {};
    }
    
    currentState.audience_poll_active = true;
    currentState.show_voting_activity = true;
    
    // Also merge any state from the message
    if (message.state) {
        Object.assign(currentState, message.state);
    }
    
    console.log('📊 Updated currentState with poll active:', currentState);
    
    // Force update the info panel to show integrated voting
    updateInfoPanel(currentState);
    
    // Start the countdown timer
    startVotingCountdown(message.duration || 60000, message.startTime || Date.now());
    
    // Initialize integrated voting with empty votes
    updateIntegratedVoting({ A: 0, B: 0, C: 0, D: 0 });
    
    // Double-check that the voting display was created
    const votingCheck = document.getElementById('integrated-voting-options');
    if (!votingCheck) {
        console.error('❌ Voting display was not created properly!');
        // Try to force create it again
        showIntegratedVoting(currentState);
    } else {
        console.log('✅ Voting display verified in DOM');
    }
}

// Handle poll update
function handlePollUpdate(message) {
    console.log('📊 Poll update:', message);
    updateVoteProgressBars(message.votes);
}

// Handle poll ended
function handlePollEnded(message) {
    console.log('🏁 Poll ended:', message);
    stopVotingCountdown();
    
    // Clear any remaining leading classes when poll ends
    const leadingElements = document.querySelectorAll('.leading');
    leadingElements.forEach(el => {
        el.classList.remove('leading');
        console.log('🧹 Cleared leading class at poll end from:', el.id || el.className);
    });
    
    // Update current state to reflect poll has ended
    if (currentState) {
        currentState.audience_poll_active = false;
        currentState.show_voting_activity = false;
        // CRITICAL FIX: Also clear revote status when poll ends
        currentState.is_revote_active = false;
        console.log('🔄 Cleared is_revote_active flag after poll ended');
    }
    
    // Hide the voting panel popup (separate from info panel)
    const votingSection = document.getElementById('voting-section');
    if (votingSection) {
        votingSection.classList.add('hidden');
        console.log('✅ Hidden voting panel popup after poll ended');
    }
    
    // Update info panel content (it remains visible as a static panel)
    updateInfoPanel(currentState);
}

// Start voting countdown
function startVotingCountdown(duration, startTime) {
    // Clear any existing countdown
    stopVotingCountdown();
    
    // ONLY use integrated voting (in info panel), hide separate voting section
    const votingSection = document.getElementById('voting-section');
    const countdownTimer = document.getElementById('countdown-timer');
    const integratedTimer = document.getElementById('countdown-timer-integrated');
    const integratedVoting = document.getElementById('integrated-voting');
    
    console.log('🔍 Looking for voting elements:', {
        votingSection: !!votingSection,
        countdownTimer: !!countdownTimer,
        integratedTimer: !!integratedTimer,
        integratedVoting: !!integratedVoting
    });
    
    // Show integrated voting if it exists (this is the one in info panel)
    if (integratedVoting) {
        integratedVoting.style.display = 'block';
        console.log('✅ Showing integrated voting panel (in info panel)');
    }
    
    // HIDE separate voting panel to avoid duplicates
    if (votingSection) {
        votingSection.classList.add('hidden');
        console.log('🚫 Hiding separate voting panel to avoid duplicates');
    }
    
    // Create vote options if they don't exist
    createVoteOptions();
    
    // Ensure startTime is valid
    if (!startTime || isNaN(startTime)) {
        startTime = Date.now();
        console.log('⚠️ Invalid startTime, using current time:', startTime);
    }
    
    function updateTimer() {
        const now = Date.now();
        const elapsed = now - startTime;
        const remaining = Math.max(0, duration - elapsed);
        const seconds = Math.ceil(remaining / 1000);
        
        const timerText = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
        
        // Update all possible timer locations
        if (countdownTimer) {
            countdownTimer.textContent = timerText;
        }
        
        // Update integrated timer
        const integratedTimerEl = document.getElementById('countdown-timer-integrated');
        if (integratedTimerEl) {
            integratedTimerEl.textContent = timerText;
            // Only log timer updates occasionally to avoid spam
            if (seconds % 10 === 0 || seconds <= 5) {
                console.log('⏱️ Timer:', timerText, 'seconds:', seconds, 'remaining:', remaining);
            }
        }
        
        // Update any other timer elements
        const integratedTimerNew = document.getElementById('integrated-voting-timer');
        if (integratedTimerNew) {
            integratedTimerNew.textContent = timerText;
        }
        
        // Add urgent styling for last 30 seconds
        if (seconds <= 30) {
            if (countdownTimer) {
                countdownTimer.classList.add('urgent');
            }
            if (integratedTimerEl) {
                integratedTimerEl.classList.add('urgent');
            }
            if (audioSystem && seconds <= 10 && seconds > 0) {
                audioSystem.playTick();
            }
        }
        
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            if (votingSection) {
                votingSection.classList.add('hidden');
            }
            if (integratedVoting) {
                integratedVoting.style.display = 'none';
            }
            console.log('⏰ Voting timer expired');
        }
    }
    
    // Run immediately and then every second
    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
    console.log('✅ Countdown timer started with interval:', countdownInterval);
}

// Stop voting countdown
function stopVotingCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    
    const votingSection = document.getElementById('voting-section');
    if (votingSection) {
        votingSection.classList.add('hidden');
    }
    
    // Clear leading classes when hiding voting display
    const leadingElements = document.querySelectorAll('.leading');
    leadingElements.forEach(el => {
        el.classList.remove('leading');
        console.log('🧹 Cleared leading class on voting end from:', el.id || el.className);
    });
    
    // Also clear the integrated voting display
    const integratedVoting = document.getElementById('integrated-voting');
    const infoContent = document.getElementById('info-content');
    if (integratedVoting) {
        integratedVoting.style.display = 'none';
        // Remove voting-active class when clearing voting
        if (infoContent) infoContent.classList.remove('voting-active');
    }
    
    // Make sure info area stays visible
    const infoArea = document.getElementById('info-area');
    if (infoArea) {
        infoArea.classList.remove('hidden');
        infoArea.style.display = 'flex';
        console.log('✅ Ensured info area remains visible after voting ends');
    }
}

// Update vote progress bars
function updateVoteProgressBars(votes) {
    const letters = ['A', 'B', 'C', 'D'];
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
    const maxVotes = Math.max(...Object.values(votes));
    
    letters.forEach(letter => {
        const count = votes[letter] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const isLeading = count > 0 && count === maxVotes;
        
        // Update separate voting panel elements
        const voteOption = document.getElementById(`vote-option-${letter}`);
        const progressBar = document.getElementById(`progress-${letter}`);
        const percentageEl = document.getElementById(`percentage-${letter}`);
        const countEl = document.getElementById(`count-${letter}`);
        
        if (progressBar) progressBar.style.width = `${percentage}%`;
        if (percentageEl) percentageEl.textContent = `${percentage}%`;
        if (countEl) countEl.textContent = count;
        if (voteOption) {
            if (isLeading) {
                voteOption.classList.add('leading');
            } else {
                voteOption.classList.remove('leading');
            }
        }
        
        // Also update integrated voting panel elements
        const fillEl = document.getElementById(`integrated-fill-${letter}`);
        const intCountEl = document.getElementById(`integrated-count-${letter}`);
        const intPercentEl = document.getElementById(`integrated-percent-${letter}`);
        const intOptionEl = document.getElementById(`integrated-vote-${letter}`);
        
        if (fillEl) fillEl.style.width = `${percentage}%`;
        if (intCountEl) intCountEl.textContent = count;
        if (intPercentEl) intPercentEl.textContent = `${percentage}%`;
        if (intOptionEl) {
            if (isLeading) {
                intOptionEl.classList.add('leading');
            } else {
                intOptionEl.classList.remove('leading');
            }
        }
    });
    
    console.log('✅ Updated voting displays');
}

// Create voting options for A, B, C, D
function createVoteOptions() {
    // Clear any existing leading classes from previous votes
    const existingLeading = document.querySelectorAll('.vote-option-integrated.leading, .vote-option.leading, .lifeline-option-horizontal.leading');
    existingLeading.forEach(el => {
        el.classList.remove('leading');
        console.log('🧹 Cleared leading class from:', el.id || el.className);
    });
    
    // ONLY create options for integrated voting content (in info panel)
    const votingContentIntegrated = document.getElementById('voting-content-integrated');
    
    console.log('🎆 Creating vote options in integrated panel. Found element:', !!votingContentIntegrated);
    
    const options = ['A', 'B', 'C', 'D'];
    
    // Skip separate panel - we're only using integrated
    
    // Create options for integrated voting panel if it exists
    if (votingContentIntegrated && votingContentIntegrated.children.length === 0) {
        // Remove lifeline-layout class for audience voting (use 2x2 grid)
        votingContentIntegrated.classList.remove('lifeline-layout');
        
        // Restore audience timer and hide lifeline timer
        const audienceTimer = document.getElementById('countdown-timer-integrated');
        const lifelineTimer = document.getElementById('integrated-lifeline-timer');
        
        if (audienceTimer) {
            audienceTimer.style.display = ''; // Show audience timer
        }
        if (lifelineTimer) {
            lifelineTimer.style.display = 'none'; // Hide lifeline timer
        }
        options.forEach(letter => {
            const voteOption = document.createElement('div');
            voteOption.className = 'vote-option-integrated';
            voteOption.id = `integrated-vote-${letter}`;
            
            voteOption.innerHTML = `
                <div class="vote-option-top">
                    <div class="vote-letter">${letter}</div>
                    <div class="vote-stats">
                        <span class="vote-count" id="integrated-count-${letter}">0</span>
                        <span class="vote-percentage" id="integrated-percent-${letter}">0%</span>
                    </div>
                </div>
                <div class="vote-bar">
                    <div class="vote-fill" id="integrated-fill-${letter}" style="width: 0%"></div>
                </div>
            `;
            votingContentIntegrated.appendChild(voteOption);
        });
        console.log('✅ Created vote options in integrated panel');
    }
    
    console.log('✅ Created voting options A, B, C, D with progress bars');
}

// Create lifeline voting options
function createLifelineVotingOptions(availableLifelines) {
    const lifeline_votingOptions = document.getElementById('lifeline-voting-options');
    if (!lifeline_votingOptions) return;
    
    // Clear existing content
    lifeline_votingOptions.innerHTML = '';
    
    // Add total votes display at the top
    const totalVotesDiv = document.createElement('div');
    totalVotesDiv.className = 'lifeline-total-votes';
    totalVotesDiv.id = 'lifeline-total-votes';
    totalVotesDiv.innerHTML = '<span>Total Votes: </span><span id="lifeline-total-count">0</span>';
    totalVotesDiv.style.textAlign = 'center';
    totalVotesDiv.style.marginBottom = '10px';
    totalVotesDiv.style.fontSize = '14px';
    totalVotesDiv.style.color = 'rgba(255, 215, 0, 0.8)';
    lifeline_votingOptions.appendChild(totalVotesDiv);
    
    // Map lifelines to display names and emblems
    const lifelineData = {
        'fiftyFifty': { name: '50:50', emblem: '⚡' },
        'takeAnotherVote': { name: 'Take Another Vote', emblem: '📊' },
        'askAMod': { name: 'Ask a Mod', emblem: '🛡️' }
    };
    
    // Check current game state for used lifelines
    const usedLifelines = currentState && currentState.lifelines_used ? currentState.lifelines_used : [];
    console.log('🔍 Checking used lifelines:', usedLifelines);
    
    availableLifelines.forEach((lifeline, index) => {
        const voteOption = document.createElement('div');
        
        // Check if this lifeline has been used
        const isUsed = usedLifelines.includes(lifeline);
        
        // Apply appropriate CSS classes
        voteOption.className = isUsed ? 'lifeline-vote-option lifeline-vote-used' : 'lifeline-vote-option';
        voteOption.id = `lifeline-vote-${index + 1}`;
        
        // Store lifeline type and used status as data attributes for vote processing
        voteOption.dataset.lifeline = lifeline;
        voteOption.dataset.used = isUsed.toString();
        
        const data = lifelineData[lifeline] || { name: lifeline, emblem: '?' };
        
        voteOption.innerHTML = `
            <div class="lifeline-vote-left">
                <div class="lifeline-vote-number">${index + 1}</div>
                <div class="lifeline-vote-details">
                    <div class="lifeline-vote-name">
                        <span class="lifeline-emblem">${data.emblem}</span>
                        ${data.name}
                        ${isUsed ? ' <span class="used-indicator">(USED)</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="lifeline-vote-stats">
                <div class="lifeline-vote-percentage" id="lifeline-percentage-${index + 1}">0%</div>
                <div class="lifeline-vote-count" id="lifeline-count-${index + 1}">0 votes</div>
                <div class="lifeline-vote-progress">
                    <div class="lifeline-vote-fill" id="lifeline-progress-${index + 1}" style="width: 0%"></div>
                </div>
            </div>
        `;
        
        lifeline_votingOptions.appendChild(voteOption);
        
        if (isUsed) {
            console.log(`🚫 Lifeline ${lifeline} marked as used - dimmed in voting display`);
        }
    });
    
    console.log('✅ Created lifeline voting options with usage state tracking:', availableLifelines);
}

// Handle audience poll vote update
function handleAudiencePollVoteUpdate(message) {
    if (message.votes) {
        // Use requestAnimationFrame for smoother updates
        requestAnimationFrame(() => {
            updateVoteProgressBars(message.votes);
            updateIntegratedVoting(message.votes);
        });
    }
}

// Update audience choice display overlay
let audienceChoiceDisplayTimeout = null;

function updateAudienceChoiceDisplay(state) {
    const overlay = document.getElementById('audience-choice-overlay');
    const answerEl = document.getElementById('audience-choice-answer');
    const votesEl = document.getElementById('audience-choice-votes');
    const percentageEl = document.getElementById('audience-choice-percentage');
    
    if (!overlay) {
        console.warn('⚠️ Audience choice overlay not found in DOM');
        return;
    }
    
    // Clear any pending timeout to prevent conflicts
    if (audienceChoiceDisplayTimeout) {
        clearTimeout(audienceChoiceDisplayTimeout);
        audienceChoiceDisplayTimeout = null;
    }
    
    // Check if we should show the poll winner
    if (state.show_poll_winner) {
        // Show the overlay with winner information
        const winner = state.show_poll_winner;
        const votes = state.poll_winner_votes || 0;
        const percentage = state.poll_winner_percentage || 0;
        
        console.log(`🏆 Showing audience choice: ${winner} with ${votes} votes (${percentage}%)`);
        
        // Update content first
        if (answerEl) answerEl.textContent = winner;
        if (votesEl) votesEl.textContent = `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
        if (percentageEl) percentageEl.textContent = `${percentage}%`;
        
        // Remove hidden class and add visible class
        overlay.classList.remove('hidden');
        // Small delay to ensure class change registers
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            
            // Add pulse animation to the answer
            if (answerEl) {
                answerEl.style.animation = 'audienceChoicePulse 1s ease-in-out infinite';
            }
        });
        
        console.log('✅ Audience choice overlay displayed');
    } else {
        // Hide the overlay with a small delay to prevent flashing
        audienceChoiceDisplayTimeout = setTimeout(() => {
            if (!overlay.classList.contains('hidden')) {
                overlay.classList.remove('visible');
                overlay.classList.add('hidden');
                
                // Remove animation
                if (answerEl) {
                    answerEl.style.animation = '';
                }
                
                console.log('✅ Audience choice overlay hidden');
            }
        }, 100); // Small delay to prevent rapid show/hide
    }
}

// Show integrated voting display in the info panel
function showIntegratedVoting(state) {
    console.log('🎯 showIntegratedVoting called with state:', state);
    
    const infoMessage = document.getElementById('info-message');
    const infoDetails = document.getElementById('info-details');
    const integratedVoting = document.getElementById('integrated-voting');
    
    console.log('🎯 Elements found:', { 
        infoMessage: !!infoMessage, 
        infoDetails: !!infoDetails,
        integratedVoting: !!integratedVoting 
    });
    
    if (!integratedVoting) {
        console.error('❌ Cannot show integrated voting - element not found');
        return;
    }
    
    // Hide the normal content
    if (infoMessage) infoMessage.style.display = 'none';
    if (infoDetails) infoDetails.style.display = 'none';
    
    // Show the integrated voting panel
    integratedVoting.style.display = 'block';
    
    console.log('🎯 Showing existing integrated voting panel');
    
    // CRITICAL FIX: Update voting title to show correct type
    const votingTitle = document.getElementById('voting-title-integrated');
    if (votingTitle) {
        if (state.is_revote_active) {
            votingTitle.textContent = 'REVOTE ON REMAINING';
            console.log('📝 Set voting title to REVOTE ON REMAINING');
        } else {
            votingTitle.textContent = 'AUDIENCE VOTING';
            console.log('📝 Set voting title to AUDIENCE VOTING');
        }
    }
    
    // Use the existing voting-content-integrated element for options
    const optionsContainer = document.getElementById('voting-content-integrated');
    
    // CRITICAL FIX: Only clear if we have lifeline content, not vote options
    if (optionsContainer) {
        // Check if we have lifeline elements (they have different class names)
        const hasLifelineContent = optionsContainer.querySelector('.lifeline-vote-option-integrated');
        const hasVoteContent = optionsContainer.querySelector('.vote-option-integrated');
        
        // Only clear if we have lifeline content OR no content at all
        if (hasLifelineContent || !hasVoteContent) {
            // Clear any existing content (including lifeline options)
            optionsContainer.innerHTML = '';
            console.log('🧹 Cleared voting container content (had lifeline content or was empty)');
            
            // Remove lifeline-specific styling
            optionsContainer.classList.remove('lifeline-layout');
            console.log('🎨 Removed lifeline-layout class');
        }
        
        // Hide lifeline timer if it exists
        const lifelineTimer = document.getElementById('integrated-lifeline-timer');
        if (lifelineTimer) {
            lifelineTimer.style.display = 'none';
            console.log('⏱️ Hidden lifeline timer');
        }
        
        // Show audience timer
        const audienceTimer = document.getElementById('countdown-timer-integrated');
        if (audienceTimer) {
            audienceTimer.style.display = '';
            console.log('⏱️ Showing audience timer');
        }
        
        // Check if we need to create vote options (only if they don't exist)
        const needsCreation = !optionsContainer.querySelector('.vote-option-integrated');
        
        if (needsCreation) {
            // Create A/B/C/D voting options
            const options = ['A', 'B', 'C', 'D'];
            
            options.forEach((letter, index) => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'vote-option-integrated';
                optionDiv.id = `integrated-vote-${letter}`;
                
                // Check if this answer is excluded (for revotes)
                const isExcluded = state.excluded_answers && state.excluded_answers.includes(index);
                if (isExcluded) {
                    optionDiv.classList.add('previously-wrong');
                    console.log(`🚫 Marking answer ${letter} (index ${index}) as previously wrong`);
                }
                
                optionDiv.innerHTML = `
                    <div class="vote-option-top">
                        <div class="vote-letter">${letter}</div>
                        <div class="vote-stats">
                            <span class="vote-count" id="integrated-count-${letter}">0</span>
                            <span class="vote-percentage" id="integrated-percent-${letter}">0%</span>
                        </div>
                    </div>
                    <div class="vote-bar">
                        <div class="vote-fill" id="integrated-fill-${letter}" style="width: 0%"></div>
                    </div>
                `;
                optionsContainer.appendChild(optionDiv);
            });
            
            console.log('✅ Vote options A/B/C/D created in panel');
            if (state.excluded_answers && state.excluded_answers.length > 0) {
                console.log('🚫 Excluded answers marked:', state.excluded_answers);
            }
        } else {
            console.log('📊 Vote options already exist, preserving current state');
            
            // Still need to update dimming for existing options if excluded_answers changed
            if (state.excluded_answers && state.excluded_answers.length > 0) {
                const options = ['A', 'B', 'C', 'D'];
                options.forEach((letter, index) => {
                    const optionEl = document.getElementById(`integrated-vote-${letter}`);
                    if (optionEl) {
                        const isExcluded = state.excluded_answers.includes(index);
                        if (isExcluded) {
                            optionEl.classList.add('previously-wrong');
                            console.log(`🚫 Updating answer ${letter} (index ${index}) as previously wrong`);
                        } else {
                            optionEl.classList.remove('previously-wrong');
                        }
                    }
                });
            }
        }
    }
    
    // Don't reset the timer here - it's managed by startVotingCountdown()
    // Timer should only be set when voting starts, not on every update
}

// Show integrated lifeline voting display in the info panel
function showIntegratedLifelineVoting(state) {
    const infoMessage = document.getElementById('info-message');
    const infoDetails = document.getElementById('info-details');
    const integratedVoting = document.getElementById('integrated-voting');
    
    if (!integratedVoting) {
        console.error('❌ Cannot show integrated lifeline voting - element not found');
        return;
    }
    
    // Hide the normal content
    if (infoMessage) infoMessage.style.display = 'none';
    if (infoDetails) infoDetails.style.display = 'none';
    
    // Show the integrated voting panel (reuse same panel as audience voting)
    integratedVoting.style.display = 'block';
    
    // Update the header for lifeline voting
    const votingTitle = document.getElementById('voting-title-integrated');
    if (votingTitle) {
        votingTitle.textContent = 'VOTE FOR LIFELINE';
    }
    
    // Create or update the integrated timer for lifeline voting
    let integratedTimer = document.getElementById('integrated-lifeline-timer');
    const existingTimer = document.getElementById('countdown-timer-integrated');
    
    if (!integratedTimer && existingTimer) {
        // Create a dedicated lifeline timer element
        integratedTimer = document.createElement('span');
        integratedTimer.id = 'integrated-lifeline-timer';
        integratedTimer.textContent = '30s'; // Default lifeline voting duration
        integratedTimer.style.color = '#FFD700';
        integratedTimer.style.fontWeight = '700';
        integratedTimer.style.fontSize = '22px';
        
        // Replace or add alongside existing timer
        existingTimer.style.display = 'none'; // Hide audience timer
        existingTimer.parentNode.appendChild(integratedTimer);
        console.log('✅ Created integrated lifeline timer element');
    } else if (integratedTimer && existingTimer) {
        // Show lifeline timer and hide audience timer
        existingTimer.style.display = 'none';
        integratedTimer.style.display = '';
        console.log('✅ Switched to lifeline timer display');
    }
    
    // Clear existing content and use the same container as audience voting
    const votingContent = document.getElementById('voting-content-integrated');
    if (votingContent) {
        votingContent.innerHTML = '';
        
        // Add lifeline-layout class for vertical stack display
        votingContent.classList.add('lifeline-layout');
        
        const lifelineData = {
            'fiftyFifty': { name: '50:50', icon: '⚡', num: '1' },
            'takeAnotherVote': { name: 'Another Vote', icon: '🔄', num: '2' },
            'askAMod': { name: 'Ask Mod', icon: '🛡️', num: '3' }
        };
        
        if (state.available_lifelines_for_vote) {
            state.available_lifelines_for_vote.forEach((lifeline, index) => {
                const data = lifelineData[lifeline];
                if (data) {
                    const optionDiv = document.createElement('div');
                    optionDiv.className = 'lifeline-option-horizontal'; // New class for horizontal layout
                    optionDiv.id = `lifeline-option-${index}`;
                    
                    // Simplified horizontal structure for better space usage
                    optionDiv.innerHTML = `
                        <div class="lifeline-number">${index + 1}</div>
                        <div class="lifeline-content">
                            <div class="lifeline-text">${data.icon} ${data.name}</div>
                            <div class="lifeline-bar-container">
                                <div class="lifeline-bar-fill" id="lifeline-fill-${index}" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="lifeline-stats">
                            <span class="lifeline-count" id="lifeline-count-${index}">0</span>
                            <span class="lifeline-percent" id="lifeline-percent-${index}">0%</span>
                        </div>
                    `;
                    
                    votingContent.appendChild(optionDiv);
                }
            });
        }
    }
    
    console.log('✅ Integrated lifeline voting display created in info panel');
}

// Update integrated voting display in info panel
function updateIntegratedVoting(votes) {
    const votingContent = document.getElementById('voting-content-integrated');
    const votingTimer = document.getElementById('countdown-timer-integrated');
    
    // Check if vote options have been created yet - if not, create them
    if (votingContent && votingContent.children.length === 0) {
        console.log('📝 Creating vote options first...');
        createVoteOptions();
    }
    
    // Now update the integrated display
    if (votingContent) {
        const options = ['A', 'B', 'C', 'D'];
        let totalVotes = 0;
        
        // Calculate total
        options.forEach(letter => {
            totalVotes += votes[letter] || 0;
        });
        
        // Update each option
        options.forEach((letter, index) => {
            const count = votes[letter] || 0;
            const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            
            // Try the integrated elements (created by createVoteOptions)
            const fillEl = document.getElementById(`integrated-fill-${letter}`);
            const countEl = document.getElementById(`integrated-count-${letter}`);
            const percentEl = document.getElementById(`integrated-percent-${letter}`);
            const optionEl = document.getElementById(`integrated-vote-${letter}`);
            
            // Check if this answer is excluded and someone tried to vote for it
            const isExcluded = currentState && currentState.excluded_answers && 
                              currentState.excluded_answers.includes(index);
            
            if (isExcluded && count > 0) {
                // Add a visual pulse to show the vote was rejected
                if (optionEl) {
                    optionEl.style.animation = 'rejected-pulse 0.5s ease-in-out';
                    setTimeout(() => {
                        optionEl.style.animation = '';
                    }, 500);
                    console.log(`⚠️ Vote attempt for excluded answer ${letter} rejected visually`);
                }
            }
            
            if (fillEl) {
                fillEl.style.width = percentage + '%';
            }
            if (countEl) {
                countEl.textContent = count;
            }
            if (percentEl) {
                percentEl.textContent = percentage + '%';
            }
        });
        
        console.log('✅ Updated integrated voting display with votes:', votes);
        return;
    }
    
    // Legacy code for old display
    if (!votingContent) {
        console.log('❌ Integrated voting content element not found');
        return;
    }
    
    // Create or update voting options
    const options = ['A', 'B', 'C', 'D'];
    let totalVotes = 0;
    let leadingOption = null;
    let maxVotes = 0;
    
    // Calculate total votes and find leading option
    options.forEach(letter => {
        const count = votes[letter] || 0;
        totalVotes += count;
        if (count > maxVotes) {
            maxVotes = count;
            leadingOption = letter;
        }
    });
    
    // Clear existing content if needed
    if (votingContent.children.length === 0) {
        options.forEach(letter => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'vote-option-integrated';
            optionDiv.id = `integrated-vote-${letter}`;
            
            // Determine answer state
            const answerState = currentQuestionAnswerStates[letter];
            if (answerState === 'eliminated') {
                optionDiv.classList.add('eliminated');
            } else if (answerState === 'wrong') {
                optionDiv.classList.add('previously-wrong');
            }
            
            optionDiv.innerHTML = `
                <div class="vote-option-top">
                    <div class="vote-letter">${letter}</div>
                    <div class="vote-stats">
                        <span class="vote-count" id="integrated-count-${letter}">0</span>
                        <span class="vote-percentage" id="integrated-percent-${letter}">0%</span>
                    </div>
                </div>
                <div class="vote-bar">
                    <div class="vote-fill" id="integrated-fill-${letter}"></div>
                </div>
                <div class="vote-status" id="integrated-status-${letter}"></div>
            `;
            votingContent.appendChild(optionDiv);
        });
    }
    
    // Update vote displays
    options.forEach(letter => {
        const count = votes[letter] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        
        const fillEl = document.getElementById(`integrated-fill-${letter}`);
        const countEl = document.getElementById(`integrated-count-${letter}`);
        const percentEl = document.getElementById(`integrated-percent-${letter}`);
        const optionEl = document.getElementById(`integrated-vote-${letter}`);
        const statusEl = document.getElementById(`integrated-status-${letter}`);
        
        if (fillEl) fillEl.style.width = percentage + '%';
        if (countEl) countEl.textContent = count;
        if (percentEl) percentEl.textContent = percentage + '%';
        
        // Update answer state classes and status text
        if (optionEl) {
            const answerState = currentQuestionAnswerStates[letter];
            
            // Clear all state classes first
            optionEl.classList.remove('eliminated', 'previously-wrong', 'leading');
            
            // Apply appropriate state class
            if (answerState === 'eliminated') {
                optionEl.classList.add('eliminated');
                if (statusEl) statusEl.textContent = '(Eliminated)';
            } else if (answerState === 'wrong') {
                optionEl.classList.add('previously-wrong');
                if (statusEl) statusEl.textContent = '(Already tried)';
            } else {
                if (statusEl) statusEl.textContent = '';
                // Only highlight leading if it's available
                if (letter === leadingOption && count > 0) {
                    optionEl.classList.add('leading');
                }
            }
        }
    });
    
    console.log('📊 Updated integrated voting display:', { totalVotes, leadingOption });
}

// Update integrated lifeline voting display in info panel
function updateIntegratedLifelineVoting(votes, availableLifelines) {
    console.log('🎯 Updating integrated lifeline voting display:', votes);
    console.log('📋 Available lifelines for integrated panel:', availableLifelines);
    
    // Use the provided available lifelines order, or fall back to current state or defaults
    const lifelines = availableLifelines || 
                      (currentState && currentState.available_lifelines_for_vote) || 
                      ['fiftyFifty', 'takeAnotherVote', 'askAMod'];
    
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
    let maxVotes = 0;
    
    lifelines.forEach((lifeline, index) => {
        const fillEl = document.getElementById(`lifeline-fill-${index}`);
        const countEl = document.getElementById(`lifeline-count-${index}`);
        const percentEl = document.getElementById(`lifeline-percent-${index}`);
        
        if (!fillEl || !countEl || !percentEl) {
            console.warn(`⚠️ Missing integrated lifeline elements for position ${index + 1} (${lifeline})`);
            return;
        }
        
        const count = votes[lifeline] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        maxVotes = Math.max(maxVotes, count);
        
        // Update the display
        fillEl.style.width = `${percentage}%`;
        countEl.textContent = count;
        percentEl.textContent = `${percentage}%`;
        
        // Add/remove leading class (works for both old and new HTML structure)
        const optionEl = fillEl.closest('.vote-option-integrated') || fillEl.closest('.lifeline-option-horizontal');
        if (optionEl) {
            if (count > 0 && count === maxVotes) {
                optionEl.classList.add('leading');
            } else {
                optionEl.classList.remove('leading');
            }
        }
        
        console.log(`📊 Updated integrated position ${index + 1} (${lifeline}): ${count} votes (${percentage}%)`);
    });
}

// Handle lifeline vote update
function handleLifelineVoteUpdate(message) {
    console.log('🎯 Lifeline vote update:', message);
    // Pass available lifelines to ensure proper ordering
    updateLifelineVoteCounts(message.voteCounts || message.votes, message.availableLifelines);
    // Also update the integrated info panel display with proper ordering
    updateIntegratedLifelineVoting(message.voteCounts || message.votes, message.availableLifelines);
}

// Update lifeline vote counts
function updateLifelineVoteCounts(votes, availableLifelines) {
    console.log('🎯 Updating lifeline vote counts:', votes);
    console.log('📋 Available lifelines order:', availableLifelines);
    
    // Use the actual available lifelines order from the server, or fall back to game state
    const lifelines = availableLifelines || 
                      (currentState && currentState.available_lifelines_for_vote) || 
                      ['fiftyFifty', 'takeAnotherVote', 'askAMod'];
    
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
    
    // Update total votes display
    const totalCountEl = document.getElementById('lifeline-total-count');
    if (totalCountEl) {
        totalCountEl.textContent = totalVotes;
        console.log(`📊 Total lifeline votes: ${totalVotes}`);
    }
    
    lifelines.forEach((lifeline, index) => {
        const voteOption = document.getElementById(`lifeline-vote-${index + 1}`);
        const progressBar = document.getElementById(`lifeline-progress-${index + 1}`);
        const percentageEl = document.getElementById(`lifeline-percentage-${index + 1}`);
        const countEl = document.getElementById(`lifeline-count-${index + 1}`);
        
        console.log(`🔍 Position ${index + 1} is lifeline: ${lifeline}, elements:`, {
            voteOption: !!voteOption,
            progressBar: !!progressBar, 
            percentageEl: !!percentageEl,
            countEl: !!countEl
        });
        
        if (!voteOption || !progressBar || !percentageEl || !countEl) {
            console.warn(`⚠️ Missing elements for position ${index + 1} (${lifeline})`);
            return;
        }
        
        const count = votes[lifeline] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        
        progressBar.style.width = `${percentage}%`;
        percentageEl.textContent = `${percentage}%`;
        countEl.textContent = count + (count === 1 ? ' vote' : ' votes');
        
        console.log(`📊 Updated position ${index + 1} (${lifeline}): ${count} votes (${percentage}%)`);
        
        // Highlight leading option
        if (count > 0 && count === Math.max(...Object.values(votes))) {
            voteOption.classList.add('leading');
            console.log(`🏆 Position ${index + 1} (${lifeline}) is leading`);
        } else {
            voteOption.classList.remove('leading');
        }
    });
}

// Handle lifeline voting started
function handleLifelineVotingStarted(message) {
    console.log('🎯 Lifeline voting started:', message);
    
    // Show lifeline voting panel
    const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
    if (lifelineVotingPanel) {
        lifelineVotingPanel.classList.remove('hidden');
        console.log('✅ Showed lifeline voting panel');
    } else {
        console.warn('⚠️ Lifeline voting panel not found');
    }
    
    // Create lifeline voting options
    createLifelineVotingOptions(message.availableLifelines || ['fiftyFifty', 'askAudience', 'askAMod']);
    
    // Also show lifelines area for context
    const lifelinesArea = document.getElementById('lifelines-area');
    if (lifelinesArea) {
        lifelinesArea.classList.remove('hidden');
        lifelinesArea.classList.add('voting-active');
        console.log('✅ Showed lifelines panel for voting');
    } else {
        console.warn('⚠️ Lifelines area element not found');
    }
    
    // Initialize lifeline voting display
    const lifelines = message.availableLifelines || ['fiftyFifty', 'takeAnotherVote', 'askAMod'];
    lifelines.forEach((lifeline, index) => {
        const voteOption = document.getElementById(`lifeline-vote-${index + 1}`);
        if (voteOption) {
            const progressBar = voteOption.querySelector('.lifeline-vote-fill');
            const percentageEl = voteOption.querySelector('.lifeline-vote-percentage');
            
            if (progressBar) progressBar.style.width = '0%';
            if (percentageEl) percentageEl.textContent = '0%';
            voteOption.classList.remove('leading');
        }
    });
}

// Handle lifeline voting countdown updates
function handleLifelineVotingCountdown(message) {
    console.log('⏱️ Lifeline voting countdown update:', message.seconds, 'seconds remaining');
    
    const lifelineTimer = document.getElementById('lifeline-voting-timer');
    if (lifelineTimer) {
        const minutes = Math.floor(message.seconds / 60);
        const seconds = message.seconds % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        lifelineTimer.textContent = timeString;
        
        // Add urgency styling for final 10 seconds
        if (message.seconds <= 10) {
            lifelineTimer.style.color = '#ff4444';
            lifelineTimer.style.textShadow = '0 0 10px rgba(255, 68, 68, 0.8)';
            console.log('⚠️ Final countdown - applying urgent styling');
        } else {
            lifelineTimer.style.color = '';
            lifelineTimer.style.textShadow = '';
        }
    } else {
        console.warn('⚠️ Lifeline voting timer element not found');
    }
    
    // Also update the integrated timer in the info panel
    const integratedTimer = document.getElementById('integrated-lifeline-timer');
    if (integratedTimer) {
        if (message.seconds >= 60) {
            // For times 60 seconds or more, show in minutes:seconds format
            const minutes = Math.floor(message.seconds / 60);
            const seconds = message.seconds % 60;
            integratedTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
            // For times less than 60 seconds, show in seconds format
            integratedTimer.textContent = `${message.seconds}s`;
        }
        console.log('⏱️ Updated integrated lifeline timer:', integratedTimer.textContent);
        
        // Add urgent styling to integrated timer for last 10 seconds
        if (message.seconds <= 10) {
            integratedTimer.style.color = '#ff4444';
            integratedTimer.style.textShadow = '0 0 10px rgba(255, 68, 68, 0.8)';
        } else {
            integratedTimer.style.color = '';
            integratedTimer.style.textShadow = '';
        }
    }
}

// Handle post-lifeline revote
function handlePostLifelineRevote(message) {
    console.log('🔄 Post-lifeline revote started:', message);
    
    // CRITICAL FIX: Update current state to show revote is active
    currentState.is_revote_active = true;
    currentState.audience_poll_active = true; // Also mark poll as active for voting
    console.log('🔄 Updated currentState.is_revote_active to true');
    
    // Update info panel immediately to show revote status
    updateInfoPanel(currentState);
    console.log('📊 Updated info panel for revote display');
    
    // CRITICAL FIX: Hide lifeline voting panel during revote
    const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
    if (lifelineVotingPanel) {
        lifelineVotingPanel.classList.add('hidden');
        console.log('✅ Hidden lifeline voting panel for audience revote');
    }
    
    // Show voting section for revote
    const votingSection = document.getElementById('voting-section');
    if (votingSection) {
        votingSection.classList.remove('hidden');
        console.log('✅ Showed voting section for post-lifeline revote');
    } else {
        console.warn('⚠️ Voting section element not found');
    }
    
    // Start revote countdown
    startVotingCountdown(message.duration || 60000, message.startTime || Date.now());
}

// Handle post Ask-a-Mod revote
function handlePostAskAModRevote(message) {
    console.log('🔄 Post Ask-a-Mod revote started:', message);
    
    // CRITICAL FIX: Update current state to show revote is active
    currentState.is_revote_active = true;
    currentState.audience_poll_active = true; // Also mark poll as active for voting
    console.log('🔄 Updated currentState.is_revote_active to true for Ask a Mod revote');
    
    // Update info panel immediately to show revote status
    updateInfoPanel(currentState);
    console.log('📊 Updated info panel for Ask a Mod revote display');
    
    // CRITICAL FIX: Hide lifeline voting panel during revote
    const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
    if (lifelineVotingPanel) {
        lifelineVotingPanel.classList.add('hidden');
        console.log('✅ Hidden lifeline voting panel for Ask a Mod audience revote');
    }
    
    // Show voting section for revote  
    const votingSection = document.getElementById('voting-section');
    if (votingSection) {
        votingSection.classList.remove('hidden');
        console.log('✅ Showed voting section for post Ask-a-Mod revote');
    } else {
        console.warn('⚠️ Voting section element not found');
    }
    
    // Start revote countdown
    startVotingCountdown(message.duration || 60000, message.startTime || Date.now());
}

// Handle lifeline voting ended
function handleLifelineVotingEnded(message) {
    console.log('🏁 Lifeline voting ended:', message);
    
    // Hide lifeline voting panel
    const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
    if (lifelineVotingPanel) {
        lifelineVotingPanel.classList.add('hidden');
        console.log('✅ Hidden lifeline voting panel');
    } else {
        console.warn('⚠️ Lifeline voting panel element not found');
    }
    
    // Also hide the integrated voting display in the info panel
    const integratedVoting = document.getElementById('integrated-voting');
    if (integratedVoting) {
        integratedVoting.style.display = 'none';
        console.log('✅ Hidden integrated voting display in info panel');
    }
    
    // Reset the integrated timer in the info panel and clear urgent styling
    const integratedTimer = document.getElementById('integrated-lifeline-timer');
    if (integratedTimer) {
        integratedTimer.textContent = '60s'; // Reset to default
        integratedTimer.style.color = '';
        integratedTimer.style.textShadow = '';
        console.log('⏱️ Reset integrated lifeline timer to default');
    }
    
    // Also clear urgent styling from main timer
    const lifelineTimer = document.getElementById('lifeline-voting-timer');
    if (lifelineTimer) {
        lifelineTimer.style.color = '';
        lifelineTimer.style.textShadow = '';
    }
}

// Handle explicit hide lifeline voting panel message
function handleHideLifelineVotingPanel(message) {
    console.log('🔒 Hide lifeline voting panel message received:', message.reason || 'no reason provided');
    
    // Hide the lifeline voting panel
    const lifelineVotingPanel = document.getElementById('lifeline-voting-panel');
    if (lifelineVotingPanel) {
        lifelineVotingPanel.classList.add('hidden');
        console.log('✅ Hidden lifeline voting panel due to:', message.reason || 'explicit hide request');
    } else {
        console.warn('⚠️ Lifeline voting panel element not found when trying to hide');
    }
    
    // Also hide the integrated voting display in the info panel
    const integratedVoting = document.getElementById('integrated-voting');
    if (integratedVoting) {
        integratedVoting.style.display = 'none';
        console.log('✅ Hidden integrated lifeline voting display in info panel');
    }
    
    // Update current state to reflect lifeline voting is no longer active
    if (currentState) {
        currentState.lifeline_voting_active = false;
        // Force info panel to update to show normal content
        updateInfoPanel(currentState);
        console.log('📊 Updated info panel after hiding lifeline voting');
    }
    
    // Also stop any active countdown timer
    if (window.lifelineVotingInterval) {
        clearInterval(window.lifelineVotingInterval);
        window.lifelineVotingInterval = null;
        console.log('⏱️ Cleared lifeline voting countdown timer');
    }
}

// Handle giveaway overlay
function handleGiveawayOverlay(message) {
    console.log('🎁 Giveaway overlay:', message);
    
    if (message.action === 'show') {
        showGiveawayOverlay(message.data);
    } else if (message.action === 'add_entry') {
        addGiveawayEntry(message.data);
    } else if (message.action === 'hide') {
        hideGiveawayOverlay();
    }
}

// Show giveaway overlay
function showGiveawayOverlay(data) {
    const overlay = document.getElementById('giveaway-overlay');
    if (!overlay) return;
    
    const title = overlay.querySelector('.giveaway-title');
    const description = overlay.querySelector('.giveaway-description');
    const keyword = overlay.querySelector('.giveaway-keyword');
    
    if (title) title.textContent = data.title || 'Giveaway';
    if (description) description.textContent = data.description || '';
    if (keyword) keyword.textContent = data.keyword || '';
    
    overlay.classList.remove('hidden');
}

// Add giveaway entry
function addGiveawayEntry(data) {
    const entriesList = document.getElementById('giveaway-entries');
    if (!entriesList) return;
    
    const entry = document.createElement('div');
    entry.className = 'giveaway-entry';
    entry.textContent = data.username;
    
    entriesList.appendChild(entry);
    
    // Keep only last 20 entries visible
    const entries = entriesList.querySelectorAll('.giveaway-entry');
    if (entries.length > 20) {
        entries[0].remove();
    }
}

// Hide giveaway overlay
function hideGiveawayOverlay() {
    const overlay = document.getElementById('giveaway-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

// Handle chat message
function handleChatMessage(message) {
    console.log('💬 Chat message:', message);
    displayChatMessage(message);
}

// Display chat message
function displayChatMessage(message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    
    const usernameEl = document.createElement('span');
    usernameEl.className = 'chat-username';
    usernameEl.textContent = message.username;
    usernameEl.style.color = message.color || '#00ff00';
    
    const textEl = document.createElement('span');
    textEl.className = 'chat-text';
    textEl.textContent = message.text;
    
    messageEl.appendChild(usernameEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(textEl);
    
    chatMessages.appendChild(messageEl);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Keep only last 50 messages
    const messages = chatMessages.querySelectorAll('.chat-message');
    if (messages.length > 50) {
        messages[0].remove();
    }
}

// Update answer states based on game events
function updateAnswerStates(eventType, data) {
    console.log('🔄 Updating answer states:', eventType, data);
    
    switch(eventType) {
        case 'fiftyFifty':
            // Mark eliminated answers
            if (data.eliminated) {
                data.eliminated.forEach(letter => {
                    currentQuestionAnswerStates[letter] = 'eliminated';
                    eliminatedAnswers.push(letter);
                });
                console.log('❌ Eliminated answers:', data.eliminated);
            }
            break;
            
        case 'eliminated':
            // Mark answers as eliminated (50:50 lifeline)
            if (data && Array.isArray(data)) {
                data.forEach(letter => {
                    currentQuestionAnswerStates[letter] = 'eliminated';
                    console.log('🚫 Answer eliminated:', letter);
                });
                eliminatedAnswers = eliminatedAnswers.concat(data);
                console.log('✅ Updated eliminated answers list:', eliminatedAnswers);
            }
            break;
            
        case 'wrongAnswer':
            // Mark answer as previously wrong
            if (data.selectedAnswer) {
                const letter = ['A', 'B', 'C', 'D'][data.selectedAnswer];
                currentQuestionAnswerStates[letter] = 'wrong';
                previousWrongAnswers.push(letter);
                console.log('❌ Wrong answer marked:', letter);
            }
            break;
            
        case 'newQuestion':
        case 'reset':
            // Reset all answer states for new question
            currentQuestionAnswerStates = {
                A: 'available',
                B: 'available', 
                C: 'available',
                D: 'available'
            };
            eliminatedAnswers = [];
            previousWrongAnswers = [];
            console.log('🆕 Answer states reset for new question');
            break;
            
        case 'revote':
            // During revote, keep eliminated and wrong states
            console.log('🔄 Revote - maintaining answer states:', currentQuestionAnswerStates);
            break;
    }
    
    // If voting is active, refresh the display
    const integratedVoting = document.getElementById('integrated-voting');
    if (integratedVoting && integratedVoting.style.display !== 'none') {
        // Get current votes and refresh display
        const votingContent = document.getElementById('voting-content-integrated');
        if (votingContent) {
            // Force refresh by triggering update with current vote data
            const currentVotes = {};
            ['A', 'B', 'C', 'D'].forEach(letter => {
                const countEl = document.getElementById(`integrated-count-${letter}`);
                if (countEl) {
                    currentVotes[letter] = parseInt(countEl.textContent) || 0;
                }
            });
            updateIntegratedVoting(currentVotes);
        }
    }
}

// Handle Roary speech
function handleRoarySpeech(message) {
    console.log('🎤 Roary speech:', message);
    
    if (message.audioUrl) {
        playRoaryAudio(message.audioUrl);
    }
    
    if (message.text) {
        displayRoaryMessage(message.text);
    }
}

// Play Roary audio
async function playRoaryAudio(audioUrl) {
    const ttsAudio = document.getElementById('ttsAudio');
    if (!ttsAudio) return;
    
    try {
        ttsAudio.src = audioUrl;
        ttsAudio.volume = 0.8;
        await ttsAudio.play();
        console.log('🎵 Playing Roary audio:', audioUrl);
    } catch (error) {
        console.error('❌ Failed to play Roary audio:', error);
    }
}

// Display Roary message
function displayRoaryMessage(text) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message roary-message';
    
    const usernameEl = document.createElement('span');
    usernameEl.className = 'chat-username';
    usernameEl.textContent = 'Roary';
    usernameEl.style.color = '#ffd700';
    
    const textEl = document.createElement('span');
    textEl.className = 'chat-text';
    textEl.textContent = text;
    
    messageEl.appendChild(usernameEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(textEl);
    
    chatMessages.appendChild(messageEl);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Trigger confetti effect
function triggerConfetti() {
    console.log('🎊 Triggering confetti');
    
    // Create or get confetti container
    let container = document.querySelector('.confetti-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);
    }
    
    // Clear any existing particles
    container.innerHTML = '';
    
    // Create confetti particles shooting from both sides
    for (let i = 0; i < 60; i++) {
        createConfettiParticle(container, i % 2 === 0 ? 'left' : 'right', i);
    }
    
    // Remove container after animation completes
    setTimeout(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    }, 3000);
}

// Heartbeat mechanism for connection monitoring
function startHeartbeat() {
    stopHeartbeat(); // Clear any existing interval
    
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Send ping to server
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            
            // Check if we've missed too many heartbeats
            const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
            if (timeSinceLastHeartbeat > 30000) { // 30 seconds without response
                missedHeartbeats++;
                console.warn(`⚠️ Missed ${missedHeartbeats} heartbeats`);
                
                if (missedHeartbeats >= 3) {
                    console.error('❌ Connection appears dead, forcing reconnect');
                    ws.close();
                    scheduleReconnect();
                }
            }
        }
    }, 10000); // Send heartbeat every 10 seconds
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Create confetti particle
function createConfettiParticle(container, side, index) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle ' + side;
    
    // Random vertical starting position along the side
    const startY = Math.random() * window.innerHeight;
    particle.style.top = startY + 'px';
    
    // CRITICAL: Start particle off-screen to prevent appearing on screen before animation
    if (side === 'left') {
        particle.style.left = '-50px'; // Start well off the left edge
    } else {
        particle.style.right = '-50px'; // Start well off the right edge
    }
    
    // Initially hide particle until animation starts
    particle.style.opacity = '0';
    
    // Set color
    particle.style.backgroundColor = getRandomColor();
    
    // Stagger the animation for wave effect
    particle.style.animationDelay = (index * 0.02) + 's';
    
    // Add particle to container
    container.appendChild(particle);
    setTimeout(() => {
        particle.remove();
    }, 5000);
}

// Get random color for confetti
function getRandomColor() {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Utility function to handle user interaction for audio
function handleUserInteraction() {
    if (audioSystem) {
        // Enable audio playback after user interaction
        audioSystem.setVolumes();
    }
    
    // Remove event listeners after first interaction
    document.removeEventListener('click', handleUserInteraction);
    document.removeEventListener('keydown', handleUserInteraction);
}

// Add event listeners for user interaction
document.addEventListener('click', handleUserInteraction);
document.addEventListener('keydown', handleUserInteraction);

// Update info panel with audience guidance based on game state
// Game Tips Functions
function startTipsRotation() {
    // Rotate tips every 8 seconds
    tipRotationInterval = setInterval(rotateTip, 8000);
    console.log('💡 Started game tips rotation');
}

function stopTipsRotation() {
    if (tipRotationInterval) {
        clearInterval(tipRotationInterval);
        tipRotationInterval = null;
        console.log('💡 Stopped game tips rotation');
    }
}

function rotateTip() {
    currentTipIndex = (currentTipIndex + 1) % gameTips.length;
    console.log('💡 Rotating to tip #' + (currentTipIndex + 1) + ': ' + gameTips[currentTipIndex].title);
    
    // Only update the panel if we're currently showing tips
    if (currentState && shouldShowTips(currentState)) {
        updateInfoPanel(currentState);
    }
}

function getCurrentTip() {
    const tip = gameTips[currentTipIndex];
    console.log('📝 DEBUG: getCurrentTip called, index:', currentTipIndex, 'tip:', tip);
    return tip;
}

function shouldShowTips(state) {
    // Show tips when game is idle or in non-critical states
    // If state is empty or undefined, show tips
    if (!state || Object.keys(state).length === 0) {
        return true;
    }
    
    return !state.audience_poll_active && 
           !state.lifeline_voting_active && 
           !state.is_revote_active &&
           !state.waiting_for_mod_responses &&
           !state.mod_response_display_active &&
           !state.fifty_fifty_active &&
           !state.answer_locked_in &&
           !state.preparing_for_game &&           // Don't show tips when preparing for next question
           !state.game_active &&                  // Don't show tips when game is active (unless other conditions apply)
           (!state.answers_revealed || (!state.answer_is_wrong && state.answers_revealed));
}

function updateInfoPanel(state) {
    try {
        console.log('🔍 DEBUG: updateInfoPanel called with state:', {
            game_active: state.game_active,
            question_visible: state.question_visible,
            answers_visible: state.answers_visible,
            current_question: state.current_question,
            is_revote_active: state.is_revote_active,
            audience_poll_active: state.audience_poll_active,
            lifeline_voting_active: state.lifeline_voting_active,
            preparing_for_game: state.preparing_for_game,
            answer_locked_in: state.answer_locked_in,
            answers_revealed: state.answers_revealed,
            answer_is_wrong: state.answer_is_wrong
        });
        
        const infoArea = document.getElementById('info-area');
        const infoTitle = document.getElementById('info-title');
        const infoIcon = document.getElementById('info-icon');
        const infoMessage = document.getElementById('info-message');
        const infoDetails = document.getElementById('info-details');
        
        console.log('🔍 DEBUG: Elements found status:', {
            infoArea: !!infoArea,
            infoTitle: !!infoTitle,
            infoIcon: !!infoIcon,
            infoMessage: !!infoMessage,
            infoDetails: !!infoDetails
        });
        
        if (!infoArea || !infoTitle || !infoIcon || !infoMessage || !infoDetails) {
            console.log('❌ DEBUG: Missing info area elements, cannot update panel');
            return;
        }

        if (state.hot_seat_entry_active) {
            const entryMessage = state.hot_seat_entry_message || 'Type JOIN in chat to enter the hot seat!';
            const remainingSeconds = typeof state.hot_seat_entry_remaining === 'number'
                ? Math.max(0, state.hot_seat_entry_remaining)
                : null;
            const entriesCount = typeof state.hot_seat_entry_count === 'number'
                ? state.hot_seat_entry_count
                : 0;

            infoTitle.textContent = 'HOT SEAT ACTIVATED';

            const iconSpan = infoIcon.querySelector('span');
            if (iconSpan) {
                iconSpan.textContent = '🔥';
            } else {
                infoIcon.textContent = '🔥';
            }

            infoMessage.textContent = entryMessage;
            infoMessage.style.display = 'block';

            const detailsParts = [];
            if (remainingSeconds !== null) {
                const minutes = Math.floor(remainingSeconds / 60);
                const seconds = remainingSeconds % 60;
                const formatted = minutes > 0
                    ? `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
                    : `${seconds}s remaining`;
                detailsParts.push(formatted);
            }

            detailsParts.push(entriesCount === 1 ? '1 entry so far' : `${entriesCount} entries so far`);

            if (state.hot_seat_entry_last_join) {
                detailsParts.push(`${state.hot_seat_entry_last_join} joined!`);
            }

            infoDetails.textContent = detailsParts.filter(Boolean).join(' • ');
            infoDetails.style.display = 'block';

            const integratedVoting = document.getElementById('integrated-voting');
            if (integratedVoting) {
                integratedVoting.style.display = 'none';
            }

            return;
        }

        // Determine dynamic status based on actual game state
        let title = "GAME STATUS";
        let icon = "🎮";
        let message = "";
        let details = "";
        
        // Only remove hidden class if needed, let CSS handle display
        if (infoArea.classList.contains('hidden')) {
            console.log('🔧 Removing hidden class from info panel');
            infoArea.classList.remove('hidden');
        }
    
        // Voting section is now separate and handled independently
        // Info panel remains static and just updates its content
        
        // Check if we should show tips instead of game state
        const shouldShowGameTips = shouldShowTips(state);
        console.log('🎯 DEBUG: Should show tips?', shouldShowGameTips);
        console.log('🎯 DEBUG: Tips condition breakdown:', {
            emptyState: !state || Object.keys(state).length === 0,
            audience_poll_active: state.audience_poll_active,
            lifeline_voting_active: state.lifeline_voting_active,
            is_revote_active: state.is_revote_active,
            game_active: state.game_active,
            preparing_for_game: state.preparing_for_game
        });
    
        // Check if voting is active - both audience polls and lifeline voting
        const votingIsActive = state.audience_poll_active || 
                              state.lifeline_voting_active || 
                              state.is_revote_active ||
                              state.waiting_for_mod_responses ||
                              state.mod_response_display_active;
    
    // Check if voting is active - if so, show voting display instead of normal content
    // Include revotes after lifelines!
    // CRITICAL FIX: Check is_revote_active FIRST to prioritize revote display over lifeline voting
    if (state.is_revote_active) {
        // Post-lifeline revote - ALWAYS show audience voting, NEVER lifeline voting
        console.log('🔄 Showing REVOTE display in info panel (ABSOLUTE PRIORITY over lifeline voting)');
        console.log('🔍 DEBUG: is_revote_active=true, forcing audience voting display regardless of other states');
        
        // Clear normal content and show voting display
        infoMessage.textContent = '';
        infoDetails.textContent = '';
        infoMessage.style.display = 'none';
        infoDetails.style.display = 'none';
        
        title = "REVOTE ACTIVE";
        icon = "🔄";
        
        // Only call showIntegratedVoting if it's not already visible
        const integratedVotingRevote = document.getElementById('integrated-voting');
        if (!integratedVotingRevote || integratedVotingRevote.style.display === 'none') {
            // Show integrated voting display for audience revote
            showIntegratedVoting(state);
        }
        
        // Update title and icon
        infoTitle.textContent = title;
        infoIcon.textContent = icon;
        
        return; // Exit early since revote display handles everything
    } else if (state.audience_poll_active && !state.lifeline_voting_active) {
        // Regular audience poll (not lifeline voting)
        console.log('🗳️ Showing regular audience poll display');
        
        // Clear normal content and show voting display
        infoMessage.textContent = '';
        infoDetails.textContent = '';
        infoMessage.style.display = 'none';
        infoDetails.style.display = 'none';
        
        title = "AUDIENCE VOTING";
        icon = "🗳️";
        
        // Only call showIntegratedVoting if it's not already visible
        const integratedVoting = document.getElementById('integrated-voting');
        if (!integratedVoting || integratedVoting.style.display === 'none') {
            // Show integrated voting display for audience poll
            showIntegratedVoting(state);
        }
        
        // Update title and icon
        infoTitle.textContent = title;
        infoIcon.textContent = icon;
        
        return; // Exit early
    } else if (state.lifeline_voting_active && !state.is_revote_active && !state.audience_poll_active) {
        // ONLY show lifeline voting if we're absolutely sure it's not a revote
        console.log('🎯 Showing LIFELINE voting display (confirmed not a revote)');
        console.log('🔍 DEBUG: lifeline_voting_active=true, is_revote_active=false, audience_poll_active=false');
        
        // Clear any existing text content first
        infoMessage.textContent = '';
        infoDetails.textContent = '';
        infoMessage.style.display = 'none';
        infoDetails.style.display = 'none';
        
        title = "VOTING FOR LIFELINE";
        icon = "🎯";
        // Show lifeline voting display
        showIntegratedLifelineVoting(state);
        
        // Update title and icon
        infoTitle.textContent = title;
        infoIcon.textContent = icon;
        
        return; // Exit early since voting display handles the rest
    } else {
        // Make sure voting displays are hidden when voting is not active
        const integratedVoting = document.getElementById('integrated-voting');
        if (integratedVoting && integratedVoting.style.display !== 'none') {
            integratedVoting.style.display = 'none';
            console.log('✅ Hidden integrated voting - voting not active');
        }
    }
    
    // Normal content when not voting - show message and details
    infoMessage.style.display = 'block';
    infoDetails.style.display = 'block';
    
    // Determine dynamic game status based on actual state
    if (!state.game_active) {
        title = "WAITING FOR HOST";
        icon = "⏸️";
        message = "Game Inactive";
        details = "Waiting for the host to start the game";
    } else if (state.answers_revealed && state.answer_is_wrong) {
        title = "WRONG ANSWER";
        icon = "❌";
        message = "Incorrect!";
        details = "The answer was wrong. Lifelines may be available.";
    } else if (state.answers_revealed && !state.answer_is_wrong) {
        title = "CORRECT!";
        icon = "✅";
        message = "Well Done!";
        details = "The answer was correct! Moving on...";
    } else if (state.answer_locked_in) {
        title = "ANSWER LOCKED IN";
        icon = "🔒";
        message = "Locked and Loaded";
        details = "Waiting for the reveal...";
    } else if (state.answers_visible && !state.answer_locked_in) {
        title = "SELECT YOUR ANSWER";
        icon = "🤔";
        message = "Make Your Choice";
        details = "The host will lock in an answer soon";
    } else if (state.question_visible && !state.answers_visible) {
        title = "QUESTION " + (state.current_question + 1) + " OF 15";
        icon = "❓";
        message = "Reading Question";
        details = "Answers will be revealed shortly";
    } else if (state.preparing_for_game) {
        title = "PREPARING";
        icon = "⏳";
        message = "Get Ready!";
        
        // Show a quick pro tip while preparing
        details = getRandomProTip();
    } else if (state.curtains_closed) {
        title = "GAME STARTING";
        icon = "🎬";
        message = "Opening Curtains";
        details = "The show is about to begin!";
    } else if (state.is_revote_active) {
        title = "REVOTE ACTIVE";
        icon = "🔄";
        message = "Second Chance!";
        details = "Vote again after the lifeline!";
    } else {
        // Default fallback state - show pro tips when idle
        title = "GAME READY";
        icon = "🎮";
        if (state.contestant_name) {
            message = state.contestant_name;
            // Show rotating pro tips when waiting
            if (!tipRotationInterval) {
                startTipRotation();
            }
            details = getRandomProTip();
        } else {
            message = "Kimbillionaire";
            details = getRandomProTip();
        }
    }
    
    // Update the panel content
    console.log('📝 DEBUG: Final info panel content determined:', { title, icon, message, details });
    console.log('📝 DEBUG: Setting info panel content in DOM');
    infoTitle.textContent = title;
    infoIcon.innerHTML = '<span>' + icon + '</span>';
    
    // Only set message and details content if they will be visible
    if (!votingIsActive) {
        infoMessage.textContent = message;
        infoDetails.textContent = details;
    }
    
    console.log('📝 DEBUG: Content set - verifying:', {
        titleContent: infoTitle.textContent,
        iconContent: infoIcon.textContent,
        messageContent: infoMessage.textContent,
        detailsContent: infoDetails.textContent,
        votingIsActive: votingIsActive,
        panelVisible: infoPanel.style.display
    });
    
    // Show/hide integrated voting based on any voting state (audience poll OR lifeline voting)
    const integratedVoting = document.getElementById('integrated-voting');
    const infoContent = document.getElementById('info-content');
    
    if (integratedVoting) {
        if (state.audience_poll_active || state.lifeline_voting_active) {
            console.log('📊 Showing integrated voting in info panel (audience or lifeline)');
            integratedVoting.style.display = 'block';
            // Add voting-active class to change layout behavior
            if (infoContent) infoContent.classList.add('voting-active');
            // Hide ONLY the message and details text when voting is active
            if (infoMessage) infoMessage.style.display = 'none';
            if (infoDetails) infoDetails.style.display = 'none';
        } else {
            console.log('📊 Hiding integrated voting in info panel');
            integratedVoting.style.display = 'none';
            // Remove voting-active class to restore normal layout
            if (infoContent) infoContent.classList.remove('voting-active');
            // Show regular info content when no voting is active
            if (infoMessage) infoMessage.style.display = 'block';
            if (infoDetails) infoDetails.style.display = 'block';
        }
    }
    
        // Stop tips rotation when we're showing active game content or voting
        if ((state.game_active || state.audience_poll_active || state.lifeline_voting_active) && tipRotationInterval) {
            stopTipRotation();
        }
    } catch (error) {
        console.error('❌ Error in updateInfoPanel:', error);
        // Don't let info panel errors stop other display updates
    }
}

// Handle mod response update messages during Ask a Mod
function handleModResponseUpdate(message) {
    console.log('🛡️ Received mod response update:', message);
    if (message.newResponse) {
        displayModResponseInGameshow(message.newResponse);
    } else if (message.modResponse) {
        displayModResponseInGameshow(message.modResponse);
    }
}

// Handle Ask a Mod display updates
function handleAskAModDisplayUpdate(message) {
    console.log('🛡️ Received Ask a Mod display update:', message);
    
    if (message.newResponse) {
        displayModResponseInGameshow(message.newResponse);
    }
    
    // Update display with all responses if provided
    if (message.allResponses && Array.isArray(message.allResponses)) {
        displayAllModResponses(message.allResponses);
    }
}

// Twitch Emote Definitions for mod response display - All 81 emotes
const TWITCH_EMOTES = {
  'k1m6aClipit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c6a0b28a6a5548c8b64698444174173a/default/dark/2.0',
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
  'k1m6aDj': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8cf31502415443788a03fe3aefc1a7af/default/dark/2.0',
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
  'k1m6aJam': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e849d7766e9e4293a881e75f8139552c/default/dark/2.0',
  'k1m6aJason': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_85afabbfc15e49c69c9064ae5b8bd6bd/default/dark/2.0',
  'k1m6aKekw': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_48b672a057f74de0b953f7004c66d8b9/default/dark/2.0',
  'k1m6aL': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a383d8c68a0444dd8e2bf1b9ee0b3c30/default/dark/2.0',
  'k1m6aLearn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_95fb44fddcaf48069e02f4ef5d84ff82/default/dark/2.0',
  'k1m6aLettuce': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_33109ae4e55d45838bf0895d226a8a8c/default/dark/2.0',
  'k1m6aLove': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_767294f4fbf14deaa65487efb5e11b55/default/dark/2.0',
  'k1m6aLul': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_04f3c7fe0428460e855cbd6a62aa8b07/default/dark/2.0',
  'k1m6aLurk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dbcaac379c324382b41b6fbc716f3966/default/dark/2.0',
  'k1m6aMod': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ca20669eb3d9410dbe6907d3fb427fd5/default/dark/2.0',
  'k1m6aMoney': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e84f0755bec84b8da286011bcf9503d1/default/dark/2.0',
  'k1m6aNo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e555a2b5667e4a73bc55f163ff1a6fc9/default/dark/2.0',
  'k1m6aPat': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_300ed456269c49928bc5d0db072a9c95/default/dark/2.0',
  'k1m6aPew': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d763ee290c774744a6b006754ae6b52b/default/dark/2.0',
  'k1m6aPixel': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cc583397b8d14507af71592fc3b15c2b/default/dark/2.0',
  'k1m6aPog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_03b9318aa256404590085b7aad65eb82/default/dark/2.0',
  'k1m6aPopcorn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_bfdfdcf6304e4ec4a4890449601cc0ba/default/dark/2.0',
  'k1m6aPray': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1b5460d0cb5043d3bb842b222188ac52/default/dark/2.0',
  'k1m6aPride': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_081872353abf446d80cbe106d9755a61/default/dark/2.0',
  'k1m6aPsg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_57fc02265af64c63b30106e2b83fd75e/default/dark/2.0',
  'k1m6aPsgjuice': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ea0ac815167448e7a1cafde20fe93427/default/dark/2.0',
  'k1m6aPuke': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_27486795377745d8a237370db0d08501/default/dark/2.0',
  'k1m6aRage': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_bc68594da22d4efc88c83016d7248eb6/default/dark/2.0',
  'k1m6aRip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c7fb2c733dde4b898723521a606ff63e/default/dark/2.0',
  'k1m6aSad': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_69b1ba54dc0a4d0890f85f3ab72e0e43/default/dark/2.0',
  'k1m6aSalute': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b6e561b15bb1485683e3bdb862204b49/default/dark/3.0',
  'k1m6aShock': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ffdf2bdc4405492798e761ad16617199/default/dark/2.0',
  'k1m6aSip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3687a7632e6a489e9f951fa976947a1b/default/dark/2.0',
  'k1m6aSleep': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0ef29e6d15f2416a90d7fd4677b6b6e6/default/dark/2.0',
  'k1m6aSmug': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8a344f3f450944a7932025656003d66c/default/dark/2.0',
  'k1m6aSniper': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f8bca68fd1b04ff4a662c65896f32c19/default/dark/2.0',
  'k1m6aStab': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_076521534f724bec852d2ada23458216/default/dark/2.0',
  'k1m6aStare': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a7ab8ce9904f4ebc8448e9aff4e7f25d/default/dark/2.0',
  'k1m6aSteer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7f852081c9a14efe9bde161c4359a528/default/dark/2.0',
  'k1m6aSuit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a70b975f48634e2c856e06b4d8520534/default/dark/2.0',
  'k1m6aTaptap': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_be90f6cee63445f290b0e03f9e43d43e/default/dark/2.0',
  'k1m6aThink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c7461b2486334be587e6dc97f344eb32/default/dark/2.0',
  'k1m6aTongue': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e3685e6f62d5472b8c31714fde236039/default/dark/2.0',
  'k1m6aUmbrella': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f07b5d75ddf14638add815e7341b113f/default/dark/2.0',
  'k1m6aW': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1ff0e62efa884e619e3bd8d8b05c5704/default/dark/2.0',
  'k1m6aWave': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_eef8c2eca3974415b13dc80f291c2f96/default/dark/2.0',
  'k1m6aWiggle': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_59d9e228421a43dcbdb44d58f2ce4866/default/dark/2.0',
  'k1m6aWink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7cf3df4d43324e3d89c0c071fea2f8e4/default/dark/2.0',
  'k1m6aWow': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_45b386bb9be44b0e8b3b72de2da02ce9/default/dark/2.0',
  'k1m6aXmasgift': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_261341b67fe8409baced480af78130e2/default/dark/2.0',
  'k1m6aYes': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1f4eb7f1a0e64f0e91ede6be618e0760/default/dark/2.0',
  'k1m6aZombie': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c65f4314d1b94f1c8bd10ba7d139d6c1/default/dark/2.0'
};

// Function to replace Twitch emote text with images
function replaceTwitchEmotes(text) {
  // HTML escape the text first for security
  let processedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  // Sort emotes by length (longest first) to avoid partial replacements
  const sortedEmotes = Object.keys(TWITCH_EMOTES).sort((a, b) => b.length - a.length);
  
  // Replace each emote with an img tag
  sortedEmotes.forEach(emote => {
    const regex = new RegExp(`\\b${emote}\\b`, 'g');
    const imgTag = `<img src="${TWITCH_EMOTES[emote]}" alt="${emote}" style="display: inline-block; width: 24px; height: 24px; vertical-align: middle; margin: 0 2px;">`;
    processedText = processedText.replace(regex, imgTag);
  });
  
  return processedText;
}

// Display a single mod response in the centered panel
function displayModResponseInGameshow(modResponse) {
    if (!modResponse || !modResponse.username || !modResponse.message) {
        console.warn('⚠️ Invalid mod response:', modResponse);
        return;
    }
    
    const icon = modResponse.isVIP ? '💎' : '🛡️';
    const userClass = modResponse.isVIP ? 'vip' : '';
    console.log(`${icon} Displaying response from ${modResponse.userType || 'moderator'} ${modResponse.username}: ${modResponse.message}`);
    
    // Get the centered mod response panel
    const panel = document.getElementById('mod-response-panel');
    const container = document.getElementById('mod-response-container');
    
    if (!panel || !container) {
        console.error('❌ Mod response panel not found in DOM');
        return;
    }
    
    // Show the panel if hidden
    if (panel.classList.contains('hidden')) {
        showModResponsePanel();
    }
    
    // Create mod response element
    const responseEl = document.createElement('div');
    responseEl.className = 'mod-response-item';
    
    // Create header
    const headerEl = document.createElement('div');
    headerEl.className = 'mod-response-item-header';
    
    const iconEl = document.createElement('span');
    iconEl.className = 'mod-response-icon';
    iconEl.textContent = icon;
    
    const usernameEl = document.createElement('span');
    usernameEl.className = 'mod-response-username' + (userClass ? ' ' + userClass : '');
    usernameEl.textContent = modResponse.username;
    
    headerEl.appendChild(iconEl);
    headerEl.appendChild(usernameEl);
    
    // Create message
    const messageEl = document.createElement('div');
    messageEl.className = 'mod-response-message';
    // Process emotes and use innerHTML to display them
    messageEl.innerHTML = replaceTwitchEmotes(modResponse.message);
    
    // Assemble response element
    responseEl.appendChild(headerEl);
    responseEl.appendChild(messageEl);
    
    // Add to container without delay
    container.appendChild(responseEl);
    
    // Force display update
    console.log(`✅ Added response to panel - Total responses now: ${container.children.length}`);
    
    // Update status
    updateModResponseStatus();
    
    // Auto-scroll to latest response
    container.scrollTop = container.scrollHeight;
    
    console.log('✅ Added response to centered mod panel');
}

// Display all mod responses (used for full updates)
function displayAllModResponses(responses) {
    if (!Array.isArray(responses)) {
        console.warn('⚠️ Invalid responses array:', responses);
        return;
    }
    
    console.log('🛡️ Displaying all mod responses:', responses.length, 'total');
    
    // Get the centered mod response panel
    const panel = document.getElementById('mod-response-panel');
    const container = document.getElementById('mod-response-container');
    
    if (!panel || !container) {
        console.error('❌ Mod response panel not found in DOM');
        return;
    }
    
    // Clear existing responses
    container.innerHTML = '';
    
    // Show the panel if hidden
    if (panel.classList.contains('hidden')) {
        showModResponsePanel();
    }
    
    // Add all responses
    responses.forEach((response, index) => {
        if (response && response.username && response.message) {
            const icon = response.isVIP ? '💎' : '🛡️';
            const userClass = response.isVIP ? 'vip' : '';
            
            const responseEl = document.createElement('div');
            responseEl.className = 'mod-response-item';
            
            // Create header
            const headerEl = document.createElement('div');
            headerEl.className = 'mod-response-item-header';
            
            const iconEl = document.createElement('span');
            iconEl.className = 'mod-response-icon';
            iconEl.textContent = icon;
            
            const usernameEl = document.createElement('span');
            usernameEl.className = 'mod-response-username' + (userClass ? ' ' + userClass : '');
            usernameEl.textContent = response.username;
            
            headerEl.appendChild(iconEl);
            headerEl.appendChild(usernameEl);
            
            // Create message
            const messageEl = document.createElement('div');
            messageEl.className = 'mod-response-message';
            // Process emotes and use innerHTML to display them
            messageEl.innerHTML = replaceTwitchEmotes(response.message);
            
            // Assemble response element
            responseEl.appendChild(headerEl);
            responseEl.appendChild(messageEl);
            
            // Add to container
            container.appendChild(responseEl);
        }
    });
    
    // Update status
    updateModResponseStatus();
    
    console.log('✅ Displayed all mod responses in centered panel');
}

// Helper function to show the mod response panel
function showModResponsePanel() {
    const panel = document.getElementById('mod-response-panel');
    const title = document.getElementById('mod-response-title');
    
    if (panel) {
        panel.classList.remove('hidden');
        
        // Update title based on mode
        if (title) {
            const includeVips = currentState && currentState.ask_a_mod_include_vips;
            title.textContent = includeVips ? 'ASK A MOD/VIP' : 'ASK A MOD';
        }
        
        // Start timer if Ask a Mod is active
        if (currentState && currentState.ask_a_mod_active) {
            startModResponseTimer();
        }
        
        console.log('📺 Mod response panel shown');
    }
}

// Helper function to hide the mod response panel
function hideModResponsePanel() {
    const panel = document.getElementById('mod-response-panel');
    const container = document.getElementById('mod-responses-list');
    
    if (panel) {
        panel.classList.add('hidden');
        
        // Clear responses
        if (container) {
            container.innerHTML = '';
        }
        
        console.log('📺 Mod response panel hidden');
    }
}

// Update the status text in the mod response panel
function updateModResponseStatus() {
    const statusEl = document.getElementById('mod-response-status');
    const container = document.getElementById('mod-responses-list');
    
    if (statusEl && container) {
        const count = container.children.length;
        if (count === 0) {
            statusEl.textContent = 'Waiting for responses...';
        } else if (count === 1) {
            statusEl.textContent = '1 response received';
        } else {
            statusEl.textContent = `${count} responses received`;
        }
    }
}

// Start the countdown timer for Ask a Mod
function startModResponseTimer() {
    const timerEl = document.getElementById('mod-response-timer');
    
    if (!timerEl || !currentState || !currentState.ask_a_mod_start_time) return;
    
    const duration = currentState.ask_a_mod_duration || 30000;
    
    // Clear any existing timer
    if (window.modResponseTimerInterval) {
        clearInterval(window.modResponseTimerInterval);
    }
    
    window.modResponseTimerInterval = setInterval(() => {
        const elapsed = Date.now() - currentState.ask_a_mod_start_time;
        const remaining = Math.max(0, duration - elapsed);
        
        const seconds = Math.ceil(remaining / 1000);
        const displaySeconds = seconds % 60;
        const displayMinutes = Math.floor(seconds / 60);
        
        timerEl.textContent = displayMinutes > 0 ? 
            `${displayMinutes}:${displaySeconds.toString().padStart(2, '0')}` : 
            `0:${displaySeconds.toString().padStart(2, '0')}`;
        
        if (remaining === 0) {
            clearInterval(window.modResponseTimerInterval);
            window.modResponseTimerInterval = null;
        }
    }, 100);
}

// Handle Ask a Mod session ended
function handleAskAModEnded(message) {
    console.log('🛡️ Ask a Mod session ended:', message);
    
    // Clear timer
    if (window.modResponseTimerInterval) {
        clearInterval(window.modResponseTimerInterval);
        window.modResponseTimerInterval = null;
    }
    
    // Hide panel after a short delay to show final status
    setTimeout(() => {
        hideModResponsePanel();
    }, 3000);
    
    // Hide the mod responses container after a brief delay
    setTimeout(() => {
        const modContainer = document.getElementById('mod-responses-container');
        if (modContainer) {
            modContainer.style.display = 'none';
            console.log('✅ Hidden mod responses container after Ask a Mod ended');
        }
    }, 2000); // 2-second delay to let users read final responses
}

// Pro Tips Functions
function getRandomProTip() {
    // Get a random tip from the array
    const randomIndex = Math.floor(Math.random() * proTips.length);
    return proTips[randomIndex];
}

function getNextProTip() {
    // Cycle through tips in order
    const tip = proTips[currentTipIndex];
    currentTipIndex = (currentTipIndex + 1) % proTips.length;
    return tip;
}

function startTipRotation() {
    // Stop any existing rotation
    if (tipRotationInterval) {
        clearInterval(tipRotationInterval);
    }
    
    // Rotate tips every 8 seconds
    tipRotationInterval = setInterval(() => {
        // Only update if we're in the idle state
        if (currentState && currentState.contestant_name && !currentState.game_active && 
            !currentState.audience_poll_active && !currentState.lifeline_voting_active) {
            updateInfoPanel(currentState);
        }
    }, 8000);
}

function stopTipRotation() {
    if (tipRotationInterval) {
        clearInterval(tipRotationInterval);
        tipRotationInterval = null;
    }
}

// How to Play Panel Functions
function showHowToPlay() {
    const panel = document.getElementById('how-to-play-panel');
    if (panel) {
        panel.classList.remove('hidden');
        panel.classList.add('visible');
        console.log('📖 Showing How to Play panel');
    }
}

function hideHowToPlay() {
    const panel = document.getElementById('how-to-play-panel');
    if (panel) {
        panel.classList.remove('visible');
        panel.classList.add('hidden');
        console.log('📖 Hiding How to Play panel');
    }
}

// Credits Display Functions
function showCredits(participants) {
    const overlay = document.getElementById('credits-overlay');
    const participantsContainer = document.getElementById('credits-participants');
    
    if (!overlay || !participantsContainer) {
        console.error('❌ Credits elements not found');
        return;
    }
    
    // Clear previous participants
    participantsContainer.innerHTML = '';
    
    // Show the overlay
    overlay.classList.remove('hidden');
    console.log('🎬 Showing credits with', participants.length, 'participants');
    
    // Create scrolling container for all names
    if (participants && participants.length > 0) {
        // Create a container that will scroll
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'credits-name-container';
        
        // Add all participant names to the scrolling container
        participants.forEach((participant, index) => {
            const nameDiv = document.createElement('div');
            nameDiv.className = 'credits-name';
            nameDiv.textContent = participant;
            scrollContainer.appendChild(nameDiv);
        });
        
        // Add the scrolling container to the viewport
        participantsContainer.appendChild(scrollContainer);
        
        // Calculate duration based on number of participants (about 1.5 seconds per name)
        const scrollDuration = Math.max(10, participants.length * 1.5);
        scrollContainer.style.animationDuration = scrollDuration + 's';
        
        console.log(`🎬 Starting credit scroll for ${participants.length} names over ${scrollDuration} seconds`);
        
        // Start fade out after scroll completes
        setTimeout(() => {
            console.log('🎬 Credits scroll complete, starting fade out');
            
            // Add fade out transition
            overlay.style.transition = 'opacity 2s ease-out';
            overlay.style.opacity = '0';
            
            // Hide completely after fade
                setTimeout(() => {
                    overlay.classList.add('hidden');
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                    overlay.classList.remove('credits-roll-active');

                    // Clear the local credits state
                    if (currentState) {
                        currentState.credits_rolling = false;
                        currentState.credits_displayed = false;
                }
                
                // Notify server that credits are complete
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'credits_complete',
                        timestamp: Date.now()
                    }));
                    console.log('📡 Sent credits_complete to server');
                }
                
                console.log('🎬 Credits fully hidden');
            }, 2000); // Wait for fade to complete
        }, scrollDuration * 1000); // Start fade right after last name exits
        
    } else {
        // No participants, show default message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'credits-name';
        messageDiv.textContent = 'Thanks for watching!';
        participantsContainer.appendChild(messageDiv);
        
        // Auto-hide after a delay with fade
        setTimeout(() => {
            // Fade out smoothly
            overlay.style.transition = 'opacity 2s ease-out';
            overlay.style.opacity = '0';
            
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.classList.remove('credits-roll-active');

                if (currentState) {
                    currentState.credits_rolling = false;
                    currentState.credits_displayed = false;
                }
                
                // Notify server that credits are complete
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'credits_complete',
                        timestamp: Date.now()
                    }));
                    console.log('📡 Sent credits_complete to server');
                }
            }, 2000);
        }, 3000); // Show message for 3 seconds before fading
    }
}

function hideCredits() {
    const overlay = document.getElementById('credits-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('credits-roll-active');
        console.log('🎬 Hiding credits');
    }
}

// Toggle How to Play panel with keyboard shortcut
document.addEventListener('keydown', function(event) {
    // Press 'H' to toggle How to Play panel
    if (event.key === 'h' || event.key === 'H') {
        const panel = document.getElementById('how-to-play-panel');
        if (panel) {
            if (panel.classList.contains('visible')) {
                hideHowToPlay();
            } else {
                showHowToPlay();
            }
        }
    }
    // Press 'Escape' to close How to Play panel
    if (event.key === 'Escape') {
        const panel = document.getElementById('how-to-play-panel');
        if (panel && panel.classList.contains('visible')) {
            hideHowToPlay();
        }
    }
});

console.log('📜 Kimbillionaire gameshow client script loaded');
// Hot Seat Feature Functions

let hotSeatEntryState = {
    active: false,
    remainingSeconds: 0,
    entries: 0,
    message: '',
    lastJoin: null
};

let hotSeatProfileHideTimeout = null;
let hotSeatProfileCountdownRemaining = null;
let hotSeatProfileCountdownTotal = null;

function escapeHtml(unsafe = '') {
    return (unsafe || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildHotSeatStoryMarkup(profileData, primaryUser) {
    if (!profileData || typeof profileData !== 'object') {
        return '';
    }

    const storyHtml = typeof profileData.storyHtml === 'string' ? profileData.storyHtml.trim() : '';
    if (storyHtml) {
        return storyHtml;
    }

    const storyText = typeof profileData.storyText === 'string' ? profileData.storyText.trim() : '';
    if (!storyText) {
        return '';
    }

    const displayName = (profileData.displayName || profileData.username || primaryUser || '').trim() || primaryUser || '';
    const safeDisplayName = escapeHtml(displayName);

    const paragraphBlocks = storyText
        .split(/\r?\n{2,}/)
        .map((block) => block
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean))
        .filter((lines) => lines.length > 0)
        .map((lines) => `<p>${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`);

    const storyBody = paragraphBlocks.join('') || `<p>${escapeHtml(storyText)}</p>`;

    return `
        <div class="hot-seat-profile-story-block hot-seat-profile-story-meta">
            <span class="hot-seat-profile-story-label">Username:</span>
            <span class="hot-seat-profile-story-value">${safeDisplayName}</span>
        </div>
        <div class="hot-seat-profile-story-block hot-seat-profile-story-text">
            <span class="hot-seat-profile-story-label">Story:</span>
            <div class="hot-seat-profile-story-text-body">${storyBody}</div>
        </div>
    `.trim();
}

function formatHotSeatSelectionMethod(method) {
    switch (method) {
        case 'join_entry':
            return 'Random draw from JOIN entries';
        case 'participants':
            return 'Selected from participant pool';
        case 'recent_chat':
            return 'Recent chat spotlight';
        case 'poll_history':
            return 'Selected from poll history';
        case 'manual':
            return 'Host selected hot seat';
        default:
            return 'Hot seat selection';
    }
}

function hideHotSeatProfileCard(instant = false) {
    const overlay = document.getElementById('hot-seat-profile-overlay');
    if (!overlay) {
        return;
    }

    const countdownEl = document.getElementById('hot-seat-profile-countdown');
    if (countdownEl) {
        countdownEl.classList.add('hidden');
        countdownEl.textContent = '';
    }

    hotSeatProfileCountdownRemaining = null;
    hotSeatProfileCountdownTotal = null;

    if (hotSeatProfileHideTimeout) {
        clearTimeout(hotSeatProfileHideTimeout);
        hotSeatProfileHideTimeout = null;
    }

    if (overlay.classList.contains('hidden')) {
        return;
    }

    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('show');

    if (instant) {
        overlay.classList.add('hidden');
        return;
    }

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 400);
}

function showHotSeatProfileCard(primaryUser, profileData, alternateProfileEntries = [], alternateNames = [], selectionMethod = 'manual', announcement = '', options = {}) {
    const overlay = document.getElementById('hot-seat-profile-overlay');
    if (!overlay) {
        return;
    }

    hideHotSeatProfileCard(true);

    const { displayDurationMs, countdownSeconds = null } = options || {};
    const fallbackDuration = typeof displayDurationMs === 'number' && displayDurationMs > 0
        ? displayDurationMs
        : 8000;

    const nameEl = document.getElementById('hot-seat-profile-name');
    const taglineEl = document.getElementById('hot-seat-profile-tagline');
    const blurbEl = document.getElementById('hot-seat-profile-blurb');
    const countdownEl = document.getElementById('hot-seat-profile-countdown');
    const dividerEl = document.getElementById('hot-seat-profile-divider');
    const storyEl = document.getElementById('hot-seat-profile-story');
    const alternatesEl = document.getElementById('hot-seat-profile-alternates');

    if (nameEl) {
        nameEl.textContent = (profileData && profileData.displayName) || primaryUser;
    }

    if (taglineEl) {
        taglineEl.textContent = formatHotSeatSelectionMethod(selectionMethod || 'manual');
    }

    if (blurbEl) {
        const defaultBlurb = announcement && announcement.trim().length > 0
            ? announcement
            : `${primaryUser} has been selected for the hot seat! Cheer them on!`;
        blurbEl.textContent = defaultBlurb;
    }

    const storyMarkup = buildHotSeatStoryMarkup(profileData, primaryUser);
    if (storyEl && dividerEl) {
        if (storyMarkup && storyMarkup.trim().length > 0) {
            storyEl.innerHTML = storyMarkup;
            storyEl.classList.remove('hidden');
            dividerEl.classList.remove('hidden');
        } else {
            storyEl.innerHTML = '';
            storyEl.classList.add('hidden');
            dividerEl.classList.add('hidden');
        }
    }

    if (alternatesEl) {
        const fallbackNames = Array.isArray(alternateNames) ? alternateNames : [];
        const uploadedNames = Array.isArray(alternateProfileEntries)
            ? alternateProfileEntries
                .map(entry => (entry && entry.profile && (entry.profile.displayName || entry.profile.username || entry.username)) || null)
                .filter(Boolean)
            : [];

        const combined = (uploadedNames.length > 0 ? uploadedNames : fallbackNames).filter(Boolean);

        if (combined.length > 0) {
            alternatesEl.innerHTML = `<span class="hot-seat-profile-alt-label">Alternates:</span> ${combined.map(name => escapeHtml(name)).join(', ')}`;
            alternatesEl.classList.remove('hidden');
        } else {
            alternatesEl.classList.add('hidden');
            alternatesEl.innerHTML = '';
        }
    }

    if (countdownEl) {
        const initialCountdown = typeof countdownSeconds === 'number' ? Math.max(0, countdownSeconds) : null;
        hotSeatProfileCountdownTotal = initialCountdown;
        hotSeatProfileCountdownRemaining = initialCountdown;

        if (initialCountdown !== null) {
            updateHotSeatProfileCountdownDisplay(initialCountdown, initialCountdown);
        } else {
            countdownEl.classList.add('hidden');
            countdownEl.textContent = '';
        }
    }

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
        overlay.classList.add('show');
    });

    if (hotSeatProfileHideTimeout) {
        clearTimeout(hotSeatProfileHideTimeout);
    }

    if (fallbackDuration > 0) {
        hotSeatProfileHideTimeout = setTimeout(() => {
            hideHotSeatProfileCard();
        }, fallbackDuration);
    } else {
        hotSeatProfileHideTimeout = null;
    }
}

function updateHotSeatProfileCountdownDisplay(remainingSeconds = null, totalSeconds = null) {
    const countdownEl = document.getElementById('hot-seat-profile-countdown');
    if (!countdownEl) {
        return;
    }

    if (typeof remainingSeconds === 'number') {
        if (remainingSeconds > 0) {
            const prefix = totalSeconds && totalSeconds >= remainingSeconds
                ? 'Question begins in '
                : '';
            countdownEl.textContent = `${prefix}${remainingSeconds}s`;
            countdownEl.classList.remove('hidden');
        } else {
            countdownEl.textContent = 'Question starting...';
            countdownEl.classList.remove('hidden');
        }
    } else {
        countdownEl.textContent = '';
        countdownEl.classList.add('hidden');
    }
}

function mergeHotSeatEntryState(partial = {}) {
    hotSeatEntryState = {
        active: partial.active !== undefined ? partial.active : hotSeatEntryState.active,
        remainingSeconds: typeof partial.remainingSeconds === 'number'
            ? partial.remainingSeconds
            : hotSeatEntryState.remainingSeconds,
        entries: typeof partial.entries === 'number'
            ? partial.entries
            : hotSeatEntryState.entries,
        message: partial.message !== undefined ? partial.message : hotSeatEntryState.message,
        lastJoin: partial.lastJoin !== undefined ? partial.lastJoin : hotSeatEntryState.lastJoin
    };

    if (!currentState || typeof currentState !== 'object') {
        currentState = {};
    }

    currentState.hot_seat_entry_active = hotSeatEntryState.active;
    currentState.hot_seat_entry_remaining = hotSeatEntryState.remainingSeconds;
    currentState.hot_seat_entry_count = hotSeatEntryState.entries;
    currentState.hot_seat_entry_message = hotSeatEntryState.message;
    currentState.hot_seat_entry_last_join = hotSeatEntryState.lastJoin;

    updateInfoPanel(currentState);
}

function setHotSeatAnsweringStatus(primaryUser, participants = []) {
    const statusEl = document.getElementById('hot-seat-status');
    if (!statusEl) {
        return;
    }

    if (participants.length > 1) {
        statusEl.textContent = `Only ${primaryUser} may answer right now. Alternates: ${participants.slice(1).join(', ')}`;
    } else {
        statusEl.textContent = `Only ${primaryUser} may answer this question. Type A, B, C, or D now!`;
    }

    statusEl.style.color = '';
}

function handleHotSeatProfileRevealStarted(message) {
    const durationSeconds = typeof message.durationSeconds === 'number'
        ? Math.max(0, message.durationSeconds)
        : (typeof message.durationMs === 'number' ? Math.max(0, Math.ceil(message.durationMs / 1000)) : null);

    hotSeatProfileCountdownTotal = durationSeconds;
    hotSeatProfileCountdownRemaining = durationSeconds;

    updateHotSeatProfileCountdownDisplay(durationSeconds, durationSeconds);

    if (!currentState || typeof currentState !== 'object') {
        currentState = {};
    }

    currentState.hot_seat_profile_reveal_active = true;
    currentState.hot_seat_profile_reveal_remaining = durationSeconds;
}

function handleHotSeatProfileCountdown(message) {
    const remainingSeconds = typeof message.remainingSeconds === 'number'
        ? Math.max(0, message.remainingSeconds)
        : (typeof message.remainingMs === 'number' ? Math.max(0, Math.ceil(message.remainingMs / 1000)) : null);

    if (remainingSeconds !== null) {
        hotSeatProfileCountdownRemaining = remainingSeconds;
        if (typeof message.durationMs === 'number' && !hotSeatProfileCountdownTotal) {
            hotSeatProfileCountdownTotal = Math.max(0, Math.ceil(message.durationMs / 1000));
        }

        updateHotSeatProfileCountdownDisplay(remainingSeconds, hotSeatProfileCountdownTotal);

        const statusEl = document.getElementById('hot-seat-status');
        if (statusEl && remainingSeconds > 0) {
            statusEl.textContent = `Profile spotlight in progress. Question begins in ${remainingSeconds}s.`;
            statusEl.style.color = '';
        }

        if (!currentState || typeof currentState !== 'object') {
            currentState = {};
        }

        currentState.hot_seat_profile_reveal_active = remainingSeconds > 0;
        currentState.hot_seat_profile_reveal_remaining = remainingSeconds;
    }
}

function handleHotSeatProfileRevealComplete(message) {
    hotSeatProfileCountdownRemaining = 0;
    updateHotSeatProfileCountdownDisplay(0, hotSeatProfileCountdownTotal);

    if (!currentState || typeof currentState !== 'object') {
        currentState = {};
    }

    currentState.hot_seat_profile_reveal_active = false;
    currentState.hot_seat_profile_reveal_remaining = 0;

    const primaryUser = message && message.user
        ? message.user
        : (currentState.hot_seat_user || 'Mystery Player');
    const participants = Array.isArray(currentState.hot_seat_users) ? currentState.hot_seat_users : [primaryUser];

    const statusEl = document.getElementById('hot-seat-status');
    if (statusEl) {
        statusEl.textContent = 'Question starting now!';
        statusEl.style.color = '';
    }

    const infoDetails = document.getElementById('info-details');
    if (infoDetails) {
        infoDetails.textContent = 'Only the hot seat player can lock in an answer during this round.';
    }

    setTimeout(() => {
        setHotSeatAnsweringStatus(primaryUser, participants);
    }, 500);

    setTimeout(() => {
        hideHotSeatProfileCard();
    }, 600);
}

function handleHotSeatEntryStarted(message) {
    const durationMs = typeof message.duration === 'number' ? message.duration : 0;
    const remainingSeconds = Math.max(0, Math.ceil(durationMs / 1000));
    const entryMessage = message.message || 'Type JOIN in chat to enter the hot seat!';

    hideHotSeatProfileCard(true);

    mergeHotSeatEntryState({
        active: true,
        remainingSeconds,
        entries: 0,
        message: entryMessage,
        lastJoin: null
    });
}

function handleHotSeatEntryCountdown(message) {
    const remainingMs = typeof message.remaining === 'number' ? message.remaining : null;
    const remainingSeconds = remainingMs !== null ? Math.max(0, Math.ceil(remainingMs / 1000)) : hotSeatEntryState.remainingSeconds;
    const entries = typeof message.entries === 'number' ? message.entries : hotSeatEntryState.entries;

    mergeHotSeatEntryState({
        active: true,
        remainingSeconds,
        entries
    });
}

function handleHotSeatEntryUpdate(message) {
    const entries = typeof message.entries === 'number' ? message.entries : hotSeatEntryState.entries;
    const lastJoin = message.username || null;
    const joinMessage = lastJoin
        ? `${lastJoin} joined the hot seat! Type JOIN to enter.`
        : hotSeatEntryState.message || 'Type JOIN in chat to enter the hot seat!';

    mergeHotSeatEntryState({
        active: true,
        entries,
        message: joinMessage,
        lastJoin
    });
}

function handleHotSeatNoEntries(message) {
    const infoMessage = message && message.message
        ? message.message
        : 'No entries received for the hot seat round.';

    mergeHotSeatEntryState({
        active: false,
        remainingSeconds: 0,
        entries: 0,
        message: infoMessage,
        lastJoin: null
    });
}

function handleHotSeatActivated(message) {
    const participants = Array.isArray(message.users) && message.users.length
        ? message.users
        : (message.user ? [message.user] : []);
    const primaryUser = participants[0] || 'Mystery Player';
    const fallbackTimer = (currentState && typeof currentState.hot_seat_timer === 'number')
        ? currentState.hot_seat_timer
        : 60;
    const timerValue = typeof message.timer === 'number' && message.timer > 0
        ? message.timer
        : fallbackTimer;

    hotSeatEntryState = {
        active: false,
        remainingSeconds: 0,
        entries: 0,
        message: '',
        lastJoin: null
    };

    if (currentState && typeof currentState === 'object') {
        currentState.hot_seat_entry_active = false;
        currentState.hot_seat_entry_remaining = 0;
        currentState.hot_seat_entry_count = 0;
        currentState.hot_seat_entry_message = '';
        currentState.hot_seat_entry_last_join = null;
    }

    console.log("🔥 HOT SEAT ACTIVATED for user:", primaryUser);
    if (participants.length > 1) {
        console.log("👥 Additional hot seat participants:", participants.slice(1).join(', '));
    }

    const alternateNames = participants.slice(1);
    const profileRevealDurationMs = typeof message.profileRevealDurationMs === 'number'
        ? message.profileRevealDurationMs
        : (typeof message.profileRevealDurationSeconds === 'number'
            ? message.profileRevealDurationSeconds * 1000
            : null);
    const profileRevealDurationSeconds = typeof message.profileRevealDurationSeconds === 'number'
        ? Math.max(0, message.profileRevealDurationSeconds)
        : (profileRevealDurationMs !== null ? Math.max(0, Math.ceil(profileRevealDurationMs / 1000)) : null);
    const profileDisplayDurationMs = profileRevealDurationMs !== null
        ? profileRevealDurationMs + 5000
        : 45000;

    showHotSeatProfileCard(
        primaryUser,
        message.profile || null,
        Array.isArray(message.alternateProfiles) ? message.alternateProfiles : [],
        alternateNames,
        message.selectionMethod || 'manual',
        message.message || '',
        {
            displayDurationMs: profileDisplayDurationMs,
            countdownSeconds: profileRevealDurationSeconds
        }
    );

    const display = document.getElementById("hot-seat-display");
    const userEl = document.getElementById("hot-seat-user");
    const timerEl = document.getElementById("hot-seat-timer");
    const statusEl = document.getElementById("hot-seat-status");

    if (display && userEl && timerEl && statusEl) {
        display.classList.remove("hidden");
        display.classList.remove('entry-open');
        display.classList.add("active");
        display.setAttribute('aria-hidden', 'false');
        display.setAttribute('role', 'dialog');
        display.setAttribute('aria-modal', 'true');
        display.setAttribute('aria-label', `Hot seat active for ${primaryUser}`);

        userEl.textContent = primaryUser;
        timerEl.textContent = `${timerValue}s`;
        timerEl.className = "hot-seat-timer";
        statusEl.style.color = "";
        if (profileRevealDurationSeconds !== null && profileRevealDurationSeconds > 0) {
            statusEl.textContent = `Profile spotlight in progress. Question begins in ${profileRevealDurationSeconds}s.`;
        } else {
            statusEl.textContent = 'Profile spotlight in progress. Question begins soon.';
        }
    }

    const infoMessage = document.getElementById('info-message');
    const infoDetails = document.getElementById('info-details');
    if (infoMessage) {
        infoMessage.textContent = `🔥 HOT SEAT: ${primaryUser} is live!`;
    }
    if (infoDetails) {
        infoDetails.textContent = 'Spotlight on their story. Question begins after the countdown.';
    }

    const bannerMessageParts = [`${primaryUser} is on the hot seat now!`];
    if (participants.length > 1) {
        bannerMessageParts.push(`Alternates: ${participants.slice(1).join(', ')}`);
    }
    if (profileRevealDurationSeconds !== null && profileRevealDurationSeconds > 0) {
        bannerMessageParts.push(`Question in ${profileRevealDurationSeconds}s.`);
    }
    bannerMessageParts.push('Lions cheer them on!');

    setHotSeatBanner({
        visible: true,
        mode: 'active',
        title: 'Hot Seat Live',
        message: bannerMessageParts.join(' ')
    });

    const hud = document.getElementById("hot-seat-hud");
    const hudUser = document.getElementById("hot-seat-hud-user");
    const hudTimer = document.getElementById("hot-seat-hud-timer");

    if (hud && hudUser && hudTimer) {
        hudUser.textContent = primaryUser;
        hudTimer.textContent = `${timerValue} seconds remaining`;
        hud.classList.remove("hidden");

        setTimeout(() => {
            hud.classList.add("hidden");
        }, 5000);
    }

    document.body.classList.add('hot-seat-active');

    if (currentState) {
        currentState.hot_seat_user = primaryUser;
        currentState.hot_seat_users = participants;
        currentState.hot_seat_timer = timerValue;
        currentState.hot_seat_profile_reveal_active = true;
        currentState.hot_seat_profile_reveal_remaining = profileRevealDurationSeconds;
    }

    const audioController = (typeof window !== 'undefined' && window.soundSystem && typeof window.soundSystem.playLockIn === 'function')
        ? window.soundSystem
        : (audioSystem && typeof audioSystem.playLockIn === 'function' ? audioSystem : null);

    if (audioController) {
        audioController.playLockIn();
    }
}

function handleHotSeatTimerUpdate(message) {
    const timerEl = document.getElementById("hot-seat-timer");
    const hudTimer = document.getElementById("hot-seat-hud-timer");

    if (timerEl) {
        timerEl.textContent = `${message.timer}s`;

        // Add warning class at 20 seconds
        if (message.timer <= 20 && message.timer > 10) {
            timerEl.className = "hot-seat-timer warning";
        }
        // Add critical class at 10 seconds
        else if (message.timer <= 10) {
            timerEl.className = "hot-seat-timer critical";
        }
    }
    
    if (hudTimer) {
        hudTimer.textContent = message.timer + " seconds remaining";
    }
}

function handleHotSeatAnswered(message) {
    console.log("🎯 HOT SEAT ANSWER:", message.user, "selected", message.answer);

    const statusEl = document.getElementById("hot-seat-status");
    if (statusEl) {
        statusEl.textContent = `Answer ${message.answer} locked in! (${message.timeRemaining}s remaining)`;
        statusEl.style.color = "#4CAF50";
    }

    setHotSeatBanner({
        visible: true,
        mode: 'active',
        title: 'Hot Seat Live',
        message: `${message.user} locked in ${message.answer}. Lions stand by!`
    });

    // Play lock-in sound
    const audioController = (typeof window !== 'undefined' && window.soundSystem && typeof window.soundSystem.playLockIn === 'function')
        ? window.soundSystem
        : (audioSystem && typeof audioSystem.playLockIn === 'function' ? audioSystem : null);

    if (audioController) {
        audioController.playLockIn();
    }
}

function handleHotSeatTimeout(message) {
    console.log("⏰ HOT SEAT TIMEOUT for", message.user);

    const statusEl = document.getElementById("hot-seat-status");
    if (statusEl) {
        statusEl.textContent = "TIME IS UP! No answer submitted.";
        statusEl.style.color = "#FF4500";
    }

    setHotSeatBanner({
        visible: true,
        mode: 'active',
        title: 'Hot Seat Live',
        message: `Time expired for ${message.user}. Lions get ready for the next entry!`
    });

    // Play wrong answer sound
    const audioController = (typeof window !== 'undefined' && window.soundSystem && typeof window.soundSystem.playWrong === 'function')
        ? window.soundSystem
        : (audioSystem && typeof audioSystem.playWrong === 'function' ? audioSystem : null);

    if (audioController) {
        audioController.playWrong();
    }
}

function handleHotSeatEnded(message) {
    console.log("🔚 HOT SEAT ENDED for", message.user);

    // Hide hot seat display
    const display = document.getElementById("hot-seat-display");
    if (display) {
        display.classList.remove("active");
        display.classList.remove('entry-open');
        display.classList.add("hidden");
        display.setAttribute('aria-hidden', 'true');
        display.removeAttribute('aria-modal');
        display.removeAttribute('aria-label');
        display.removeAttribute('role');
    }

    // Hide HUD if still visible
    const hud = document.getElementById("hot-seat-hud");
    if (hud) {
        hud.classList.add("hidden");
    }
    
    // Reset status text color
    const statusEl = document.getElementById("hot-seat-status");
    if (statusEl) {
        statusEl.style.color = "";
    }

    const infoMessage = document.getElementById('info-message');
    const infoDetails = document.getElementById('info-details');
    if (infoMessage) {
        infoMessage.textContent = 'Waiting for the next contestant...';
    }
    if (infoDetails) {
        infoDetails.textContent = 'Get ready to type JOIN in chat when the host calls for the next hot seat!';
    }

    document.body.classList.remove('hot-seat-active');

    setHotSeatBanner({ visible: false });

    hideHotSeatProfileCard();
}

// Leaderboard Display Functions
let currentLeaderboardData = null;
let currentLeaderboardPeriod = 'current_game';

function handleLeaderboardUpdate(message) {
    console.log("📊 Leaderboard update received:", message);
    
    // Store the leaderboard data
    if (message.data) {
        currentLeaderboardData = message.data;
        
        // If leaderboard is currently visible, update the display
        const overlay = document.getElementById('leaderboard-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            // Get the correct period data from the leaderboard structure
            const displayPeriod = currentLeaderboardPeriod || 'current_game';
            
            // The data structure is {current_game: [...], daily: [...], weekly: [...], etc}
            const periodData = message.data[displayPeriod] || message.data.current_game || [];
            
            console.log(`📊 Updating leaderboard display for period: ${displayPeriod} with ${periodData.length} players`);
            
            // Update the display with new data
            renderLeaderboardEntries(periodData, displayPeriod);
        }
    }
}

function showLeaderboard(period = 'current_game', leaderboardData = null) {
    console.log("🏆 Showing leaderboard for period:", period);

    const overlay = document.getElementById('leaderboard-overlay');
    const periodBadge = document.getElementById('leaderboard-period');
    const listContainer = document.getElementById('leaderboard-list');
    const header = document.querySelector('.leaderboard-overlay-header h2');

    if (!overlay || !periodBadge || !listContainer) {
        console.error('❌ Leaderboard elements not found');
        return;
    }

    if (header) {
        header.textContent = '🏆 LEADERBOARD';
        header.style.fontSize = '';
        header.style.animation = '';
    }

    periodBadge.style.background = '';
    periodBadge.style.animation = '';
    
    // Store current period
    currentLeaderboardPeriod = period;

    if (leaderboardData && typeof leaderboardData === 'object') {
        currentLeaderboardData = leaderboardData;
    }
    
    // Prepare for animation
    overlay.style.display = 'block';
    overlay.style.opacity = '0';
    overlay.style.transform = 'translateX(100%)';
    overlay.classList.remove('hidden');
    
    // Update period badge text
    const periodLabels = {
        'current_game': 'Current Game',
        'daily': 'Daily',
        'weekly': 'Weekly',
        'monthly': 'Monthly',
        'all_time': 'All Time'
    };
    periodBadge.textContent = periodLabels[period] || 'Current Game';
    
    // Request latest data from server if we don't have it
    if (!currentLeaderboardData) {
        fetch('/api/leaderboard')
            .then(response => response.json())
            .then(data => {
                currentLeaderboardData = data;
                // Data structure is {current_game: [...], daily: [...], etc}
                const periodData = data[period] || data.current_game || [];
                renderLeaderboardEntries(periodData, period);
            })
            .catch(error => {
                console.error('❌ Error fetching leaderboard:', error);
                renderLeaderboardEntries([], period);
            });
    } else {
        // Use cached data - data structure is {current_game: [...], daily: [...], etc}
        const periodData = currentLeaderboardData[period] || currentLeaderboardData.current_game || [];
        renderLeaderboardEntries(periodData, period);
    }
    
    // Trigger animation with a small delay for smooth effect
    requestAnimationFrame(() => {
        overlay.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
        overlay.style.opacity = '1';
        overlay.style.transform = 'translateX(0)';
    });
    
    // Play sound effect if available
    if (typeof soundSystem !== 'undefined' && soundSystem && soundSystem.playApplause) {
        soundSystem.playApplause();
    }
}

function hideLeaderboard() {
    console.log("👻 Hiding leaderboard");
    
    const overlay = document.getElementById('leaderboard-overlay');
    if (overlay) {
        // Animate out smoothly
        overlay.style.transition = 'opacity 0.5s ease-in, transform 0.5s ease-in';
        overlay.style.opacity = '0';
        overlay.style.transform = 'translateX(100%)';
        
        // Hide completely after animation
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            // Reset transform for next show
            overlay.style.transform = '';
            overlay.style.transition = '';
        }, 500);
    }
}

// Show end-game leaderboard with winners
function showEndGameLeaderboard(winners, prizeConfig) {
    console.log("🏆 Showing end-game winners leaderboard");
    
    const overlay = document.getElementById('leaderboard-overlay');
    const periodBadge = document.getElementById('leaderboard-period');
    const listContainer = document.getElementById('leaderboard-list');
    const header = document.querySelector('.leaderboard-overlay-header h2');
    
    if (!overlay || !periodBadge || !listContainer) {
        console.error('❌ Leaderboard elements not found');
        return;
    }
    
    // Update header for winners
    if (header) {
        header.textContent = '🏆 WINNERS! 🏆';
        header.style.fontSize = '36px';
        header.style.animation = 'goldPulse 2s ease-in-out infinite';
    }
    
    // Update period badge
    periodBadge.textContent = `Top ${prizeConfig.topWinnersCount} Winners`;
    periodBadge.style.background = 'linear-gradient(135deg, #FFD700, #FFA500)';
    periodBadge.style.animation = 'shimmer 2s ease-in-out infinite';
    
    // Clear existing entries
    listContainer.innerHTML = '';
    
    // Add prize message
    const prizeMessage = document.createElement('div');
    prizeMessage.className = 'prize-message';
    prizeMessage.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #FFD700; font-size: 20px; font-weight: bold;">
            ${prizeConfig.customMessage}
            <div style="margin-top: 10px; font-size: 24px;">
                🎉 Each winner receives: ${prizeConfig.prizeName}! 🎉
            </div>
        </div>
    `;
    listContainer.appendChild(prizeMessage);
    
    // Render winners with special styling
    winners.forEach((player, index) => {
        const entry = document.createElement('div');
        entry.className = 'leaderboard-entry winner-entry';
        entry.style.opacity = '0';
        entry.style.transform = 'translateX(-50px)';
        
        // Add winner glow effect
        entry.style.background = 'linear-gradient(135deg, rgba(255, 215, 0, 0.3), rgba(255, 193, 7, 0.2))';
        entry.style.border = '2px solid #FFD700';
        entry.style.boxShadow = '0 0 20px rgba(255, 215, 0, 0.5)';
        
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏆';
        
        entry.innerHTML = `
            <div class="leaderboard-rank" style="font-size: 28px;">${medal}</div>
            <div class="leaderboard-player">
                <div class="leaderboard-name" style="font-size: 20px; color: #FFD700;">${player.username}</div>
                <div class="leaderboard-stats">
                    <span class="stat-points" style="font-size: 18px;">${player.points} pts</span>
                    <span class="stat-accuracy">${player.correct_answers}/${player.total_votes} correct</span>
                </div>
            </div>
        `;
        
        listContainer.appendChild(entry);
        
        // Animate entry appearance
        setTimeout(() => {
            entry.style.transition = 'all 0.5s ease-out';
            entry.style.opacity = '1';
            entry.style.transform = 'translateX(0)';
        }, (index + 1) * 100);
    });
    
    // Show the overlay with special animation
    overlay.style.display = 'block';
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(0.8)';
    overlay.classList.remove('hidden');
    
    requestAnimationFrame(() => {
        overlay.style.transition = 'all 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
        overlay.style.opacity = '1';
        overlay.style.transform = 'scale(1)';
    });
    
    // Credits will be triggered manually from control panel
    console.log('🏆 Winners displayed - waiting for manual credits roll from control panel');
}

// Start credits roll
function startCreditsRoll() {
    console.log('🎬 Starting credits roll...');

    // Hide the winners leaderboard first
    hideLeaderboard();

    const creditsOverlay = document.getElementById('credits-overlay');
    if (!creditsOverlay) {
        console.error('❌ Credits overlay not found in DOM');
        return;
    }

    const participants = currentState && Array.isArray(currentState.gameshow_participants)
        ? currentState.gameshow_participants
        : [];

    const subtitleEl = creditsOverlay.querySelector('.credits-subtitle');
    if (subtitleEl && currentState && currentState.prizeConfiguration && currentState.prizeConfiguration.customMessage) {
        subtitleEl.textContent = currentState.prizeConfiguration.customMessage;
    }

    creditsOverlay.classList.add('credits-roll-active');

    showCredits(participants);

    if (window.soundSystem && typeof window.soundSystem.playApplause === 'function') {
        window.soundSystem.playApplause();
    }
}

// Create massive confetti effect for winners
function createMassiveConfetti() {
    console.log('🎊 Creating massive confetti celebration!');
    
    // Create multiple bursts of confetti
    for (let burst = 0; burst < 5; burst++) {
        setTimeout(() => {
            // Create confetti from multiple points
            const positions = [
                { x: 0.25, y: 0.5 },
                { x: 0.5, y: 0.3 },
                { x: 0.75, y: 0.5 }
            ];
            
            positions.forEach(pos => {
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: pos,
                        colors: ['#FFD700', '#FFA500', '#FF6347', '#00CED1', '#9370DB']
                    });
                }
            });
        }, burst * 300);
    }
}

function renderLeaderboardEntries(players, period) {
    const listContainer = document.getElementById('leaderboard-list');
    const totalPlayersEl = document.getElementById('leaderboard-total');
    
    if (!listContainer) {
        console.error('❌ Leaderboard list container not found');
        return;
    }
    
    // Handle empty leaderboard
    if (!players || players.length === 0) {
        // Smooth transition for empty state
        listContainer.style.opacity = '0.5';
        setTimeout(() => {
            listContainer.innerHTML = '<div class="leaderboard-empty">No players yet - be the first!</div>';
            listContainer.style.opacity = '1';
        }, 150);
        if (totalPlayersEl) {
            totalPlayersEl.textContent = '0 Players';
        }
        return;
    }
    
    // Sort players by points (descending)
    const sortedPlayers = [...players].sort((a, b) => {
        const pointsA = a.points || a.total_points || 0;
        const pointsB = b.points || b.total_points || 0;
        return pointsB - pointsA;
    });
    
    // Create new content in temporary container
    const tempContainer = document.createElement('div');
    
    // Render each player entry to temporary container
    sortedPlayers.forEach((player, index) => {
        const entry = document.createElement('div');
        entry.className = 'leaderboard-entry';
        
        // Add special class for top 3
        if (index < 3) {
            entry.classList.add(`rank-${index + 1}`);
        }
        
        // Get points value (handle different data structures)
        const points = player.points || player.total_points || 0;
        const correct = player.correct_answers || 0;
        const votes = player.total_votes || 0;
        
        // Format points with commas
        const formattedPoints = points.toLocaleString();
        
        // Create rank display
        let rankDisplay = '';
        if (index === 0) rankDisplay = '🥇';
        else if (index === 1) rankDisplay = '🥈';
        else if (index === 2) rankDisplay = '🥉';
        else rankDisplay = `#${index + 1}`;
        
        entry.innerHTML = `
            <div class="leaderboard-rank">${rankDisplay}</div>
            <div class="leaderboard-info">
                <div class="leaderboard-username">${player.username}</div>
                <div class="leaderboard-stats">
                    ${correct > 0 ? `✓${correct}` : ''}
                    ${votes > 0 ? ` • ${votes} votes` : ''}
                </div>
            </div>
            <div class="leaderboard-points">${formattedPoints}</div>
        `;
        
        tempContainer.appendChild(entry);
    });
    
    // Smooth transition: fade out, replace content, fade in
    listContainer.style.opacity = '0.5';
    setTimeout(() => {
        // Clear and add new content
        listContainer.innerHTML = '';
        while (tempContainer.firstChild) {
            listContainer.appendChild(tempContainer.firstChild);
        }
        listContainer.style.opacity = '1';
    }, 150);
    
    // Update total players count
    if (totalPlayersEl) {
        const playerCount = sortedPlayers.length;
        totalPlayersEl.textContent = `${playerCount} Player${playerCount !== 1 ? 's' : ''}`;
    }
    
    console.log(`✅ Rendered ${sortedPlayers.length} leaderboard entries for ${period}`);
}
