/**
 * Comprehensive TypeScript interfaces for Kimbillionaire Control Panel
 * Ensures type safety across the broadcast-quality game show system
 */

// 🎮 Game Mode Types
  export type GameMode = 'normal' | 'spooky';

  export const GameModeConfig: Record<GameMode, {
    label: string;
    description: string;
    color: string;
    icon: string;
  }> = {
    normal: {
      label: 'Kimbillionaire Classic',
      description: 'The original game show experience.',
      color: '#007bff',
      icon: '🎩'
    },
    spooky: {
      label: 'Spooky Halloween Edition',
      description: 'Ghosts, ghouls, and eerie surprises!',
      color: '#ff5722',
      icon: '🎃'
    }
  };

  // Core Game Types
export interface Question {
  text: string;
  answers: string[];
  correct: number;
  number: number;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  timeLimit?: number;
}

export interface SlotMachineSymbol {
  id: string;
  label: string;
  emoji: string;
  emojiUrl?: string | null;
}

export interface SlotMachineRound {
  question_index: number;
  status: 'collecting' | 'awaiting_lever' | 'spinning' | 'results';
  entry_duration_ms: number;
  entry_started_at: number;
  entries: string[];
  lever_candidate?: string | null;
  is_test_round?: boolean;
  results?: {
    symbols?: SlotMachineSymbol[];
    matched?: boolean;
    perParticipantPoints?: number;
    totalAwardedPoints?: number;
    leverUser?: string | null;
  };
}

export interface SlotMachineState {
  enabled: boolean;
  schedule_questions: number[];
  schedule_version?: 'zero_indexed' | 'question_numbers';
  entry_duration_ms: number;
  max_points?: number;
  current_round?: SlotMachineRound | null;
  last_round_result?: {
    symbols?: SlotMachineSymbol[];
    matched?: boolean;
    perParticipantPoints?: number;
    leverUser?: string | null;
    isTestRound?: boolean;
  } | null;
}

export interface GameState {
  current_question: number;
  score: number;
  game_active: boolean;
  lifelines_used: string[];
  update_needed: boolean;
  contestant_name?: string;
  currentQuestion?: Question;
  questions?: Question[];
  question_visible?: boolean;
  answers_visible?: boolean;
  answers_revealed?: boolean;
  selected_answer?: number | null;
  answer_locked?: boolean;
  timer_active?: boolean;
  timer_remaining?: number;
  curtains_closed?: boolean;
  preparing_for_game?: boolean;
  typewriter_animation_complete?: boolean;
  selectedGameMode?: GameMode;
  gameModeWheelActive?: boolean;

  // Lifeline states
  first_poll_winner?: string | null;
  is_revote_active?: boolean;
  excluded_answers?: number[];

  // Answer locking state
  answer_locked_in?: boolean;

  // Lifeline voting states
  lifeline_voting_active?: boolean;
  lifeline_voting_timer_active?: boolean;
  lifeline_voting_start_time?: number | null;
  lifeline_voting_duration?: number;
  available_lifelines_for_vote?: string[];
  lifeline_vote_counts?: {
    fiftyFifty: number;
    askAudience: number;
    phoneFriend: number;
  };
  lifeline_vote_winner?: string | null;
  answer_is_wrong?: boolean;

  // Ask a Mod lifeline states
  ask_a_mod_active?: boolean;
  mod_responses?: Array<{ username: string; message: string; timestamp: number }>;
  ask_a_mod_start_time?: number | null;
  credits_rolling?: boolean;
  credits_scrolling?: boolean;
  gameshow_participants?: string[];
  hot_seat_profiles?: Record<string, {
    username: string;
    displayName: string;
    storyHtml?: string;
    storyText?: string;
    lastUpdated?: number;
  }>;
  hot_seat_profiles_last_update?: number | null;
  hot_seat_user?: string | null;
  hot_seat_users?: string[];
  hot_seat_active?: boolean;
  hot_seat_spotlight_until?: number | null;
  prizeConfiguration?: {
    enabled?: boolean;
    topWinnersCount?: number;
    prizeName?: string;
    prizeAmount?: number;
    customMessage?: string;
    winnersAnnounced?: boolean;
  };
  slot_machine?: SlotMachineState;
}

