import React from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';

interface QuestionControlSectionProps {
  gameState: {
    current_question: number;
    game_active: boolean;
    curtains_closed?: boolean;
    preparing_for_game?: boolean;
    typewriter_animation_complete?: boolean;
    gameshow_participants?: string[];
    credits_rolling?: boolean;
    credits_scrolling?: boolean;
    answer_is_wrong?: boolean;
    available_lifelines_for_vote?: string[];
    lifeline_voting_active?: boolean;
    is_revote_active?: boolean;
    answers_visible?: boolean;
    finalLeaderboardShown?: boolean;
  };
  questionVisible: boolean;
  answersVisible: boolean;
  answersRevealed: boolean;
  answerLockedIn: boolean;
  selectedAnswer: number | null;
  onShowQuestion: () => void;
  onShowAnswers: () => void;
  onLockInAnswer: () => void;
  onRevealAnswer: () => void;
  onHideQuestion: () => void;
  onNextQuestion: () => void;
  onPreviousQuestion: () => void;
  onEndGameCredits?: () => void;
  onStartCreditsScroll?: () => void;
  onStartLifelineVote?: () => void;
  onEndLifelineVoting?: () => void;
  onShowFinalLeaderboard?: () => void;
  onRollCredits?: () => void;
  disabled?: boolean;
}

