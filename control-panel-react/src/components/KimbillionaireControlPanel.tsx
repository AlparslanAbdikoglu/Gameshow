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
import {
  Question,
  GameState,
  OBSConnectionStatus,
  OBSSettings,
  GameMode,             // ✅ new
  GameModeConfig
} from '../types/gameTypes';
import '../styles/theme.css';
import styles from './KimbillionaireControlPanel.module.css';


/**
 * Custom hook for keyboard shortcuts
 * Handles all keybinds and prevents conflicts with input fields
 */
const useKeybinds = (handlers: Record<string, () => void>, dependencies: any[] = []) => {
  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    // Ignore if user is typing in an input field
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // Define our custom shortcuts
    const ourShortcuts = ['q', 'a', 'l', 'r', 'n', 'h', 'arrowleft', 'arrowright', 'f', 'c', 'v', 'e', '?'];

    // Prevent default for our shortcuts
    if (ourShortcuts.includes(key) || (ctrl && ['arrowleft', 'arrowright'].includes(key))) {
      e.preventDefault();
    }

    // Check for matching handler
    Object.entries(handlers).forEach(([shortcut, handler]) => {
      const [modifiers, targetKey] = shortcut.includes('+')
        ? [shortcut.split('+').slice(0, -1), shortcut.split('+').pop()!]
        : [[], shortcut];

      const requiresCtrl = modifiers.includes('ctrl');
      const requiresShift = modifiers.includes('shift');

      if (key === targetKey &&
        (!requiresCtrl || ctrl) &&
        (!requiresShift || shift)) {
        handler();
      }
    });
  }, dependencies);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);
};

interface HotSeatProfileData {
  username: string;
  displayName: string;
  storyHtml: string;
  storyText: string;
}

interface HotSeatProfileParseResult {
  profiles: Record<string, HotSeatProfileData>;
  errors: string[];
}

const applyInlineProfileFormatting = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(?<!\\)\*(?!\s)([^*]+?)\*(?!\s)/g, '<em>$1</em>')
    .replace(/_(?!\s)([^_]+?)_(?!\s)/g, '<em>$1</em>');

const escapeProfileHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const convertProfileStoryToHtml = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { html: '', text: '' };
  }

  const blocks = trimmed.split(/\n{2,}/);
  const htmlBlocks = blocks
    .map((block) => {
      const lines = block
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return '';
      }

      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        const items = lines
          .map((line) => line.replace(/^[-*]\s+/, ''))
          .map((line) => `<li>${applyInlineProfileFormatting(escapeProfileHtml(line))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      const paragraph = lines.join(' ');
      return `<p>${applyInlineProfileFormatting(escapeProfileHtml(paragraph))}</p>`;
    })
    .filter(Boolean)
    .join('');

  return {
    html: htmlBlocks,
    text: trimmed
  };
};

const parseHotSeatProfilesMarkdown = (markdown: string): HotSeatProfileParseResult => {
  const lines = markdown.split(/\r?\n/);
  const profiles: Record<string, HotSeatProfileData> = {};
  const errors: string[] = [];

  let currentIdentifier: string | null = null;
  let currentDisplayName: string | null = null;
  let buffer: string[] = [];

  const flushCurrent = () => {
    if (!currentIdentifier) {
      buffer = [];
      return;
    }

    const storyRaw = buffer.join('\n');
    const { html, text } = convertProfileStoryToHtml(storyRaw);
    const normalized = currentIdentifier.trim().toLowerCase();

    if (!normalized) {
      errors.push('Skipped profile with empty username.');
      buffer = [];
      currentIdentifier = null;
      currentDisplayName = null;
      return;
    }

    profiles[normalized] = {
      username: currentIdentifier.trim(),
      displayName: (currentDisplayName || currentIdentifier).trim(),
      storyHtml: html,
      storyText: text
    };

    buffer = [];
    currentIdentifier = null;
    currentDisplayName = null;
  };

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      flushCurrent();

      let headingText = headingMatch[1].trim();
      if (!headingText) {
        errors.push(`Line ${index + 1}: heading is missing a username.`);
        return;
      }

      let usernamePart = headingText;
      let displayNamePart = headingText;

      if (headingText.includes('|')) {
        const [userSegment, displaySegment] = headingText.split('|');
        usernamePart = userSegment.trim();
        displayNamePart = (displaySegment || userSegment).trim();
      }

      if (usernamePart.startsWith('@')) {
        usernamePart = usernamePart.slice(1).trim();
      }

      if (!usernamePart) {
        errors.push(`Line ${index + 1}: heading must include a username.`);
        return;
      }

      currentIdentifier = usernamePart;
      currentDisplayName = displayNamePart;
      buffer = [];
      return;
    }

    if (currentIdentifier) {
      buffer.push(line);
    }
  });

  flushCurrent();

  return { profiles, errors };
};

const KimbillionaireControlPanel: React.FC = () => {
  // Game State
  const [gameState, setGameState] = useState<GameState>({
    current_question: 0,
    score: 0,
    game_active: false,
    lifelines_used: [],
    update_needed: false,
    selectedGameMode: 'normal'  // ✅ default to classic
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
  const [showKeybindHelp, setShowKeybindHelp] = useState(false);
  const [hotSeatProfilesCount, setHotSeatProfilesCount] = useState(0);
  const [hotSeatProfileStatus, setHotSeatProfileStatus] = useState<string | null>(null);
  const [hotSeatProfileError, setHotSeatProfileError] = useState<string | null>(null);
  const [isUploadingHotSeatProfiles, setIsUploadingHotSeatProfiles] = useState(false);
  const [hotSeatProfileFileName, setHotSeatProfileFileName] = useState<string | null>(null);
  const [hotSeatProfilesMap, setHotSeatProfilesMap] = useState<Record<string, HotSeatProfileData>>({});
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

        const loadedProfiles = currentState.hot_seat_profiles || {};
        const profileCount = Object.keys(loadedProfiles).length;
        setHotSeatProfilesMap(loadedProfiles);
        setHotSeatProfilesCount(profileCount);
        setHotSeatProfileError(null);
        setHotSeatProfileFileName(null);

        if (profileCount > 0) {
          const lastUpdated = currentState.hot_seat_profiles_last_update
            ? new Date(currentState.hot_seat_profiles_last_update).toLocaleTimeString()
            : null;
          setHotSeatProfileStatus(`Loaded ${profileCount} hot seat profile${profileCount === 1 ? '' : 's'}${lastUpdated ? ` · Updated ${lastUpdated}` : ''}.`);
        } else {
          setHotSeatProfileStatus(null);
        }

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

  useEffect(() => {
    const profiles = gameState.hot_seat_profiles || {};
    setHotSeatProfilesMap(profiles);

    const count = Object.keys(profiles).length;
    setHotSeatProfilesCount(count);

    if (!isUploadingHotSeatProfiles) {
      if (count > 0) {
        const lastUpdated = gameState.hot_seat_profiles_last_update
          ? new Date(gameState.hot_seat_profiles_last_update).toLocaleTimeString()
          : null;
        setHotSeatProfileStatus(`Loaded ${count} hot seat profile${count === 1 ? '' : 's'}${lastUpdated ? ` · Updated ${lastUpdated}` : ''}.`);
      } else {
        setHotSeatProfileStatus(null);
      }
    }
  }, [gameState.hot_seat_profiles, gameState.hot_seat_profiles_last_update, isUploadingHotSeatProfiles]);

  const hotSeatPreviewDetails = useMemo(() => {
    const profiles = hotSeatProfilesMap || {};
    const allProfiles = Object.values(profiles);
    const activeUserRaw = (gameState.hot_seat_user || '').trim();
    const normalizedActive = activeUserRaw.toLowerCase();
    const activeProfile = normalizedActive ? profiles[normalizedActive] : undefined;
    const isActive = Boolean(gameState.hot_seat_active && activeUserRaw.length > 0);

    let fallbackProfile: HotSeatProfileData | null = null;
    if (allProfiles.length > 0) {
      fallbackProfile = allProfiles
        .slice()
        .sort((a, b) => {
          const aName = (a.displayName || a.username || '').toLowerCase();
          const bName = (b.displayName || b.username || '').toLowerCase();
          return aName.localeCompare(bName);
        })[0];
    }

    let displayName = 'Hot Seat Spotlight';
    if (isActive) {
      displayName = activeProfile?.displayName || activeProfile?.username || activeUserRaw || displayName;
    } else if (fallbackProfile) {
      displayName = fallbackProfile.displayName || fallbackProfile.username || displayName;
    } else if (activeUserRaw) {
      displayName = activeUserRaw;
    }

    let storyHtml = '';
    if (isActive && activeProfile && typeof activeProfile.storyHtml === 'string' && activeProfile.storyHtml.trim().length > 0) {
      storyHtml = activeProfile.storyHtml;
    } else if (!isActive && fallbackProfile && typeof fallbackProfile.storyHtml === 'string' && fallbackProfile.storyHtml.trim().length > 0) {
      storyHtml = fallbackProfile.storyHtml;
    }

    const fallbackStoryHtml = `<p>${escapeProfileHtml(displayName)} is ready for the spotlight. Upload a hot seat story to share their background.</p>`;

    const alternates = isActive && Array.isArray(gameState.hot_seat_users)
      ? gameState.hot_seat_users.slice(1)
      : [];

    return {
      badge: isActive ? 'Hot Seat Active' : 'Hot Seat Spotlight',
      name: displayName,
      tagline: isActive ? 'Currently in the hot seat' : (fallbackProfile ? 'Uploaded story preview' : 'Ready for the spotlight'),
      blurb: isActive
        ? `${displayName} is answering from the hot seat right now.`
        : (fallbackProfile
          ? `Previewing the story that will appear when ${displayName} is selected.`
          : 'Upload a markdown file to spotlight your contestants here.'),
      storyHtml: storyHtml && storyHtml.trim().length > 0 ? storyHtml : fallbackStoryHtml,
      alternates
    };
  }, [gameState.hot_seat_active, gameState.hot_seat_user, gameState.hot_seat_users, hotSeatProfilesMap]);

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
        console.log(`⏰ Control Panel WebSocket: Reconnecting in ${delay / 1000} seconds...`);
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

  const handleShowFinalLeaderboard = useCallback(async () => {
    try {
      await gameApi.sendCommand('show_final_leaderboard');
      console.log('🏆 Final leaderboard displayed with winners');
    } catch (error) {
      console.error('❌ Failed to show final leaderboard:', error);
      alert('Failed to show final leaderboard. Please check the server connection.');
    }
  }, []);

  const handleHotSeatProfileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsUploadingHotSeatProfiles(true);
    setHotSeatProfileStatus(null);
    setHotSeatProfileError(null);

    try {
      const fileContents = await file.text();
      const { profiles, errors } = parseHotSeatProfilesMarkdown(fileContents);
      const profileCount = Object.keys(profiles).length;

      if (profileCount === 0) {
        setHotSeatProfileError('No valid profiles were found in the uploaded markdown file.');
        return;
      }

      console.log(`📁 Uploading ${profileCount} hot seat profile(s) from ${file.name}`);
      const response = await gameApi.uploadHotSeatProfiles(profiles);
      const uploadedCount = typeof response?.count === 'number' ? response.count : profileCount;

      setHotSeatProfilesMap(profiles);
      setHotSeatProfilesCount(uploadedCount);
      setHotSeatProfileStatus(`Uploaded ${uploadedCount} hot seat profile${uploadedCount === 1 ? '' : 's'} from ${file.name}.`);
      setHotSeatProfileFileName(file.name);

      if (errors.length > 0) {
        const preview = errors.slice(0, 3).join('; ');
        const overflow = errors.length > 3 ? ` (and ${errors.length - 3} more)` : '';
        setHotSeatProfileError(`Some entries were skipped: ${preview}${overflow}`);
      } else {
        setHotSeatProfileError(null);
      }
    } catch (error) {
      console.error('❌ Failed to upload hot seat profiles:', error);
      setHotSeatProfileError(error instanceof Error ? error.message : 'Unknown error while uploading profiles.');
    } finally {
      setIsUploadingHotSeatProfiles(false);
      if (event.target) {
        event.target.value = '';
      }
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

  const participantCount = Array.isArray(gameState.gameshow_participants)
    ? gameState.gameshow_participants.length
    : 0;
  const creditsRolling = Boolean(gameState.credits_rolling);
  const creditsStatusLabel = creditsRolling ? 'Rolling' : 'Idle';


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
              className={`${styles.answerOption} ${answersVisible ? styles.visible : styles.hidden
                } ${index === currentQuestion.correct ? styles.correctAnswer : ''
                } ${selectedAnswer === index ? styles.selectedAnswer : ''
                } ${answersVisible && !answerLockedIn && selectedAnswer === null ? styles.needsSelection : ''
                } ${answersVisible && index === currentQuestion.correct && !answersRevealed && answerLockedIn && selectedAnswer === index ? styles.hostHint : ''
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

  // Keyboard Shortcuts Integration
  useKeybinds({
    // Question Control
    'q': () => {
      if (!gameState.game_active || gameState.curtains_closed || answerLockedIn) return;
      handleShowQuestion();
    },
    'a': () => {
      if (!gameState.game_active || gameState.curtains_closed || answerLockedIn ||
        !questionVisible || !gameState.typewriter_animation_complete) return;
      handleShowAnswers();
    },
    'l': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        !answersVisible || answerLockedIn || answersRevealed || selectedAnswer === null) return;
      handleLockInAnswer();
    },
    'r': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        !answerLockedIn || answersRevealed) return;
      handleRevealAnswer();
    },

    // Navigation
    'n': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        (answerLockedIn && !answersRevealed) || gameState.lifeline_voting_active) return;

      // Handle lifeline vote start
      if (answersRevealed && gameState.answer_is_wrong &&
        gameState.available_lifelines_for_vote && gameState.available_lifelines_for_vote.length > 0 &&
        !gameState.lifeline_voting_active) {
        handleStartLifelineVote();
      } else if (answersRevealed && gameState.current_question < 14) {
        handleNextQuestion();
      }
    },
    'arrowright': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        (answerLockedIn && !answersRevealed) || gameState.lifeline_voting_active) return;

      if (answersRevealed && gameState.answer_is_wrong &&
        gameState.available_lifelines_for_vote && gameState.available_lifelines_for_vote.length > 0 &&
        !gameState.lifeline_voting_active) {
        handleStartLifelineVote();
      } else if (answersRevealed && gameState.current_question < 14) {
        handleNextQuestion();
      }
    },
    'arrowleft': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        answerLockedIn || gameState.current_question === 0) return;
      handlePreviousQuestion();
    },

    // Utility
    'h': () => {
      if (!gameState.game_active) return;
      handleHideQuestion();
    },

    // Lifeline Controls
    'v': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        !answersRevealed || !gameState.answer_is_wrong ||
        !gameState.available_lifelines_for_vote || !gameState.available_lifelines_for_vote.length ||
        gameState.lifeline_voting_active) return;
      handleStartLifelineVote();
    },
    'e': () => {
      if (!gameState.game_active || gameState.curtains_closed ||
        !gameState.lifeline_voting_active) return;
      handleEndLifelineVoting();
    },

    // End Game Controls
    'f': () => {
      if (!gameState.game_active || gameState.current_question !== 14 ||
        !answersRevealed || (gameState as any).finalLeaderboardShown) return;
      handleShowFinalLeaderboard();
    },
    'c': () => {
      if (!gameState.game_active || gameState.current_question !== 14 ||
        !(gameState as any).finalLeaderboardShown) return;
      handleEndGameCredits();
    },

    // Help Toggle
    '?': () => setShowKeybindHelp(!showKeybindHelp),
  }, [
    gameState,
    questionVisible,
    answersVisible,
    answersRevealed,
    answerLockedIn,
    selectedAnswer,
    showKeybindHelp,
    handleShowQuestion,
    handleShowAnswers,
    handleLockInAnswer,
    handleRevealAnswer,
    handleNextQuestion,
    handlePreviousQuestion,
    handleHideQuestion,
    handleStartLifelineVote,
    handleEndLifelineVoting,
    handleShowFinalLeaderboard,
    handleEndGameCredits
  ]);

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
                  style={{ padding: '8px 16px', fontSize: '14px' }}
                >
                  Settings
                </button>
              </>
            )}
            <button
              className={styles.primaryBtn}
              onClick={() => setShowAnimationPanel(true)}
              style={{ padding: '8px 16px', fontSize: '14px', marginLeft: '10px' }}
              title="Animation Control Center">
              🎬 Animations
            </button>
            <button
              onClick={() => setShowKeybindHelp(!showKeybindHelp)}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                background: 'rgba(255, 215, 0, 0.1)',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                borderRadius: '8px',
                color: '#FFD700',
                cursor: 'pointer',
                fontWeight: 'bold',
                marginLeft: '10px'
              }}
              title="Press ? to toggle keyboard shortcuts"
            >
              ⌨️ Shortcuts
            </button>
            <div className={styles.serverControls} style={{ marginLeft: '20px', display: 'flex', gap: '8px' }}>
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
            <div className={styles.modeSelector} style={{ marginLeft: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="gameMode" style={{ color: '#fff', fontWeight: 'bold' }}>🎮 Mode:</label>
              <select
                id="gameMode"
                value={gameState.selectedGameMode || 'normal'}
                onChange={(e) =>
                  setGameState((prev) => ({
                    ...prev,
                    selectedGameMode: e.target.value as GameMode
                  }))
                }
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  color: '#fff',
                  padding: '6px 10px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {Object.entries(GameModeConfig).map(([mode, config]) => (
                  <option key={mode} value={mode}>
                    {config.icon} {config.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Producer Preview button removed to reduce lag */}
          </div>
        </div>
      </header>

      {/* Keybind Help Panel */}
      {showKeybindHelp && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 20, 40, 0.98)',
          border: '2px solid rgba(255, 215, 0, 0.5)',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflowY: 'auto',
          zIndex: 10000,
          backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px'
          }}>
            <h2 style={{ color: '#FFD700', margin: 0 }}>⌨️ Keyboard Shortcuts</h2>
            <button
              onClick={() => setShowKeybindHelp(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#FFD700',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '0 8px'
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Question Controls */}
            <div>
              <h3 style={{ color: '#FFD700', fontSize: '16px', marginBottom: '8px' }}>
                Question Controls
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'Q', desc: 'Show Question' },
                  { key: 'A', desc: 'Show Answers' },
                  { key: 'L', desc: 'Lock In Answer' },
                  { key: 'R', desc: 'Reveal Answer' },
                  { key: 'H', desc: 'Hide All' }
                ].map(({ key, desc }) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px'
                  }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{desc}</span>
                    <kbd style={{
                      background: 'rgba(255, 215, 0, 0.2)',
                      border: '1px solid rgba(255, 215, 0, 0.4)',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      fontFamily: 'monospace',
                      color: '#FFD700',
                      fontWeight: 'bold'
                    }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div>
              <h3 style={{ color: '#FFD700', fontSize: '16px', marginBottom: '8px' }}>
                Navigation
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'N or →', desc: 'Next Question / Start Lifeline Vote' },
                  { key: '←', desc: 'Previous Question' }
                ].map(({ key, desc }) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px'
                  }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{desc}</span>
                    <kbd style={{
                      background: 'rgba(255, 215, 0, 0.2)',
                      border: '1px solid rgba(255, 215, 0, 0.4)',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      fontFamily: 'monospace',
                      color: '#FFD700',
                      fontWeight: 'bold'
                    }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* Lifeline Controls */}
            <div>
              <h3 style={{ color: '#FFD700', fontSize: '16px', marginBottom: '8px' }}>
                Lifeline Controls
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'V', desc: 'Start Lifeline Vote' },
                  { key: 'E', desc: 'End Lifeline Voting' }
                ].map(({ key, desc }) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px'
                  }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{desc}</span>
                    <kbd style={{
                      background: 'rgba(255, 215, 0, 0.2)',
                      border: '1px solid rgba(255, 215, 0, 0.4)',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      fontFamily: 'monospace',
                      color: '#FFD700',
                      fontWeight: 'bold'
                    }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* End Game */}
            <div>
              <h3 style={{ color: '#FFD700', fontSize: '16px', marginBottom: '8px' }}>
                End Game Sequence
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'F', desc: 'Show Final Leaderboard' },
                  { key: 'C', desc: 'Roll Credits' }
                ].map(({ key, desc }) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px'
                  }}>
                    <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{desc}</span>
                    <kbd style={{
                      background: 'rgba(255, 215, 0, 0.2)',
                      border: '1px solid rgba(255, 215, 0, 0.4)',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      fontFamily: 'monospace',
                      color: '#FFD700',
                      fontWeight: 'bold'
                    }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {/* Help */}
            <div style={{
              marginTop: '8px',
              padding: '12px',
              background: 'rgba(255, 215, 0, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 215, 0, 0.3)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  Toggle this help
                </span>
                <kbd style={{
                  background: 'rgba(255, 215, 0, 0.2)',
                  border: '1px solid rgba(255, 215, 0, 0.4)',
                  borderRadius: '4px',
                  padding: '4px 12px',
                  fontFamily: 'monospace',
                  color: '#FFD700',
                  fontWeight: 'bold'
                }}>?</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live Chat Configuration - Top Priority */}
      <div className={styles.container}>
        <div className={styles.mainContent}>



          {/* OBS Settings Panel */}
          {showOBSSettings && (
            <div className={styles.controlSection}>
              <h2>OBS WebSocket Settings</h2>
              <div style={{ marginBottom: '15px' }}>
                <p style={{ color: '#FFD700', marginBottom: '10px' }}>
                  Configure OBS WebSocket connection:
                </p>
                <div className={styles.obsSettingsGrid}>
                  <div>
                    <label style={{ color: '#fff', display: 'block', marginBottom: '5px' }}>Host:</label>
                    <input
                      type="text"
                      value={obsSettings.host}
                      onChange={(e) => setObsSettings(prev => ({ ...prev, host: e.target.value }))}
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
                    <label style={{ color: '#fff', display: 'block', marginBottom: '5px' }}>Port:</label>
                    <input
                      type="number"
                      value={obsSettings.port}
                      onChange={(e) => setObsSettings(prev => ({ ...prev, port: parseInt(e.target.value) }))}
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
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ color: '#fff', display: 'block', marginBottom: '5px' }}>Password:</label>
                    <input
                      type="password"
                      value={obsSettings.password}
                      onChange={(e) => setObsSettings(prev => ({ ...prev, password: e.target.value }))}
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
              <div style={{ marginTop: '15px', color: '#ccc', fontSize: '14px' }}>
                <p><strong>Setup Instructions:</strong></p>
                <ol style={{ paddingLeft: '20px', lineHeight: '1.6' }}>
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
                <span style={{ fontSize: '20px' }}>🎮</span>
                <span style={{ color: '#10b981', fontWeight: 'bold' }}>
                  Game Started! Press <kbd style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px', margin: '0 4px' }}>Q</kbd> to begin the first question.
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
                  <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>
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
                      <div style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>
                        🗳️ Normal Votes
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                        <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>seconds</span>
                      </div>
                    </div>

                    {/* Revote Timer */}
                    <div style={{
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '6px',
                      padding: '10px'
                    }}>
                      <div style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>
                        🔄 Revotes
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                        <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>seconds</span>
                      </div>
                    </div>

                    {/* Ask a Mod Timer */}
                    <div style={{
                      background: 'rgba(139, 69, 19, 0.1)',
                      border: '1px solid rgba(139, 69, 19, 0.3)',
                      borderRadius: '6px',
                      padding: '10px'
                    }}>
                      <div style={{ color: '#8b4513', fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>
                        🛡️ Ask a Mod
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                        <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>seconds</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '6px' }}>
                      Quick Presets:
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        className={styles.secondaryBtn}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => applyPreset(60, 45, 30)}
                      >
                        Standard (60/45/30)
                      </button>
                      <button
                        className={styles.secondaryBtn}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => applyPreset(45, 30, 20)}
                      >
                        Fast (45/30/20)
                      </button>
                      <button
                        className={styles.secondaryBtn}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => applyPreset(90, 60, 45)}
                      >
                        Extended (90/60/45)
                      </button>
                    </div>
                  </div>

                  <button
                    className={styles.primaryBtn}
                    style={{ padding: '6px 12px', fontSize: '12px', width: '100%' }}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ margin: 0 }}>Current Question Preview</h2>
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowQuestionEditor(!showQuestionEditor)}
                style={{ padding: '8px 16px', fontSize: '14px' }}
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
              onStartLifelineVote={handleStartLifelineVote}
              onEndLifelineVoting={handleEndLifelineVoting}
              onShowFinalLeaderboard={handleShowFinalLeaderboard}
              onRollCredits={handleEndGameCredits}
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

          <GlassPanel title="Credits & Hot Seat Highlights">
            <div className={styles.creditsStatusGrid}>
              <div className={styles.creditsStatusCard}>
                <span className={styles.creditsStatusLabel}>Credits Status</span>
                <span
                  className={`${styles.creditsStatusValue} ${creditsRolling ? styles.creditsStatusActive : styles.creditsStatusIdle
                    }`}
                >
                  {creditsStatusLabel}
                </span>
                <span className={styles.creditsStatusSubtext}>
                  {participantCount} participant{participantCount === 1 ? '' : 's'} ready for credits
                </span>
              </div>

              <div className={styles.creditsStatusCard}>
                <span className={styles.creditsStatusLabel}>Hot Seat Profiles</span>
                <span
                  className={`${styles.creditsStatusValue} ${hotSeatProfilesCount > 0 ? styles.creditsStatusActive : styles.creditsStatusIdle
                    }`}
                >
                  {hotSeatProfilesCount}
                </span>
                <span className={styles.creditsStatusSubtext}>
                  {hotSeatProfileFileName
                    ? `Last upload: ${hotSeatProfileFileName}`
                    : 'Upload markdown to spotlight players'}
                </span>
              </div>
            </div>

            <div className={styles.hotSeatUpload}>
              <label htmlFor="hotSeatProfileUpload" className={styles.uploadLabel}>
                Upload hot seat background stories (accepting:.md .txt)
              </label>

              {/* Custom-styled upload button */}
              <label className={styles.customUploadButton}>
                📂 Select File
                <input
                  id="hotSeatProfileUpload"
                  type="file"
                  accept=".md,.markdown,.txt"
                  onChange={handleHotSeatProfileUpload}
                  disabled={isUploadingHotSeatProfiles}
                  style={{ display: 'none' }}
                />
              </label>

              <div className={styles.uploadStatusRow}>
                {isUploadingHotSeatProfiles && (
                  <span className={styles.uploadStatus}>Uploading profiles...</span>
                )}
                {!isUploadingHotSeatProfiles && hotSeatProfileStatus && (
                  <span className={styles.uploadStatus}>{hotSeatProfileStatus}</span>
                )}
                {!isUploadingHotSeatProfiles && hotSeatProfileError && (
                  <span className={styles.uploadStatusError}>{hotSeatProfileError}</span>
                )}
              </div>
            </div>

            <div className={styles.hotSeatPreviewWrapper}>
              <span className={styles.hotSeatPreviewTitle}>Hot Seat Story Preview</span>
              <div className={styles.hotSeatPreviewCard}>
                <span className={styles.hotSeatPreviewBadge}>{hotSeatPreviewDetails.badge}</span>
                <span className={styles.hotSeatPreviewName}>{hotSeatPreviewDetails.name}</span>
                <span className={styles.hotSeatPreviewTagline}>{hotSeatPreviewDetails.tagline}</span>
                <div className={styles.hotSeatPreviewBlurb}>{hotSeatPreviewDetails.blurb}</div>
                <div className={styles.hotSeatPreviewDivider} />
                <div
                  className={styles.hotSeatPreviewStory}
                  dangerouslySetInnerHTML={{ __html: hotSeatPreviewDetails.storyHtml }}
                />
                {hotSeatPreviewDetails.alternates.length > 0 && (
                  <div className={styles.hotSeatPreviewAlternates}>
                    Alternates: {hotSeatPreviewDetails.alternates.join(', ')}
                  </div>
                )}
              </div>
            </div>
          </GlassPanel>


          {/* Performance Test removed to reduce lag */}

          {/* Overlay Controls Section */}
          <div className={styles.controlSection}>
            <h2>Overlay Controls</h2>

            <div className={styles.buttonGrid} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', gridColumn: '1 / -1' }}>
                <span style={{ color: '#FFD700' }}>Active Overlay:</span>
                <span style={{ color: '#4CAF50', fontWeight: 'bold', padding: '8px 16px', fontSize: '14px' }}>
                  Version 2.0 (Modern Glass Morphism)
                </span>
              </div>
            </div>

            <div className={styles.overlayControls}>
              <h3 style={{ color: '#FFD700', marginBottom: '10px' }}>Visual Controls:</h3>
              <div className={styles.buttonGrid}>
                <button className={styles.secondaryBtn}>Change Background</button>
                <button className={styles.secondaryBtn}>Update Logo</button>
                <button className={styles.secondaryBtn}>Font Settings</button>
                <button className={styles.secondaryBtn}>Color Scheme</button>
                <button className={styles.secondaryBtn}>Animation Speed</button>
                <button className={styles.secondaryBtn}>Sound Effects</button>
              </div>

              <div style={{ marginTop: '15px' }}>
                <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>Layout Options:</h4>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ margin: 0 }}>Prize Levels</h2>
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowPrizeEditor(!showPrizeEditor)}
                style={{ padding: '8px 16px', fontSize: '14px' }}
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
              <h3 style={{ color: '#FFD700', margin: '0 0 8px 0', fontSize: '14px' }}>Game State</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px' }}>
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
                    className={`${styles.moneyLevel} ${level === (gameState.current_question + 1) && gameState.game_active ? styles.currentLevel : ''
                      } ${level < (gameState.current_question + 1) && gameState.game_active ? styles.achievedLevel : ''
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

      {/* Animation Control Panel Modal */}
      <AnimationControlPanel
        isVisible={showAnimationPanel}
        onClose={() => setShowAnimationPanel(false)}
      />
    </div>
  );
};

export default KimbillionaireControlPanel;