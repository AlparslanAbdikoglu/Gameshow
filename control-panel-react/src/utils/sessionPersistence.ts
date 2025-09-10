import React from 'react';

/**
 * Session Persistence Utility for Kimbillionaire Control Panel
 * Handles localStorage management, auto-save, and session recovery
 */

interface GameSessionData {
  // Core game state
  current_question: number;
  score: number;
  game_active: boolean;
  lifelines_used: string[];
  contestant_name: string;
  
  // UI state
  question_visible: boolean;
  answers_visible: boolean;
  answers_revealed: boolean;
  answer_locked_in: boolean;
  selected_answer: number | null;
  
  // Configuration
  questions?: any[];
  prize_amounts?: string[];
  
  // Metadata
  session_id: string;
  last_saved: string;
  version: string;
}

interface SessionSettings {
  auto_save_interval: number; // milliseconds
  max_sessions: number; // maximum stored sessions
  compression: boolean; // compress data before storing
}

const DEFAULT_SETTINGS: SessionSettings = {
  auto_save_interval: 30000, // 30 seconds
  max_sessions: 5,
  compression: false
};

const STORAGE_KEYS = {
  CURRENT_SESSION: 'kimbillionaire_current_session',
  SESSION_LIST: 'kimbillionaire_sessions',
  SETTINGS: 'kimbillionaire_settings',
  AUTO_SAVE_TIMER: 'kimbillionaire_auto_save'
} as const;

class SessionPersistenceManager {
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private settings: SessionSettings;
  private currentSessionId: string;

