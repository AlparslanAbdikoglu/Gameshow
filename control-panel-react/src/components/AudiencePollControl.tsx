import React, { useState, useEffect, useCallback } from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';

interface PollStatus {
  isActive: boolean;
  currentPoll?: {
    id: string;
    startTime: string;
    duration: number;
  };
  votes?: {
    combined: { A: number; B: number; C: number; D: number };
  };
  timeRemaining?: number;
  totalPolls?: number;
}

interface AudiencePollControlProps {
  gameState: {
    game_active: boolean;
    answers_visible: boolean;
    lifelines_used: string[];
    current_question?: number;
  };
  disabled?: boolean;
}

const AudiencePollControl: React.FC<AudiencePollControlProps> = ({
  gameState,
  disabled = false
}) => {
  const [pollStatus, setPollStatus] = useState<PollStatus>({
    isActive: false,
    totalPolls: 0
  });
  const [isConnected, setIsConnected] = useState(false);
  const [pollDuration, setPollDuration] = useState(30);
  const [voteKeywords, setVoteKeywords] = useState(['A', 'B', 'C', 'D']);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // API base URL
  const API_BASE = 'http://localhost:8081';

  // Load timer configuration from main system
  const loadTimerConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    try {
      const response = await fetch(`${API_BASE}/api/timer-config`);
      if (response.ok) {
        const config = await response.json();
        const configuredDuration = config.audience_poll_duration_seconds || 60;
        setPollDuration(configuredDuration);
        console.log('✅ AudiencePollControl synced with timer config:', configuredDuration + 's');
      } else {
        console.warn('⚠️ Could not load timer config, using default duration');
      }
    } catch (error) {
      console.warn('⚠️ Timer config load failed, using default duration:', error);
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  // Start a new poll
  const handleStartPoll = useCallback(async () => {
    if (pollStatus.isActive) {
      console.warn('Poll already active');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/poll/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pollId: `question_${gameState?.current_question || 0}_${Date.now()}`,
          duration: pollDuration * 1000,
          keywords: voteKeywords
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Poll started successfully:', result);
        setPollStatus(prev => ({
          ...prev,
          isActive: true,
          currentPoll: result.poll
        }));
      } else {
        console.error('❌ Failed to start poll:', result);
        alert('Failed to start poll. Check console for details.');
      }
    } catch (error) {
      console.error('❌ Error starting poll:', error);
      alert('Error starting poll. Make sure the bridge server is running.');
    }
  }, [pollStatus.isActive, pollDuration, voteKeywords, gameState]);

  // End the current poll
  const handleEndPoll = useCallback(async () => {
    if (!pollStatus.isActive) {
      console.warn('No active poll to end');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/poll/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Poll ended successfully');
        setPollStatus(prev => ({
          ...prev,
          isActive: false,
          currentPoll: undefined,
          votes: undefined,
          timeRemaining: undefined
        }));
      } else {
        console.error('❌ Failed to end poll:', result);
      }
    } catch (error) {
      console.error('❌ Error ending poll:', error);
    }
  }, [pollStatus.isActive]);

  // Test connection to bridge server
  const testConnection = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/state`);
      const data = await response.json();
      setIsConnected(true);
      console.log('✅ Bridge server connection successful');
    } catch (error) {
      setIsConnected(false);
      console.error('❌ Bridge server connection failed:', error);
    }
  }, []);

  // Check connection on mount and load timer config
  useEffect(() => {
    testConnection();
    loadTimerConfig(); // Load timer configuration on mount
    const interval = setInterval(testConnection, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [testConnection, loadTimerConfig]);

  // Calculate vote percentages
  const getVotePercentages = useCallback(() => {
    if (!pollStatus.votes?.combined) return { A: 0, B: 0, C: 0, D: 0 };
    
    const votes = pollStatus.votes.combined;
    const total = Object.values(votes).reduce((sum, count) => sum + count, 0);
    
    if (total === 0) return { A: 0, B: 0, C: 0, D: 0 };
    
    return {
      A: Math.round((votes.A / total) * 100),
      B: Math.round((votes.B / total) * 100),
      C: Math.round((votes.C / total) * 100),
      D: Math.round((votes.D / total) * 100)
    };
  }, [pollStatus.votes]);

  // Get winner
  const getWinner = useCallback(() => {
    if (!pollStatus.votes?.combined) return null;
    
    const votes = pollStatus.votes.combined;
    return Object.keys(votes).reduce((a, b) => {
      const voteA = (votes as any)[a] || 0;
      const voteB = (votes as any)[b] || 0;
      return voteA > voteB ? a : b;
    });
  }, [pollStatus.votes]);

  const percentages = getVotePercentages();
  const winner = getWinner();
  const canStartPoll = gameState.game_active && gameState.answers_visible && !disabled;

  return (
    <GlassPanel title="🗳️ Audience Polling System">
      {/* Connection Status */}
      <div style={{
        background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <span style={{fontSize: '20px'}}>
          {isConnected ? '✅' : '❌'}
        </span>
        <span style={{
          color: isConnected ? '#10b981' : '#ef4444',
          fontWeight: 'bold'
        }}>
          {isConnected ? 'Polling System Connected' : 'Polling System Disconnected'}
        </span>
        {!isConnected && (
          <button 
            className={styles.secondaryBtn}
            onClick={testConnection}
            style={{marginLeft: 'auto', padding: '6px 12px', fontSize: '12px'}}
          >
            Retry
          </button>
        )}
      </div>

      {/* Poll Configuration */}
      <div style={{marginBottom: '20px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
          <h3 style={{color: '#FFD700', margin: 0, fontSize: '16px'}}>Poll Settings</h3>
          <button
            className={styles.secondaryBtn}
            onClick={loadTimerConfig}
            disabled={isLoadingConfig || pollStatus.isActive}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              opacity: (isLoadingConfig || pollStatus.isActive) ? 0.5 : 1,
              cursor: (isLoadingConfig || pollStatus.isActive) ? 'not-allowed' : 'pointer'
            }}
            title="Sync with main timer configuration"
          >
            {isLoadingConfig ? '⏳' : '🔄'} Sync
          </button>
        </div>
        <div style={{
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '6px',
          padding: '8px 12px',
          marginBottom: '15px',
          fontSize: '12px',
          color: '#60a5fa'
        }}>
          ℹ️ Duration synced with main timer configuration. Use Timer Configuration panel to modify.
        </div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
          <div>
            <label style={{color: '#fff', display: 'block', marginBottom: '5px', fontSize: '14px'}}>
              Duration (seconds):
            </label>
            <input
              type="number"
              min="10"
              max="300"
              value={pollDuration}
              onChange={(e) => setPollDuration(parseInt(e.target.value) || 30)}
              disabled={pollStatus.isActive}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                background: pollStatus.isActive ? '#444' : '#333',
                color: 'white',
                opacity: pollStatus.isActive ? 0.6 : 1
              }}
              title="Duration is synced with main timer configuration"
            />
          </div>
          <div>
            <label style={{color: '#fff', display: 'block', marginBottom: '5px', fontSize: '14px'}}>
              Vote Options:
            </label>
            <input
              type="text"
              value={voteKeywords.join(', ')}
              onChange={(e) => setVoteKeywords(e.target.value.split(',').map(k => k.trim()).filter(k => k))}
              disabled={pollStatus.isActive}
              placeholder="A, B, C, D"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                background: pollStatus.isActive ? '#444' : '#333',
                color: 'white',
                opacity: pollStatus.isActive ? 0.6 : 1
              }}
            />
          </div>
        </div>
      </div>

      {/* Poll Controls */}
      <div className={styles.buttonGrid} style={{marginBottom: '20px'}}>
        <button
          className={`${styles.primaryBtn} ${canStartPoll && !pollStatus.isActive ? styles.glowingBtn : ''}`}
          onClick={handleStartPoll}
          disabled={!canStartPoll || pollStatus.isActive || !isConnected}
          style={{
            opacity: (!canStartPoll || pollStatus.isActive || !isConnected) ? 0.5 : 1,
            cursor: (!canStartPoll || pollStatus.isActive || !isConnected) ? 'not-allowed' : 'pointer'
          }}
          title={
            !gameState.game_active ? 'Start the game first' :
            !gameState.answers_visible ? 'Show answers first' :
            pollStatus.isActive ? 'Poll already active' :
            !isConnected ? 'System not connected' :
            'Start audience poll'
          }
        >
          {pollStatus.isActive ? '🟢 Poll Active' : '🗳️ Start Poll'}
        </button>
        
        <button
          className={styles.dangerBtn}
          onClick={handleEndPoll}
          disabled={!pollStatus.isActive}
          style={{
            opacity: !pollStatus.isActive ? 0.5 : 1,
            cursor: !pollStatus.isActive ? 'not-allowed' : 'pointer'
          }}
        >
          End Poll
        </button>
      </div>

      {/* Active Poll Status */}
      {pollStatus.isActive && (
        <div style={{
          background: 'rgba(255, 215, 0, 0.1)',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '15px'
        }}>
          <h4 style={{color: '#FFD700', margin: '0 0 10px 0', fontSize: '16px'}}>
            🔴 Live Poll Active
          </h4>
          <div style={{fontSize: '14px', color: '#fff', lineHeight: '1.5'}}>
            <div><strong>Poll ID:</strong> {pollStatus.currentPoll?.id}</div>
            <div><strong>Duration:</strong> {pollDuration} seconds</div>
            <div><strong>Options:</strong> {voteKeywords.join(', ')}</div>
            {pollStatus.timeRemaining && (
              <div><strong>Time Remaining:</strong> {Math.ceil(pollStatus.timeRemaining / 1000)}s</div>
            )}
          </div>
        </div>
      )}

      {/* Vote Results */}
      {pollStatus.votes && (
        <div style={{marginBottom: '15px'}}>
          <h4 style={{color: '#FFD700', marginBottom: '10px', fontSize: '16px'}}>
            📊 Live Results
          </h4>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px'}}>
            {voteKeywords.map(option => {
              const votes = pollStatus.votes?.combined?.[option as keyof typeof pollStatus.votes.combined] || 0;
              const percentage = (percentages as any)[option] || 0;
              const isWinner = winner === option;
              
              return (
                <div
                  key={option}
                  style={{
                    background: isWinner ? 'rgba(255, 215, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                    border: `1px solid ${isWinner ? '#FFD700' : 'rgba(255, 255, 255, 0.2)'}`,
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {/* Progress bar */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: '3px',
                    width: `${percentage}%`,
                    background: isWinner ? '#FFD700' : 'rgba(255, 215, 0, 0.5)',
                    transition: 'width 0.5s ease'
                  }} />
                  
                  <span style={{
                    fontWeight: 'bold',
                    color: isWinner ? '#FFD700' : '#fff',
                    fontSize: '16px'
                  }}>
                    {option}
                  </span>
                  <div style={{textAlign: 'right'}}>
                    <div style={{
                      color: isWinner ? '#FFD700' : '#fff',
                      fontWeight: 'bold',
                      fontSize: '14px'
                    }}>
                      {votes} votes
                    </div>
                    <div style={{
                      color: isWinner ? '#FFD700' : 'rgba(255, 255, 255, 0.7)',
                      fontSize: '12px'
                    }}>
                      {percentage}%
                    </div>
                  </div>
                  {isWinner && <span style={{marginLeft: '8px'}}>👑</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* System Info */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '6px',
        padding: '10px 12px',
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.7)'
      }}>
        <div><strong>OBS Overlay:</strong> http://localhost:8082/</div>
        <div><strong>Test Page:</strong> http://localhost:8082/test</div>
        <div><strong>Total Polls:</strong> {pollStatus.totalPolls || 0}</div>
      </div>
    </GlassPanel>
  );
};

export default AudiencePollControl;