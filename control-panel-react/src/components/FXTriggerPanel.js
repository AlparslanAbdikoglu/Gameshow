import React, { useState } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';

const FXContainer = styled(motion.div)`
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--glass-shadow);
  grid-area: fx;
`;

const FXHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
`;

const FXTitle = styled.h2`
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  color: var(--primary-gold);
  text-transform: uppercase;
  letter-spacing: 2px;
`;

const FXStatus = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: ${props => props.active ? 'var(--success-green)' : 'var(--neutral-gray)'};
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const StatusDot = styled(motion.div)`
  width: 10px;
  height: 10px;
  background: ${props => props.active ? 'var(--success-green)' : 'var(--neutral-gray)'};
  border-radius: var(--radius-circle);
`;

const FXGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
`;

const FXButton = styled(motion.button)`
  background: ${props => {
    switch(props.variant) {
      case 'celebration': return 'linear-gradient(135deg, var(--success-green), #45a049)';
      case 'confetti': return 'linear-gradient(135deg, var(--primary-gold), var(--secondary-gold))';
      case 'timeout': return 'linear-gradient(135deg, var(--danger-red), #d32f2f)';
      case 'dramatic': return 'linear-gradient(135deg, var(--warning-orange), #f57c00)';
      default: return 'linear-gradient(135deg, var(--primary-blue), var(--secondary-blue))';
    }
  }};
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  color: white;
  font-weight: var(--font-bold);
  cursor: pointer;
  font-size: var(--text-base);
  text-transform: uppercase;
  letter-spacing: 1px;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 100px;
  opacity: ${props => props.disabled ? 0.5 : 1};
`;

const FXIcon = styled.div`
  font-size: 32px;
  margin-bottom: var(--spacing-sm);
  filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));
`;

const FXLabel = styled.div`
  font-size: var(--text-sm);
  text-align: center;
  line-height: 1.2;
`;

const FXDescription = styled.div`
  font-size: var(--text-xs);
  opacity: 0.8;
  text-align: center;
  margin-top: var(--spacing-xs);
`;

const QuickActionsRow = styled.div`
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
`;

const QuickAction = styled(motion.button)`
  flex: 1;
  background: linear-gradient(135deg, rgba(30, 60, 114, 0.8), rgba(42, 82, 152, 0.8));
  border: 2px solid var(--primary-gold);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  color: var(--primary-gold);
  font-weight: var(--font-semibold);
  cursor: pointer;
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const EffectPreview = styled(motion.div)`
  background: rgba(0, 0, 0, 0.8);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  text-align: center;
  border: 2px solid ${props => {
    switch(props.type) {
      case 'celebration': return 'var(--success-green)';
      case 'timeout': return 'var(--danger-red)';
      case 'dramatic': return 'var(--warning-orange)';
      default: return 'var(--primary-gold)';
    }
  }};
  position: relative;
  overflow: hidden;
`;

const PreviewIcon = styled(motion.div)`
  font-size: 48px;
  margin-bottom: var(--spacing-md);
`;

const PreviewText = styled.div`
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: ${props => {
    switch(props.type) {
      case 'celebration': return 'var(--success-green)';
      case 'timeout': return 'var(--danger-red)';
      case 'dramatic': return 'var(--warning-orange)';
      default: return 'var(--primary-gold)';
    }
  }};
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const TimerControls = styled.div`
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  background: rgba(0, 0, 0, 0.3);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
`;

const TimerButton = styled(motion.button)`
  background: ${props => props.variant === 'start' ? 'var(--success-green)' : 'var(--danger-red)'};
  border: none;
  border-radius: var(--radius-circle);
  width: 40px;
  height: 40px;
  color: white;
  font-weight: var(--font-bold);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const TimerDisplay = styled.div`
  flex: 1;
  text-align: center;
  font-size: var(--text-xl);
  font-weight: var(--font-black);
  color: var(--primary-gold);
  font-family: 'Courier New', monospace;
`;

const TimerInput = styled.input`
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--primary-gold);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm);
  color: white;
  font-size: var(--text-sm);
  width: 60px;
  text-align: center;
`;

const PulseEffect = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-lg);
  border: 2px solid var(--primary-gold);
  opacity: 0;
`;

const Shimmer = styled(motion.div)`
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  z-index: 1;
`;

