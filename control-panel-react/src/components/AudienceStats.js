import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';

const StatsContainer = styled(motion.div)`
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--glass-shadow);
  grid-area: stats;
`;

const StatsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
`;

const StatsTitle = styled.h2`
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  color: var(--primary-gold);
  text-transform: uppercase;
  letter-spacing: 2px;
`;

const LiveIndicator = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--success-green);
  font-weight: var(--font-semibold);
`;

const LiveDot = styled(motion.div)`
  width: 12px;
  height: 12px;
  background-color: var(--success-green);
  border-radius: var(--radius-circle);
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
`;

const StatCard = styled(motion.div)`
  background: rgba(0, 0, 0, 0.3);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
`;

const StatNumber = styled(motion.div)`
  font-size: var(--text-4xl);
  font-weight: var(--font-black);
  color: var(--primary-gold);
  margin-bottom: var(--spacing-sm);
`;

const StatLabel = styled.div`
  font-size: var(--text-sm);
  color: var(--neutral-gray);
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const VotingChart = styled.div`
  margin-bottom: var(--spacing-xl);
`;

const ChartTitle = styled.h3`
  font-size: var(--text-lg);
  color: white;
  margin-bottom: var(--spacing-md);
  text-align: center;
`;

const VoteBar = styled(motion.div)`
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-md);
  gap: var(--spacing-md);
`;

const VoteLabel = styled.div`
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--primary-gold);
  width: 40px;
  text-align: center;
`;

const VoteBarContainer = styled.div`
  flex: 1;
  height: 30px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
`;

const VoteBarFill = styled(motion.div)`
  height: 100%;
  background: ${props => props.isTop ? 
    'linear-gradient(90deg, var(--primary-gold), var(--secondary-gold))' : 
    'linear-gradient(90deg, var(--secondary-blue), var(--primary-blue))'
  };
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--spacing-sm);
  position: relative;
  overflow: hidden;
`;

const VotePercentage = styled.div`
  color: white;
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
`;

const Shimmer = styled(motion.div)`
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
`;

const StatusBar = styled(motion.div)`
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md) var(--spacing-lg);
  text-align: center;
  border: 1px solid ${props => {
    switch(props.status) {
      case 'waiting': return 'var(--warning-orange)';
      case 'revealing': return 'var(--danger-red)';
      case 'winner': return 'var(--success-green)';
      default: return 'var(--primary-gold)';
    }
  }};
`;

const StatusText = styled.div`
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: ${props => {
    switch(props.status) {
      case 'waiting': return 'var(--warning-orange)';
      case 'revealing': return 'var(--danger-red)';
      case 'winner': return 'var(--success-green)';
      default: return 'var(--primary-gold)';
    }
  }};
`;

const AudienceStats = ({ 
  totalParticipants = 0, 
  votingPercentage = 0, 
  votes = { A: 0, B: 0, C: 0, D: 0 },
  status = 'waiting',
  mostPopularAnswer = 'A'
}) => {
  const [animationKey, setAnimationKey] = useState(0);
  
  useEffect(() => {
    setAnimationKey(prev => prev + 1);
  }, [totalParticipants, votes]);

  const statusMessages = {
    waiting: "Waiting for answers...",
    revealing: "Revealing in 3, 2, 1...",
    winner: "Winner!",
    voting: "Voting in progress...",
    closed: "Voting closed"
  };

  // Calculate percentages and find the highest vote
  const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
  const votePercentages = Object.entries(votes).map(([letter, count]) => ({
    letter,
    count,
    percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
  })).sort((a, b) => b.count - a.count);

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    hover: { scale: 1.05, y: -5 }
  };

  // Removed unused barVariants

  return (
    <StatsContainer
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
    >
      <StatsHeader>
        <StatsTitle>Audience Live Stats</StatsTitle>
        <LiveIndicator>
          <LiveDot
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          LIVE
        </LiveIndicator>
      </StatsHeader>

      <StatsGrid>
        <StatCard
          key={`participants-${animationKey}`}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
          transition={{ duration: 0.3 }}
        >
          <StatNumber
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
          >
            {totalParticipants.toLocaleString()}
          </StatNumber>
          <StatLabel>Total Participating</StatLabel>
        </StatCard>

        <StatCard
          key={`voting-${animationKey}`}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <StatNumber
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
          >
            {votingPercentage}%
          </StatNumber>
          <StatLabel>Currently Voting</StatLabel>
        </StatCard>

        <StatCard
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <StatNumber
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
          >
            {mostPopularAnswer}
          </StatNumber>
          <StatLabel>Most Popular</StatLabel>
        </StatCard>

        <StatCard
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <StatNumber
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.3 }}
          >
            {totalVotes.toLocaleString()}
          </StatNumber>
          <StatLabel>Total Votes</StatLabel>
        </StatCard>
      </StatsGrid>

      <VotingChart>
        <ChartTitle>Live Vote Distribution</ChartTitle>
        {votePercentages.map((vote, index) => (
          <VoteBar key={vote.letter}>
            <VoteLabel>{vote.letter}:</VoteLabel>
            <VoteBarContainer>
              <VoteBarFill
                isTop={index === 0}
                initial={{ width: 0 }}
                animate={{ width: `${vote.percentage}%` }}
                transition={{ duration: 1, delay: index * 0.1 }}
              >
                <Shimmer
                  animate={{ x: ["0%", "200%"] }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity, 
                    repeatDelay: 1,
                    delay: index * 0.2 
                  }}
                />
                <VotePercentage>{vote.percentage}%</VotePercentage>
              </VoteBarFill>
            </VoteBarContainer>
          </VoteBar>
        ))}
      </VotingChart>

      <StatusBar
        status={status}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <StatusText status={status}>
          {statusMessages[status] || "Ready"}
        </StatusText>
      </StatusBar>
    </StatsContainer>
  );
};

export default AudienceStats;