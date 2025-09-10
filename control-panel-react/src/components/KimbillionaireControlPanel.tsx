import React, { useState, useEffect, useCallback, useMemo } from 'react';
// import PerformanceTest from './PerformanceTest'; // Removed to reduce lag
import QuestionControlSection from './QuestionControlSection';
import GlassPanel from './GlassPanel';
import PrizeEditor from './PrizeEditor';
import QuestionEditor from './QuestionEditor';
import AnimationControlPanel from './AnimationControlPanel';
import LiveChatConfig from './LiveChatConfig';
import LiveChatViewer from './LiveChatViewer';
import LifelineManager from './LifelineManager';
import GiveawayControlPanel from './GiveawayControlPanel';
import LeaderboardControl from './LeaderboardControl';
import PrizeConfiguration from './PrizeConfiguration';
// import PerformanceMonitor from './PerformanceMonitor'; // Removed - component deleted
// import ProducerPreview from './ProducerPreview'; // Removed to reduce lag
import { obsIntegration } from '../utils/obs-integration';
import { gameApi } from '../utils/api';
import type { 
  Question, 
  GameState, 
  OBSConnectionStatus, 
  OBSSettings
} from '../types/gameTypes';
import '../styles/theme.css';
import styles from './KimbillionaireControlPanel.module.css';

// Remove duplicate interfaces - now using types from gameTypes.ts
// NO DEFAULT QUESTIONS - Control panel ONLY uses questions from the server

// Removed defaultQuestions array - now using server as single source of truth
/*
const defaultQuestions: Question[] = [
  {
    text: "What does 'IPO' stand for in finance?",
    answers: ["Initial Public Offering", "International Private Organization", "Investment Portfolio Option", "Independent Price Objective"],
    correct: 0,
    number: 1
  },
  {
    text: "What is a 'bull market'?",
    answers: ["A market where prices are falling", "A market where prices are rising", "A market with high volatility", "A market with low trading volume"],
    correct: 1,
    number: 2
  },
  {
    text: "What does 'P/E ratio' measure?",
    answers: ["Price to Earnings ratio", "Profit to Expense ratio", "Portfolio to Equity ratio", "Performance to Efficiency ratio"],
    correct: 0,
    number: 3
  },
  {
    text: "What is compound interest?",
    answers: ["Interest paid only on principal", "Interest paid on interest plus principal", "Interest that changes monthly", "Interest paid by companies"],
    correct: 1,
    number: 4
  },
  {
    text: "What does 'diversification' mean in investing?",
    answers: ["Buying only one type of stock", "Spreading investments across different assets", "Selling all investments quickly", "Investing only in bonds"],
    correct: 1,
    number: 5
  },
  {
    text: "What is a dividend?",
    answers: ["A loan from a bank", "A payment to shareholders from company profits", "A fee charged by brokers", "A type of investment risk"],
    correct: 1,
    number: 6
  },
  {
    text: "What does 'ROI' stand for?",
    answers: ["Return on Investment", "Rate of Interest", "Risk of Investment", "Return on Income"],
    correct: 0,
    number: 7
  },
  {
    text: "What is a 'bear market'?",
    answers: ["A market where prices are rising", "A market where prices are falling", "A market with stable prices", "A market with high dividends"],
    correct: 1,
    number: 8
  },
  {
    text: "What is the primary purpose of the Federal Reserve?",
    answers: ["To regulate stock markets", "To control monetary policy and banking", "To collect taxes", "To manage government spending"],
    correct: 1,
    number: 9
  },
  {
    text: "What does 'liquidity' refer to in finance?",
    answers: ["How quickly an asset can be converted to cash", "The amount of water in investments", "How profitable an investment is", "The risk level of an investment"],
    correct: 0,
    number: 10
  },
  {
    text: "What is a mutual fund?",
    answers: ["A type of bank account", "A pooled investment vehicle managed by professionals", "A government bond", "A type of insurance policy"],
    correct: 1,
    number: 11
  },
  {
    text: "What does 'volatility' measure in the stock market?",
    answers: ["The number of trades per day", "The price fluctuation of a security", "The dividend yield", "The market capitalization"],
    correct: 1,
    number: 12
  },
  {
    text: "What is the difference between a stock and a bond?",
    answers: ["Stocks are debt, bonds are equity", "Stocks are equity, bonds are debt", "They are the same thing", "Stocks are safer than bonds"],
    correct: 1,
    number: 13
  },
  {
    text: "What does 'market capitalization' represent?",
    answers: ["Total value of a company's shares", "Annual revenue of a company", "Number of employees", "Amount of debt a company has"],
    correct: 0,
    number: 14
  },
  {
    text: "What is the purpose of an emergency fund?",
    answers: ["To invest in high-risk stocks", "To cover unexpected expenses", "To pay taxes", "To buy luxury items"],
    correct: 1,
    number: 15
  }
];
*/

