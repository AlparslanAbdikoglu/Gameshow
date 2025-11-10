import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

interface PreviousWinner {
  game_id: string;
  date: string;
  username: string;
  final_points: number;
  correct_answers: number;
  total_answers: number;
  accuracy: number;
  best_streak: number;
  fastest_correct_time: number | null;
  hot_seat_appearances: number;
  hot_seat_correct: number;
  questions_completed: number;
  total_points_all_games?: number;
  total_votes?: number;
}

interface PreviousWinnersData {
  winners: PreviousWinner[];
  metadata: {
    total_games: number;
    last_updated: string | null;
    note?: string;
  };
}

interface AggregatedPreviousWinner {
  username: string;
  wins: number;
  totalPoints: number;
  totalCorrect: number;
  totalVotes: number;
  bestStreak: number;
  hotSeatAppearances: number;
  hotSeatCorrect: number;
  lastWinDate: Date | null;
}

const safeNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type InternalAggregatedWinner = AggregatedPreviousWinner & {
  sumPoints: number;
  allTimePoints: number;
  allTimeCorrect: number;
  allTimeVotes: number;
  allTimeBestStreak: number;
  allTimeHotSeatAppearances: number;
  allTimeHotSeatCorrect: number;
};

export const aggregatePreviousWinners = (winners: PreviousWinner[]): AggregatedPreviousWinner[] => {
  if (!Array.isArray(winners)) {
    return [];
  }

  const aggregated = new Map<string, InternalAggregatedWinner>();

  winners.forEach((winner) => {
    if (!winner || !winner.username) {
      return;
    }

    const username = winner.username.trim();
    if (!username) {
      return;
    }

    const lookupKey = username.toLowerCase();
    if (!aggregated.has(lookupKey)) {
      aggregated.set(lookupKey, {
        username,
        wins: 0,
        totalPoints: 0,
        totalCorrect: 0,
        totalVotes: 0,
        bestStreak: 0,
        hotSeatAppearances: 0,
        hotSeatCorrect: 0,
        lastWinDate: null,
        sumPoints: 0,
        allTimePoints: 0,
        allTimeCorrect: 0,
        allTimeVotes: 0,
        allTimeBestStreak: 0,
        allTimeHotSeatAppearances: 0,
        allTimeHotSeatCorrect: 0
      });
    }

    const record = aggregated.get(lookupKey)!;

    if (!record.username) {
      record.username = username;
    }

    record.wins += 1;
    record.sumPoints += safeNumber((winner as { final_points?: number }).final_points ?? (winner as { total_points?: number }).total_points ?? 0);
    record.totalCorrect += safeNumber(winner.correct_answers);

    const votesSource = (winner as { total_votes?: number; votes?: number }).total_votes
      ?? (winner as { votes?: number }).votes
      ?? winner.total_answers;
    record.totalVotes += safeNumber(votesSource);

    record.bestStreak = Math.max(record.bestStreak, safeNumber(winner.best_streak));
    record.hotSeatAppearances += safeNumber(winner.hot_seat_appearances);
    record.hotSeatCorrect += safeNumber(winner.hot_seat_correct);

    const allTimePointsCandidate = safeNumber(
      (winner as { total_points_all_games?: number }).total_points_all_games
        ?? (winner as { all_time_points?: number }).all_time_points
        ?? (winner as { points_all_time?: number }).points_all_time
    );
    if (allTimePointsCandidate > record.allTimePoints) {
      record.allTimePoints = allTimePointsCandidate;
    }

    const allTimeCorrectCandidate = safeNumber(
      (winner as { total_correct_all_games?: number }).total_correct_all_games
        ?? (winner as { correct_all_time?: number }).correct_all_time
        ?? (winner as { correct_votes_all_time?: number }).correct_votes_all_time
    );
    if (allTimeCorrectCandidate > record.allTimeCorrect) {
      record.allTimeCorrect = allTimeCorrectCandidate;
    }

    const allTimeVotesCandidate = safeNumber(
      (winner as { total_votes_all_games?: number }).total_votes_all_games
        ?? (winner as { votes_all_time?: number }).votes_all_time
    );
    if (allTimeVotesCandidate > record.allTimeVotes) {
      record.allTimeVotes = allTimeVotesCandidate;
    }

    const allTimeBestStreakCandidate = safeNumber(
      (winner as { best_streak_all_time?: number }).best_streak_all_time
        ?? (winner as { all_time_best_streak?: number }).all_time_best_streak
    );
    if (allTimeBestStreakCandidate > record.allTimeBestStreak) {
      record.allTimeBestStreak = allTimeBestStreakCandidate;
    }

    const allTimeHotSeatCandidate = safeNumber((winner as { hot_seat_appearances_all_time?: number }).hot_seat_appearances_all_time);
    if (allTimeHotSeatCandidate > record.allTimeHotSeatAppearances) {
      record.allTimeHotSeatAppearances = allTimeHotSeatCandidate;
    }

    const allTimeHotSeatCorrectCandidate = safeNumber((winner as { hot_seat_correct_all_time?: number }).hot_seat_correct_all_time);
    if (allTimeHotSeatCorrectCandidate > record.allTimeHotSeatCorrect) {
      record.allTimeHotSeatCorrect = allTimeHotSeatCorrectCandidate;
    }

    if (winner.date) {
      const winDate = new Date(winner.date);
      if (!Number.isNaN(winDate.getTime())) {
        if (!record.lastWinDate || winDate > record.lastWinDate) {
          record.lastWinDate = winDate;
        }
      }
    }
  });

  return Array.from(aggregated.values()).map((record) => {
    const totalPoints = record.allTimePoints > 0 ? record.allTimePoints : record.sumPoints;
    const totalCorrect = record.allTimeCorrect > 0 ? record.allTimeCorrect : record.totalCorrect;
    const totalVotes = record.allTimeVotes > 0 ? record.allTimeVotes : record.totalVotes;
    const bestStreak = record.allTimeBestStreak > 0 ? record.allTimeBestStreak : record.bestStreak;
    const hotSeatAppearances =
      record.allTimeHotSeatAppearances > 0 ? record.allTimeHotSeatAppearances : record.hotSeatAppearances;
    const hotSeatCorrect =
      record.allTimeHotSeatCorrect > 0 ? record.allTimeHotSeatCorrect : record.hotSeatCorrect;

    return {
      username: record.username,
      wins: record.wins,
      totalPoints,
      totalCorrect,
      totalVotes,
      bestStreak,
      hotSeatAppearances,
      hotSeatCorrect,
      lastWinDate: record.lastWinDate
    };
  });
};

