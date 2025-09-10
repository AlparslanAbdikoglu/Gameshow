import React, { useState } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';

const QuestionContainer = styled(motion.div)`
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--glass-shadow);
  grid-area: questions;
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const QuestionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
`;

const QuestionTitle = styled.h2`
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  color: var(--primary-gold);
  text-transform: uppercase;
  letter-spacing: 2px;
`;

const QuestionNumber = styled.div`
  background: linear-gradient(135deg, var(--primary-gold), var(--secondary-gold));
  color: black;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-weight: var(--font-bold);
  font-size: var(--text-lg);
`;

const QuestionDisplay = styled(motion.div)`
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xl);
  margin-bottom: var(--spacing-lg);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid ${props => props.visible ? 'var(--primary-gold)' : 'transparent'};
  transition: border-color var(--transition-standard);
`;

const QuestionText = styled(motion.div)`
  font-size: var(--text-xl);
  font-weight: var(--font-medium);
  text-align: center;
  line-height: 1.5;
  color: ${props => props.visible ? 'white' : 'var(--neutral-gray)'};
`;

const AnswersGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
`;

const AnswerOption = styled(motion.div)`
  background: ${props => {
    if (props.revealed && props.correct) return 'linear-gradient(135deg, var(--success-green), #45a049)';
    if (props.revealed && !props.correct) return 'linear-gradient(135deg, var(--danger-red), #d32f2f)';
    if (props.visible) return 'linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.8))';
    return 'rgba(0, 0, 0, 0.3)';
  }};
  border: 2px solid ${props => {
    if (props.revealed && props.correct) return 'var(--success-green)';
    if (props.revealed && !props.correct) return 'var(--danger-red)';
    if (props.visible) return 'var(--primary-gold)';
    return 'transparent';
  }};
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  position: relative;
  overflow: hidden;
`;

const AnswerLetter = styled.div`
  font-size: var(--text-xl);
  font-weight: var(--font-black);
  color: ${props => props.visible ? 'var(--primary-gold)' : 'var(--neutral-gray)'};
  min-width: 32px;
`;

const AnswerText = styled.div`
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: ${props => props.visible ? 'white' : 'var(--neutral-gray)'};
  flex: 1;
`;

const ControlButtons = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
`;

const ControlButton = styled(motion.button)`
  background: ${props => {
    switch(props.variant) {
      case 'show': return 'linear-gradient(135deg, var(--success-green), #45a049)';
      case 'hide': return 'linear-gradient(135deg, var(--warning-orange), #f57c00)';
      case 'reveal': return 'linear-gradient(135deg, var(--danger-red), #d32f2f)';
      default: return 'linear-gradient(135deg, var(--primary-gold), var(--secondary-gold))';
    }
  }};
  border: none;
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  color: ${props => props.variant === 'default' ? 'black' : 'white'};
  font-weight: var(--font-bold);
  cursor: pointer;
  font-size: var(--text-base);
  text-transform: uppercase;
  letter-spacing: 1px;
  position: relative;
  overflow: hidden;
`;

const ButtonIcon = styled.span`
  margin-right: var(--spacing-sm);
  font-size: var(--text-lg);
`;

const NavigationButtons = styled.div`
  display: flex;
  gap: var(--spacing-md);
  justify-content: space-between;
  margin-top: auto;
`;

const NavButton = styled(motion.button)`
  background: linear-gradient(135deg, var(--primary-blue), var(--secondary-blue));
  border: 2px solid var(--primary-gold);
  border-radius: var(--radius-md);
  padding: var(--spacing-md) var(--spacing-lg);
  color: var(--primary-gold);
  font-weight: var(--font-bold);
  cursor: pointer;
  font-size: var(--text-base);
  text-transform: uppercase;
  letter-spacing: 1px;
  flex: 1;
  disabled: ${props => props.disabled};
  opacity: ${props => props.disabled ? 0.5 : 1};
`;