// Lifeline Types
export type LifelineType = 'fifty_fifty' | 'phone_friend' | 'ask_audience' | 'custom';

export interface LifelineState {
  type: LifelineType;
  used: boolean;
  available: boolean;
  description: string;
}

export interface LifelineManager {
  fiftyFifty: LifelineState;
  askAudience: LifelineState;
  phoneAFriend: LifelineState;
  customLifeline?: LifelineState;
}

// UI State Types
export interface UIState {
  questionVisible: boolean;
  answersVisible: boolean;
  answersRevealed: boolean;
  answerLockedIn: boolean;
  selectedAnswer: number | null;
  showPrizeEditor: boolean;
  showOBSSettings: boolean;
  showQuestionEditor: boolean;
}

// OBS Integration Types
export type OBSConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface OBSSettings {
  host: string;
  port: number;
  password: string;
}

export interface OBSState {
  connected: boolean;
  status: OBSConnectionStatus;
  settings: OBSSettings;
  lastError?: string;
}

// Timer Types
export interface TimerState {
  active: boolean;
  duration: number;
  remaining: number;
  warningThreshold: number;
  criticalThreshold: number;
  onExpire?: () => void;
}

// Prize/Money Types
export interface MoneyLevel {
  amount: string;
  level: number;
  achieved: boolean;
  current: boolean;
  safeHaven?: boolean;
}

export interface PrizeConfiguration {
  levels: string[];
  currentLevel: number;
  safeHavens: number[];
  finalPrize: string;
}

// Performance Types
export interface PerformanceMetrics {
  fps: number;
  memory: number;
  cpuUsage: number;
  networkLatency: number;
  renderTime: number;
  componentCount: number;
}

// Audience Types
export interface AudienceMetrics {
  totalPlayers: number;
  activeParticipants: number;
  correctPercentage: number;
  responseTime: number;
  engagement: number;
}

// Event Types
export interface GameEvent {
  type: 'state_update' | 'question_change' | 'timer_update' | 'lifeline_used' | 'game_over';
  timestamp: number;
  data: any;
}

// API Response Types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface QuestionResponse extends APIResponse {
  data: Question[];
}

export interface StateResponse extends APIResponse {
  data: GameState;
}

// Component Props
export interface BaseComponentProps {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  loading?: boolean;
}

export interface GameControlProps extends BaseComponentProps {
  gameState: GameState;
  onStateChange: (state: Partial<GameState>) => void;
}

export interface ProducerPreviewProps extends BaseComponentProps {
  gameState: GameState;
  isVisible: boolean;
  onToggle: () => void;
}

// Error Handling
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface GameError {
  id: string;
  message: string;
  severity: ErrorSeverity;
  timestamp: number;
  context?: Record<string, any>;
  stack?: string;
}

// Configuration
export interface GameConfiguration {
  totalQuestions: number;
  questionTimeLimit: number;
  lifelines: LifelineType[];
  prizeStructure: string[];
  safeHavens: number[];
  theme: 'classic' | 'modern' | 'custom';
  audioEnabled: boolean;
  animationsEnabled: boolean;
  availableGameModes?: GameMode[];
  defaultGameMode?: GameMode;
}

// Keyboard Shortcuts
export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  description: string;
  action: () => void;
}

export interface ShortcutCategory {
  name: string;
  shortcuts: KeyboardShortcut[];
}

// Animation
export interface AnimationConfig {
  duration: number;
  easing: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | string;
  delay?: number;
  iterations?: number;
}

// Theme
export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  error: string;
  warning: string;
  success: string;
}

export interface GameTheme {
  name: string;
  colors: ThemeColors;
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
}

// Utility
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;