export const mergeAggregatedPreviousWinnersWithAllTime = (
  winners: AggregatedPreviousWinner[],
  allTimeUsers?: LeaderboardUser[]
): AggregatedPreviousWinner[] => {
  if (!Array.isArray(winners) || winners.length === 0 || !allTimeUsers || allTimeUsers.length === 0) {
    return winners;
  }

  const lookup = new Map<string, LeaderboardUser>();
  allTimeUsers.forEach((user) => {
    if (user && user.username) {
      lookup.set(user.username.trim().toLowerCase(), user);
    }
  });

  return winners.map((winner) => {
    const match = lookup.get(winner.username.trim().toLowerCase());
    if (!match) {
      return winner;
    }

    const enriched = { ...winner };

    const points = safeNumber((match as { points?: number }).points ?? (match as { total_points?: number }).total_points);
    if (points > 0) {
      enriched.totalPoints = points;
    }

    const correct = safeNumber(
      (match as { correct_answers?: number }).correct_answers
        ?? (match as { correct_votes?: number }).correct_votes
        ?? (match as { correct?: number }).correct
    );
    if (correct > 0) {
      enriched.totalCorrect = correct;
    }

    const votes = safeNumber((match as { total_votes?: number }).total_votes ?? (match as { votes?: number }).votes);
    if (votes > 0) {
      enriched.totalVotes = votes;
    }

    const streak = safeNumber(
      (match as { best_streak?: number }).best_streak
        ?? (match as { bestStreak?: number }).bestStreak
        ?? (match as { current_streak?: number }).current_streak
    );
    if (streak > enriched.bestStreak) {
      enriched.bestStreak = streak;
    }

    const hotSeatAppearances = safeNumber((match as { hot_seat_appearances?: number }).hot_seat_appearances);
    if (hotSeatAppearances > enriched.hotSeatAppearances) {
      enriched.hotSeatAppearances = hotSeatAppearances;
    }

    const hotSeatCorrect = safeNumber((match as { hot_seat_correct?: number }).hot_seat_correct);
    if (hotSeatCorrect > enriched.hotSeatCorrect) {
      enriched.hotSeatCorrect = hotSeatCorrect;
    }

    return enriched;
  });
};

