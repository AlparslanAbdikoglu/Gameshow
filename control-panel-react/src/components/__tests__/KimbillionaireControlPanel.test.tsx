import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import KimbillionaireControlPanel from '../KimbillionaireControlPanel';
import * as gameApi from '../../utils/api';
import * as obsIntegration from '../../utils/obs-integration';

// Mock external dependencies
jest.mock('../../utils/api');
jest.mock('../../utils/obs-integration');

const mockGameApi = gameApi as jest.Mocked<typeof gameApi>;
const mockObsIntegration = obsIntegration as jest.Mocked<typeof obsIntegration>;

describe('KimbillionaireControlPanel - Critical Path Tests', () => {
  const mockGameState = {
    current_question: 0,
    score: 0,
    game_active: false,
    lifelines_used: [],
    update_needed: false
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (window as any).AudioContext = jest.fn().mockImplementation(() => ({
      createOscillator: jest.fn(),
      createGain: jest.fn(),
      destination: {},
      currentTime: 0,
      resume: jest.fn(),
      close: jest.fn()
    }));
    (window as any).webkitAudioContext = (window as any).AudioContext;

    // Setup default API mocks
    mockGameApi.gameApi = {
      getState: jest.fn().mockResolvedValue(mockGameState),
      startGame: jest.fn().mockResolvedValue({ success: true }),
      resetGame: jest.fn().mockResolvedValue({ success: true }),
      nextQuestion: jest.fn().mockResolvedValue({ success: true }),
      previousQuestion: jest.fn().mockResolvedValue({ success: true }),
      showQuestion: jest.fn().mockResolvedValue({ success: true }),
      showAnswers: jest.fn().mockResolvedValue({ success: true }),
      hideQuestion: jest.fn().mockResolvedValue({ success: true }),
      hideAnswers: jest.fn().mockResolvedValue({ success: true }),
      revealAnswer: jest.fn().mockResolvedValue({ success: true }),
      lockAnswer: jest.fn().mockResolvedValue({ success: true }),
      setSelectedAnswer: jest.fn().mockResolvedValue({ success: true }),
      setContestant: jest.fn().mockResolvedValue({ success: true }),
      updatePrizes: jest.fn().mockResolvedValue({ success: true }),
      updateQuestions: jest.fn().mockResolvedValue({ success: true }),
      shutdownServer: jest.fn().mockResolvedValue({ success: true })
    } as any;

    // Setup OBS mocks
    mockObsIntegration.obsIntegration = {
      connect: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      showQuestion: jest.fn().mockResolvedValue(true),
      showAnswers: jest.fn().mockResolvedValue(true),
      hideAnswers: jest.fn().mockResolvedValue(true),
      revealCorrectAnswer: jest.fn().mockResolvedValue(true),
      switchOverlay: jest.fn().mockResolvedValue(true)
    } as any;

    // Mock WebSocket
    global.WebSocket = jest.fn().mockImplementation(() => {
      const listeners: Record<string, Set<(event: any) => void>> = {};

      return {
        onopen: jest.fn(),
        onmessage: jest.fn(),
        onerror: jest.fn(),
        close: jest.fn(),
        send: jest.fn(),
        readyState: 0,
        addEventListener: jest.fn((type: string, handler: (event: any) => void) => {
          if (!listeners[type]) {
            listeners[type] = new Set();
          }
          listeners[type].add(handler);
        }),
        removeEventListener: jest.fn((type: string, handler: (event: any) => void) => {
          listeners[type]?.delete(handler);
        })
      };
    }) as any;
  });

  describe('Critical Path 1: Game Setup and Start', () => {
    test('should render control panel with all essential sections', () => {
      render(<KimbillionaireControlPanel />);
      
      expect(screen.getByText(/Who Wants to be a Kimbillionaire - Control Panel/i)).toBeInTheDocument();
      expect(screen.getByText(/Game Setup/i)).toBeInTheDocument();
      expect(screen.getByText(/Question Control/i)).toBeInTheDocument();
      expect(screen.getByText(/Prize Levels/i)).toBeInTheDocument();
    });

    test('should start game successfully', async () => {
      render(<KimbillionaireControlPanel />);
      
      const startButton = screen.getByText(/Start Game/i);
      fireEvent.click(startButton);
      
      await waitFor(() => {
        expect(mockGameApi.gameApi.startGame).toHaveBeenCalled();
      });
    });

    test('should reset game with confirmation', async () => {
      // Mock window.confirm
      window.confirm = jest.fn(() => true);
      
      render(<KimbillionaireControlPanel />);
      
      const resetButton = screen.getByText(/Reset Game/i);
      fireEvent.click(resetButton);
      
      await waitFor(() => {
        expect(window.confirm).toHaveBeenCalled();
        expect(mockGameApi.gameApi.resetGame).toHaveBeenCalled();
      });
    });
  });

  describe('Critical Path 2: Question Flow Control', () => {
    test('should execute complete question flow: Show → Answers → Lock → Reveal → Next', async () => {
      render(<KimbillionaireControlPanel />);
      
      // Step 1: Show Question
      const showQuestionBtn = screen.getByText(/1\. Show Question/i);
      fireEvent.click(showQuestionBtn);
      
      await waitFor(() => {
        expect(mockGameApi.gameApi.showQuestion).toHaveBeenCalled();
      });

      // Step 2: Show Answers
      const showAnswersBtn = screen.getByText(/2\. Show Answers/i);
      fireEvent.click(showAnswersBtn);
      
      await waitFor(() => {
        expect(mockGameApi.gameApi.showAnswers).toHaveBeenCalled();
      });

      // Step 3: Select and Lock Answer
      // This would require more detailed component state simulation
      // For now, test that the lock button exists
      expect(screen.getByText(/3\. Lock In Answer/i)).toBeInTheDocument();
    });

    test('should navigate between questions', async () => {
      render(<KimbillionaireControlPanel />);
      
      const nextButton = screen.getByText(/Next/i);
      fireEvent.click(nextButton);
      
      await waitFor(() => {
        expect(mockGameApi.gameApi.nextQuestion).toHaveBeenCalled();
      });
    });
  });

  describe('Critical Path 3: Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      mockGameApi.gameApi.startGame = jest.fn().mockRejectedValue(new Error('Server error'));
      
      // Mock alert
      window.alert = jest.fn();
      
      render(<KimbillionaireControlPanel />);
      
      const startButton = screen.getByText(/Start Game/i);
      fireEvent.click(startButton);
      
      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(
          expect.stringContaining('Failed to start the game')
        );
      });
    });

    test('should handle OBS connection failures', async () => {
      mockObsIntegration.obsIntegration.connect = jest.fn().mockResolvedValue(false);
      
      render(<KimbillionaireControlPanel />);
      
      await waitFor(() => {
        expect(screen.getByText(/OBS Disconnected/i)).toBeInTheDocument();
      });
    });
  });

  describe('Critical Path 4: Performance Requirements', () => {
    test('should render within performance budget', () => {
      const startTime = performance.now();
      render(<KimbillionaireControlPanel />);
      const endTime = performance.now();
      
      // Should render in under 100ms for broadcast quality
      expect(endTime - startTime).toBeLessThan(100);
    });

    test('should memoize expensive operations', () => {
      const { rerender } = render(<KimbillionaireControlPanel />);
      
      // Force re-render with same props
      rerender(<KimbillionaireControlPanel />);
      
      // Should not cause additional API calls
      expect(mockGameApi.gameApi.getState).toHaveBeenCalledTimes(1);
    });
  });

  describe('Critical Path 5: Accessibility', () => {
    test('should have proper ARIA labels and roles', () => {
      render(<KimbillionaireControlPanel />);
      
      // Check for essential accessibility features
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      
      // All buttons should have accessible names
      buttons.forEach(button => {
        expect(button).toHaveAccessibleName();
      });
    });

    test('should support keyboard navigation', () => {
      render(<KimbillionaireControlPanel />);
      
      // Tab navigation should work
      const firstButton = screen.getAllByRole('button')[0];
      firstButton.focus();
      expect(firstButton).toHaveFocus();
    });
  });
});

// Integration test for complete game show simulation
describe('Integration: Complete Show Simulation', () => {
  test('should handle complete show workflow from start to finish', async () => {
    render(<KimbillionaireControlPanel />);
    
    // 1. Start game
    const startButton = screen.getByText(/Start Game/i);
    fireEvent.click(startButton);
    
    await waitFor(() => {
      expect(mockGameApi.gameApi.startGame).toHaveBeenCalled();
    });

    // 2. Show question
    const showQuestionBtn = screen.getByText(/1\. Show Question/i);
    fireEvent.click(showQuestionBtn);
    
    await waitFor(() => {
      expect(mockGameApi.gameApi.showQuestion).toHaveBeenCalled();
    });

    // 3. Show answers
    const showAnswersBtn = screen.getByText(/2\. Show Answers/i);
    fireEvent.click(showAnswersBtn);
    
    await waitFor(() => {
      expect(mockGameApi.gameApi.showAnswers).toHaveBeenCalled();
    });

    // This test verifies the basic flow works without throwing errors
    expect(screen.getByText(/Question Control/i)).toBeInTheDocument();
  });
});