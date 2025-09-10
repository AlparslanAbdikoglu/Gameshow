import React, { useState, useEffect, useCallback } from 'react';

interface GiveawayEvent {
  type: string;
  prizeName?: string;
  prizeAmount?: string;
  numWinners?: number;
  duration?: number;
  keyword?: string;
  timeRemaining?: number;
  entry?: {
    username: string;
    weight: number;
    entryMethod: string;
    keyword?: string;
  };
  stats?: {
    participantCount: number;
    voterCount: number;
    totalWeight: number;
  };
  participantCount?: number;
  totalWeight?: number;
  winners?: Array<{
    username: string;
    weight: number;
    entryMethod: string;
    keyword?: string;
  }>;
  timestamp: number;
}

interface RecentEntry {
  username: string;
  weight: number;
  entryMethod: string;
  keyword?: string;
  timestamp: number;
}

const GiveawayOverlay: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [giveawayData, setGiveawayData] = useState({
    prizeName: '',
    prizeAmount: '',
    numWinners: 1,
    keyword: 'JUICE',
    timeRemaining: 0,
    participantCount: 0,
    totalWeight: 0
  });
  const [winners, setWinners] = useState<Array<{
    username: string;
    weight: number;
    entryMethod: string;
    keyword?: string;
  }>>([]);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [showWinners, setShowWinners] = useState(false);
  const [confetti, setConfetti] = useState(false);

  const connectWebSocket = useCallback(() => {
    const wsUrl = 'ws://localhost:8081';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ GiveawayOverlay WebSocket connected');
      ws.send(JSON.stringify({ 
        type: 'register', 
        client: 'giveaway_overlay' 
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data: GiveawayEvent = JSON.parse(event.data);
        
        switch (data.type) {
          case 'giveaway_started':
            console.log('🎁 Giveaway started:', data);
            setGiveawayData({
              prizeName: data.prizeName || '',
              prizeAmount: data.prizeAmount || '',
              numWinners: data.numWinners || 1,
              keyword: data.keyword || 'JUICE',
              timeRemaining: data.duration || 120000,
              participantCount: 0,
              totalWeight: 0
            });
            setIsVisible(true);
            setShowWinners(false);
            setWinners([]);
            setRecentEntries([]);
            break;

          case 'giveaway_time_update':
            setGiveawayData(prev => ({
              ...prev,
              timeRemaining: data.timeRemaining || 0
            }));
            break;

          case 'giveaway_entry':
            console.log('➕ New entry:', data);
            // Handle the new structure from server
            if (data.entry && data.entry.username && data.entry.weight && data.entry.entryMethod) {
              const newEntry: RecentEntry = {
                username: data.entry.username,
                weight: data.entry.weight,
                entryMethod: data.entry.entryMethod,
                keyword: data.entry.keyword,
                timestamp: Date.now()
              };
              
              setRecentEntries(prev => [newEntry, ...prev.slice(0, 9)]); // Keep last 10
              setGiveawayData(prev => ({
                ...prev,
                participantCount: data.stats?.participantCount || prev.participantCount,
                totalWeight: data.stats?.totalWeight || prev.totalWeight
              }));
            }
            break;

          case 'giveaway_closed':
            console.log('🛑 Giveaway closed:', data);
            setGiveawayData(prev => ({
              ...prev,
              timeRemaining: 0,
              participantCount: data.participantCount || prev.participantCount,
              totalWeight: data.totalWeight || prev.totalWeight
            }));
            break;

          case 'giveaway_winners':
            console.log('🏆 Winners selected:', data);
            if (data.winners) {
              setWinners(data.winners);
              setShowWinners(true);
              setConfetti(true);
              // Stop confetti after 3 seconds
              setTimeout(() => setConfetti(false), 3000);
              // Winners overlay will now stay visible until manually dismissed or new giveaway starts
            }
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('❌ GiveawayOverlay WebSocket disconnected');
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (event) => {
      console.error('❌ GiveawayOverlay WebSocket error event occurred');
    };

    return ws;
  }, []);

  useEffect(() => {
    const ws = connectWebSocket();
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [connectWebSocket]);

  const formatTime = (milliseconds: number): string => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getEntryMethodDisplay = (method: string, keyword?: string): string => {
    switch (method) {
      case 'chat_keyword': 
        return keyword ? `User typed "${keyword}" in chat` : '💬 Chat';
      case 'poll_voter': 
        return '🗳️ Voter';
      case 'voted_and_keyword':
        return keyword ? `Voter typed "${keyword}" in chat (3x bonus!)` : '🗳️ Voter + Chat';
      default: 
        return '❓ Unknown';
    }
  };

  if (!isVisible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 9999,
      animation: 'fadeIn 0.5s ease-in',
      maxWidth: '90vw',
      maxHeight: '90vh'
    }}>
      {/* Confetti Effect */}
      {confetti && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 10000,
          animation: 'confettiFall 3s ease-out'
        }}>
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: '10px',
                height: '10px',
                backgroundColor: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'][i % 5],
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                animation: 'confettiPiece 3s linear'
              }}
            />
          ))}
        </div>
      )}

      {/* Main Giveaway Panel */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0, 43, 92, 0.95) 0%, rgba(0, 30, 70, 0.98) 100%)',
        backdropFilter: 'blur(25px) saturate(120%)',
        border: '3px solid #FFD700',
        borderRadius: '25px',
        padding: '30px',
        boxShadow: '0 0 50px rgba(255, 215, 0, 0.5)',
        color: 'white',
        textAlign: 'center',
        minWidth: '600px',
        maxWidth: '800px'
      }}>
        {/* Winners Display */}
        {showWinners ? (
          <div>
            <h1 style={{ color: '#FFD700', marginBottom: '20px', fontSize: '2.5em' }}>
              🏆 WINNERS! 🏆
            </h1>
            <h2 style={{ color: 'white', marginBottom: '30px' }}>
              {giveawayData.prizeName} ({giveawayData.prizeAmount})
            </h2>
            
            {winners.map((winner, index) => (
              <div key={index} style={{
                background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 193, 7, 0.3))',
                border: '2px solid #FFD700',
                borderRadius: '15px',
                padding: '20px',
                margin: '10px 0',
                fontSize: '1.5em',
                animation: `winnerPulse 2s infinite ${index * 0.2}s`
              }}>
                <div style={{ fontSize: '1.8em', fontWeight: 'bold' }}>
                  {winner.username}
                </div>
                <div style={{ fontSize: '0.8em', color: '#FFD700' }}>
                  {getEntryMethodDisplay(winner.entryMethod, winner.keyword)} ({winner.weight}×)
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Active Giveaway Display */
          <div>
            <h1 style={{ color: '#FFD700', marginBottom: '10px', fontSize: '2.2em' }}>
              🎁 GIVEAWAY! 🎁
            </h1>
            
            <h2 style={{ color: 'white', marginBottom: '20px', fontSize: '1.5em' }}>
              {giveawayData.prizeName} ({giveawayData.prizeAmount})
            </h2>

            {/* Timer */}
            <div style={{
              fontSize: '3em',
              fontWeight: 'bold',
              color: giveawayData.timeRemaining < 30000 ? '#FF6B6B' : '#FFD700',
              marginBottom: '20px',
              textShadow: '0 0 20px currentColor',
              animation: giveawayData.timeRemaining < 30000 ? 'urgentPulse 1s infinite' : 'none'
            }}>
              {formatTime(giveawayData.timeRemaining)}
            </div>

            {/* Instructions */}
            <div style={{
              background: 'rgba(255, 215, 0, 0.1)',
              border: '2px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '15px',
              padding: '20px',
              marginBottom: '20px'
            }}>
              <h3 style={{ color: '#FFD700', marginBottom: '15px' }}>
                How to Enter:
              </h3>
              <div style={{ fontSize: '1.2em', lineHeight: '1.6' }}>
                <div>💬 Type <strong>{giveawayData.keyword}</strong> in chat (1× entry)</div>
                <div>🗳️ Vote in any poll (3× entry weight!)</div>
              </div>
            </div>

            {/* Stats */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-around',
              marginBottom: '20px',
              fontSize: '1.1em'
            }}>
              <div>
                <div style={{ color: '#FFD700', fontWeight: 'bold' }}>Winners</div>
                <div>{giveawayData.numWinners}</div>
              </div>
              <div>
                <div style={{ color: '#FFD700', fontWeight: 'bold' }}>Participants</div>
                <div>{giveawayData.participantCount}</div>
              </div>
              <div>
                <div style={{ color: '#FFD700', fontWeight: 'bold' }}>Total Entries</div>
                <div>{giveawayData.totalWeight}</div>
              </div>
            </div>

            {/* Recent Entries Feed */}
            {recentEntries.length > 0 && (
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '10px',
                padding: '15px',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                <h4 style={{ color: '#FFD700', marginBottom: '10px' }}>
                  Recent Entries:
                </h4>
                {recentEntries.slice(0, 5).map((entry, index) => (
                  <div
                    key={`${entry.username}-${entry.timestamp}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '5px',
                      opacity: 1 - (index * 0.15),
                      animation: index === 0 ? 'slideIn 0.3s ease-out' : 'none'
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>{entry.username}</span>
                    <span style={{ 
                      color: entry.weight === 3 ? '#4ECDC4' : '#FFD700',
                      fontSize: '0.9em'
                    }}>
                      {getEntryMethodDisplay(entry.entryMethod, entry.keyword)} ({entry.weight}×)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }

        @keyframes winnerPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 20px rgba(255, 215, 0, 0.5); }
          50% { transform: scale(1.05); box-shadow: 0 0 30px rgba(255, 215, 0, 0.8); }
        }

        @keyframes urgentPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes slideIn {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        @keyframes confettiFall {
          to { transform: translateY(100vh) rotate(360deg); }
        }

        @keyframes confettiPiece {
          0% { transform: translateY(-10px) rotate(0deg); }
          100% { transform: translateY(100vh) rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default GiveawayOverlay;