const FXTriggerPanel = ({ 
  onTriggerEffect = () => {},
  onStartTimer = () => {},
  onStopTimer = () => {},
  timerActive = false,
  timeRemaining = 30
}) => {
  const [activeEffects, setActiveEffects] = useState(new Set());
  const [showConfetti, setShowConfetti] = useState(false);
  const [previewEffect, setPreviewEffect] = useState(null);
  const [customTimer, setCustomTimer] = useState(30);

  const triggerEffect = async (effectType) => {
    // Add effect to active set
    const newActiveEffects = new Set(activeEffects);
    newActiveEffects.add(effectType);
    setActiveEffects(newActiveEffects);

    // Show preview
    setPreviewEffect(effectType);

    // Handle specific effects
    switch(effectType) {
      case 'confetti':
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 5000);
        break;
      case 'celebration':
        // Trigger celebration sequence
        break;
      case 'timeout':
        // Show timeout effect
        break;
      case 'dramatic':
        // Dramatic pause effect
        break;
      default:
        // Handle unknown effect types
        console.warn('Unknown effect type:', effectType);
        break;
    }

    // Call parent handler
    await onTriggerEffect(effectType);

    // Remove effect from active set after delay
    setTimeout(() => {
      const updatedEffects = new Set(activeEffects);
      updatedEffects.delete(effectType);
      setActiveEffects(updatedEffects);
      setPreviewEffect(null);
    }, 3000);
  };

  const effects = [
    {
      id: 'confetti',
      icon: '🎉',
      label: 'Confetti Burst',
      description: 'Golden confetti celebration',
      variant: 'confetti'
    },
    {
      id: 'celebration',
      icon: '🎊',
      label: 'Winner Celebration',
      description: 'Full winner celebration sequence',
      variant: 'celebration'
    },
    {
      id: 'timeout',
      icon: '⏰',
      label: 'Time Up',
      description: 'Timeout warning effect',
      variant: 'timeout'
    },
    {
      id: 'dramatic',
      icon: '🎭',
      label: 'Dramatic Pause',
      description: 'Tension building effect',
      variant: 'dramatic'
    }
  ];

  const quickActions = [
    { id: 'applause', label: 'Applause', action: () => triggerEffect('applause') },
    { id: 'drumroll', label: 'Drumroll', action: () => triggerEffect('drumroll') },
    { id: 'suspense', label: 'Suspense', action: () => triggerEffect('suspense') }
  ];

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const buttonVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
    hover: { scale: 1.05, y: -2 },
    tap: { scale: 0.95 },
    active: {
      scale: [1, 1.1, 1],
      transition: { duration: 0.3 }
    }
  };

  return (
    <FXContainer
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {showConfetti && (
        <Confetti
          width={1920}
          height={1080}
          numberOfPieces={200}
          colors={['#FFD700', '#FFA500', '#FF6B35', '#F7931E']}
          recycle={false}
          gravity={0.3}
        />
      )}

      <FXHeader>
        <FXTitle>FX Triggers</FXTitle>
        <FXStatus active={activeEffects.size > 0}>
          <StatusDot 
            active={activeEffects.size > 0}
            animate={activeEffects.size > 0 ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 1, repeat: Infinity }}
          />
          {activeEffects.size > 0 ? 'Active' : 'Ready'}
        </FXStatus>
      </FXHeader>

      <FXGrid>
        {effects.map((effect, index) => (
          <FXButton
            key={effect.id}
            variant={effect.variant}
            variants={buttonVariants}
            initial="hidden"
            animate="visible"
            whileHover="hover"
            whileTap="tap"
            transition={{ delay: index * 0.1 }}
            onClick={() => triggerEffect(effect.id)}
            disabled={activeEffects.has(effect.id)}
          >
            {activeEffects.has(effect.id) && (
              <PulseEffect
                animate={{ 
                  opacity: [0, 0.8, 0],
                  scale: [1, 1.1, 1]
                }}
                transition={{ 
                  duration: 1, 
                  repeat: Infinity 
                }}
              />
            )}

            <Shimmer
              animate={{ x: ["0%", "200%"] }}
              transition={{ 
                duration: 3, 
                repeat: Infinity, 
                repeatDelay: 2,
                delay: index * 0.5 
              }}
            />

            <FXIcon>{effect.icon}</FXIcon>
            <FXLabel>{effect.label}</FXLabel>
            <FXDescription>{effect.description}</FXDescription>
          </FXButton>
        ))}
      </FXGrid>

      <QuickActionsRow>
        {quickActions.map((action, index) => (
          <QuickAction
            key={action.id}
            variants={buttonVariants}
            whileHover="hover"
            whileTap="tap"
            onClick={action.action}
          >
            {action.label}
          </QuickAction>
        ))}
      </QuickActionsRow>

      <TimerControls>
        <TimerInput
          type="number"
          value={customTimer}
          onChange={(e) => setCustomTimer(parseInt(e.target.value) || 30)}
          min="1"
          max="300"
        />
        <TimerButton
          variant="start"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => onStartTimer(customTimer)}
          disabled={timerActive}
        >
          ▶
        </TimerButton>
        <TimerDisplay>
          {formatTime(timeRemaining)}
        </TimerDisplay>
        <TimerButton
          variant="stop"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onStopTimer}
          disabled={!timerActive}
        >
          ⏹
        </TimerButton>
      </TimerControls>

      <AnimatePresence>
        {previewEffect && (
          <EffectPreview
            type={previewEffect}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.3 }}
          >
            <PreviewIcon
              animate={{ 
                rotate: [0, 10, -10, 0],
                scale: [1, 1.1, 1]
              }}
              transition={{ duration: 0.5, repeat: 2 }}
            >
              {effects.find(e => e.id === previewEffect)?.icon}
            </PreviewIcon>
            <PreviewText type={previewEffect}>
              {effects.find(e => e.id === previewEffect)?.label} Active!
            </PreviewText>
          </EffectPreview>
        )}
      </AnimatePresence>
    </FXContainer>
  );
};

export default FXTriggerPanel;