const QuestionControlSection: React.FC<QuestionControlSectionProps> = React.memo(({
  gameState,
  questionVisible,
  answersVisible,
  answersRevealed,
  answerLockedIn,
  selectedAnswer,
  onShowQuestion,
  onShowAnswers,
  onLockInAnswer,
  onRevealAnswer,
  onHideQuestion,
  onNextQuestion,
  onPreviousQuestion,
  onEndGameCredits,
  onStartCreditsScroll,
  onStartLifelineVote,
  onEndLifelineVoting,
  onShowFinalLeaderboard,
  onRollCredits,
  disabled = false
}) => {
  return (
    <GlassPanel 
      title="Question Control" 
      isLocked={false}
    >
      
      {/* Status Message for Curtain/Preparation Lock */}
      {gameState.curtains_closed && gameState.game_active && (
        <div style={{
          background: 'rgba(255, 107, 53, 0.2)',
          border: '1px solid rgba(255, 107, 53, 0.5)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          textAlign: 'center',
          color: '#FF6B35',
          fontSize: '14px',
          fontWeight: '600'
        }}>
          {gameState.preparing_for_game ? 
            '⏳ Preparing scene for game... Please wait' : 
            '🎭 Waiting for curtains to open...'}
        </div>
      )}
      
      {/* Ready for Question Message - shown when curtains are open and preparing */}
      {!gameState.curtains_closed && gameState.preparing_for_game && gameState.game_active && (
        <div style={{
          background: 'rgba(40, 167, 69, 0.2)',
          border: '1px solid rgba(40, 167, 69, 0.5)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          textAlign: 'center',
          color: '#28a745',
          fontSize: '14px',
          fontWeight: '600'
        }}>
          ✅ Scene ready - Press "Show Question" to continue
        </div>
      )}
      
      {/* Typewriter Animation Message - shown when question is visible but typewriter hasn't completed */}
      {questionVisible && gameState.typewriter_animation_complete === false && (
        <div style={{
          background: 'rgba(255, 193, 7, 0.2)',
          border: '1px solid rgba(255, 193, 7, 0.5)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          textAlign: 'center',
          color: '#FFC107',
          fontSize: '14px',
          fontWeight: '600'
        }}>
          ⌨️ Question typing animation in progress... Please wait for completion
        </div>
      )}
      
      {/* Game Flow Progress Indicator */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '20px',
        border: '1px solid rgba(255, 215, 0, 0.2)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '8px',
          fontSize: '14px',
          color: '#FFD700'
        }}>
          <span>Game Flow Progress</span>
          <span>
            {answersRevealed ? '5/5 Complete' :
             answerLockedIn ? '4/5' :
             answersVisible ? '3/5' :
             questionVisible ? '2/5' : '1/5'}
          </span>
        </div>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          {/* Step indicators */}
          {[
            { step: 1, label: 'Show Q', active: questionVisible, isNext: gameState.game_active && !questionVisible && !disabled },
            { step: 2, label: 'Show A', active: answersVisible, isNext: questionVisible && !answersVisible && gameState.typewriter_animation_complete },
            { step: 3, label: 'Lock', active: answerLockedIn || answersRevealed, isNext: answersVisible && !answerLockedIn && selectedAnswer !== null },
            { step: 4, label: 'Reveal', active: answersRevealed, isNext: answerLockedIn && !answersRevealed },
            { step: 5, label: 'Next', active: false, isNext: answersRevealed }
          ].map((item, index) => (
            <React.Fragment key={item.step}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: item.active 
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : item.isNext
                  ? 'linear-gradient(135deg, #FFD700, #FFA500)'
                  : 'rgba(255, 215, 0, 0.2)',
                border: `2px solid ${item.active ? '#10b981' : item.isNext ? '#FFD700' : 'rgba(255, 215, 0, 0.4)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                color: item.active ? 'white' : item.isNext ? '#002B5C' : '#FFD700',
                transition: 'all 0.3s ease',
                animation: 'none',
                boxShadow: item.isNext && !item.active ? '0 2px 8px rgba(255, 215, 0, 0.3)' : 'none'
              }}>
                {item.active ? '✓' : item.step}
              </div>
              {index < 4 && (
                <div style={{
                  flex: 1,
                  height: '3px',
                  background: 'rgba(255, 215, 0, 0.2)',
                  borderRadius: '2px',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    background: 'linear-gradient(90deg, #10b981, #059669)',
                    width: item.active ? '100%' : '0%',
                    borderRadius: '2px',
                    transition: 'width 0.5s ease'
                  }}></div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '8px',
          fontSize: '10px',
          color: 'rgba(255, 255, 255, 0.6)'
        }}>
          <span>Show Q</span>
          <span>Show A</span>
          <span>Lock</span>
          <span>Reveal</span>
          <span>Next</span>
        </div>
      </div>
      
      {/* Question Flow Row */}
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button 
          className={`${styles.secondaryBtn} ${styles.glowingBtn} ${
            questionVisible 
              ? `${styles.completedStep}` 
              : answerLockedIn 
              ? styles.disabledBtn 
              : gameState.game_active && !questionVisible && !answersVisible && !answersRevealed
              ? `${styles.primaryBtn} ${styles.nextStep} ${styles.pulsingBtn}`
              : styles.primaryBtn
          }`}
          onClick={onShowQuestion}
          disabled={answerLockedIn || disabled}
          title={
            questionVisible 
              ? "Question is currently visible" 
              : answerLockedIn 
              ? "Cannot change question while answer is locked in" 
              : gameState.game_active && !questionVisible
              ? "Click to begin - Show the question!"
              : "Show question"
          }
        >
          {questionVisible ? "✓ Question Shown" : "Show Question"}
        </button>
        <button 
          className={`${styles.secondaryBtn} ${styles.glowingBtn} ${
            answersVisible 
              ? `${styles.completedStep}` 
              : questionVisible && !answerLockedIn && gameState.typewriter_animation_complete
              ? `${styles.primaryBtn} ${styles.nextStep}`
              : answerLockedIn || !gameState.typewriter_animation_complete
              ? styles.disabledBtn 
              : styles.secondaryBtn
          }`}
          onClick={onShowAnswers}
          disabled={answerLockedIn || !questionVisible || !gameState.typewriter_animation_complete || disabled}
          title={
            answersVisible 
              ? "Answers are currently visible" 
              : !questionVisible 
              ? "Show question first" 
              : !gameState.typewriter_animation_complete
              ? "Wait for question typewriter animation to complete"
              : answerLockedIn 
              ? "Cannot show answers while answer is locked in" 
              : "Show answer choices"
          }
        >
          {answersVisible ? "✓ Answers Shown" : 
           questionVisible && !gameState.typewriter_animation_complete ? "⌨️ Wait for Animation" : 
           "Show Answers"}
        </button>
      </div>

      {/* Lock In Row */}
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button 
          className={`${styles.lockInBtn} ${
            answerLockedIn || (answersRevealed && !gameState.is_revote_active)
              ? `${styles.lockedInBtn} ${styles.disabledBtn}` 
              : answersVisible && selectedAnswer !== null && !answerLockedIn
              ? `${styles.nextStep} ${styles.pulsingBtn}`
              : answersVisible && selectedAnswer === null
              ? styles.waitingForSelection
              : styles.unlocked
          }`}
          onClick={onLockInAnswer}
          disabled={(!answersVisible && !gameState.answers_visible && !answerLockedIn && !gameState.is_revote_active) || answerLockedIn || (answersRevealed && !gameState.is_revote_active) || disabled}
          title={
            answersRevealed && !gameState.is_revote_active
              ? "Answer revealed - Use Next Question to continue"
              : answerLockedIn 
              ? "Answer is locked in - Click Reveal to show the correct answer" 
              : !answersVisible && !gameState.answers_visible && !gameState.is_revote_active
              ? "Show answers first" 
              : selectedAnswer !== null
              ? `Click to lock in answer ${['A', 'B', 'C', 'D'][selectedAnswer]}`
              : gameState.is_revote_active
              ? "Select an answer during revote, then lock it in"
              : "Select an answer first, then lock it in"
          }
        >
          {answersRevealed && !gameState.is_revote_active
            ? '✅ Answer Revealed'
            : answerLockedIn 
            ? '🔒 Answer Locked In' 
            : selectedAnswer !== null 
            ? `Lock In Answer ${['A', 'B', 'C', 'D'][selectedAnswer]}` 
            : answersVisible
            ? 'Select an Answer First'
            : 'Lock In Answer'
          }
        </button>
      </div>

      {/* Reveal Row */}
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button 
          className={`${styles.primaryBtn} ${styles.glowingBtn} ${
            answersRevealed
              ? styles.completedStep
              : answerLockedIn && !answersRevealed
              ? `${styles.nextStep} ${styles.pulsingBtn}`
              : !answerLockedIn
              ? styles.disabledBtn
              : ''
          }`}
          onClick={onRevealAnswer}
          disabled={(!answerLockedIn && !answersRevealed) || answersRevealed || disabled}
          title={
            answersRevealed 
              ? "Answer has been revealed" 
              : answerLockedIn 
              ? "Click to reveal the answer!" 
              : "Lock in an answer first"
          }
        >
          {answersRevealed ? '✓ Answer Revealed' : 'Reveal Answer'}
        </button>
      </div>

      {/* Manual End Lifeline Voting Button - Only show when lifeline voting is active */}
      {gameState.lifeline_voting_active && onEndLifelineVoting && (
        <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
          <button 
            className={`${styles.dangerBtn} ${styles.pulsingBtn}`}
            onClick={onEndLifelineVoting}
            disabled={disabled}
            title="Manually end lifeline voting and apply results immediately"
            style={{
              background: 'linear-gradient(135deg, #dc3545, #c82333)',
              border: '2px solid #dc3545',
              color: 'white',
              fontWeight: 'bold',
              animation: 'pulse 2s infinite'
            }}
          >
            🛑 END LIFELINE VOTING NOW
          </button>
        </div>
      )}

      {/* Navigation Row */}
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button 
          className={`${styles.secondaryBtn} ${(answerLockedIn || gameState.current_question === 0) ? styles.disabledBtn : ''}`}
          onClick={onPreviousQuestion}
          disabled={answerLockedIn || gameState.current_question === 0 || disabled}
          title={
            answersRevealed 
              ? "You can also go to previous question" 
              : answerLockedIn 
              ? "Cannot change question while answer is locked in" 
              : gameState.current_question === 0 
              ? "Already at first question" 
              : "Previous question"
          }
        >
          ← Previous
        </button>
        <button 
          className={`${
            // Show as primary/pulsing for wrong answer with lifelines available
            answersRevealed && gameState.answer_is_wrong && 
            gameState.available_lifelines_for_vote && 
            gameState.available_lifelines_for_vote.length > 0 && 
            !gameState.lifeline_voting_active
              ? `${styles.primaryBtn} ${styles.nextStep} ${styles.pulsingBtn}`
              : answersRevealed && !gameState.answer_is_wrong
              ? `${styles.primaryBtn} ${styles.nextStep} ${styles.pulsingBtn}` 
              : answerLockedIn 
              ? styles.disabledBtn 
              : styles.secondaryBtn
          }`}
          onClick={
            // Start lifeline vote if wrong answer and lifelines available
            answersRevealed && gameState.answer_is_wrong && 
            gameState.available_lifelines_for_vote && 
            gameState.available_lifelines_for_vote.length > 0 &&
            !gameState.lifeline_voting_active && 
            onStartLifelineVote
              ? onStartLifelineVote
              : onNextQuestion
          }
          disabled={(answerLockedIn && !answersRevealed) || gameState.lifeline_voting_active || gameState.current_question === 14 && answersRevealed || disabled}
          title={
            gameState.current_question === 14 && answersRevealed
              ? "All 15 questions completed! Use the buttons below for final sequence"
              : answersRevealed && gameState.answer_is_wrong && 
                gameState.available_lifelines_for_vote && 
                gameState.available_lifelines_for_vote.length > 0 &&
                !gameState.lifeline_voting_active
              ? "Audience got it wrong! Click to start 60-second lifeline vote"
              : gameState.lifeline_voting_active
              ? "Lifeline voting in progress..."
              : answersRevealed 
              ? "Click to move to the next question!" 
              : answerLockedIn 
              ? "Reveal the answer first before moving to next question" 
              : "Next question"
          }
        >
          {gameState.current_question === 14 && answersRevealed 
            ? "✓ Game Complete" 
            : answersRevealed && gameState.answer_is_wrong && 
              gameState.available_lifelines_for_vote && 
              gameState.available_lifelines_for_vote.length > 0 &&
              !gameState.lifeline_voting_active
            ? "🗳️ VOTE FOR LIFELINE"
            : gameState.lifeline_voting_active
            ? "⏱️ Voting..."
            : answersRevealed 
            ? "Next Question →" 
            : "Next →"}
        </button>
      </div>


      {/* End Game Sequence - Show when question 15 is completed */}
      {gameState.current_question === 14 && answersRevealed && (
        <div className={styles.endGameSection} style={{marginTop: '20px', padding: '15px', border: '2px solid #FFD700', borderRadius: '10px', background: 'rgba(255, 215, 0, 0.1)'}}>
          <h3 style={{textAlign: 'center', color: '#FFD700', marginBottom: '15px'}}>🏆 End Game Sequence 🏆</h3>
          
          {/* Show Final Leaderboard Button */}
          {!gameState.finalLeaderboardShown && (
            <div className={styles.buttonGrid} style={{marginBottom: '10px'}}>
              <button 
                className={`${styles.primaryBtn} ${styles.nextStep} ${styles.pulsingBtn}`}
                onClick={() => {
                  if (onShowFinalLeaderboard) {
                    onShowFinalLeaderboard();
                  }
                }}
                disabled={disabled}
                style={{
                  background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                  border: '2px solid #FFD700',
                  color: '#000',
                  fontWeight: 'bold',
                  fontSize: '18px',
                  padding: '15px',
                  width: '100%'
                }}
              >
                🏆 Show Final Leaderboard
              </button>
            </div>
          )}
          
          {/* Roll Credits Button - Show after leaderboard is displayed */}
          {gameState.finalLeaderboardShown && (
            <div className={styles.buttonGrid}>
              <button 
                className={`${styles.primaryBtn} ${styles.nextStep}`}
                onClick={() => {
                  if (onRollCredits) {
                    onRollCredits();
                  }
                }}
                disabled={disabled}
                style={{
                  background: 'linear-gradient(135deg, #8B4513, #A0522D)',
                  border: '2px solid #8B4513',
                  color: '#FFF',
                  fontWeight: 'bold',
                  fontSize: '18px',
                  padding: '15px',
                  width: '100%'
                }}
              >
                🎬 Roll Credits
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reset Row */}
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button 
          className={styles.dangerBtn}
          onClick={onHideQuestion}
          disabled={disabled}
          title="Hide question and answers to reset display"
        >
          Hide All
        </button>
      </div>
    </GlassPanel>
  );
});

QuestionControlSection.displayName = 'QuestionControlSection';

export default QuestionControlSection;