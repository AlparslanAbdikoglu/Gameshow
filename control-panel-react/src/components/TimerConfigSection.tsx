import React, { useState, useEffect, useCallback } from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';

interface TimerConfig {
  audience_poll_duration: number;
  audience_poll_duration_seconds: number;
  revote_duration: number;
  revote_duration_seconds: number;
  ask_a_mod_duration: number;
  ask_a_mod_duration_seconds: number;
  lifeline_voting_duration?: number;
  lifeline_voting_duration_seconds?: number;
}

interface TimerConfigSectionProps {
  disabled?: boolean;
}

const TimerConfigSection: React.FC<TimerConfigSectionProps> = ({ disabled = false }) => {
  const [timerConfig, setTimerConfig] = useState<TimerConfig | null>(null);
  const [initializedConfig] = useState<TimerConfig>({
    audience_poll_duration: 60000,
    audience_poll_duration_seconds: 60,
    revote_duration: 45000,
    revote_duration_seconds: 45,
    ask_a_mod_duration: 30000,
    ask_a_mod_duration_seconds: 30,
    lifeline_voting_duration: 30000,
    lifeline_voting_duration_seconds: 30
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localNormalDuration, setLocalNormalDuration] = useState(60);
  const [localRevoteDuration, setLocalRevoteDuration] = useState(45);
  const [localAskAModDuration, setLocalAskAModDuration] = useState(30);
  const [localLifelineVotingDuration, setLocalLifelineVotingDuration] = useState(30);
  const [selectedTimerType, setSelectedTimerType] = useState<'normal' | 'revote' | 'askmod' | 'lifeline'>('normal');

  const API_BASE = 'http://localhost:8081';

  // Helper function to get current value and range based on selected timer type
  const getTimerTypeInfo = useCallback((): {
    value: number;
    setValue: (value: number) => void;
    min: number;
    max: number;
    presets: number[];
    label: string;
    description: string;
    color: string;
    bgColor: string;
    borderColor: string;
    currentServerValue: number;
  } => {
    switch (selectedTimerType) {
      case 'normal':
        return {
          value: localNormalDuration,
          setValue: setLocalNormalDuration,
          min: 15,
          max: 300,
          presets: [30, 45, 60, 90, 120],
          label: '🗳️ Normal Votes (Round Start)',
          description: 'Initial voting period at the start of each round',
          color: '#3b82f6',
          bgColor: 'rgba(59, 130, 246, 0.1)',
          borderColor: 'rgba(59, 130, 246, 0.3)',
          currentServerValue: safeConfig.audience_poll_duration_seconds || 60
        };
      case 'revote':
        return {
          value: localRevoteDuration,
          setValue: setLocalRevoteDuration,
          min: 10,
          max: 180,
          presets: [20, 30, 45, 60, 90],
          label: '🔄 Revote (Lifeline Triggered)',
          description: 'Voting period after lifeline is used',
          color: '#f59e0b',
          bgColor: 'rgba(245, 158, 11, 0.1)',
          borderColor: 'rgba(245, 158, 11, 0.3)',
          currentServerValue: safeConfig.revote_duration_seconds || 45
        };
      case 'askmod':
        return {
          value: localAskAModDuration,
          setValue: setLocalAskAModDuration,
          min: 10,
          max: 120,
          presets: [15, 20, 30, 45, 60],
          label: '🛡️ Ask a Mod (Chat Display)',
          description: 'Time to display mod responses before revote',
          color: '#8b4513',
          bgColor: 'rgba(139, 69, 19, 0.1)',
          borderColor: 'rgba(139, 69, 19, 0.3)',
          currentServerValue: safeConfig.ask_a_mod_duration_seconds || 30
        };
      case 'lifeline':
        return {
          value: localLifelineVotingDuration,
          setValue: setLocalLifelineVotingDuration,
          min: 10,
          max: 120,
          presets: [15, 20, 30, 45, 60],
          label: '💡 Lifeline Voting',
          description: 'Time for choosing lifelines (1, 2, 3) after wrong answer',
          color: '#9333ea',
          bgColor: 'rgba(147, 51, 234, 0.1)',
          borderColor: 'rgba(147, 51, 234, 0.3)',
          currentServerValue: safeConfig.lifeline_voting_duration_seconds || 30
        };
      default:
        return getTimerTypeInfo();
    }
  }, [selectedTimerType, localNormalDuration, localRevoteDuration, localAskAModDuration, localLifelineVotingDuration, timerConfig, initializedConfig]);

  // Load current timer configuration
  const loadTimerConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/api/timer-config`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const config = await response.json();
      setTimerConfig(config);
      setLocalNormalDuration(config.audience_poll_duration_seconds || 60);
      setLocalRevoteDuration(config.revote_duration_seconds || 45);
      setLocalAskAModDuration(config.ask_a_mod_duration_seconds || 30);
      setLocalLifelineVotingDuration(config.lifeline_voting_duration_seconds || 30);
      console.log('✅ Timer configuration loaded:', config);
    } catch (error) {
      console.error('❌ Failed to load timer configuration:', error);
      setError('Failed to load timer configuration. Check server connection.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save timer configuration for selected type only
  const saveTimerConfig = useCallback(async () => {
    if (isSaving || disabled) return;
    
    const timerInfo = getTimerTypeInfo();
    
    // Validate current timer type input
    if (timerInfo.value < timerInfo.min || timerInfo.value > timerInfo.max) {
      setError(`${timerInfo.label.replace(/🗳️|🔄|🛡️/g, '').trim()} duration must be between ${timerInfo.min} and ${timerInfo.max} seconds`);
      return;
    }
    
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Create update object based on selected timer type
      const updateData: any = {};
      switch (selectedTimerType) {
        case 'normal':
          updateData.audience_poll_duration_seconds = localNormalDuration;
          break;
        case 'revote':
          updateData.revote_duration_seconds = localRevoteDuration;
          break;
        case 'askmod':
          updateData.ask_a_mod_duration_seconds = localAskAModDuration;
          break;
        case 'lifeline':
          updateData.lifeline_voting_duration_seconds = localLifelineVotingDuration;
          break;
      }
      
      const response = await fetch(`${API_BASE}/api/timer-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      setTimerConfig(result.config);
      setSuccess(`${timerInfo.label} timer updated successfully`);
      console.log('✅ Timer configuration saved successfully:', result);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
      
    } catch (error) {
      console.error('❌ Failed to save timer configuration:', error);
      setError(error instanceof Error ? error.message : 'Failed to save timer configuration');
    } finally {
      setIsSaving(false);
    }
  }, [selectedTimerType, localNormalDuration, localRevoteDuration, localAskAModDuration, localLifelineVotingDuration, isSaving, disabled, getTimerTypeInfo]);

  // Load configuration on mount
  useEffect(() => {
    loadTimerConfig();
  }, [loadTimerConfig]);

  // Handle input changes for currently selected timer type
  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timerInfo = getTimerTypeInfo();
    const value = parseInt(e.target.value) || timerInfo.min;
    const clampedValue = Math.max(timerInfo.min, Math.min(timerInfo.max, value));
    
    timerInfo.setValue(clampedValue);
    setError(null);
    setSuccess(null);
  };

  // Handle enter key
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveTimerConfig();
    }
  };

  // Quick preset button handler for currently selected timer type
  const setPreset = (seconds: number) => {
    const timerInfo = getTimerTypeInfo();
    timerInfo.setValue(seconds);
    setError(null);
    setSuccess(null);
  };

  // Safe config access with fallbacks
  const safeConfig = timerConfig || initializedConfig;
  
  // Get current timer info
  const currentTimerInfo = getTimerTypeInfo();
  
  const hasChanges = currentTimerInfo.value !== currentTimerInfo.currentServerValue;
  
  const isValidDuration = 
    currentTimerInfo.value >= currentTimerInfo.min && 
    currentTimerInfo.value <= currentTimerInfo.max;

  return (
    <GlassPanel title="⏱️ Timer Configuration">
      {/* Loading State */}
      {isLoading && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{fontSize: '18px'}}>⏳</span>
          <span style={{color: '#3b82f6', fontWeight: 'bold'}}>
            Loading timer configuration...
          </span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{fontSize: '18px'}}>❌</span>
          <div>
            <div style={{color: '#ef4444', fontWeight: 'bold', marginBottom: '4px'}}>
              Configuration Error
            </div>
            <div style={{color: '#fca5a5', fontSize: '14px'}}>
              {error}
            </div>
          </div>
        </div>
      )}

      {/* Success State */}
      {success && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{fontSize: '18px'}}>✅</span>
          <span style={{color: '#10b981', fontWeight: 'bold'}}>
            {success}
          </span>
        </div>
      )}

      {/* Timer Type Dropdown */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ 
          display: 'block', 
          color: '#FFD700', 
          fontSize: '16px', 
          fontWeight: 'bold', 
          marginBottom: '8px' 
        }}>
          🎮 Select Timer Type to Configure
        </label>
        <select
          value={selectedTimerType}
          onChange={(e) => setSelectedTimerType(e.target.value as 'normal' | 'revote' | 'askmod' | 'lifeline')}
          disabled={disabled || isSaving}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '14px',
            borderRadius: '8px',
            border: '2px solid rgba(255, 215, 0, 0.4)',
            background: disabled || isSaving ? '#444' : '#333',
            color: 'white',
            cursor: disabled || isSaving ? 'not-allowed' : 'pointer'
          }}
        >
          <option value="normal">🗳️ Normal Votes (Round Start) - {safeConfig.audience_poll_duration_seconds || 60}s</option>
          <option value="revote">🔄 Revote (Lifeline Triggered) - {safeConfig.revote_duration_seconds || 45}s</option>
          <option value="askmod">🛡️ Ask a Mod (Chat Display) - {safeConfig.ask_a_mod_duration_seconds || 30}s</option>
          <option value="lifeline">💡 Lifeline Voting (Wrong Answer) - {safeConfig.lifeline_voting_duration_seconds || 30}s</option>
        </select>
      </div>

      {/* Current Timer Configuration */}
      <div style={{
        background: currentTimerInfo.bgColor,
        border: `1px solid ${currentTimerInfo.borderColor}`,
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <h4 style={{color: currentTimerInfo.color, margin: '0 0 8px 0', fontSize: '16px', fontWeight: 'bold'}}>
          {currentTimerInfo.label}
        </h4>
        <p style={{fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)', margin: '0 0 16px 0'}}>
          {currentTimerInfo.description}
        </p>

        {/* Current Status */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '6px',
          padding: '10px',
          marginBottom: '16px',
          fontSize: '14px'
        }}>
          <div style={{color: '#fff', marginBottom: '4px'}}>
            <strong>Server Value:</strong> {currentTimerInfo.currentServerValue} seconds ({(currentTimerInfo.currentServerValue / 60).toFixed(1)} min)
          </div>
          <div style={{color: '#fff', marginBottom: '4px'}}>
            <strong>Local Value:</strong> {currentTimerInfo.value} seconds ({(currentTimerInfo.value / 60).toFixed(1)} min)
          </div>
          <div>
            <strong>Status:</strong> {hasChanges ? 
              <span style={{color: '#fbbf24'}}>⚠️ Unsaved changes</span> : 
              <span style={{color: '#10b981'}}>✅ Synchronized</span>
            }
          </div>
        </div>

        {/* Timer Input */}
        <input
          type="number"
          min={currentTimerInfo.min}
          max={currentTimerInfo.max}
          value={currentTimerInfo.value}
          onChange={handleDurationChange}
          onKeyPress={handleKeyPress}
          disabled={disabled || isSaving}
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: '14px',
            borderRadius: '8px',
            border: `2px solid ${currentTimerInfo.borderColor}`,
            background: disabled || isSaving ? '#444' : '#333',
            color: 'white',
            marginBottom: '10px'
          }}
          placeholder={`${currentTimerInfo.min}-${currentTimerInfo.max} seconds`}
        />
        
        {/* Range Information */}
        <div style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '10px'}}>
          Range: {currentTimerInfo.min}-{currentTimerInfo.max}s • Current: {currentTimerInfo.value}s ({(currentTimerInfo.value / 60).toFixed(1)} min)
        </div>

        {/* Preset Buttons */}
        <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
          {currentTimerInfo.presets.map(seconds => (
            <button
              key={seconds}
              onClick={() => setPreset(seconds)}
              disabled={disabled || isSaving}
              className={currentTimerInfo.value === seconds ? styles.primaryBtn : styles.secondaryBtn}
              style={{
                padding: '6px 10px',
                fontSize: '11px',
                opacity: disabled || isSaving ? 0.5 : 1
              }}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className={styles.buttonGrid}>
        <button
          className={`${styles.primaryBtn} ${hasChanges && isValidDuration ? styles.glowingBtn : ''}`}
          onClick={saveTimerConfig}
          disabled={!hasChanges || !isValidDuration || disabled || isSaving}
          style={{
            opacity: (!hasChanges || !isValidDuration || disabled || isSaving) ? 0.5 : 1,
            cursor: (!hasChanges || !isValidDuration || disabled || isSaving) ? 'not-allowed' : 'pointer'
          }}
          title={
            !isValidDuration ? `Duration must be between ${currentTimerInfo.min}-${currentTimerInfo.max} seconds` :
            !hasChanges ? 'No changes to save' :
            disabled ? 'Timer configuration disabled' :
            isSaving ? 'Saving configuration...' :
            'Save timer configuration'
          }
        >
          {isSaving ? '💾 Saving...' : hasChanges ? '💾 Save Changes' : '✅ Saved'}
        </button>
        
        <button
          className={styles.secondaryBtn}
          onClick={loadTimerConfig}
          disabled={disabled || isLoading || isSaving}
          style={{
            opacity: (disabled || isLoading || isSaving) ? 0.5 : 1,
            cursor: (disabled || isLoading || isSaving) ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? '⏳ Loading...' : '🔄 Reload'}
        </button>
      </div>

      {/* System Information */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '6px',
        padding: '12px 15px',
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.7)',
        marginTop: '16px'
      }}>
        <div><strong>API Endpoint:</strong> {API_BASE}/api/timer-config</div>
        <div><strong>Current Type:</strong> {currentTimerInfo.label}</div>
        <div><strong>Valid Range:</strong> {currentTimerInfo.min}-{currentTimerInfo.max} seconds</div>
        <div><strong>Description:</strong> {currentTimerInfo.description}</div>
      </div>
    </GlassPanel>
  );
};

export default TimerConfigSection;