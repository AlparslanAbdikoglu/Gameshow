import React, { useState, useEffect, useCallback } from 'react';

interface GiveawayStatus {
  active: boolean;
  closed: boolean;
  prizeName: string;
  prizeAmount: string;
  numWinners: number;
  timeRemaining: number;
  participantCount: number;
  totalWeight: number;
  keyword?: string;
  winners: Array<{
    username: string;
    weight: number;
    entryMethod: string;
    announcement?: string;
  }>;
}

interface GiveawayControlPanelProps {
  className?: string;
}

const GiveawayControlPanel: React.FC<GiveawayControlPanelProps> = ({ className }) => {
  const [giveawayStatus, setGiveawayStatus] = useState<GiveawayStatus>({
    active: false,
    closed: false,
    prizeName: '',
    prizeAmount: '',
    numWinners: 1,
    timeRemaining: 0,
    participantCount: 0,
    totalWeight: 0,
    keyword: '',
    winners: []
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoResetCountdown, setAutoResetCountdown] = useState<number | null>(null);
  const [hotSeatEnabled, setHotSeatEnabled] = useState(false);

  // Form state for starting new giveaway
  const [formData, setFormData] = useState({
    prizeName: '',
    prizeAmount: '',
    numWinners: 1,
    keyword: 'JUICE' // Default keyword
  });

  // WebSocket connection for real-time updates
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const isMountedRef = React.useRef(true);
  const heartbeatIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const autoResetTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const fetchGiveawayStatus = useCallback(async () => {
    try {
      // Fetch game state to get hot seat enabled status
      const gameStateResponse = await fetch('http://localhost:8081/api/state');
      if (gameStateResponse.ok) {
        const gameState = await gameStateResponse.json();
        setHotSeatEnabled(gameState.hot_seat_enabled || false);
      }
      
      const response = await fetch('http://localhost:8081/api/giveaway', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        setGiveawayStatus(result);
        // Only log when status actually changes (not for every timer update)
      } else {
        console.error('Failed to fetch giveaway status:', response.status);
      }
    } catch (error) {
      console.error('Error fetching giveaway status:', error);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    // Check if we already have an open connection or one that's connecting
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket already connected or connecting, skipping...');
      return;
    }

    // Close any existing connection properly
    if (ws) {
      console.log('Closing existing WebSocket connection before creating new one');
      ws.close();
      setWs(null);
    }

    const wsUrl = 'ws://localhost:8081';
    console.log('Creating new WebSocket connection to:', wsUrl);
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('✅ GiveawayControlPanel WebSocket connected');
      setConnectionStatus('connected');
      websocket.send(JSON.stringify({ 
        type: 'register', 
        client: 'giveaway_control_panel' 
      }));
      
      // Start heartbeat to keep connection alive
      heartbeatIntervalRef.current = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000); // Send ping every 30 seconds
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle giveaway-specific events
        if (data.type?.startsWith('giveaway') || 
            ['entryReceived', 'winnersSelected'].includes(data.type)) {
          console.log('📡 Giveaway event received:', data.type);
          
          // Clear winners immediately on reset or start to prevent stale data
          if (data.type === 'giveaway_reset' || data.type === 'giveaway_started') {
            setGiveawayStatus(prev => ({
              ...prev,
              winners: []
            }));
            
            // Clear auto-reset countdown and timer
            if (autoResetTimeoutRef.current) {
              clearInterval(autoResetTimeoutRef.current);
              autoResetTimeoutRef.current = null;
            }
            setAutoResetCountdown(null);
          }
          
          // Use the current fetchGiveawayStatus function reference
          setTimeout(fetchGiveawayStatus, 0);
        }
        
        // Handle timeUpdated separately - update only the timer without fetching full status
        if (data.type === 'timeUpdated' && data.timeRemaining !== undefined) {
          setGiveawayStatus(prev => ({
            ...prev,
            timeRemaining: data.timeRemaining
          }));
        }
        
        // Handle winnersSelected - winners will now stay visible until manual reset
        if (data.type === 'winnersSelected') {
          console.log('🏆 Winners selected - winners will stay visible until manual reset');
          // Clear any existing auto-reset timer (if any)
          if (autoResetTimeoutRef.current) {
            clearInterval(autoResetTimeoutRef.current);
            autoResetTimeoutRef.current = null;
          }
          setAutoResetCountdown(null);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onclose = (event) => {
      console.log('❌ GiveawayControlPanel WebSocket disconnected:', event.code, event.reason);
      setWs(null);
      setConnectionStatus('disconnected');
      
      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      
      // Only reconnect if it wasn't a manual close and component is still mounted
      if (event.code !== 1000 && isMountedRef.current) {
        setConnectionStatus('connecting');
        console.log('🔄 Attempting to reconnect in 5 seconds...');
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connectWebSocket();
          }
        }, 5000);
      }
    };

    websocket.onerror = (event) => {
      console.error('❌ GiveawayControlPanel WebSocket error:', event);
    };

    setWs(websocket);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - we want this function to be stable

  const giveawayAction = async (action: string, data?: any) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:8081/api/giveaway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, ...data })
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log(`✅ Giveaway ${action} successful:`, result);
        fetchGiveawayStatus(); // Refresh status
      } else {
        setError(result.error || `Failed to ${action} giveaway`);
      }
    } catch (error) {
      console.error(`Error with giveaway ${action}:`, error);
      setError(`Failed to ${action} giveaway`);
    } finally {
      setIsLoading(false);
    }
  };

  const startGiveaway = async () => {
    if (!formData.prizeName.trim()) {
      setError('Prize name is required');
      return;
    }
    
    if (!formData.keyword.trim()) {
      setError('Entry keyword is required');
      return;
    }
    
    await giveawayAction('start', {
      prizeName: formData.prizeName.trim(),
      prizeAmount: formData.prizeAmount.trim() || 'TBD',
      numWinners: formData.numWinners,
      keyword: formData.keyword.trim().toUpperCase()
    });
  };

  const stopGiveaway = () => giveawayAction('stop');
  const endEarlyWithWinners = () => giveawayAction('end_early_with_winners');
  const selectWinners = () => giveawayAction('select_winners');
  const resetGiveaway = () => giveawayAction('reset');
  const resetForNewGiveaway = () => giveawayAction('reset', { clearWinners: true });

  const formatTime = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Initialize WebSocket and fetch initial status
  useEffect(() => {
    isMountedRef.current = true;
    
    // Connect WebSocket once
    connectWebSocket();
    
    // Fetch initial status
    fetchGiveawayStatus();
    
    // Set up periodic status refresh (reduced frequency)
    const interval = setInterval(() => {
      // Only fetch if no active WebSocket or if we need periodic refresh
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        fetchGiveawayStatus();
      }
    }, 10000); // Reduced to 10 seconds since WebSocket handles real-time updates
    
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      
      // Clear all timers
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (autoResetTimeoutRef.current) {
        clearInterval(autoResetTimeoutRef.current);
      }
      
      // Clean shutdown
      if (ws?.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Component unmounting');
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - only run once on mount

  const panelStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, rgba(0, 43, 92, 0.85) 0%, rgba(0, 30, 70, 0.9) 100%)',
    backdropFilter: 'blur(25px) saturate(120%)',
    border: '2px solid rgba(255, 215, 0, 0.3)',
    borderRadius: '20px',
    padding: '20px',
    margin: '10px 0',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    color: 'white'
  };

  const buttonStyle = (variant: 'primary' | 'success' | 'danger' | 'warning' = 'primary'): React.CSSProperties => {
    const colors = {
      primary: { bg: 'linear-gradient(135deg, #007bff, #0056b3)', border: '#007bff' },
      success: { bg: 'linear-gradient(135deg, #28a745, #1e7e34)', border: '#28a745' },
      danger: { bg: 'linear-gradient(135deg, #dc3545, #c82333)', border: '#dc3545' },
      warning: { bg: 'linear-gradient(135deg, #ffc107, #e0a800)', border: '#ffc107' }
    };

    return {
      background: colors[variant].bg,
      border: `2px solid ${colors[variant].border}`,
      borderRadius: '8px',
      padding: '8px 16px',
      color: 'white',
      cursor: isLoading ? 'not-allowed' : 'pointer',
      opacity: isLoading ? 0.6 : 1,
      fontWeight: '600',
      fontSize: '14px',
      marginRight: '8px',
      marginBottom: '8px'
    };
  };

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.1)',
    border: '2px solid rgba(255, 215, 0, 0.3)',
    borderRadius: '8px',
    padding: '8px 12px',
    color: 'white',
    fontSize: '14px',
    width: '100%',
    marginBottom: '8px'
  };

  return (
    <div style={panelStyle} className={className}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ color: '#FFD700', margin: 0 }}>
          🎁 Giveaway Control Panel
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: connectionStatus === 'connected' ? '#28a745' : 
                           connectionStatus === 'connecting' ? '#ffc107' : '#dc3545'
          }}></div>
          <span style={{ fontSize: '12px', color: '#ccc' }}>
            {connectionStatus === 'connected' ? 'Connected' : 
             connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(220, 53, 69, 0.2)',
          border: '1px solid rgba(220, 53, 69, 0.5)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          color: '#dc3545'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Current Status */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>Status</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span style={{ 
            width: '12px', 
            height: '12px', 
            borderRadius: '50%', 
            backgroundColor: giveawayStatus.active ? '#28a745' : giveawayStatus.closed ? '#ffc107' : '#6c757d' 
          }}></span>
          <span>
            {giveawayStatus.active ? '🟢 Registration Open' : 
             giveawayStatus.closed ? '🟡 Closed - Ready for Winner Selection' : 
             '⚪ Inactive'}
          </span>
        </div>
        
        {giveawayStatus.active && (
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFD700', textAlign: 'center' }}>
            ⏰ {formatTime(giveawayStatus.timeRemaining)}
          </div>
        )}
        
        {(giveawayStatus.active || giveawayStatus.closed) && giveawayStatus.winners.length === 0 && (
          <>
            <div>🏆 Prize: {giveawayStatus.prizeName} ({giveawayStatus.prizeAmount})</div>
            <div>🎯 Winners: {giveawayStatus.numWinners}</div>
            {giveawayStatus.keyword && (
              <div>🔑 Keyword: <span style={{ color: '#FFD700', fontWeight: 'bold' }}>{giveawayStatus.keyword}</span></div>
            )}
            <div>👥 Participants: {giveawayStatus.participantCount}</div>
            <div>⚖️ Total Weight: {giveawayStatus.totalWeight}</div>
          </>
        )}
      </div>

      {/* Start New Giveaway */}
      {!giveawayStatus.active && !giveawayStatus.closed && (
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>Start New Giveaway</h4>
          
          <input
            type="text"
            placeholder="Prize Name (e.g., $100 Gift Card)"
            value={formData.prizeName}
            onChange={(e) => setFormData({ ...formData, prizeName: e.target.value })}
            style={inputStyle}
          />
          
          <input
            type="text"
            placeholder="Prize Amount (optional)"
            value={formData.prizeAmount}
            onChange={(e) => setFormData({ ...formData, prizeAmount: e.target.value })}
            style={inputStyle}
          />
          
          <input
            type="text"
            placeholder="Entry Keyword (e.g., JUICE)"
            value={formData.keyword}
            onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
            style={inputStyle}
          />
          
          <input
            type="number"
            placeholder="Number of Winners"
            value={formData.numWinners}
            onChange={(e) => setFormData({ ...formData, numWinners: parseInt(e.target.value) || 1 })}
            min="1"
            max="10"
            style={inputStyle}
          />
          
          <button onClick={startGiveaway} style={buttonStyle('success')} disabled={isLoading}>
            🎁 Start Giveaway (2 min)
          </button>
        </div>
      )}

      {/* Active Giveaway Controls */}
      {giveawayStatus.active && (
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>Active Giveaway</h4>
          <button onClick={endEarlyWithWinners} style={buttonStyle('danger')} disabled={isLoading}>
            🛑 End Early & Pick Winners
          </button>
        </div>
      )}

      {/* Winner Selection or Reset if no participants */}
      {giveawayStatus.closed && giveawayStatus.winners.length === 0 && (
        <div style={{ marginBottom: '20px' }}>
          {giveawayStatus.participantCount > 0 ? (
            <>
              <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>Select Winners</h4>
              <button onClick={selectWinners} style={buttonStyle('warning')} disabled={isLoading}>
                🎯 Select {giveawayStatus.numWinners} Winner(s)
              </button>
            </>
          ) : (
            <>
              <h4 style={{ color: '#FF6B6B', marginBottom: '10px' }}>No Participants</h4>
              <div style={{ 
                padding: '12px', 
                background: 'rgba(255, 107, 107, 0.1)', 
                border: '1px solid rgba(255, 107, 107, 0.3)', 
                borderRadius: '8px', 
                marginBottom: '12px',
                textAlign: 'center',
                color: '#FF6B6B'
              }}>
                ❌ No participants entered the giveaway.<br/>
                Nobody typed the keyword: <strong>{giveawayStatus.keyword}</strong>
              </div>
              <button onClick={resetGiveaway} style={buttonStyle('primary')} disabled={isLoading}>
                🔄 Reset Giveaway
              </button>
            </>
          )}
        </div>
      )}

      {/* Winners Display */}
      {giveawayStatus.winners.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ color: '#FFD700', marginBottom: '8px', fontSize: '14px' }}>🏆 Giveaway Winners</h4>
          <div style={{
            maxHeight: '100px',
            overflowY: 'auto',
            background: 'rgba(255, 215, 0, 0.05)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '6px',
            padding: '4px',
            marginBottom: '8px'
          }}>
            {giveawayStatus.winners.map((winner, index) => (
              <div key={index} style={{
                background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(40, 167, 69, 0.1))',
                border: '1px solid rgba(255, 215, 0, 0.5)',
                borderRadius: '4px',
                padding: '4px 6px',
                marginBottom: '3px',
                textAlign: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                lineHeight: '1.2'
              }}>
                🎉 <span style={{ color: '#FFD700' }}>{winner.username}</span> Won! 🎉
              </div>
            ))}
          </div>
          
          {/* Auto-reset countdown removed - winners now stay visible until manual reset */}
          
          <button onClick={resetForNewGiveaway} style={buttonStyle('primary')} disabled={isLoading}>
            🔄 Reset for New Giveaway
          </button>
        </div>
      )}

      {/* Hot Seat Control Section */}
      <div style={{ 
        marginBottom: '20px',
        padding: '15px',
        background: 'linear-gradient(135deg, rgba(255, 69, 0, 0.1), rgba(255, 140, 0, 0.05))',
        borderRadius: '10px',
        border: '1px solid rgba(255, 69, 0, 0.3)'
      }}>
        <h4 style={{ color: '#FF8C00', marginBottom: '15px' }}>🔥 Hot Seat Control</h4>
        
        {/* Hot Seat Enable Toggle */}
        <div style={{ 
          marginBottom: '15px',
          padding: '10px',
          background: hotSeatEnabled ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
          borderRadius: '5px',
          border: `1px solid ${hotSeatEnabled ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'}`
        }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            cursor: 'pointer',
            fontSize: '14px',
            color: hotSeatEnabled ? '#4CAF50' : '#F44336'
          }}>
            <input
              type="checkbox"
              checked={hotSeatEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setHotSeatEnabled(enabled);
                
                try {
                  const response = await fetch('http://localhost:8081/api/control', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      action: 'toggle_hot_seat',
                      enabled: enabled
                    })
                  });
                  
                  if (!response.ok) {
                    console.error('Failed to toggle hot seat');
                    // Revert on failure
                    setHotSeatEnabled(!enabled);
                  }
                } catch (error) {
                  console.error('Error toggling hot seat:', error);
                  // Revert on failure
                  setHotSeatEnabled(!enabled);
                }
              }}
              style={{ marginRight: '10px', transform: 'scale(1.2)' }}
            />
            <span style={{ fontWeight: 'bold' }}>
              Hot Seat Feature: {hotSeatEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </label>
          <div style={{ marginTop: '5px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
            {hotSeatEnabled 
              ? 'Hot seat will activate automatically on questions 5, 10, and 15'
              : 'Game will play normally without hot seat interruptions'}
          </div>
        </div>
        
        {/* Quick Toggle Button */}
        <button
          onClick={async () => {
            const newEnabled = !hotSeatEnabled;
            setHotSeatEnabled(newEnabled);
            
            try {
              const response = await fetch('http://localhost:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  action: 'toggle_hot_seat',
                  enabled: newEnabled
                })
              });
              
              if (!response.ok) {
                console.error('Failed to toggle hot seat');
                setHotSeatEnabled(!newEnabled);
              }
            } catch (error) {
              console.error('Error toggling hot seat:', error);
              setHotSeatEnabled(!newEnabled);
            }
          }}
          style={{
            ...buttonStyle(hotSeatEnabled ? 'danger' : 'success'),
            width: '100%',
            marginBottom: '15px',
            fontWeight: 'bold',
            fontSize: '16px'
          }}
        >
          {hotSeatEnabled ? '🔴 DISABLE Hot Seat' : '🟢 ENABLE Hot Seat'}
        </button>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
            Number of Hot Seat Winners:
          </label>
          <input
            type="number"
            min="1"
            max="10"
            defaultValue="1"
            id="hotSeatWinnerCount"
            style={{
              ...inputStyle,
              marginBottom: '10px'
            }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
            Manual Username Selection (optional):
          </label>
          <input
            type="text"
            placeholder="Username (leave empty for raffle from JOIN entries)"
            id="hotSeatUsername"
            style={{
              ...inputStyle,
              marginBottom: '10px'
            }}
          />
        </div>
        
        <button 
          onClick={async () => {
            if (!hotSeatEnabled) {
              alert('Please enable Hot Seat feature first');
              return;
            }
            try {
              const response = await fetch('http://localhost:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  action: 'start_hot_seat_entry'
                })
              });
              
              if (response.ok) {
                console.log('✅ Hot seat entry period started');
              }
            } catch (error) {
              console.error('Error starting hot seat entry:', error);
            }
          }}
          disabled={!hotSeatEnabled}
          style={{
            ...buttonStyle('primary'),
            width: '100%',
            marginBottom: '10px',
            opacity: hotSeatEnabled ? 1 : 0.5,
            cursor: hotSeatEnabled ? 'pointer' : 'not-allowed'
          }}
        >
          📝 Start Hot Seat Entry (Type JOIN)
        </button>
        
        <button 
          onClick={async () => {
            if (!hotSeatEnabled) {
              alert('Please enable Hot Seat feature first');
              return;
            }
            const usernameInput = document.getElementById('hotSeatUsername') as HTMLInputElement;
            const winnerCountInput = document.getElementById('hotSeatWinnerCount') as HTMLInputElement;
            const username = usernameInput?.value?.trim() || null;
            const winnerCount = parseInt(winnerCountInput?.value || '1');
            
            try {
              const response = await fetch('http://localhost:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  action: 'activate_hot_seat',
                  username: username,
                  winner_count: winnerCount
                })
              });
              
              if (response.ok) {
                console.log('✅ Hot seat activated');
                if (usernameInput) usernameInput.value = '';
              }
            } catch (error) {
              console.error('Error activating hot seat:', error);
            }
          }}
          disabled={!hotSeatEnabled}
          style={{
            ...buttonStyle('warning'),
            width: '100%',
            marginBottom: '10px',
            opacity: hotSeatEnabled ? 1 : 0.5,
            cursor: hotSeatEnabled ? 'pointer' : 'not-allowed'
          }}
        >
          🔥 Draw Hot Seat Winners & Activate
        </button>
        
        <button 
          onClick={async () => {
            if (!hotSeatEnabled) {
              alert('Please enable Hot Seat feature first');
              return;
            }
            try {
              const response = await fetch('http://localhost:8081/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'end_hot_seat' })
              });
              
              if (response.ok) {
                console.log('✅ Hot seat ended');
              }
            } catch (error) {
              console.error('Error ending hot seat:', error);
            }
          }}
          disabled={!hotSeatEnabled}
          style={{
            ...buttonStyle('danger'),
            width: '100%',
            opacity: hotSeatEnabled ? 1 : 0.5,
            cursor: hotSeatEnabled ? 'pointer' : 'not-allowed'
          }}
        >
          🔚 End Hot Seat
        </button>
        
        <div style={{ 
          fontSize: '12px', 
          color: 'rgba(255, 255, 255, 0.6)', 
          marginTop: '10px',
          fontStyle: 'italic'
        }}>
          💡 Hot seat automatically activates on questions 5, 10, and 15. Use manual control to activate at any time.
        </div>
      </div>

      {/* Instructions */}
      <div style={{ 
        fontSize: '12px', 
        color: 'rgba(255, 255, 255, 0.7)', 
        borderTop: '1px solid rgba(255, 215, 0, 0.2)', 
        paddingTop: '10px' 
      }}>
        <strong>How it works:</strong><br />
        {giveawayStatus.active && giveawayStatus.keyword && (
          <>
            <div style={{ 
              fontSize: '16px', 
              fontWeight: 'bold', 
              color: '#FFD700', 
              background: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
              padding: '8px',
              margin: '8px 0',
              textAlign: 'center'
            }}>
              💬 Type "{giveawayStatus.keyword}" in chat to enter
            </div>
          </>
        )}
        • Users who voted during the show get 3× chance to win<br />
        • 2-minute registration window<br />
        • Weighted random selection<br />
        • Winners selected from live chat participants
      </div>
    </div>
  );
};

export default GiveawayControlPanel;