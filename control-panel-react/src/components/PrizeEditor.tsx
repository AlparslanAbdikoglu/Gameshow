import React from 'react';
import styles from './KimbillionaireControlPanel.module.css';

interface PrizeEditorProps {
  prizeAmounts: string[];
  onUpdatePrize: (index: number, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isVisible: boolean;
}

/**
 * Dedicated Prize Editor component with memoization for performance
 * Handles the complex prize amount editing interface
 */
const PrizeEditor: React.FC<PrizeEditorProps> = React.memo(({
  prizeAmounts,
  onUpdatePrize,
  onSave,
  onCancel,
  isVisible
}) => {
  if (!isVisible) return null;

  return (
    <div className={styles.prizeEditor}>
      <h3 style={{color: '#FFD700', marginBottom: '10px'}}>Edit Prize Amounts:</h3>
      <div className={styles.prizeInputGrid}>
        {prizeAmounts.slice().reverse().map((amount, index) => {
          const originalIndex = prizeAmounts.length - 1 - index;
          return (
            <div key={originalIndex} className={styles.prizeInputRow}>
              <span className={styles.prizeNumber}>{originalIndex + 1}.</span>
              <input
                type="text"
                value={amount}
                onChange={(e) => onUpdatePrize(originalIndex, e.target.value)}
                className={styles.prizeInput}
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255, 215, 0, 0.3)',
                  background: '#333',
                  color: 'white',
                  width: '100%'
                }}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.buttonGrid} style={{marginTop: '15px'}}>
        <button className={styles.primaryBtn} onClick={onSave}>
          Save Prizes
        </button>
        <button className={styles.secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
});

PrizeEditor.displayName = 'PrizeEditor';

export default PrizeEditor;