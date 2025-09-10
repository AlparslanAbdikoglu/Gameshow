import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './QuestionControl.module.css';

interface Question {
  text: string;
  answers: string[];
  correct: number;
  number: number;
}

interface QuestionControlProps {
  currentQuestion?: Question;
  questionVisible?: boolean;
  answersVisible?: boolean;
  answersRevealed?: boolean;
  onShowQuestion?: () => void;
  onHideQuestion?: () => void;
  onShowAnswers?: () => void;
  onHideAnswers?: () => void;
  onRevealAnswer?: () => void;
  onNextQuestion?: () => void;
  onPrevQuestion?: () => void;
  canGoNext?: boolean;
  canGoPrev?: boolean;
  isRevealing?: boolean;
}

const QuestionControl: React.FC<QuestionControlProps> = ({
  currentQuestion = {
    text: "What is the capital of France?",
    answers: ["London", "Berlin", "Paris", "Madrid"],
    correct: 2,
    number: 1
  },
  questionVisible = false,
  answersVisible = false,
  answersRevealed = false,
  onShowQuestion = () => {},
  onHideQuestion = () => {},
  onShowAnswers = () => {},
  onHideAnswers = () => {},
  onRevealAnswer = () => {},
  onNextQuestion = () => {},
  onPrevQuestion = () => {},
  canGoNext = true,
  canGoPrev = true,
  isRevealing = false
}) => {
  const [countdown, setCountdown] = useState<number | null>(null);

  const handleRevealWithCountdown = useCallback(async () => {
    setCountdown(3);
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev === 1) {
          clearInterval(countdownInterval);
          setTimeout(() => {
            setCountdown(null);
            onRevealAnswer();
          }, 1000);
          return 0;
        }
        return (prev || 0) - 1;
      });
    }, 1000);
  }, [onRevealAnswer]);

  const letters = ['A', 'B', 'C', 'D'];

  const containerVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { 
        duration: 0.5,
        staggerChildren: 0.1
      }
    }
  };

  const buttonVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
    hover: { scale: 1.05, y: -2 },
    tap: { scale: 0.95 }
  };

  const answerVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: { type: "spring", stiffness: 300 }
    },
    revealed: {
      scale: [1, 1.05, 1],
      transition: { duration: 0.5 }
    }
  };

  return (
    <motion.div
      className={`glass-panel ${styles.questionContainer}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className={styles.questionHeader}>
        <h2 className={styles.questionTitle}>Question & Answers</h2>
        <div className={styles.questionNumber}>Q{currentQuestion.number}</div>
      </div>

      <motion.div 
        className={`${styles.questionDisplay} ${questionVisible ? styles.visible : ''}`}
      >
        <motion.div 
          className={styles.questionText}
          initial={{ opacity: 0, y: 20 }}
          animate={{ 
            opacity: questionVisible ? 1 : 0.3, 
            y: questionVisible ? 0 : 20 
          }}
          transition={{ duration: 0.5 }}
        >
          {questionVisible ? currentQuestion.text : "Question Hidden"}
        </motion.div>
      </motion.div>

      <div className={styles.answersGrid}>
        {currentQuestion.answers.map((answer, index) => (
          <motion.div
            key={index}
            className={`${styles.answerOption} ${answersVisible ? styles.visible : ''} ${
              answersRevealed && index === currentQuestion.correct ? styles.correct : ''
            } ${answersRevealed && index !== currentQuestion.correct ? styles.incorrect : ''}`}
            variants={answerVariants}
            initial="hidden"
            animate={answersVisible ? "visible" : "hidden"}
            whileHover={answersVisible ? { scale: 1.02 } : {}}
          >
            {answersRevealed && index === currentQuestion.correct && (
              <motion.div
                className={styles.revealShimmer}
                animate={{ x: ["0%", "200%"] }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            )}
            <div className={styles.answerLetter}>
              {letters[index]}:
            </div>
            <div className={styles.answerText}>
              {answersVisible ? answer : "Hidden"}
            </div>
          </motion.div>
        ))}
      </div>

      <div className={styles.controlButtons}>
        <motion.button
          className="btn-success"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={questionVisible ? onShowAnswers : onShowQuestion}
          disabled={isRevealing}
        >
          <span className={styles.buttonIcon}>👁️</span>
          {questionVisible ? 'Show Answers' : 'Show Question'}
        </motion.button>

        <motion.button
          className="btn-secondary"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={answersVisible ? onHideAnswers : onHideQuestion}
          disabled={isRevealing}
        >
          <span className={styles.buttonIcon}>🙈</span>
          {answersVisible ? 'Hide Answers' : 'Hide Question'}
        </motion.button>

        <motion.button
          className="btn-danger"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={handleRevealWithCountdown}
          disabled={!answersVisible || answersRevealed || isRevealing}
        >
          <span className={styles.buttonIcon}>🎯</span>
          Reveal Answer
        </motion.button>
      </div>

      <div className={styles.navigationButtons}>
        <motion.button
          className="btn-secondary"
          variants={buttonVariants}
          whileHover={canGoPrev ? "hover" : {}}
          whileTap={canGoPrev ? "tap" : {}}
          onClick={onPrevQuestion}
          disabled={!canGoPrev || isRevealing}
        >
          ← Previous
        </motion.button>

        <motion.button
          className="btn-secondary"
          variants={buttonVariants}
          whileHover={canGoNext ? "hover" : {}}
          whileTap={canGoNext ? "tap" : {}}
          onClick={onNextQuestion}
          disabled={!canGoNext || isRevealing}
        >
          Next →
        </motion.button>
      </div>

      <AnimatePresence>
        {countdown !== null && (
          <motion.div
            className={styles.countdownOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={styles.countdownNumber}
              key={countdown}
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 180 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              {countdown > 0 ? countdown : "REVEAL!"}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default QuestionControl;