const KimbillionaireControlPanel: React.FC = () => {
  // Game State
  const [gameState, setGameState] = useState<GameState>({
    current_question: 0,
    score: 0,
    game_active: false,
    lifelines_used: [],
    update_needed: false
  });
  const [questionVisible, setQuestionVisible] = useState(false);
  const [answersVisible, setAnswersVisible] = useState(false);
  const [answersRevealed, setAnswersRevealed] = useState(false);
  // Removed unused isRevealing state
  const [contestantName, setContestantName] = useState('Kimba Gang');
  const [contestantSet, setContestantSet] = useState(false);
  const [answerLockedIn, setAnswerLockedIn] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showPrizeEditor, setShowPrizeEditor] = useState(false);
  // Removed unused currentOverlay state
  const [showOBSSettings, setShowOBSSettings] = useState(false);
  const [showQuestionEditor, setShowQuestionEditor] = useState(false);
  const [showAnimationPanel, setShowAnimationPanel] = useState(false);
  const [roaryEnabled, setRoaryEnabled] = useState(true);
  // const [showProducerPreview, setShowProducerPreview] = useState(false); // Removed to reduce lag
  const [questions, setQuestions] = useState<Question[]>([]);
  // Removed questionsLoading state since it's not displayed in UI
  const [obsSettings, setObsSettings] = useState<OBSSettings>(() => {
    // Load OBS settings from localStorage if available
    const savedSettings = localStorage.getItem('obsSettings');
    if (savedSettings) {
      try {
        return JSON.parse(savedSettings);
      } catch (e) {
        console.error('Failed to parse saved OBS settings:', e);
      }
    }
    return {
      host: 'localhost',
      port: 4455,
      password: ''
    };
  });
  // Animations always optimized - no toggle needed
  
  // Prize Money Configuration
  const [prizeAmounts, setPrizeAmounts] = useState([
    '$100', '$200', '$300', '$500', '$1,000',
    '$2,000', '$4,000', '$8,000', '$16,000', '$32,000',
    '$64,000', '$125,000', '$250,000', '$500,000', '$1,000,000'
  ]);
  
  // OBS Connection State
  const [obsConnected, setObsConnected] = useState(false);
  const [obsStatus, setObsStatus] = useState<OBSConnectionStatus>('disconnected');

  // Timer Configuration State
  const [normalVoteDuration, setNormalVoteDuration] = useState(60);
  const [revoteDuration, setRevoteDuration] = useState(45);
  const [askModDuration, setAskModDuration] = useState(30);
  const [timerConfigLoading, setTimerConfigLoading] = useState(false);
  const [timerConfigSuccess, setTimerConfigSuccess] = useState<string | null>(null);


  // CRITICAL: Load current game state on mount to prevent fallback to defaults
  useEffect(() => {
    const loadInitialGameState = async () => {
      try {
        console.log('🔄 Loading initial game state from server...');
        const currentState = await gameApi.getState();
        setGameState(currentState);
        
        // Sync all UI states with server state
        setQuestionVisible(currentState.question_visible || false);
        setAnswersVisible(currentState.answers_visible || false);
        setAnswersRevealed(currentState.answers_revealed || false);
        setAnswerLockedIn(currentState.answer_locked_in || false);
        setSelectedAnswer(currentState.selected_answer);
        
        // Load questions from state if available
        if (currentState.questions && currentState.questions.length > 0) {
          setQuestions(currentState.questions);
        }
        
        console.log('✅ Initial game state loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load initial game state:', error);
      }
    };
    loadInitialGameState();
  }, []); // Only run once on mount

  // Load Roary status on mount
  useEffect(() => {
    const loadRoaryStatus = async () => {
      try {
        const data = await gameApi.getRoaryStatus();
        setRoaryEnabled(data.status === 'active');
      } catch (error) {
        console.log('Could not load Roary status, using default');
      }
    };
    loadRoaryStatus();
  }, []);

  // Load current prizes from server on mount
  useEffect(() => {
    const loadPrizes = async () => {
      try {
        const data = await gameApi.getPrizes();
        setPrizeAmounts(data.prizes);
        console.log('✅ Loaded current prizes from server:', data.prizes);
      } catch (error) {
        console.log('Could not load prizes from server, using default');
      }
    };
    loadPrizes();
  }, []);

  // Load questions from server on mount
  useEffect(() => {
    const loadQuestions = async () => {
      try {
        // First check if gameState already has questions from server
        if (gameState.questions && gameState.questions.length > 0) {
          setQuestions(gameState.questions);
          console.log('✅ Using questions from gameState:', gameState.questions.length);
          return;
        }
        
        // Otherwise load from server API
        const serverQuestions = await gameApi.getQuestions();
        if (serverQuestions && serverQuestions.length > 0) {
          setQuestions(serverQuestions);
          console.log('✅ Loaded questions from server:', serverQuestions.length);
        } else {
          console.warn('⚠️ No questions available from server yet');
          // Initialize with empty array - host can add questions via editor
          setQuestions([]);
        }
      } catch (error) {
        console.error('❌ Failed to load questions from server:', error);
        console.log('⏳ Server connection issue - host can still edit questions');
        // Initialize with empty array - host can add questions via editor
        setQuestions([]);
      }
    };
    loadQuestions();
  }, [gameState.questions]);

  // Initialize OBS connection - auto-connect on mount
  useEffect(() => {
    console.log('📺 OBS WebSocket: Auto-connecting...');
    console.log('   Host:', obsSettings.host);
    console.log('   Port:', obsSettings.port);
    
    // Auto-connect to OBS on component mount
    const autoConnect = async () => {
      setObsStatus('connecting');
      try {
        const connected = await obsIntegration.connect(obsSettings.host, obsSettings.port, obsSettings.password);
        setObsConnected(connected);
        setObsStatus(connected ? 'connected' : 'disconnected');
        
        if (connected) {
          console.log('✅ OBS auto-connected successfully!');
        } else {
          console.log('❌ OBS auto-connection failed. Use the Reconnect button to try again.');
        }
      } catch (error) {
        console.error('❌ OBS auto-connection error:', error);
        setObsConnected(false);
        setObsStatus('disconnected');
      }
    };
    
    // Delay auto-connect slightly to ensure component is fully mounted
    const timer = setTimeout(autoConnect, 500);
    
    // Clean up OBS connection on unmount
    return () => {
      clearTimeout(timer);
      if (obsConnected) {
        obsIntegration.disconnect();
      }
    };
  }, [obsSettings.host, obsSettings.password, obsSettings.port, obsConnected]); // Include OBS settings and connection dependencies

  // Tab visibility optimization remains but without animation toggle

  // Save OBS settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('obsSettings', JSON.stringify(obsSettings));
  }, [obsSettings]);

  // Initialize WebSocket for real-time state updates
  useEffect(() => {
    // Skip if window is not focused to save resources
    if (document.hidden) {
      return;
    }

    // Robust WebSocket connection with automatic reconnection
    let ws: WebSocket | null = null;
    let reconnectInterval: NodeJS.Timeout | null = null;
    let isConnected = false;
    let connectionAttempts = 0;
    let lastConnectionAttempt = 0;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isUnmounting = false;
    
    // Prevent multiple connections by using a global flag
    if ((window as any).__kimbillionaireWSConnecting) {
      console.log('⚠️ WebSocket connection already in progress by another instance');
      return;
    }
    (window as any).__kimbillionaireWSConnecting = true;

    const connectWebSocket = () => {
      // Prevent rapid reconnection attempts
      const now = Date.now();
      if (now - lastConnectionAttempt < 3000) {
        console.log('⚠️ Control Panel WebSocket: Throttling connection attempt');
        return;
      }
      lastConnectionAttempt = now;

      if (isUnmounting) {
        console.log('⚠️ Control Panel WebSocket: Component unmounting, skipping connection');
        return;
      }

      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('✅ Control Panel WebSocket: Already connected or connecting');
        return;
      }

      // Clean up existing connection
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          console.log('Control Panel WebSocket close error (expected):', e);
        }
        ws = null;
      }

      try {
        connectionAttempts++;
        console.log(`🔌 Control Panel WebSocket: Connection attempt #${connectionAttempts}`);

        // Limit connection attempts
        if (connectionAttempts > 10) {
          console.log('❌ Control Panel WebSocket: Too many attempts, stopping');
          return;
        }

        // Direct WebSocket connection to bridge server
        ws = new WebSocket('ws://localhost:8081');
        
        ws.onopen = async () => {
          console.log('✅ Control Panel WebSocket: Connected successfully!');
          isConnected = true;
          connectionAttempts = 0; // Reset counter on successful connection
          
          // IMPORTANT: Fetch current game state on reconnection to prevent fallback to defaults
          try {
            console.log('🔄 Fetching current game state after WebSocket reconnection...');
            const currentState = await gameApi.getState();
            setGameState(currentState);
            
            // Update UI state based on fetched game state
            setQuestionVisible(currentState.question_visible || false);
            setAnswersVisible(currentState.answers_visible || false);
            setAnswersRevealed(currentState.answers_revealed || false);
            setAnswerLockedIn(currentState.answer_locked_in || false);
            setSelectedAnswer(currentState.selected_answer);
            
            console.log('✅ Game state synchronized after reconnection');
          } catch (error) {
            console.error('❌ Failed to fetch game state on reconnection:', error);
          }
          
          // Clear any existing reconnect interval
          if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
          }

          // No need for heartbeat interval - server handles ping/pong automatically
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }

          // Request initial state
          gameApi.getState().then(state => {
            setGameState(state);
            console.log('🔄 Control Panel: Initial state loaded');
          }).catch(console.error);
        };
        
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('📨 Control Panel WebSocket: Received message', message);
            
            if (message.type === 'state' && message.data) {
              console.log('🔄 Control Panel: Updating state from WebSocket');
              setGameState(message.data);
              
              // Sync local UI state with server state
              React.startTransition(() => {
                setQuestionVisible(message.data.question_visible || false);
                setAnswersVisible(message.data.answers_visible || false);
                setAnswersRevealed(message.data.answers_revealed || false);
                setAnswerLockedIn(message.data.answer_locked_in || false);
                setSelectedAnswer(message.data.selected_answer);
                if (message.data.contestant_name && message.data.contestant_name.length > 1) {
                  setContestantName(message.data.contestant_name);
                }
              });
            } else if (message.type === 'roary_status_update') {
              console.log('🤖 Control Panel: Roary status updated:', message.enabled);
              setRoaryEnabled(message.enabled);
            } else if (message.type === 'ping') {
              // Respond to heartbeat ping from bridge server
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                // Uncomment for debugging: console.log('🏓 Control Panel: Responded to ping');
              }
            }
          } catch (error) {
            console.error('❌ Control Panel WebSocket: Parse error:', error);
          }
        };
        
        ws.onclose = (event) => {
          console.log(`❌ Control Panel WebSocket: Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
          isConnected = false;
          
          // Clear heartbeat
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          
          // Schedule reconnection if not unmounting and not a normal closure
          if (!isUnmounting && event.code !== 1000) {
            scheduleReconnect();
          }
        };
        
        ws.onerror = (event) => {
          console.error('❌ Control Panel WebSocket: Error event occurred');
          isConnected = false;
        };

      } catch (error) {
        console.error('❌ Control Panel WebSocket: Connection failed:', error);
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (!reconnectInterval && !isConnected && !isUnmounting && connectionAttempts < 10) {
        const delay = Math.min(3000 + (connectionAttempts * 1000), 10000);
        console.log(`⏰ Control Panel WebSocket: Reconnecting in ${delay/1000} seconds...`);
        reconnectInterval = setTimeout(() => {
          reconnectInterval = null;
          if (!isConnected && !isUnmounting) {
            connectWebSocket();
          }
        }, delay);
      }
    };

    // Initial connection
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      isUnmounting = true;
      console.log('🧹 Control Panel: Cleaning up WebSocket connection');
      
      // Clear global connection flag
      (window as any).__kimbillionaireWSConnecting = false;
      
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          console.log('WebSocket cleanup error (expected):', e);
        }
        ws = null;
      }
      
      obsIntegration.disconnect();
    };
  }, []);

  // Question Management - ALWAYS use server's currentQuestion for consistency
  const currentQuestion = useMemo(() => {
    // ONLY use the currentQuestion from gameState - NO FALLBACKS
    // This ensures control panel and gameshow ALWAYS show the same question
    if (gameState.currentQuestion) {
      return gameState.currentQuestion;
    }
    // If server has questions array, use that (but NOT defaultQuestions)
    if (gameState.questions && gameState.questions[gameState.current_question]) {
      return gameState.questions[gameState.current_question];
    }
    // Only use local questions if they came from server (not defaults)
    if (questions && questions.length > 0 && questions[gameState.current_question]) {
      return questions[gameState.current_question];
    }
    // Return null if no server data available - NEVER use hardcoded defaults
    return null;
  }, [gameState.currentQuestion, gameState.questions, questions, gameState.current_question]);

  const handleStartGame = useCallback(async () => {
    // Add confirmation for starting a new game if one is already active
    if (gameState.game_active) {
      const confirmed = window.confirm(
        '⚠️ START NEW GAME ⚠️\n\n' +
        'A game is already in progress. Starting a new game will:\n' +
        '• Reset all progress\n' +
        '• Clear current question and answers\n' +
        '• Reset score to $0\n\n' +
        'Are you sure you want to start a new game?'
      );
      
      if (!confirmed) {
        return;
      }
    }

    try {
      // Start the game on server
      await gameApi.startGame();
      
      // Fetch updated state to ensure synchronization
      const updatedState = await gameApi.getState();
      
      // Batch state updates for performance
      React.startTransition(() => {
        setGameState(updatedState);
      });
      
      console.log('🎮 Game started successfully');
      
    } catch (error) {
      console.error('❌ Failed to start game:', error);
      alert('Failed to start the game. Please check the server connection and try again.');
    }
  }, [gameState.game_active]);

  const handleShowQuestion = useCallback(async () => {
    try {
      // Update game state via API first
      await gameApi.showQuestion();
      
      // Fetch fresh state to ensure synchronization
      const updatedState = await gameApi.getState();
      
      // Batch state updates for performance
      React.startTransition(() => {
        setGameState(updatedState);
        setQuestionVisible(updatedState.question_visible || false);
      });
      
      console.log('✅ Show Question: State synchronized');
      
      // OBS scene calls disabled per user request
      // if (obsConnected) {
      //   await obsIntegration.showQuestion();
      // }
    } catch (error) {
      console.error('❌ Failed to show question:', error);
      alert('Failed to show question. Please check the server connection.');
    }
  }, []); // No dependencies needed since OBS integration is disabled

  const handleHideQuestion = useCallback(async () => {
    try {
      // Batch state updates to prevent multiple re-renders
      React.startTransition(() => {
        setQuestionVisible(false);
        setAnswersVisible(false);
        setAnswersRevealed(false);
        setAnswerLockedIn(false);
        setSelectedAnswer(null);
      });
      // Update game state via API
      await gameApi.hideQuestion();
      // Note: Questions are handled by browser source, no OBS integration needed
    } catch (error) {
      console.error('❌ Failed to hide question:', error);
      alert('Failed to hide question. Please check the bridge server connection.');
    }
  }, []); // No dependencies needed since OBS integration is disabled

  const handleShowAnswers = useCallback(async () => {
    try {
      // Update game state via API first
      await gameApi.showAnswers();
      
      // Fetch fresh state to ensure synchronization
      const updatedState = await gameApi.getState();
      
      // Batch state updates for performance
      React.startTransition(() => {
        setGameState(updatedState);
        setAnswersVisible(updatedState.answers_visible || false);
      });
      
      console.log('✅ Show Answers: State synchronized');
      
      // Note: Answers are handled by browser source, no OBS integration needed
    } catch (error) {
      console.error('❌ Failed to show answers:', error);
      alert('Failed to show answers. Please check the server connection.');
    }
  }, []); // No dependencies needed since OBS integration is disabled

  // Removed unused handleHideAnswers function

  const handleRevealAnswer = useCallback(async () => {
    try {
      // Update game state via API first
      await gameApi.revealAnswer();
      
      // Then update UI state if API call succeeded
      React.startTransition(() => {
        setAnswersRevealed(true);
        setAnswerLockedIn(false); // Unlock after revealing
      });
    } catch (error) {
      console.error('Failed to reveal answer:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to reveal answer. Make sure the answer is locked in first.';
      alert(errorMessage);
    }
  }, []);

  const handleNextQuestion = useCallback(async () => {
    if (answerLockedIn) {
      console.warn('Cannot navigate to next question while answer is locked in');
      return;
    }

    try {
      // Navigate to next question on server
      await gameApi.nextQuestion();
      
      // Fetch updated state to ensure synchronization
      const updatedState = await gameApi.getState();
      setGameState(updatedState);
      
      // Clear all UI state for fresh question display
      React.startTransition(() => {
        setQuestionVisible(false);
        setAnswersVisible(false);
        setAnswersRevealed(false);
        setAnswerLockedIn(false);
        setSelectedAnswer(null);
      });
      
      console.log(`📈 Advanced to question ${updatedState.current_question + 1}`);
      
    } catch (error) {
      console.error('❌ Failed to advance to next question:', error);
      alert('Failed to advance to next question. Please try again.');
    }
  }, [answerLockedIn]);

  const handleStartLifelineVote = useCallback(async () => {
    try {
      console.log('🗳️ Starting lifeline vote...');
      
      // Start lifeline voting on server
      await gameApi.startLifelineVote();
      
      // Fetch updated state
      const updatedState = await gameApi.getState();
      setGameState(updatedState);
      
      console.log('✅ Lifeline voting started for 60 seconds');
      
    } catch (error: any) {
      console.error('❌ Failed to start lifeline vote:', error);
      alert(error.message || 'Failed to start lifeline voting. Please try again.');
    }
  }, []);

  const handleEndLifelineVoting = useCallback(async () => {
    try {
      console.log('🛑 Manually ending lifeline voting...');
      
      // End lifeline voting on server
      await gameApi.sendControlAction('end_lifeline_voting');
      
      // Fetch updated state
      const updatedState = await gameApi.getState();
      setGameState(updatedState);
      
      console.log('✅ Lifeline voting ended manually');
      
    } catch (error: any) {
      console.error('❌ Failed to end lifeline voting:', error);
      alert(error.message || 'Failed to end lifeline voting. Please try again.');
    }
  }, []);

  const handlePreviousQuestion = useCallback(async () => {
    if (answerLockedIn) {
      console.warn('Cannot navigate to previous question while answer is locked in');
      return;
    }
    
    if (gameState.current_question <= 0) {
      console.warn('Already at first question');
      return;
    }

    try {
      // Navigate to previous question on server
      await gameApi.previousQuestion();
      
      // Fetch updated state to ensure synchronization
      const updatedState = await gameApi.getState();
      setGameState(updatedState);
      
      // Clear all UI state for fresh question display
      React.startTransition(() => {
        setQuestionVisible(false);
        setAnswersVisible(false);
        setAnswersRevealed(false);
        setAnswerLockedIn(false);
        setSelectedAnswer(null);
      });
      
      console.log(`📉 Moved back to question ${updatedState.current_question + 1}`);
      
    } catch (error) {
      console.error('❌ Failed to go to previous question:', error);
      alert('Failed to go to previous question. Please try again.');
    }
  }, [answerLockedIn, gameState.current_question]);

  const handleSelectAnswer = useCallback(async (answerIndex: number) => {
    if (answersVisible && !answerLockedIn) {
      // Batch state updates for performance
      React.startTransition(() => {
        setSelectedAnswer(answerIndex);
      });
      // Don't send to backend until locked in - keep selection local only
    }
  }, [answersVisible, answerLockedIn]);

  const handleLockInAnswer = useCallback(async () => {
    if (!answerLockedIn && selectedAnswer !== null) {
      // Send selected answer to backend when locking in
      await gameApi.setSelectedAnswer(selectedAnswer);
    }
    await gameApi.lockAnswer();
    
    // Trigger the dramatic lock animation
    if (!answerLockedIn) {
      await gameApi.triggerAnimation('dramatic_lock');
    }
    
    // Batch state updates for performance
    React.startTransition(() => {
      setAnswerLockedIn(!answerLockedIn);
    });
  }, [answerLockedIn, selectedAnswer]);

  const handleSetContestant = useCallback(async () => {
    if (contestantName.trim()) {
      try {
        await gameApi.setContestant(contestantName.trim());
        setContestantSet(true);
      } catch (error) {
        console.error('❌ Failed to set contestant:', error);
        alert('Failed to set contestant. Please check if the bridge server is running on port 8081.');
      }
    } else {
      alert('Please enter a contestant name (e.g., "The Audience" or player name)');
    }
  }, [contestantName]);

  const handleResetGame = useCallback(async () => {
    // Add confirmation dialog for destructive action
    const confirmed = window.confirm(
      '⚠️ RESET GAME ⚠️\n\n' +
      'This will completely reset the game to the beginning:\n' +
      '• Reset to Question 1\n' +
      '• Clear all progress and selections\n' +
      '• Hide all questions and answers\n' +
      '• Reset contestant information\n' +
      '• Clear lifeline usage\n\n' +
      'Are you sure you want to continue?'
    );
    
    if (!confirmed) {
      return;
    }

    try {
      // Reset server state first
      await gameApi.resetGame();
      
      // Fetch fresh state from server to ensure synchronization
      const freshState = await gameApi.getState();
      setGameState(freshState);
      
      // Reset all local control panel state to match server
      React.startTransition(() => {
        setQuestionVisible(false);
        setAnswersVisible(false);
        setAnswersRevealed(false);
        setAnswerLockedIn(false);
        setSelectedAnswer(null);
        setContestantName('');
        setContestantSet(false);
        setShowPrizeEditor(false);
        setShowOBSSettings(false);
        setShowQuestionEditor(false);
        // Timer functionality now handled by TimerConfigSection component
      });
      
      console.log('🔄 Complete reset: Server + Control Panel cleared to initial state');
      console.log('Current question reset to:', freshState.current_question);
      
      // Optional: Show success notification
      // You could add a toast notification here if desired
      
    } catch (error) {
      console.error('❌ Failed to reset game:', error);
      alert('Failed to reset the game. Please try again or check the server connection.');
    }
  }, []);

  const handleUseLifeline = useCallback(async (lifelineType: 'fiftyFifty' | 'takeAnotherVote' | 'askAMod') => {
    try {
      console.log(`🛟 Using lifeline: ${lifelineType}`);
      
      // Convert internal names to API actions
      let apiAction: 'fiftyFifty' | 'askAMod' | 'takeAnotherVote' | undefined;
      if (lifelineType === 'fiftyFifty') {
        apiAction = 'fiftyFifty';
      } else if (lifelineType === 'takeAnotherVote') {
        // Use the new clear action for Take Another Vote
        try {
          const response = await fetch('http://localhost:8081/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'use_lifeline_take_another_vote' })
          });
          const result = await response.json();
          console.log(`✅ Take Another Vote lifeline activated successfully:`, result);
          return {
            success: true,
            message: 'Take Another Vote lifeline activated!',
            data: result
          };
        } catch (error) {
          throw new Error('Failed to activate Take Another Vote lifeline');
        }
      } else if (lifelineType === 'askAMod') {
        apiAction = 'askAMod';
      }
      
      // Call the API to use the lifeline (for fiftyFifty and askAMod)
      if (apiAction) {
        const result = await gameApi.useLifeline(apiAction);
        console.log(`✅ Lifeline ${lifelineType} activated successfully:`, result);
        
        return {
          success: true,
          message: `${lifelineType === 'fiftyFifty' ? '50:50' 
                   : lifelineType === 'askAMod' ? 'Ask a Mod' 
                   : 'Lifeline'} activated!`,
          data: result
        };
      }
      
    } catch (error) {
      console.error(`❌ Failed to use lifeline ${lifelineType}:`, error);
      throw error; // Let LifelineManager handle the error display
    }
  }, []);

  const handleResetLifelines = useCallback(async () => {
    try {
      console.log('🔄 Resetting all lifelines...');
      
      // Reset lifelines by sending a reset_game request or specific lifeline reset
      // For now, we'll just update the local state and let the game reset handle it
      alert('Lifelines will be reset with the next game reset.');
      
    } catch (error) {
      console.error('❌ Failed to reset lifelines:', error);
      alert('Failed to reset lifelines. Please try again.');
    }
  }, []);

  // Removed unused handleSetTheme function

  const handleEndGameCredits = useCallback(async () => {
    try {
      await gameApi.endGameCredits();
      console.log('🎬 Credits started - game will show participant list');
    } catch (error) {
      console.error('❌ Failed to start credits:', error);
      alert('Failed to start credits. Please check the server connection.');
    }
  }, []);

  const handleStartCreditsScroll = useCallback(async () => {
    try {
      await gameApi.startCreditsScroll();
      console.log('📜 Credits scroll started - names will now animate');
    } catch (error) {
      console.error('❌ Failed to start credits scroll:', error);
      alert('Failed to start credits scroll. Please check the server connection.');
    }
  }, []);

  const handleShowFinalLeaderboard = useCallback(async () => {
    try {
      await gameApi.sendCommand('show_final_leaderboard');
      console.log('🏆 Final leaderboard displayed with winners');
    } catch (error) {
      console.error('❌ Failed to show final leaderboard:', error);
      alert('Failed to show final leaderboard. Please check the server connection.');
    }
  }, []);

  const handleRollCredits = useCallback(async () => {
    try {
      await gameApi.sendCommand('roll_credits');
      console.log('🎬 Credits rolling after winners display');
    } catch (error) {
      console.error('❌ Failed to roll credits:', error);
      alert('Failed to roll credits. Please check the server connection.');
    }
  }, []);

  const handleToggleRoary = useCallback(async () => {
    try {
      const newState = !roaryEnabled;
      setRoaryEnabled(newState);
      
      // Send toggle command to server
      const response = await fetch('/api/roary/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: newState
        })
      });

      if (!response.ok) {
        throw new Error('Failed to toggle Roary');
      }

      console.log(`🤖 Roary ${newState ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('❌ Failed to toggle Roary:', error);
      // Revert the state on error
      setRoaryEnabled(!roaryEnabled);
      alert('Failed to toggle Roary. Please check the server connection.');
    }
  }, [roaryEnabled]);


  const handleOBSReconnect = useCallback(async () => {
    console.log('🔄 Attempting to connect to OBS...');
    setObsStatus('connecting');
    
    try {
      // First disconnect if already connected
      if (obsConnected) {
        await obsIntegration.disconnect();
      }
      
      // Attempt connection with current settings
      const connected = await obsIntegration.connect(obsSettings.host, obsSettings.port, obsSettings.password);
      setObsConnected(connected);
      setObsStatus(connected ? 'connected' : 'disconnected');
      
      if (connected) {
        console.log('✅ OBS connection successful!');
        alert('✅ Successfully connected to OBS WebSocket!');
      } else {
        console.error('❌ OBS connection failed. Check the console for details.');
        alert(`❌ Failed to connect to OBS WebSocket.\n\nPlease check:\n1. OBS is running\n2. WebSocket Server is enabled in OBS (Tools → WebSocket Server Settings)\n3. The host (${obsSettings.host}) and port (${obsSettings.port}) are correct\n4. The password matches your OBS settings\n5. No firewall is blocking the connection\n\nCommon settings:\n- Local OBS: localhost or 127.0.0.1\n- Default port: 4455`);
      }
    } catch (error: any) {
      console.error('❌ OBS connection error:', error);
      setObsConnected(false);
      setObsStatus('disconnected');
      
      let errorMessage = '❌ Failed to connect to OBS WebSocket.\n\n';
      
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMessage += 'Network error: Cannot reach OBS WebSocket server.\n\n';
      }
      
      errorMessage += `Please check:\n1. OBS is running\n2. WebSocket Server is enabled in OBS (Tools → WebSocket Server Settings)\n3. The host (${obsSettings.host}) and port (${obsSettings.port}) are correct\n4. The password matches your OBS settings\n5. No firewall is blocking the connection\n\nCommon settings:\n- Local OBS: localhost or 127.0.0.1\n- Default port: 4455\n\nError details: ${error.message || 'Unknown error'}`;
      
      alert(errorMessage);
    }
  }, [obsSettings, obsConnected]);

  const handleSavePrizes = useCallback(async () => {
    // Save prize configuration to backend
    await gameApi.updatePrizes(prizeAmounts);
    setShowPrizeEditor(false);
  }, [prizeAmounts]);

  const handleUpdatePrize = useCallback((index: number, value: string) => {
    const newPrizes = [...prizeAmounts];
    newPrizes[index] = value;
    setPrizeAmounts(newPrizes);
  }, [prizeAmounts]);

  const handleSaveQuestions = useCallback(async () => {
    try {
      // Save questions to backend
      await gameApi.updateQuestions(questions);
      setShowQuestionEditor(false);
      console.log('✅ Questions saved successfully');
    } catch (error) {
      console.error('❌ Failed to save questions:', error);
    }
  }, [questions]);

  const handleUpdateQuestion = useCallback((index: number, question: Question) => {
    const newQuestions = [...questions];
    newQuestions[index] = question;
    setQuestions(newQuestions);
  }, [questions]);

  // Timer Configuration Functions
  const loadTimerConfig = useCallback(async () => {
    try {
      const config = await gameApi.getTimerConfig();
      setNormalVoteDuration(config.audience_poll_duration_seconds || 60);
      setRevoteDuration(config.revote_duration_seconds || 45);
      setAskModDuration(config.ask_a_mod_duration_seconds || 30);
      console.log('✅ Timer configuration loaded:', config);
    } catch (error) {
      console.error('❌ Failed to load timer configuration:', error);
    }
  }, []);

  const saveTimerConfig = useCallback(async () => {
    if (timerConfigLoading) return;
    
    setTimerConfigLoading(true);
    setTimerConfigSuccess(null);
    
    try {
      const updateData = {
        audience_poll_duration_seconds: normalVoteDuration,
        revote_duration_seconds: revoteDuration,
        ask_a_mod_duration_seconds: askModDuration
      };
      
      await gameApi.updateTimerConfig(updateData);
      
      setTimerConfigSuccess('Timer settings applied successfully!');
      console.log('✅ Timer configuration saved:', updateData);
      
      // Clear success message after 3 seconds
      setTimeout(() => setTimerConfigSuccess(null), 3000);
    } catch (error) {
      console.error('❌ Failed to save timer configuration:', error);
      alert('Failed to save timer configuration. Please try again.');
    } finally {
      setTimerConfigLoading(false);
    }
  }, [normalVoteDuration, revoteDuration, askModDuration, timerConfigLoading]);

  const applyPreset = useCallback((normal: number, revote: number, askMod: number) => {
    setNormalVoteDuration(normal);
    setRevoteDuration(revote);
    setAskModDuration(askMod);
    setTimerConfigSuccess(null);
  }, []);

  // Load timer configuration on mount
  useEffect(() => {
    loadTimerConfig();
  }, [loadTimerConfig]);

  // Removed unused handleSwitchOverlay function

  // Memoized question preview section for performance
  const questionPreviewSection = useMemo(() => (
    <div className={styles.questionPreview}>
      <div className={styles.questionNumber}>
        Question {gameState.current_question + 1} of 15
      </div>
      <div className={`${styles.questionText} ${questionVisible ? styles.visible : styles.hidden}`}>
        {questionVisible ? (currentQuestion?.text || "Loading question from server...") : "Question Hidden"}
      </div>
      <div className={styles.answersGrid}>
        {currentQuestion && currentQuestion.answers ? (
          currentQuestion.answers.map((answer, index) => (
            <div 
              key={index}
              className={`${styles.answerOption} ${
                answersVisible ? styles.visible : styles.hidden
              } ${
                index === currentQuestion.correct ? styles.correctAnswer : ''
              } ${
                selectedAnswer === index ? styles.selectedAnswer : ''
              } ${
                answersVisible && !answerLockedIn && selectedAnswer === null ? styles.needsSelection : ''
              } ${
                answersVisible && index === currentQuestion.correct && !answersRevealed && answerLockedIn && selectedAnswer === index ? styles.hostHint : ''
              }`}
              onClick={() => handleSelectAnswer(index)}
              style={{
                cursor: answersVisible && !answerLockedIn ? 'pointer' : 'default'
              }}
              title={
                answersVisible && !answerLockedIn 
                  ? `Click to select answer ${['A', 'B', 'C', 'D'][index]}` 
                  : undefined
              }
            >
              <span className={styles.answerLetter}>{['A', 'B', 'C', 'D'][index]}:</span>
              <span className={styles.answerText}>
                {answersVisible ? answer : "Hidden"}
              </span>
              {index === currentQuestion.correct && (
                <span className={styles.correctIndicator} title="Correct Answer">
                  ✓
                </span>
              )}
            </div>
          ))
        ) : (
          <div className={styles.noAnswers}>Waiting for questions from server...</div>
        )}
      </div>
    </div>
  ), [
    gameState.current_question, 
    questionVisible, 
    answersVisible, 
    answersRevealed, 
    selectedAnswer, 
    answerLockedIn, 
    currentQuestion,
    handleSelectAnswer
  ]);

  // Keyboard Shortcuts Integration - placed after all handler definitions
  // Keyboard shortcuts removed for cleaner host experience during live shows

  // Animation variants removed to improve performance

  return (
    <div className={styles.controlPanelContainer}>
      {/* Header */}
      <header className={styles.controlPanelHeader}>
        <div className={styles.headerContent}>
          <h1 className={styles.panelTitle}>Who Wants to be a Kimbillionaire - Control Panel</h1>
          <div className={styles.statusSection}>
            <div className={`${styles.statusIndicator} ${styles[`status${obsStatus.charAt(0).toUpperCase() + obsStatus.slice(1)}`]}`}>
              <div className={styles.statusDot}></div>
              <span>
                {obsStatus === 'connected' && 'OBS Connected'}
                {obsStatus === 'connecting' && 'Connecting...'}
                {obsStatus === 'disconnected' && 'OBS Disconnected'}
              </span>
            </div>
            {obsStatus === 'disconnected' && (
              <>
                <button 
                  className={styles.primaryBtn}
                  onClick={handleOBSReconnect}
                >
                  Reconnect
                </button>
                <button 
                  className={styles.secondaryBtn}
                  onClick={() => setShowOBSSettings(!showOBSSettings)}
                  style={{padding: '8px 16px', fontSize: '14px'}}
                >
                  Settings
                </button>
              </>
            )}
            <button 
              className={styles.primaryBtn}
              onClick={() => setShowAnimationPanel(true)}
              style={{padding: '8px 16px', fontSize: '14px', marginLeft: '10px'}}
              title="Animation Control Center">
              🎬 Animations
            </button>
            <div className={styles.serverControls} style={{marginLeft: '20px', display: 'flex', gap: '8px'}}>
              <button 
                className={roaryEnabled ? styles.successBtn : styles.dangerBtn}
                onClick={handleToggleRoary}
                style={{
                  padding: '8px 16px', 
                  fontSize: '14px', 
                  backgroundColor: roaryEnabled ? '#FFD700' : '#6b7280', 
                  border: 'none', 
                  color: roaryEnabled ? '#000' : 'white', 
                  borderRadius: '4px',
                  fontWeight: 'bold'
                }}
                title={roaryEnabled ? 'AI Roary is active - click to disable' : 'AI Roary is disabled - click to enable'}>
                🤖 Roary {roaryEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {/* Producer Preview button removed to reduce lag */}
          </div>
        </div>
      </header>

      {/* Live Chat Configuration - Top Priority */}
      <div className={styles.container}>
        <div className={styles.mainContent}>



      {/* OBS Settings Panel */}
      {showOBSSettings && (
        <div className={styles.controlSection}>
          <h2>OBS WebSocket Settings</h2>
          <div style={{marginBottom: '15px'}}>
            <p style={{color: '#FFD700', marginBottom: '10px'}}>
              Configure OBS WebSocket connection:
            </p>
            <div className={styles.obsSettingsGrid}>
              <div>
                <label style={{color: '#fff', display: 'block', marginBottom: '5px'}}>Host:</label>
                <input
                  type="text"
                  value={obsSettings.host}
                  onChange={(e) => setObsSettings(prev => ({...prev, host: e.target.value}))}
                  style={{
                    padding: '8px 12px',
                    fontSize: '14px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    background: '#333',
                    color: 'white',
                    width: '100%'
                  }}
                />
              </div>
              <div>
                <label style={{color: '#fff', display: 'block', marginBottom: '5px'}}>Port:</label>
                <input
                  type="number"
                  value={obsSettings.port}
                  onChange={(e) => setObsSettings(prev => ({...prev, port: parseInt(e.target.value)}))}
                  style={{
                    padding: '8px 12px',
                    fontSize: '14px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    background: '#333',
                    color: 'white',
                    width: '100%'
                  }}
                />
              </div>
              <div style={{gridColumn: '1 / -1'}}>
                <label style={{color: '#fff', display: 'block', marginBottom: '5px'}}>Password:</label>
                <input
                  type="password"
                  value={obsSettings.password}
                  onChange={(e) => setObsSettings(prev => ({...prev, password: e.target.value}))}
                  style={{
                    padding: '8px 12px',
                    fontSize: '14px',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    background: '#333',
                    color: 'white',
                    width: '100%'
                  }}
                />
              </div>
            </div>
          </div>
          <div className={styles.buttonGrid}>
            <button className={styles.primaryBtn} onClick={handleOBSReconnect}>
              Connect with These Settings
            </button>
            <button 
              className={styles.secondaryBtn} 
              onClick={() => setShowOBSSettings(false)}
            >
              Close Settings
            </button>
          </div>
          <div style={{marginTop: '15px', color: '#ccc', fontSize: '14px'}}>
            <p><strong>Setup Instructions:</strong></p>
            <ol style={{paddingLeft: '20px', lineHeight: '1.6'}}>
              <li>Open OBS Studio</li>
              <li>Go to Tools → WebSocket Server Settings</li>
              <li>Enable WebSocket Server</li>
              <li>Set Port to {obsSettings.port}</li>
              <li>{obsSettings.password ? `Set Password to "${obsSettings.password}"` : 'Leave Password blank (no authentication)'}</li>
              <li>Click OK</li>
              <li>Click "Connect with These Settings" above</li>
            </ol>
          </div>
        </div>
      )}

      {/* Game Setup Section */}
      <GlassPanel title="Game Setup">
        {gameState.game_active && !questionVisible && !answersVisible && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{fontSize: '20px'}}>🎮</span>
            <span style={{color: '#10b981', fontWeight: 'bold'}}>
              Game Started! Click "Show Question" below to begin the first question.
            </span>
          </div>
        )}
        
        {/* Compact Timer Configuration */}
        <div style={{ marginBottom: '20px' }}>
          <details style={{
            background: 'rgba(255, 215, 0, 0.05)',
            border: '1px solid rgba(255, 215, 0, 0.2)',
            borderRadius: '8px',
            padding: '12px'
          }}>
            <summary style={{
              color: '#FFD700',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 0'
            }}>
              ⏱️ Timer Configuration
              <span style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)'}}>
                (Normal: {normalVoteDuration}s • Revote: {revoteDuration}s • Ask Mod: {askModDuration}s)
              </span>
            </summary>
            
            <div style={{ paddingTop: '12px' }}>
              {/* Success Message */}
              {timerConfigSuccess && (
                <div style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  marginBottom: '12px',
                  fontSize: '12px',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  ✅ {timerConfigSuccess}
                </div>
              )}
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginBottom: '12px'
              }}>
                {/* Normal Voting Timer */}
                <div style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '6px',
                  padding: '10px'
                }}>
                  <div style={{color: '#3b82f6', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px'}}>
                    🗳️ Normal Votes
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input
                      type="number"
                      min="15"
                      max="300"
                      value={normalVoteDuration}
                      onChange={(e) => setNormalVoteDuration(parseInt(e.target.value) || 15)}
                      style={{
                        width: '60px',
                        padding: '4px 6px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        background: '#333',
                        color: 'white'
                      }}
                    />
                    <span style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)'}}>seconds</span>
                  </div>
                </div>

                {/* Revote Timer */}
                <div style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '6px',
                  padding: '10px'
                }}>
                  <div style={{color: '#f59e0b', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px'}}>
                    🔄 Revotes
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input
                      type="number"
                      min="10"
                      max="180"
                      value={revoteDuration}
                      onChange={(e) => setRevoteDuration(parseInt(e.target.value) || 10)}
                      style={{
                        width: '60px',
                        padding: '4px 6px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        background: '#333',
                        color: 'white'
                      }}
                    />
                    <span style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)'}}>seconds</span>
                  </div>
                </div>

                {/* Ask a Mod Timer */}
                <div style={{
                  background: 'rgba(139, 69, 19, 0.1)',
                  border: '1px solid rgba(139, 69, 19, 0.3)',
                  borderRadius: '6px',
                  padding: '10px'
                }}>
                  <div style={{color: '#8b4513', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px'}}>
                    🛡️ Ask a Mod
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input
                      type="number"
                      min="10"
                      max="120"
                      value={askModDuration}
                      onChange={(e) => setAskModDuration(parseInt(e.target.value) || 10)}
                      style={{
                        width: '60px',
                        padding: '4px 6px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: '1px solid rgba(139, 69, 19, 0.3)',
                        background: '#333',
                        color: 'white'
                      }}
                    />
                    <span style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)'}}>seconds</span>
                  </div>
                </div>
              </div>
              
              {/* Quick Preset Buttons */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '6px'}}>
                  Quick Presets:
                </div>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                  <button 
                    className={styles.secondaryBtn} 
                    style={{padding: '4px 8px', fontSize: '11px'}}
                    onClick={() => applyPreset(60, 45, 30)}
                  >
                    Standard (60/45/30)
                  </button>
                  <button 
                    className={styles.secondaryBtn} 
                    style={{padding: '4px 8px', fontSize: '11px'}}
                    onClick={() => applyPreset(45, 30, 20)}
                  >
                    Fast (45/30/20)
                  </button>
                  <button 
                    className={styles.secondaryBtn} 
                    style={{padding: '4px 8px', fontSize: '11px'}}
                    onClick={() => applyPreset(90, 60, 45)}
                  >
                    Extended (90/60/45)
                  </button>
                </div>
              </div>
              
              <button 
                className={styles.primaryBtn}
                style={{padding: '6px 12px', fontSize: '12px', width: '100%'}}
                onClick={saveTimerConfig}
                disabled={timerConfigLoading}
              >
                {timerConfigLoading ? '⏳ Applying...' : '💾 Apply Timer Settings'}
              </button>
            </div>
          </details>
        </div>

        <div className={styles.buttonGrid}>
          <input 
            type="text" 
            placeholder="Kimba Gang" 
            value={contestantName}
            onChange={(e) => setContestantName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSetContestant();
              }
            }}
            style={{
              padding: '15px 20px',
              fontSize: '16px',
              borderRadius: '8px',
              border: contestantSet ? '1px solid #4CAF50' : '1px solid #FFD700',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'white',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease'
            }}
          />
          <button 
            className={`${styles.primaryBtn} ${!contestantSet ? styles.pulsingBtn : ''}`}
            onClick={handleSetContestant}
            style={{
              opacity: contestantSet ? 0.8 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            {contestantSet ? '✓ Contestant Set' : 'Set Contestant'}
          </button>
          <button 
            className={`${styles.primaryBtn} ${styles.glowingBtn} ${contestantSet && !gameState.game_active ? styles.readyToStart : ''}`}
            onClick={handleStartGame}
            disabled={!contestantSet || gameState.game_active}
            style={{
              opacity: !contestantSet ? 0.5 : 1,
              cursor: !contestantSet ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease'
            }}
            title={!contestantSet ? 'Please set contestant name first' : ''}
          >
            {!contestantSet ? '🔒 Set Contestant First' : gameState.game_active ? 'Game Active' : '🎮 Start Game'}
          </button>
          <button 
            className={styles.dangerBtn}
            onClick={handleResetGame}
          >
            Reset Game
          </button>
        </div>
      </GlassPanel>


      {/* Current Question Preview Section */}
      <div className={`${styles.controlSection} ${!gameState.game_active ? styles.lockedSection : ''}`}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
          <h2 style={{margin: 0}}>Current Question Preview</h2>
          <button 
            className={styles.secondaryBtn}
            onClick={() => setShowQuestionEditor(!showQuestionEditor)}
            style={{padding: '8px 16px', fontSize: '14px'}}
          >
            {showQuestionEditor ? 'Hide Editor' : 'Edit Questions'}
          </button>
        </div>
        
        {questionPreviewSection}
        
        <QuestionEditor
          questions={questions}
          onUpdateQuestion={handleUpdateQuestion}
          onSave={handleSaveQuestions}
          onCancel={() => setShowQuestionEditor(false)}
          isVisible={showQuestionEditor}
        />
      </div>

      {/* Question Control Section */}
      <div className={(!gameState.game_active || gameState.curtains_closed) ? styles.lockedSection : ''}>
        <QuestionControlSection
          gameState={gameState}
          questionVisible={questionVisible}
          answersVisible={answersVisible}
          answersRevealed={answersRevealed}
          answerLockedIn={answerLockedIn}
          selectedAnswer={selectedAnswer}
          onShowQuestion={handleShowQuestion}
          onShowAnswers={handleShowAnswers}
          onLockInAnswer={handleLockInAnswer}
          onRevealAnswer={handleRevealAnswer}
          onHideQuestion={handleHideQuestion}
          onNextQuestion={handleNextQuestion}
          onPreviousQuestion={handlePreviousQuestion}
          onEndGameCredits={handleEndGameCredits}
          onStartCreditsScroll={handleStartCreditsScroll}
          onStartLifelineVote={handleStartLifelineVote}
          onEndLifelineVoting={handleEndLifelineVoting}
          onShowFinalLeaderboard={handleShowFinalLeaderboard}
          onRollCredits={handleRollCredits}
          disabled={!gameState.game_active || gameState.curtains_closed}
        />
      </div>

      {/* Lifelines Section */}
      <div className={`${styles.controlSection} ${!gameState.game_active ? styles.lockedSection : ''}`}>
        <h2>LIFELINES</h2>
        <LifelineManager
          lifelines={{
            fiftyFifty: { 
              used: gameState.lifelines_used.includes('fiftyFifty'), 
              active: false 
            },
            takeAnotherVote: { 
              used: gameState.lifelines_used.includes('takeAnotherVote'), 
              active: gameState.is_revote_active || false 
            },
            askAMod: { 
              used: gameState.lifelines_used.includes('askAMod'), 
              active: gameState.ask_a_mod_active || false 
            }
          }}
          onUseLifeline={handleUseLifeline}
          onResetLifelines={handleResetLifelines}
        />
      </div>

      {/* Leaderboard Section */}
      <div className={styles.controlSection}>
        <LeaderboardControl />
      </div>

      {/* Prize Configuration Section */}
      <div className={styles.controlSection}>
        <PrizeConfiguration disabled={!gameState.game_active} />
      </div>


      {/* Performance Test removed to reduce lag */}

      {/* Overlay Controls Section */}
      <div className={styles.controlSection}>
        <h2>Overlay Controls</h2>
        
        <div className={styles.buttonGrid} style={{marginBottom: '20px'}}>
          <div style={{display: 'flex', gap: '10px', alignItems: 'center', gridColumn: '1 / -1'}}>
            <span style={{color: '#FFD700'}}>Active Overlay:</span>
            <span style={{color: '#4CAF50', fontWeight: 'bold', padding: '8px 16px', fontSize: '14px'}}>
              Version 2.0 (Modern Glass Morphism)
            </span>
          </div>
        </div>
        
        <div className={styles.overlayControls}>
          <h3 style={{color: '#FFD700', marginBottom: '10px'}}>Visual Controls:</h3>
          <div className={styles.buttonGrid}>
            <button className={styles.secondaryBtn}>Change Background</button>
            <button className={styles.secondaryBtn}>Update Logo</button>
            <button className={styles.secondaryBtn}>Font Settings</button>
            <button className={styles.secondaryBtn}>Color Scheme</button>
            <button className={styles.secondaryBtn}>Animation Speed</button>
            <button className={styles.secondaryBtn}>Sound Effects</button>
          </div>
          
          <div style={{marginTop: '15px'}}>
            <h4 style={{color: '#FFD700', marginBottom: '10px'}}>Layout Options:</h4>
            <div className={styles.buttonGrid}>
              <button className={styles.secondaryBtn}>Show/Hide Timer</button>
              <button className={styles.secondaryBtn}>Show/Hide Lifelines</button>
              <button className={styles.secondaryBtn}>Show/Hide Money Tree</button>
              <button className={styles.secondaryBtn}>Show/Hide Contestant Info</button>
            </div>
          </div>
        </div>
      </div>


      
        </div>

        {/* Sidebar with Prize Levels */}
        <div className={styles.sidebar}>
          {/* Live Chat Configuration - Top of Sidebar */}
          <LiveChatConfig 
            disabled={showOBSSettings || showQuestionEditor || showPrizeEditor}
            onConfigUpdate={(config) => {
              console.log('🌐 Live chat config updated:', config);
            }}
          />
          
          {/* Live Chat Viewer - Below Configuration */}
          <LiveChatViewer 
            disabled={showOBSSettings || showQuestionEditor || showPrizeEditor}
          />
          
          {/* Giveaway Control Panel */}
          <GiveawayControlPanel 
            className={showOBSSettings || showQuestionEditor || showPrizeEditor ? styles.lockedSection : ''}
          />
          
          {/* Performance Monitor - Removed */}
          {/* <PerformanceMonitor 
            disabled={showOBSSettings || showQuestionEditor || showPrizeEditor}
          /> */}
          
          {/* Money Tree Section */}
          <div className={styles.controlSection}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
              <h2 style={{margin: 0}}>Prize Levels</h2>
              <button 
                className={styles.secondaryBtn}
                onClick={() => setShowPrizeEditor(!showPrizeEditor)}
                style={{padding: '8px 16px', fontSize: '14px'}}
              >
                {showPrizeEditor ? 'Hide Editor' : 'Edit Prizes'}
              </button>
            </div>
            
            {/* Game State Data */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
              color: '#fff',
              fontSize: '12px'
            }}>
              <h3 style={{color: '#FFD700', margin: '0 0 8px 0', fontSize: '14px'}}>Game State</h3>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px'}}>
                <div><strong>Question:</strong> {gameState.current_question + 1}/15</div>
                <div><strong>Prize:</strong> ${gameState.score.toLocaleString()}</div>
                <div><strong>Status:</strong> {gameState.game_active ? 'Active' : 'Inactive'}</div>
                <div><strong>Lifelines:</strong> {gameState.lifelines_used.length || 0} used</div>
              </div>
            </div>
            
            <PrizeEditor
              prizeAmounts={prizeAmounts}
              onUpdatePrize={handleUpdatePrize}
              onSave={handleSavePrizes}
              onCancel={() => setShowPrizeEditor(false)}
              isVisible={showPrizeEditor}
            />
            
            <div className={`${styles.moneyTree} ${gameState.game_active ? styles.active : ''}`}>
              {prizeAmounts.slice().reverse().map((amount, index): JSX.Element => {
                const level = 15 - index;
                return (
                  <div 
                    key={index}
                    data-level={`Level ${level}`}
                    className={`${styles.moneyLevel} ${
                      level === (gameState.current_question + 1) && gameState.game_active ? styles.currentLevel : ''
                    } ${
                      level < (gameState.current_question + 1) && gameState.game_active ? styles.achievedLevel : ''
                    }`}
                    style={{
                      '--level': index
                    } as React.CSSProperties}
                  >
                    {amount}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Producer Preview removed to reduce lag */}

      {/* Keyboard shortcuts help removed for cleaner host experience */}

      {/* Animation Control Panel Modal */}
      <AnimationControlPanel 
        isVisible={showAnimationPanel}
        onClose={() => setShowAnimationPanel(false)}
      />
    </div>
  );
};

export default KimbillionaireControlPanel;