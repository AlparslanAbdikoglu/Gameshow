import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';

const LadderContainer = styled(motion.div)`
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--glass-shadow);
  grid-area: money;
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const LadderHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
`;

const LadderTitle = styled.h2`
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  color: var(--primary-gold);
  text-transform: uppercase;
  letter-spacing: 2px;
`;

const CurrentPrizeDisplay = styled(motion.div)`
  background: linear-gradient(135deg, var(--primary-gold), var(--secondary-gold));
  color: black;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-weight: var(--font-black);
  font-size: var(--text-lg);
  text-align: center;
  min-width: 120px;
`;

const LadderScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-right: var(--spacing-sm);
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.3);
    border-radius: var(--radius-sm);
  }
  
  &::-webkit-scrollbar-thumb {
    background: var(--primary-gold);
    border-radius: var(--radius-sm);
  }
`;

const MoneyLevel = styled(motion.div)`
  background: ${props => {
    if (props.current) return 'linear-gradient(135deg, var(--primary-gold), var(--secondary-gold))';
    if (props.achieved) return 'linear-gradient(135deg, var(--success-green), #45a049)';
    if (props.milestone) return 'linear-gradient(135deg, rgba(255, 215, 0, 0.3), rgba(255, 165, 0, 0.3))';
    return 'rgba(0, 0, 0, 0.3)';
  }};
  border: 2px solid ${props => {
    if (props.current) return 'var(--primary-gold)';
    if (props.achieved) return 'var(--success-green)';
    if (props.milestone) return 'var(--primary-gold)';
    return 'rgba(255, 255, 255, 0.1)';
  }};
  border-radius: var(--radius-md);
  padding: var(--spacing-md) var(--spacing-lg);
  margin-bottom: var(--spacing-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  opacity: ${props => props.achieved || props.current ? 1 : 0.6};
  transform: ${props => props.current ? 'scale(1.05) translateX(-8px)' : 'scale(1)'};
  transition: all var(--transition-standard);
`;

const QuestionNumber = styled.div`
  font-size: var(--text-sm);
  color: ${props => {
    if (props.current) return 'black';
    if (props.achieved) return 'white';
    return 'var(--neutral-gray)';
  }};
  font-weight: var(--font-medium);
  min-width: 30px;
`;

const PrizeAmount = styled.div`
  font-size: var(--text-lg);
  font-weight: var(--font-black);
  color: ${props => {
    if (props.current) return 'black';
    if (props.achieved) return 'white';
    if (props.milestone) return 'var(--primary-gold)';
    return 'white';
  }};
  text-align: right;
  flex: 1;
`;

const MilestoneIcon = styled.div`
  font-size: var(--text-lg);
  margin-left: var(--spacing-sm);
  color: ${props => props.current ? 'black' : 'var(--primary-gold)'};
`;

const PulseEffect = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-md);
  border: 2px solid var(--primary-gold);
  opacity: 0;
`;

const Shimmer = styled(motion.div)`
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  z-index: 1;
`;

const SafetyNetIndicator = styled(motion.div)`
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  background: var(--success-green);
  border-radius: var(--radius-circle);
  border: 2px solid white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: white;
  font-weight: var(--font-bold);
`;

const ProgressBar = styled.div`
  height: 4px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacing-lg);
  overflow: hidden;
`;

const ProgressFill = styled(motion.div)`
  height: 100%;
  background: linear-gradient(90deg, var(--primary-gold), var(--secondary-gold));
  border-radius: var(--radius-sm);
`;

const StatsRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: rgba(0, 0, 0, 0.3);
  border-radius: var(--radius-md);
`;

const StatLabel = styled.div`
  font-size: var(--text-sm);
  color: var(--neutral-gray);
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const StatValue = styled.div`
  font-size: var(--text-base);
  color: var(--primary-gold);
  font-weight: var(--font-bold);
`;

const CelebrationOverlay = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle, rgba(255, 215, 0, 0.3) 0%, transparent 70%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
`;

const CelebrationText = styled(motion.div)`
  font-size: var(--text-4xl);
  font-weight: var(--font-black);
  color: var(--primary-gold);
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
  text-transform: uppercase;
  letter-spacing: 3px;
`;

const MoneyLadder = ({ 
  currentLevel = 0, 
  totalQuestions = 15,
  onLevelChange = () => {},
  showCelebration = false,
  animateProgress = false
}) => {
  const [previousLevel, setPreviousLevel] = useState(currentLevel);
  const [showLevelUp, setShowLevelUp] = useState(false);

  // Money ladder with realistic amounts
  const moneyLevels = [
    { amount: "$100", milestone: false },
    { amount: "$200", milestone: false },
    { amount: "$300", milestone: false },
    { amount: "$500", milestone: false },
    { amount: "$1,000", milestone: true }, // First safety net
    { amount: "$2,000", milestone: false },
    { amount: "$4,000", milestone: false },
    { amount: "$8,000", milestone: false },
    { amount: "$16,000", milestone: false },
    { amount: "$32,000", milestone: true }, // Second safety net
    { amount: "$64,000", milestone: false },
    { amount: "$125,000", milestone: false },
    { amount: "$250,000", milestone: false },
    { amount: "$500,000", milestone: false },
    { amount: "$1,000,000", milestone: true } // Grand prize
  ];

  useEffect(() => {
    if (currentLevel > previousLevel) {
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 3000);
    }
    setPreviousLevel(currentLevel);
  }, [currentLevel, previousLevel]);

  const progress = (currentLevel / (totalQuestions - 1)) * 100;
  const currentPrize = moneyLevels[currentLevel]?.amount || "$0";
  const nextMilestone = moneyLevels.find((level, index) => 
    index > currentLevel && level.milestone
  );

  const levelVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: { type: "spring", stiffness: 300 }
    },
    achieved: {
      scale: [1, 1.1, 1],
      transition: { duration: 0.5 }
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: { 
        duration: 0.5,
        staggerChildren: 0.05
      }
    }
  };

  return (
    <LadderContainer
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <LadderHeader>
        <LadderTitle>Money Ladder</LadderTitle>
        <CurrentPrizeDisplay
          animate={animateProgress ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.5 }}
        >
          {currentPrize}
        </CurrentPrizeDisplay>
      </LadderHeader>

      <ProgressBar>
        <ProgressFill
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </ProgressBar>

      <StatsRow>
        <StatLabel>Progress</StatLabel>
        <StatValue>{currentLevel + 1} / {totalQuestions}</StatValue>
      </StatsRow>

      {nextMilestone && (
        <StatsRow>
          <StatLabel>Next Milestone</StatLabel>
          <StatValue>{nextMilestone.amount}</StatValue>
        </StatsRow>
      )}

      <LadderScroll>
        {moneyLevels.map((level, index) => {
          const questionNumber = moneyLevels.length - index;
          const isCurrent = index === currentLevel;
          const isAchieved = index < currentLevel;
          const isMilestone = level.milestone;
          
          return (
            <MoneyLevel
              key={index}
              current={isCurrent}
              achieved={isAchieved}
              milestone={isMilestone}
              variants={levelVariants}
              initial="hidden"
              animate="visible"
              whileHover={!isCurrent ? { scale: 1.02, x: 5 } : {}}
              onClick={() => onLevelChange(index)}
            >
              {isCurrent && (
                <PulseEffect
                  animate={{ 
                    opacity: [0, 0.6, 0],
                    scale: [1, 1.05, 1]
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity 
                  }}
                />
              )}

              {(isAchieved || isCurrent) && (
                <Shimmer
                  animate={{ x: ["0%", "200%"] }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity, 
                    repeatDelay: 3,
                    delay: index * 0.1 
                  }}
                />
              )}

              {isMilestone && isAchieved && (
                <SafetyNetIndicator
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
                >
                  ✓
                </SafetyNetIndicator>
              )}

              <QuestionNumber
                current={isCurrent}
                achieved={isAchieved}
              >
                Q{questionNumber}
              </QuestionNumber>

              <PrizeAmount
                current={isCurrent}
                achieved={isAchieved}
                milestone={isMilestone}
              >
                {level.amount}
              </PrizeAmount>

              {isMilestone && (
                <MilestoneIcon current={isCurrent}>
                  {level.amount === "$1,000,000" ? "👑" : "🛡️"}
                </MilestoneIcon>
              )}
            </MoneyLevel>
          );
        })}
      </LadderScroll>

      <AnimatePresence>
        {showLevelUp && (
          <CelebrationOverlay
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ duration: 0.5 }}
          >
            <CelebrationText
              animate={{ 
                scale: [1, 1.2, 1],
                rotate: [0, 5, -5, 0]
              }}
              transition={{ 
                duration: 1, 
                repeat: 2 
              }}
            >
              Level Up!
            </CelebrationText>
          </CelebrationOverlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCelebration && (
          <CelebrationOverlay
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CelebrationText
              animate={{ 
                scale: [1, 1.3, 1],
                opacity: [1, 0.8, 1]
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity 
              }}
            >
              🎉 WINNER! 🎉
            </CelebrationText>
          </CelebrationOverlay>
        )}
      </AnimatePresence>
    </LadderContainer>
  );
};

export default MoneyLadder;