import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import LeaderboardControl, {
  aggregatePreviousWinners,
  mergeAggregatedPreviousWinnersWithAllTime,
  sortAggregatedPreviousWinners
} from '../LeaderboardControl';

const originalFetch = global.fetch;
const originalWebSocket = global.WebSocket;
const originalAlert = window.alert;

describe('LeaderboardControl - Previous Winners integration', () => {
  const mockLeaderboardResponse = {
    current_game: [
      {
        username: 'PlayerOne',
        points: 150,
        correct_answers: 10,
        total_votes: 12,
        current_streak: 2,
        hot_seat_appearances: 0
      }
    ],
    daily: [],
    weekly: [],
    monthly: [],
    all_time: [
      {
        username: 'ChampionA',
        points: 1331,
        correct_answers: 105,
        total_votes: 129,
        best_streak: 12,
        hot_seat_appearances: 0,
        hot_seat_correct: 0
      },
      {
        username: 'ContenderB',
        points: 1101,
        correct_answers: 81,
        total_votes: 95,
        best_streak: 15,
        hot_seat_appearances: 0,
        hot_seat_correct: 0
      }
    ],
    last_reset: {
      daily: Date.now(),
      weekly: Date.now(),
      monthly: Date.now()
    }
  };

  const mockSettingsResponse = {
    points: {
      participation: 1,
      correct_answer: 5,
      chat_participation: 1,
      speed_bonus_max: 5,
      streak_multiplier: 1.2,
      hot_seat_correct: 10,
      hot_seat_participation: 3
    },
    chat_participation_enabled: true,
    chat_participation_cooldown: 60000
  };

  const mockPreviousWinnersResponse = {
    winners: [
      {
        game_id: 'game-1',
        date: '2025-10-20T00:00:00.000Z',
        username: 'ChampionA',
        final_points: 200,
        correct_answers: 12,
        total_answers: 15,
        accuracy: 80,
        best_streak: 6,
        fastest_correct_time: null,
        hot_seat_appearances: 1,
        hot_seat_correct: 1,
        questions_completed: 15
      },
      {
        game_id: 'game-2',
        date: '2025-10-27T00:00:00.000Z',
        username: 'ChampionA',
        final_points: 150,
        correct_answers: 10,
        total_answers: 12,
        accuracy: 83,
        best_streak: 5,
        fastest_correct_time: null,
        hot_seat_appearances: 0,
        hot_seat_correct: 0,
        questions_completed: 15
      },
      {
        game_id: 'game-3',
        date: '2025-10-29T00:00:00.000Z',
        username: 'ContenderB',
        final_points: 175,
        correct_answers: 11,
        total_answers: 15,
        accuracy: 73,
        best_streak: 4,
        fastest_correct_time: null,
        hot_seat_appearances: 1,
        hot_seat_correct: 0,
        questions_completed: 15
      }
    ],
    metadata: {
      total_games: 3,
      last_updated: '2025-11-09T00:00:00.000Z',
      note: 'Historical champions shown for producer reference.'
    }
  };

  beforeEach(() => {
    const mockFetch = jest.fn((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.endsWith('/api/leaderboard')) {
        return Promise.resolve({ ok: true, json: async () => mockLeaderboardResponse } as any);
      }

      if (url.endsWith('/api/leaderboard/settings')) {
        return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as any);
      }

      if (url.includes('/api/leaderboard/previous-winners')) {
        return Promise.resolve({ ok: true, json: async () => mockPreviousWinnersResponse } as any);
      }

      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });

    global.fetch = mockFetch as unknown as typeof global.fetch;

    global.WebSocket = jest.fn().mockImplementation(() => ({
      onopen: jest.fn(),
      onmessage: jest.fn(),
      onerror: jest.fn(),
      close: jest.fn(),
      readyState: 0,
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    })) as any;

    window.alert = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket as any;
    window.alert = originalAlert;
  });

  test('aggregates previous winners without affecting current leaderboard', async () => {
    render(<LeaderboardControl />);

    await waitFor(() => {
      expect(screen.getByText('PlayerOne')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Previous Winners/i }));

    const championCell = await screen.findByRole('cell', { name: /ChampionA/i });

    const championRow = championCell.closest('tr');
    expect(championRow).not.toBeNull();
    const rowUtils = within(championRow as HTMLTableRowElement);

    expect(rowUtils.getByText('2×')).toBeInTheDocument();
    expect(
      rowUtils.getByText((_, node) => node?.textContent?.replace(/\D/g, '') === '1331')
    ).toBeInTheDocument();
    expect(rowUtils.getByText('105')).toBeInTheDocument();
    expect(rowUtils.getByText('129')).toBeInTheDocument();
    expect(rowUtils.getByText(/1 \(1 ✓\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Current Game/i }));

    await waitFor(() => {
      expect(screen.getByText('PlayerOne')).toBeInTheDocument();
    });

    expect(screen.queryByText('ChampionA')).not.toBeInTheDocument();
  });

  test('aggregatePreviousWinners sums stats per champion', () => {
    const aggregated = aggregatePreviousWinners(mockPreviousWinnersResponse.winners);
    const champion = aggregated.find((entry) => entry.username === 'ChampionA');
    const contender = aggregated.find((entry) => entry.username === 'ContenderB');

    expect(champion).toBeDefined();
    expect(champion?.wins).toBe(2);
    expect(champion?.totalPoints).toBe(350);
    expect(champion?.totalCorrect).toBe(22);
    expect(champion?.totalVotes).toBe(27);
    expect(champion?.hotSeatAppearances).toBe(1);

    expect(contender).toBeDefined();
    expect(contender?.wins).toBe(1);
    expect(contender?.totalPoints).toBe(175);
  });

  test('mergeAggregatedPreviousWinnersWithAllTime overlays all-time stats', () => {
    const aggregated = aggregatePreviousWinners(mockPreviousWinnersResponse.winners);
    const merged = mergeAggregatedPreviousWinnersWithAllTime(aggregated, mockLeaderboardResponse.all_time);
    const sorted = sortAggregatedPreviousWinners(merged);
    const champion = sorted[0];

    expect(champion.username).toBe('ChampionA');
    expect(champion.totalPoints).toBe(1331);
    expect(champion.totalCorrect).toBe(105);
    expect(champion.totalVotes).toBe(129);
    expect(champion.bestStreak).toBe(12);
    expect(champion.hotSeatAppearances).toBe(1);
  });
});
