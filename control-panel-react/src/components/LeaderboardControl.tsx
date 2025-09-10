import React, { useState, useEffect, useCallback } from 'react';
import './LeaderboardControl.css';
import IgnoredUsersDropdown from './IgnoredUsersDropdown';

interface LeaderboardUser {
  username: string;
  points: number;
  correct_answers: number;
  total_votes: number;
  current_streak?: number;
  best_streak?: number;
  daily_best_streak?: number;
  weekly_best_streak?: number;
  monthly_best_streak?: number;
  hot_seat_appearances?: number;
  hot_seat_correct?: number;
  average_response_time?: number;
}

interface LeaderboardData {
  current_game: LeaderboardUser[];
  daily: LeaderboardUser[];
  weekly: LeaderboardUser[];
  monthly: LeaderboardUser[];
  all_time: LeaderboardUser[];
  last_reset: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}

interface LeaderboardSettings {
  points: {
    participation: number;
    correct_answer: number;
    chat_participation: number;
    speed_bonus_max: number;
    streak_multiplier: number;
    hot_seat_correct: number;
    hot_seat_participation: number;
  };
  chat_participation_enabled?: boolean;
  chat_participation_cooldown?: number;
}

const LeaderboardControl: React.FC = () => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<keyof LeaderboardData>('current_game');
  const [settings, setSettings] = useState<LeaderboardSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [resetPeriod, setResetPeriod] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Fetch leaderboard data
  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard');
      const data = await response.json();
      setLeaderboardData(data);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  }, []);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }, []);

  // Initialize WebSocket for real-time updates
  useEffect(() => {
    const websocket = new WebSocket('ws://localhost:8081');
    
    websocket.onopen = () => {
      console.log('WebSocket connected for leaderboard updates');
      websocket.send(JSON.stringify({ type: 'register', client: 'leaderboard_control' }));
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'leaderboard_update') {
          setLeaderboardData(message.data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
    };

    setWs(websocket);

    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchLeaderboard();
    fetchSettings();
  }, [fetchLeaderboard, fetchSettings]);

  // Reset leaderboard
  const handleReset = async (period: string) => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          period, 
          confirmed: period === 'all_time' 
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setLeaderboardData(data.leaderboard);
        setShowConfirmReset(false);
        setResetPeriod('');
      }
    } catch (error) {
      console.error('Error resetting leaderboard:', error);
    }
    setLoading(false);
  };

  // Export leaderboard
  const handleExport = async () => {
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leaderboard-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting leaderboard:', error);
    }
  };

  // Import leaderboard
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importData = JSON.parse(e.target?.result as string);
        
        const response = await fetch('http://localhost:8081/api/leaderboard/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leaderboard: importData.leaderboard, merge: false })
        });
        
        if (response.ok) {
          const data = await response.json();
          setLeaderboardData(data.leaderboard);
        }
      } catch (error) {
        console.error('Error importing leaderboard:', error);
      }
    };
    reader.readAsText(file);
  };

  // Update settings
  const handleSettingsUpdate = async () => {
    if (!settings) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (response.ok) {
        setShowSettings(false);
      }
    } catch (error) {
      console.error('Error updating settings:', error);
    }
    setLoading(false);
  };

  // Format time since last reset
  const formatTimeSince = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'Recently';
  };

  const renderLeaderboard = (users: LeaderboardUser[]) => {
    if (!users || users.length === 0) {
      return <div className="empty-leaderboard">No data yet</div>;
    }

    return (
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Username</th>
            <th>Points</th>
            <th>Correct</th>
            <th>Votes</th>
            <th>Streak</th>
            <th>Hot Seat</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, index) => (
            <tr key={user.username} className={index < 3 ? `rank-${index + 1}` : ''}>
              <td className="rank">
                {index === 0 && '🥇'}
                {index === 1 && '🥈'}
                {index === 2 && '🥉'}
                {index > 2 && index + 1}
              </td>
              <td className="username">{user.username}</td>
              <td className="points">{user.points}</td>
              <td className="correct">{user.correct_answers}</td>
              <td className="votes">{user.total_votes}</td>
              <td className="streak">
                {/* Current game shows current streak */}
                {selectedPeriod === 'current_game' && (
                  <>
                    {user.current_streak || 0}
                    {user.best_streak && user.best_streak > (user.current_streak || 0) && 
                      <span className="best-streak"> (Best: {user.best_streak})</span>
                    }
                  </>
                )}
                
                {/* Daily shows daily best streak with all-time best if higher */}
                {selectedPeriod === 'daily' && (
                  <>
                    {user.daily_best_streak || 0}
                    {user.best_streak && user.best_streak > (user.daily_best_streak || 0) && 
                      <span className="best-streak"> (Best: {user.best_streak})</span>
                    }
                  </>
                )}
                
                {/* Weekly shows weekly best streak with all-time best if higher */}
                {selectedPeriod === 'weekly' && (
                  <>
                    {user.weekly_best_streak || 0}
                    {user.best_streak && user.best_streak > (user.weekly_best_streak || 0) && 
                      <span className="best-streak"> (Best: {user.best_streak})</span>
                    }
                  </>
                )}
                
                {/* Monthly shows monthly best streak with all-time best if higher */}
                {selectedPeriod === 'monthly' && (
                  <>
                    {user.monthly_best_streak || 0}
                    {user.best_streak && user.best_streak > (user.monthly_best_streak || 0) && 
                      <span className="best-streak"> (Best: {user.best_streak})</span>
                    }
                  </>
                )}
                
                {/* All-time shows only the best streak ever */}
                {selectedPeriod === 'all_time' && (
                  user.best_streak || 0
                )}
              </td>
              <td className="hot-seat">
                {user.hot_seat_appearances || 0}
                {user.hot_seat_correct ? ` (${user.hot_seat_correct} ✓)` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="leaderboard-control">
      <div className="leaderboard-header">
        <h2>🏆 LEADERBOARD</h2>
        <div className="header-actions">
          <div style={{ display: 'flex', gap: '6px' }}>
            <button 
              onClick={() => {
                // Send command to show leaderboard in browser source
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'broadcast',
                    message: {
                      type: 'show_leaderboard',
                      period: selectedPeriod
                    }
                  }));
                  console.log('📺 Show leaderboard in browser source:', selectedPeriod);
                }
              }}
              className="show-btn"
              style={{ background: 'linear-gradient(135deg, #4CAF50, #45a049)' }}
            >
              📺 Show
            </button>
            <button 
              onClick={() => {
                // Send command to hide leaderboard in browser source
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'broadcast',
                    message: {
                      type: 'hide_leaderboard'
                    }
                  }));
                  console.log('👻 Hide leaderboard in browser source');
                }
              }}
              className="hide-btn"
              style={{ background: 'linear-gradient(135deg, #f44336, #da190b)' }}
            >
              👻 Hide
            </button>
          </div>
          <button onClick={fetchLeaderboard} className="refresh-btn">
            🔄 Refresh
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="settings-btn">
            ⚙️ Settings
          </button>
          <button onClick={handleExport} className="export-btn">
            📥 Export
          </button>
          <label className="import-btn">
            📤 Import
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <IgnoredUsersDropdown ws={ws} />
        </div>
      </div>

      {showSettings && settings && (
        <div className="settings-panel">
          <h3>Point Settings</h3>
          <div className="settings-grid">
            <label>
              Vote Participation:
              <input
                type="number"
                value={settings.points.participation}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, participation: parseInt(e.target.value) }
                })}
              />
            </label>
            <label>
              Chat Participation:
              <input
                type="number"
                value={settings.points.chat_participation || 1}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, chat_participation: parseInt(e.target.value) }
                })}
              />
            </label>
            <label>
              Correct Answer:
              <input
                type="number"
                value={settings.points.correct_answer}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, correct_answer: parseInt(e.target.value) }
                })}
              />
            </label>
            <label>
              Max Speed Bonus:
              <input
                type="number"
                value={settings.points.speed_bonus_max}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, speed_bonus_max: parseInt(e.target.value) }
                })}
              />
            </label>
            <label>
              Streak Multiplier:
              <input
                type="number"
                step="0.1"
                value={settings.points.streak_multiplier}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, streak_multiplier: parseFloat(e.target.value) }
                })}
              />
            </label>
            <label>
              Hot Seat Correct:
              <input
                type="number"
                value={settings.points.hot_seat_correct}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, hot_seat_correct: parseInt(e.target.value) }
                })}
              />
            </label>
            <label>
              Hot Seat Participation:
              <input
                type="number"
                value={settings.points.hot_seat_participation}
                onChange={(e) => setSettings({
                  ...settings,
                  points: { ...settings.points, hot_seat_participation: parseInt(e.target.value) }
                })}
              />
            </label>
          </div>
          <div className="settings-grid" style={{ marginTop: '15px' }}>
            <label style={{ gridColumn: 'span 2' }}>
              <input
                type="checkbox"
                checked={settings.chat_participation_enabled !== false}
                onChange={(e) => setSettings({
                  ...settings,
                  chat_participation_enabled: e.target.checked
                })}
              />
              Enable Chat Participation Points
            </label>
            <label>
              Chat Cooldown (seconds):
              <input
                type="number"
                value={Math.round((settings.chat_participation_cooldown || 60000) / 1000)}
                onChange={(e) => setSettings({
                  ...settings,
                  chat_participation_cooldown: parseInt(e.target.value) * 1000
                })}
                min="1"
              />
            </label>
          </div>
          <button onClick={handleSettingsUpdate} className="save-settings-btn" disabled={loading}>
            Save Settings
          </button>
        </div>
      )}

      <div className="period-tabs">
        <button
          className={selectedPeriod === 'current_game' ? 'active' : ''}
          onClick={() => setSelectedPeriod('current_game')}
        >
          Current Game
        </button>
        <button
          className={selectedPeriod === 'daily' ? 'active' : ''}
          onClick={() => setSelectedPeriod('daily')}
        >
          Daily
        </button>
        <button
          className={selectedPeriod === 'weekly' ? 'active' : ''}
          onClick={() => setSelectedPeriod('weekly')}
        >
          Weekly
        </button>
        <button
          className={selectedPeriod === 'monthly' ? 'active' : ''}
          onClick={() => setSelectedPeriod('monthly')}
        >
          Monthly
        </button>
        <button
          className={selectedPeriod === 'all_time' ? 'active' : ''}
          onClick={() => setSelectedPeriod('all_time')}
        >
          All Time
        </button>
      </div>

      <div className="leaderboard-content">
        {leaderboardData && renderLeaderboard(leaderboardData[selectedPeriod] as LeaderboardUser[])}
      </div>

      <div className="leaderboard-footer">
        <div className="reset-info">
          {leaderboardData?.last_reset && selectedPeriod !== 'current_game' && selectedPeriod !== 'all_time' && (
            <span>
              Last reset: {formatTimeSince(leaderboardData.last_reset[selectedPeriod as keyof typeof leaderboardData.last_reset])}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            setResetPeriod(selectedPeriod);
            setShowConfirmReset(true);
          }}
          className="reset-btn"
          disabled={loading}
        >
          Reset {selectedPeriod.replace('_', ' ')}
        </button>
      </div>

      {showConfirmReset && (
        <div className="confirm-modal">
          <div className="modal-content">
            <h3>Confirm Reset</h3>
            <p>Are you sure you want to reset the {resetPeriod.replace('_', ' ')} leaderboard?</p>
            {resetPeriod === 'all_time' && (
              <p className="warning">⚠️ This will permanently delete all-time statistics!</p>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowConfirmReset(false)}>Cancel</button>
              <button 
                onClick={() => handleReset(resetPeriod)} 
                className="confirm-btn"
                disabled={loading}
              >
                {loading ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaderboardControl;