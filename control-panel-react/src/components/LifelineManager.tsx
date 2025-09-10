import React from 'react';
import lifelineStyles from './LifelineManager.module.css';

interface LifelineState {
  used: boolean;
  active: boolean;
}

interface LifelinesData {
  fiftyFifty: LifelineState;
  takeAnotherVote: LifelineState;
  askAMod: LifelineState;
  [key: string]: LifelineState;
}

interface LifelineManagerProps {
  lifelines?: LifelinesData;
  onUseLifeline?: (lifelineType: 'fiftyFifty' | 'takeAnotherVote' | 'askAMod') => Promise<any>;
  onResetLifelines?: () => void;
}

const LifelineManager: React.FC<LifelineManagerProps> = ({ 
  lifelines = {
    fiftyFifty: { used: false, active: false },
    takeAnotherVote: { used: false, active: false },
    askAMod: { used: false, active: false }
  },
  onUseLifeline = (lifelineType: 'fiftyFifty' | 'takeAnotherVote' | 'askAMod') => Promise.resolve(),
  onResetLifelines = () => {}
}) => {
  // Removed showResult state - no popups needed

  const lifelineData = {
    fiftyFifty: {
      icon: "⚡",
      name: "⚡ 50:50",
      description: "Remove two incorrect answers, leaving one correct and one incorrect answer.",
      action: "Remove Wrong Answers"
    },
    takeAnotherVote: {
      icon: "🗳️",
      name: "Take Another Vote",
      description: "Start a second voting round excluding the first choice, giving a 1-in-3 chance.",
      action: "Start Revote"
    },
    askAMod: {
      icon: "🛡️",
      name: "Ask a Mod",
      description: "Ask the moderators for help and guidance on the current question.",
      action: "Ask Mods"
    }
  };

  const handleUseLifeline = async (lifelineType: keyof LifelinesData) => {
    if (lifelines[lifelineType]?.used) return;

    try {
      if (lifelineType === 'takeAnotherVote') {
        // Call the Take Another Vote lifeline API
        console.log('🗳️ Activating Take Another Vote lifeline...');
        
        const response = await fetch('http://localhost:8081/api/control', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'use_lifeline_take_another_vote'
          })
        });
        
        if (response.ok) {
          console.log('✅ Take Another Vote lifeline activated - revote started!');
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to activate Take Another Vote lifeline');
        }
      } else {
        // Handle other lifelines normally - cast to the expected type
        try {
          await onUseLifeline(lifelineType as 'fiftyFifty' | 'takeAnotherVote' | 'askAMod');
        } catch (lifelineError) {
          // If the onUseLifeline callback throws an error, it might be a server error
          if (lifelineError instanceof Error && lifelineError.message && lifelineError.message.includes('already been used')) {
            throw lifelineError; // Re-throw with the specific server message
          } else {
            throw new Error(`Failed to activate ${(lifelineData as any)[lifelineType]?.name || lifelineType} lifeline`);
          }
        }
      }
      
      // Console log only - no popup modal needed
      console.log(`✅ ${(lifelineData as any)[lifelineType]?.name} lifeline activated successfully`);
      
      // No modal display - lifeline effects are visible in the main gameshow
      
    } catch (error) {
      console.error('❌ Error using lifeline:', error);
      
      // Log error to console only - no popup needed
      const errorMessage = error instanceof Error ? error.message : 'Error activating lifeline. Please check console and try again.';
      console.error(`❌ Lifeline error: ${errorMessage}`);
      
      // No modal display for errors - errors are logged to console
    }
  };

  const getStatusText = (lifeline: LifelineState) => {
    if (lifeline.used) return 'Used';
    if (lifeline.active) return 'Active';
    return 'Available';
  };

  const getStatusColor = (lifeline: LifelineState) => {
    if (lifeline.used) return 'used';
    if (lifeline.active) return 'active';
    return 'available';
  };

  return (
    <div className={lifelineStyles.lifelinesContainer}>
      <div className={lifelineStyles.lifelinesHeader}>
        <h3 className={lifelineStyles.lifelinesTitle}>
          Lifelines
        </h3>
        <button
          className={lifelineStyles.resetButton}
          onClick={onResetLifelines}
        >
          Reset All
        </button>
      </div>

      <div className={lifelineStyles.lifelinesGrid}>
        {Object.entries(lifelineData).map(([key, data], index) => {
          const lifeline = lifelines[key as keyof LifelinesData] || { used: false, active: false };
          
          return (
            <div
              key={key}
              className={`${lifelineStyles.lifelineCard} ${lifeline.used ? lifelineStyles.used : ''}`}
              onClick={() => handleUseLifeline(key as keyof LifelinesData)}
              style={{ '--shimmer-delay': index * 0.5 } as any}
            >
              <div 
                className={`${lifelineStyles.statusIndicator} ${lifelineStyles[getStatusColor(lifeline)]}`}
              />
              
              {!lifeline.used && (
                <div className={lifelineStyles.shimmer} />
              )}

              {lifeline.active && (
                <div className={lifelineStyles.pulseEffect} />
              )}

              <div className={lifelineStyles.lifelineIcon}>{data.icon}</div>
              <h4 className={`${lifelineStyles.lifelineName} ${lifeline.used ? lifelineStyles.used : ''}`}>
                {data.name}
              </h4>
              <p className={`${lifelineStyles.lifelineDescription} ${lifeline.used ? lifelineStyles.used : ''}`}>
                {data.description}
              </p>
              <div className={`${lifelineStyles.lifelineStatus} ${lifelineStyles[getStatusColor(lifeline)]}`}>
                {getStatusText(lifeline)}
              </div>
              
              <button
                className={`${lifelineStyles.useButton} ${lifeline.used ? lifelineStyles.used : ''}`}
                disabled={lifeline.used}
              >
                {lifeline.used ? 'Used' : data.action}
              </button>
            </div>
          );
        })}
      </div>

      {/* Removed result modal - no popups needed */}
    </div>
  );
};

export default LifelineManager;