export const sortAggregatedPreviousWinners = (winners: AggregatedPreviousWinner[]): AggregatedPreviousWinner[] => {
  if (!Array.isArray(winners)) {
    return [];
  }

  return [...winners].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }

    if (b.totalCorrect !== a.totalCorrect) {
      return b.totalCorrect - a.totalCorrect;
    }

    const aTime = a.lastWinDate?.getTime() ?? 0;
    const bTime = b.lastWinDate?.getTime() ?? 0;
    return bTime - aTime;
  });
};

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
  const [selectedPeriod, setSelectedPeriod] = useState<keyof LeaderboardData | 'previous_winners'>('current_game');
  const [settings, setSettings] = useState<LeaderboardSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [resetPeriod, setResetPeriod] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [previousWinners, setPreviousWinners] = useState<PreviousWinnersData | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string>('');

  const aggregatedPreviousWinners = useMemo(() => {
    const aggregated = aggregatePreviousWinners(previousWinners?.winners || []);
    const withAllTime = mergeAggregatedPreviousWinnersWithAllTime(aggregated, leaderboardData?.all_time);
    return sortAggregatedPreviousWinners(withAllTime);
  }, [previousWinners, leaderboardData]);

  const previousWinnersSummary = useMemo(() => {
    if (!previousWinners) {
      return {
        totalGames: 0,
        lastUpdated: null as Date | null,
        note: '',
        uniqueGames: 0
      };
    }

    const winners = previousWinners.winners || [];
    const uniqueGames = winners.reduce((set, winner) => {
      if (winner.game_id) {
        set.add(winner.game_id);
      } else if (winner.username || winner.date) {
        set.add(`${winner.username}-${winner.date}`);
      }
      return set;
    }, new Set<string>());

    const totalGames = previousWinners.metadata?.total_games ?? uniqueGames.size;
    const lastUpdated = previousWinners.metadata?.last_updated
      ? new Date(previousWinners.metadata.last_updated)
      : null;

    return {
      totalGames,
      lastUpdated,
      note: previousWinners.metadata?.note || '',
      uniqueGames: uniqueGames.size
    };
  }, [previousWinners]);

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

  // Fetch previous winners
  const fetchPreviousWinners = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/previous-winners');
      const data = await response.json();
      setPreviousWinners(data);
    } catch (error) {
      console.error('Error fetching previous winners:', error);
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
    fetchPreviousWinners();
  }, [fetchLeaderboard, fetchSettings, fetchPreviousWinners]);

  useEffect(() => {
    if (selectedPeriod === 'previous_winners') {
      fetchPreviousWinners();
    }
  }, [selectedPeriod, fetchPreviousWinners]);

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

  // Archive winner
  const handleArchiveWinner = async () => {
    if (!selectedUsername) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/previous-winners/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: selectedUsername })
      });
      
      if (response.ok) {
        const data = await response.json();
        setPreviousWinners(data.winnersData);
        setShowArchiveModal(false);
        setSelectedUsername('');
        alert(`✅ ${selectedUsername} archived as winner!`);
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error archiving winner:', error);
      alert('❌ Failed to archive winner');
    }
    setLoading(false);
  };

  // Auto-archive top winner
  const handleAutoArchive = async () => {
    if (!window.confirm('Archive the top player from current game?')) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/previous-winners/auto-archive', {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        setPreviousWinners(data.winnersData);
        alert(`✅ ${data.winner.username} archived as winner!`);
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error auto-archiving winner:', error);
      alert('❌ Failed to auto-archive winner');
    }
    setLoading(false);
  };

  // Remove previous winner
  const handleRemoveWinner = async (gameId: string) => {
    if (!window.confirm('Remove this winner entry?')) return;

    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8081/api/leaderboard/previous-winners/${gameId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const data = await response.json();
        setPreviousWinners(data.winnersData);
      }
    } catch (error) {
      console.error('Error removing winner:', error);
    }
    setLoading(false);
  };

  const handleRemoveLatestWinner = (username: string) => {
    if (!previousWinners || !previousWinners.winners.length) {
      return;
    }

    const latestEntry = [...previousWinners.winners]
      .filter((winner) => winner.username === username)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    if (latestEntry) {
      handleRemoveWinner(latestEntry.game_id);
    } else {
      alert('❌ No recorded entry found for this winner.');
    }
  };

  // Export previous winners
  const handleExportWinners = async () => {
    try {
      const response = await fetch('http://localhost:8081/api/leaderboard/previous-winners/export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `previous-winners-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting previous winners:', error);
    }
  };

  // Import previous winners
  const handleImportWinners = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importData = JSON.parse(e.target?.result as string);
        
        const response = await fetch('http://localhost:8081/api/leaderboard/previous-winners/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(importData)
        });
        
        if (response.ok) {
          const data = await response.json();
          setPreviousWinners(data.winnersData);
          alert('✅ Previous winners imported successfully!');
        }
      } catch (error) {
        console.error('Error importing previous winners:', error);
        alert('❌ Failed to import previous winners');
      }
    };
    reader.readAsText(file);
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

  const renderPreviousWinners = () => {
    if (!previousWinners || aggregatedPreviousWinners.length === 0) {
      return (
        <div className="empty-leaderboard">
          <p>No previous winners yet</p>
          <button onClick={handleAutoArchive} disabled={loading} className="archive-btn">
            🏆 Archive Top Player
          </button>
        </div>
      );
    }

    const hallOfFame = aggregatedPreviousWinners[0];
    const totalGamesDisplay =
      previousWinnersSummary.totalGames ?? previousWinnersSummary.uniqueGames ?? 0;

    return (
      <div>
        <div className="winners-header">
          <div className="winners-stats">
            <span>
              🎮 Total Games: {Number.isFinite(totalGamesDisplay) ? totalGamesDisplay.toLocaleString() : totalGamesDisplay}
            </span>
            {previousWinnersSummary.lastUpdated && (
              <span>
                📅 Last Updated: {previousWinnersSummary.lastUpdated.toLocaleString()}
              </span>
            )}
            {hallOfFame && (
              <span className="hall-of-fame">
                🏆 Hall of Fame: {hallOfFame.username} ({hallOfFame.totalPoints.toLocaleString()} pts)
              </span>
            )}
          </div>
          <div className="winners-actions">
            <button onClick={handleAutoArchive} disabled={loading} className="archive-btn">
              🏆 Archive Top Player
            </button>
            <button onClick={() => setShowArchiveModal(true)} disabled={loading} className="archive-btn">
              ➕ Archive Custom Player
            </button>
            <button onClick={handleExportWinners} className="export-btn">
              📥 Export
            </button>
            <label className="import-btn">
              📤 Import
              <input type="file" accept=".json" onChange={handleImportWinners} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
        {previousWinnersSummary.note && (
          <p className="winners-note">{previousWinnersSummary.note}</p>
        )}
        <table className="leaderboard-table previous-winners-table">
          <thead>
            <tr>
              <th className="rank">Rank</th>
              <th className="username">Winner</th>
              <th className="wins">Wins</th>
              <th className="points">Points</th>
              <th className="correct">Correct</th>
              <th className="votes">Votes</th>
              <th className="streak">Best Streak</th>
              <th className="hot-seat">Hot Seat</th>
              <th className="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {aggregatedPreviousWinners.map((winner, index) => (
              <tr
                key={winner.username}
                className={index < 3 ? `rank-${index + 1}` : ''}
                title={winner.lastWinDate ? `Last win: ${winner.lastWinDate.toLocaleString()}` : undefined}
              >
                <td className="rank">
                  {index === 0 && '🥇'}
                  {index === 1 && '🥈'}
                  {index === 2 && '🥉'}
                  {index > 2 && index + 1}
                </td>
                <td className="username">
                  {index === 0 && '👑 '}
                  {winner.username}
                  {winner.wins > 1 && <span className="wins-badge">{winner.wins}×</span>}
                  {winner.hotSeatAppearances > 0 && (
                    <span className="hot-seat-icon" title={`${winner.hotSeatAppearances} hot seat appearance${winner.hotSeatAppearances === 1 ? '' : 's'}`}>
                      🔥
                    </span>
                  )}
                </td>
                <td className="wins">{winner.wins}</td>
                <td className="points">{winner.totalPoints.toLocaleString()}</td>
                <td className="correct">{winner.totalCorrect.toLocaleString()}</td>
                <td className="votes">{winner.totalVotes.toLocaleString()}</td>
                <td className="streak">{winner.bestStreak.toLocaleString()}</td>
                <td className="hot-seat">
                  {winner.hotSeatAppearances}
                  {winner.hotSeatCorrect > 0 ? ` (${winner.hotSeatCorrect} ✓)` : ''}
                </td>
                <td>
                  <button
                    onClick={() => handleRemoveLatestWinner(winner.username)}
                    className="remove-btn"
                    disabled={loading}
                    title="Remove most recent win entry"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'broadcast',
        message: {
          type: selectedPeriod === 'previous_winners'
            ? 'show_previous_winners'
            : 'show_leaderboard',
          period: selectedPeriod
        }
      }));
      console.log('📺 Show in browser source:', selectedPeriod);
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
          <button
            onClick={() => {
              fetchLeaderboard();
              fetchPreviousWinners();
            }}
            className="refresh-btn"
          >
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
        <button
          className={selectedPeriod === 'previous_winners' ? 'active' : ''}
          onClick={() => setSelectedPeriod('previous_winners')}
        >
          🏆 Previous Winners
        </button>
      </div>

      <div className="leaderboard-content">
        {selectedPeriod === 'previous_winners'
          ? renderPreviousWinners()
          : leaderboardData
            ? renderLeaderboard(leaderboardData[selectedPeriod] as LeaderboardUser[])
            : <div className="empty-leaderboard">Loading leaderboard…</div>}
      </div>

      {selectedPeriod !== 'previous_winners' && (
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
      )}

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

      {showArchiveModal && (
        <div className="confirm-modal">
          <div className="modal-content">
            <h3>🏆 Archive Winner</h3>
            <p>Enter the username to archive as winner:</p>
            <input
              type="text"
              value={selectedUsername}
              onChange={(e) => setSelectedUsername(e.target.value)}
              placeholder="Username"
              className="username-input"
              autoFocus
            />
            <div className="modal-actions">
              <button onClick={() => {
                setShowArchiveModal(false);
                setSelectedUsername('');
              }}>Cancel</button>
              <button 
                onClick={handleArchiveWinner} 
                className="confirm-btn"
                disabled={loading || !selectedUsername}
              >
                {loading ? 'Archiving...' : 'Archive Winner'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaderboardControl;
