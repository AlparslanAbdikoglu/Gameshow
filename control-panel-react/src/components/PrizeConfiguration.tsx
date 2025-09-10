import React, { useState, useEffect } from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';
import { API_BASE_URL } from '../config';

interface PrizeConfig {
  enabled: boolean;
  topWinnersCount: number;
  prizeName: string;
  prizeAmount: number;
  customMessage: string;
  winnersAnnounced: boolean;
}

interface PrizeConfigurationProps {
  disabled?: boolean;
}

const PrizeConfiguration: React.FC<PrizeConfigurationProps> = ({ disabled = false }) => {
  const [prizeConfig, setPrizeConfig] = useState<PrizeConfig>({
    enabled: true,
    topWinnersCount: 10,
    prizeName: 'Channel Points',
    prizeAmount: 1000,
    customMessage: 'Congratulations to our top 10 winners! Make sure to enter your UIDs in the Kimba.tv Dashboard!',
    winnersAnnounced: false
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Load prize configuration on mount
  useEffect(() => {
    fetchPrizeConfig();
  }, []);

  const fetchPrizeConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/prize-config`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          setPrizeConfig(data.config);
        }
      }
    } catch (error) {
      console.error('Error fetching prize config:', error);
    }
  };

  const savePrizeConfig = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/prize-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prizeConfig)
      });
      
      if (response.ok) {
        setSaveStatus('✅ Prize configuration saved!');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('❌ Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving prize config:', error);
      setSaveStatus('❌ Error saving configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (field: keyof PrizeConfig, value: any) => {
    setPrizeConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetWinners = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/reset-winners`, {
        method: 'POST'
      });
      
      if (response.ok) {
        setPrizeConfig(prev => ({ ...prev, winnersAnnounced: false }));
        setSaveStatus('✅ Winners reset successfully');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (error) {
      console.error('Error resetting winners:', error);
    }
  };

  return (
    <GlassPanel title="🏆 Prize Configuration" className={styles.prizeConfigSection}>
      <div className={styles.prizeConfigContent}>
        {/* Enable/Disable Prizes */}
        <div className={styles.configRow}>
          <label className={styles.configLabel}>
            <input
              type="checkbox"
              checked={prizeConfig.enabled}
              onChange={(e) => handleInputChange('enabled', e.target.checked)}
              disabled={disabled}
            />
            <span style={{ marginLeft: '8px' }}>Enable End-Game Prizes</span>
          </label>
        </div>

        {/* Number of Winners */}
        <div className={styles.configRow}>
          <label className={styles.configLabel}>
            Top Winners Count:
            <input
              type="number"
              min="1"
              max="50"
              value={prizeConfig.topWinnersCount}
              onChange={(e) => handleInputChange('topWinnersCount', parseInt(e.target.value) || 10)}
              disabled={disabled || !prizeConfig.enabled}
              className={styles.prizeInput}
            />
          </label>
        </div>

        {/* Prize Name */}
        <div className={styles.configRow}>
          <label className={styles.configLabel}>
            Prize Name:
            <input
              type="text"
              value={prizeConfig.prizeName}
              onChange={(e) => handleInputChange('prizeName', e.target.value)}
              disabled={disabled || !prizeConfig.enabled}
              placeholder="e.g., Channel Points, Gift Sub, etc."
              className={styles.prizeInput}
            />
          </label>
        </div>

        {/* Custom Message */}
        <div className={styles.configRow}>
          <label className={styles.configLabel}>
            Winner Message:
            <textarea
              value={prizeConfig.customMessage}
              onChange={(e) => handleInputChange('customMessage', e.target.value)}
              disabled={disabled || !prizeConfig.enabled}
              placeholder="Message to display to winners..."
              className={styles.prizeTextarea}
              rows={3}
            />
          </label>
        </div>

        {/* Preview */}
        {prizeConfig.enabled && (
          <div className={styles.prizePreview}>
            <h4>Preview:</h4>
            <div className={styles.previewBox}>
              <p>{prizeConfig.customMessage}</p>
              <p>🏆 Top {prizeConfig.topWinnersCount} players win: {prizeConfig.prizeName}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className={styles.prizeActions}>
          <button
            onClick={savePrizeConfig}
            disabled={disabled || isSaving}
            className={`${styles.primaryBtn} ${styles.saveBtn}`}
          >
            {isSaving ? 'Saving...' : '💾 Save Configuration'}
          </button>
          
          {prizeConfig.winnersAnnounced && (
            <button
              onClick={resetWinners}
              disabled={disabled}
              className={`${styles.dangerBtn} ${styles.resetBtn}`}
            >
              🔄 Reset Winners
            </button>
          )}
        </div>

        {/* Status Message */}
        {saveStatus && (
          <div className={styles.statusMessage}>
            {saveStatus}
          </div>
        )}

        {/* Winners Status */}
        {prizeConfig.winnersAnnounced && (
          <div className={styles.winnersStatus}>
            ✅ Winners have been announced for this game
          </div>
        )}
      </div>
    </GlassPanel>
  );
};

export default PrizeConfiguration;