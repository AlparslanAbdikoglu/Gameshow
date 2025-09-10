import React, { useState, useEffect } from 'react';
import type { ProducerPreviewProps } from '../types/gameTypes';
import styles from './ProducerPreview.module.css';

const ProducerPreview: React.FC<ProducerPreviewProps> = ({
  gameState,
  isVisible,
  onToggle
}) => {
  // Removed unused previewContent state for cleaner code

  useEffect(() => {
    // The iframe handles live updates automatically via WebSocket
    // No need for manual fetching since the audience view updates in real-time
    if (isVisible) {
      console.log('📺 Producer preview opened - showing live audience view');
    }
  }, [isVisible, gameState]);

  if (!isVisible) return null;

  return (
    <div className={styles.previewContainer}>
      <div className={styles.previewHeader}>
        <h3>🎥 Live Preview (Audience View)</h3>
        <button onClick={onToggle} className={styles.closeBtn}>✕</button>
      </div>
      
      <div className={styles.previewFrame}>
        <iframe
          src="http://localhost:8081/gameshow"
          title="Live Preview"
          width="960"
          height="540"
          style={{
            border: '2px solid #FFD700',
            borderRadius: '8px',
            transform: 'scale(0.5)',
            transformOrigin: 'top left'
          }}
        />
      </div>
      
      <div className={styles.previewStatus}>
        <span className={styles.liveIndicator}>🔴 LIVE</span>
        <span>Question {gameState.current_question + 1}/15</span>
        <span>State: {gameState.game_active ? 'Active' : 'Stopped'}</span>
      </div>
    </div>
  );
};

export default React.memo(ProducerPreview);