  constructor() {
    this.settings = this.loadSettings();
    this.currentSessionId = this.generateSessionId();
    this.initializeAutoSave();
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): SessionSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.warn('Failed to load session settings:', error);
    }
    return DEFAULT_SETTINGS;
  }

  /**
   * Save settings to localStorage
   */
  saveSettings(settings: Partial<SessionSettings>): void {
    this.settings = { ...this.settings, ...settings };
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save session settings:', error);
    }
  }

  /**
   * Initialize auto-save functionality
   */
  private initializeAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      this.autoSave();
    }, this.settings.auto_save_interval);
  }

  /**
   * Save current session data
   */
  saveSession(data: Partial<GameSessionData>): boolean {
    try {
      const sessionData: GameSessionData = {
        ...data,
        session_id: this.currentSessionId,
        last_saved: new Date().toISOString(),
        version: '3.0.0'
      } as GameSessionData;

      // Save current session
      localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(sessionData));

      // Add to session history
      this.addToSessionHistory(sessionData);

      console.log('Session saved successfully:', sessionData.session_id);
      return true;
    } catch (error) {
      console.error('Failed to save session:', error);
      return false;
    }
  }

  /**
   * Load current session data
   */
  loadSession(): GameSessionData | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION);
      if (stored) {
        const data = JSON.parse(stored) as GameSessionData;
        console.log('Session loaded successfully:', data.session_id);
        return data;
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    }
    return null;
  }

  /**
   * Auto-save current session (lighter version)
   */
  private autoSave(): void {
    // This would be called by the React component to save minimal state
    const event = new CustomEvent('kimbillionaire-auto-save');
    window.dispatchEvent(event);
  }

  /**
   * Add session to history list
   */
  private addToSessionHistory(sessionData: GameSessionData): void {
    try {
      const historyKey = STORAGE_KEYS.SESSION_LIST;
      const existing = localStorage.getItem(historyKey);
      let sessions: GameSessionData[] = existing ? JSON.parse(existing) : [];

      // Remove old sessions if we exceed max limit
      if (sessions.length >= this.settings.max_sessions) {
        sessions = sessions.slice(-(this.settings.max_sessions - 1));
      }

      // Add new session
      sessions.push({
        ...sessionData,
        // Store only essential data for history
        questions: undefined, // Don't store full question set
      });

      localStorage.setItem(historyKey, JSON.stringify(sessions));
    } catch (error) {
      console.error('Failed to update session history:', error);
    }
  }

  /**
   * Get list of saved sessions
   */
  getSessionHistory(): GameSessionData[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SESSION_LIST);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load session history:', error);
      return [];
    }
  }

  /**
   * Load a specific session from history
   */
  loadSessionById(sessionId: string): GameSessionData | null {
    try {
      const sessions = this.getSessionHistory();
      return sessions.find(s => s.session_id === sessionId) || null;
    } catch (error) {
      console.error('Failed to load session by ID:', error);
      return null;
    }
  }

  /**
   * Clear all session data
   */
  clearAllSessions(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
      localStorage.removeItem(STORAGE_KEYS.SESSION_LIST);
      console.log('All sessions cleared');
    } catch (error) {
      console.error('Failed to clear sessions:', error);
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    currentSessionAge: number;
    lastSaved: string | null;
    storageUsed: number;
  } {
    const sessions = this.getSessionHistory();
    const currentSession = this.loadSession();
    
    // Calculate storage usage
    let storageUsed = 0;
    try {
      for (const key of Object.values(STORAGE_KEYS)) {
        const item = localStorage.getItem(key);
        if (item) {
          storageUsed += new Blob([item]).size;
        }
      }
    } catch (error) {
      console.warn('Could not calculate storage usage:', error);
    }

    return {
      totalSessions: sessions.length,
      currentSessionAge: currentSession 
        ? Date.now() - new Date(currentSession.last_saved).getTime()
        : 0,
      lastSaved: currentSession?.last_saved || null,
      storageUsed
    };
  }

  /**
   * Export session data for backup
   */
  exportSessions(): string {
    try {
      const currentSession = this.loadSession();
      const sessionHistory = this.getSessionHistory();
      const settings = this.settings;

      const exportData = {
        current_session: currentSession,
        session_history: sessionHistory,
        settings,
        exported_at: new Date().toISOString(),
        version: '3.0.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Failed to export sessions:', error);
      throw error;
    }
  }

  /**
   * Import session data from backup
   */
  importSessions(exportedData: string): boolean {
    try {
      const data = JSON.parse(exportedData);
      
      // Validate structure
      if (!data.version || !data.exported_at) {
        throw new Error('Invalid export format');
      }

      // Import settings
      if (data.settings) {
        this.saveSettings(data.settings);
      }

      // Import current session
      if (data.current_session) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(data.current_session));
      }

      // Import session history
      if (data.session_history) {
        localStorage.setItem(STORAGE_KEYS.SESSION_LIST, JSON.stringify(data.session_history));
      }

      console.log('Sessions imported successfully');
      return true;
    } catch (error) {
      console.error('Failed to import sessions:', error);
      return false;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Check if localStorage is available
   */
  isStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, 'test');
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Start a new session
   */
  startNewSession(): string {
    this.currentSessionId = this.generateSessionId();
    console.log('Started new session:', this.currentSessionId);
    return this.currentSessionId;
  }
}

// Create singleton instance
export const sessionManager = new SessionPersistenceManager();

/**
 * React hook for session persistence
 */
export const useSessionPersistence = () => {
  const [isAutoSaving, setIsAutoSaving] = React.useState(false);

  React.useEffect(() => {
    const handleAutoSave = () => {
      setIsAutoSaving(true);
      // Auto-save logic would be implemented here
      setTimeout(() => setIsAutoSaving(false), 1000);
    };

    window.addEventListener('kimbillionaire-auto-save', handleAutoSave);
    return () => {
      window.removeEventListener('kimbillionaire-auto-save', handleAutoSave);
    };
  }, []);

  return {
    saveSession: sessionManager.saveSession.bind(sessionManager),
    loadSession: sessionManager.loadSession.bind(sessionManager),
    clearAllSessions: sessionManager.clearAllSessions.bind(sessionManager),
    getSessionHistory: sessionManager.getSessionHistory.bind(sessionManager),
    getSessionStats: sessionManager.getSessionStats.bind(sessionManager),
    exportSessions: sessionManager.exportSessions.bind(sessionManager),
    importSessions: sessionManager.importSessions.bind(sessionManager),
    isAutoSaving,
    sessionId: sessionManager.getCurrentSessionId()
  };
};

export default sessionManager;