const CountdownOverlay = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  z-index: 10;
`;

const CountdownNumber = styled(motion.div)`
  font-size: 120px;
  font-weight: var(--font-black);
  color: var(--danger-red);
  text-shadow: 0 0 30px var(--danger-red);
`;

const RevealShimmer = styled(motion.div)`
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  z-index: 1;
`;

const QuestionManager = ({ 
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
  const [countdown, setCountdown] = useState(null);

  const handleRevealWithCountdown = async () => {
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
        return prev - 1;
      });
    }, 1000);
  };

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
    <QuestionContainer
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <QuestionHeader>
        <QuestionTitle>Question & Answers</QuestionTitle>
        <QuestionNumber>Q{currentQuestion.number}</QuestionNumber>
      </QuestionHeader>

      <QuestionDisplay visible={questionVisible}>
        <QuestionText 
          visible={questionVisible}
          initial={{ opacity: 0, y: 20 }}
          animate={{ 
            opacity: questionVisible ? 1 : 0.3, 
            y: questionVisible ? 0 : 20 
          }}
          transition={{ duration: 0.5 }}
        >
          {questionVisible ? currentQuestion.text : "Question Hidden"}
        </QuestionText>
      </QuestionDisplay>

      <AnswersGrid>
        {currentQuestion.answers.map((answer, index) => (
          <AnswerOption
            key={index}
            visible={answersVisible}
            revealed={answersRevealed}
            correct={index === currentQuestion.correct}
            variants={answerVariants}
            initial="hidden"
            animate={answersVisible ? "visible" : "hidden"}
            whileHover={answersVisible ? { scale: 1.02 } : {}}
          >
            {answersRevealed && index === currentQuestion.correct && (
              <RevealShimmer
                animate={{ x: ["0%", "200%"] }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            )}
            <AnswerLetter visible={answersVisible}>
              {letters[index]}:
            </AnswerLetter>
            <AnswerText visible={answersVisible}>
              {answersVisible ? answer : "Hidden"}
            </AnswerText>
          </AnswerOption>
        ))}
      </AnswersGrid>

      <ControlButtons>
        <ControlButton
          variant="show"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={questionVisible ? onShowAnswers : onShowQuestion}
          disabled={isRevealing}
        >
          <ButtonIcon>👁️</ButtonIcon>
          {questionVisible ? 'Show Answers' : 'Show Question'}
        </ControlButton>

        <ControlButton
          variant="hide"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={answersVisible ? onHideAnswers : onHideQuestion}
          disabled={isRevealing}
        >
          <ButtonIcon>🙈</ButtonIcon>
          {answersVisible ? 'Hide Answers' : 'Hide Question'}
        </ControlButton>

        <ControlButton
          variant="reveal"
          variants={buttonVariants}
          whileHover="hover"
          whileTap="tap"
          onClick={handleRevealWithCountdown}
          disabled={!answersVisible || answersRevealed || isRevealing}
        >
          <ButtonIcon>🎯</ButtonIcon>
          Reveal Answer
        </ControlButton>
      </ControlButtons>

      <NavigationButtons>
        <NavButton
          variants={buttonVariants}
          whileHover={canGoPrev ? "hover" : {}}
          whileTap={canGoPrev ? "tap" : {}}
          onClick={onPrevQuestion}
          disabled={!canGoPrev || isRevealing}
        >
          ← Previous
        </NavButton>

        <NavButton
          variants={buttonVariants}
          whileHover={canGoNext ? "hover" : {}}
          whileTap={canGoNext ? "tap" : {}}
          onClick={onNextQuestion}
          disabled={!canGoNext || isRevealing}
        >
          Next →
        </NavButton>
      </NavigationButtons>

      <AnimatePresence>
        {countdown !== null && (
          <CountdownOverlay
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CountdownNumber
              key={countdown}
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 180 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              {countdown > 0 ? countdown : "REVEAL!"}
            </CountdownNumber>
          </CountdownOverlay>
        )}
      </AnimatePresence>
    </QuestionContainer>
  );
};

export default QuestionManager;