// API utility functions for the Kimbillionaire control panel

// Direct connection to bridge server
const API_BASE = 'http://localhost:8081/api';
console.log('API Base URL:', API_BASE);

export const gameApi = {
  getState: async () => {
    const response = await fetch(`${API_BASE}/state`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  startGame: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'start_game' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  nextQuestion: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'next_question' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  previousQuestion: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'previous_question' }),
    });
    return response.json();
  },

  setContestant: async (name: string) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'set_contestant', name }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  setTheme: async (theme: string) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'set_theme', theme }),
    });
    return response.json();
  },

  shutdown: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'shutdown' }),
    });
    return response.json();
  },

  updatePrizes: async (prizes: string[]) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'update_prizes', prizes }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  updateOverlaySettings: async (settings: any) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'update_overlay', settings }),
    });
    return response.json();
  },

  switchOverlay: async (overlay: 'original' | 'v2') => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'switch_overlay', overlay }),
    });
    return response.json();
  },

  showQuestion: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'show_question' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  hideQuestion: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'hide_question' }),
    });
    return response.json();
  },

  showAnswers: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'show_answers' }),
    });
    return response.json();
  },

  hideAnswers: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'hide_answers' }),
    });
    return response.json();
  },

  revealAnswer: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reveal_answer' }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  resetGame: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reset_game' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },


  getQuestions: async () => {
    const response = await fetch(`${API_BASE}/questions`);
    const data = await response.json();
    return data.questions; // Extract just the questions array
  },

  updateQuestions: async (questions: any[]) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'update_questions', questions }),
    });
    return response.json();
  },

  lockAnswer: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'lock_answer' }),
    });
    return response.json();
  },

  setSelectedAnswer: async (answerIndex: number) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'set_selected_answer', answer_index: answerIndex }),
    });
    return response.json();
  },

  // Animation control functions
  sendAnimationCommand: async (command: string, params: any = {}) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'animation_command', command, params }),
    });
    return response.json();
  },

  setAnimationSettings: async (settings: {
    enabled: boolean;
    soundEnabled: boolean;
    speed: number;
  }) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'set_animation_settings', settings }),
    });
    return response.json();
  },

  // Enhanced Animation API endpoints
  triggerAnimation: async (command: string, params: any = {}) => {
    const response = await fetch(`${API_BASE}/animation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command, params }),
    });
    return response.json();
  },

  updateAnimationConfig: async (config: any) => {
    const response = await fetch(`${API_BASE}/animation/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    return response.json();
  },

  getAnimationStatus: async () => {
    const response = await fetch(`${API_BASE}/animation/status`);
    return response.json();
  },

  // Lifeline functions
  useLifeline: async (lifelineType: 'fiftyFifty' | 'askAMod' | 'takeAnotherVote') => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: `use_lifeline_${lifelineType}` }),
    });
    return response.json();
  },

  // Start lifeline voting
  startLifelineVote: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'start_lifeline_vote' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  sendControlAction: async (action: string) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // Timer functions
  sendTimerMessage: async (action: 'start' | 'stop' | 'update', params: any = {}) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: `timer_${action}`, ...params }),
    });
    return response.json();
  },

  // Live Chat Configuration functions
  getPollingConfig: async () => {
    const response = await fetch(`${API_BASE}/polling/config`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  updatePollingConfig: async (config: any) => {
    const response = await fetch(`${API_BASE}/polling/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // AI Roary functions
  getRoaryStatus: async () => {
    const response = await fetch(`${API_BASE}/roary/status`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // Prize Management functions
  getPrizes: async () => {
    const response = await fetch(`${API_BASE}/prizes`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // Credits system
  endGameCredits: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end_game_credits' }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  },

  startCreditsScroll: async () => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_credits_scroll' }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  },

  // Timer Configuration functions
  getTimerConfig: async () => {
    const response = await fetch(`${API_BASE}/timer-config`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  updateTimerConfig: async (config: any) => {
    const response = await fetch(`${API_BASE}/timer-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // Giveaway system functions
  getGiveawayStatus: async () => {
    const response = await fetch(`${API_BASE}/giveaway/status`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  startGiveaway: async (prizeName: string, prizeAmount: string, numWinners: number) => {
    const response = await fetch(`${API_BASE}/giveaway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'start',
        prizeName,
        prizeAmount,
        numWinners
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  stopGiveaway: async () => {
    const response = await fetch(`${API_BASE}/giveaway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  selectGiveawayWinners: async () => {
    const response = await fetch(`${API_BASE}/giveaway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select_winners' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  resetGiveaway: async () => {
    const response = await fetch(`${API_BASE}/giveaway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  // Generic command sender for new actions
  sendCommand: async (action: string, data: any = {}) => {
    const response = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  },
}; 