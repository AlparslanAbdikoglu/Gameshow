/**
 * 🎬 Animation Control Panel for Kimbillionaire
 * Professional broadcast animation controls
 */

import React, { useState, useEffect } from 'react';
import GlassPanel from './GlassPanel';
import { animationAPI, AnimationConfig, defaultAnimationConfig } from '../utils/animationUtils';
import { gameApi } from '../utils/api';
import styles from './KimbillionaireControlPanel.module.css';

interface AnimationControlPanelProps {
  isVisible: boolean;
  onClose: () => void;
  gameActive?: boolean;
  disabled?: boolean;
}

const AnimationControlPanel: React.FC<AnimationControlPanelProps> = ({ isVisible, onClose }) => {
  const [config, setConfig] = useState<AnimationConfig>(defaultAnimationConfig);
  const [isTestMode, setIsTestMode] = useState(false);
  const [lastAnimation, setLastAnimation] = useState<string>('');

  useEffect(() => {
    // Load saved config from localStorage
    const savedConfig = localStorage.getItem('kimbillionaire-animation-config');
    if (savedConfig) {
      try {
        const parsedConfig = JSON.parse(savedConfig);
        setConfig(parsedConfig);
        animationAPI.updateConfig(parsedConfig);
      } catch (e) {
        console.warn('Failed to load animation config:', e);
      }
    }
  }, []);

  const updateConfig = async (newConfig: Partial<AnimationConfig>) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);
    
    // Update local animation system
    animationAPI.updateConfig(updatedConfig);
    
    // Update server animation system
    try {
      await gameApi.updateAnimationConfig(updatedConfig);
    } catch (error) {
      console.error('Failed to update server animation config:', error);
    }
    
    // Save to localStorage
    localStorage.setItem('kimbillionaire-animation-config', JSON.stringify(updatedConfig));
  };

  const testAnimation = async (animationType: string, animationFn: () => Promise<void>) => {
    if (isTestMode) return;
    
    setIsTestMode(true);
    setLastAnimation(animationType);
    
    try {
      await animationFn();
    } catch (error) {
      console.error(`Animation test failed for ${animationType}:`, error);
    } finally {
      setTimeout(() => {
        setIsTestMode(false);
        setLastAnimation('');
      }, 1000);
    }
  };

  const createTestElements = () => {
    // Create test question element
    const testQuestion = document.createElement('div');
    testQuestion.className = 'question-panel';
    testQuestion.style.cssText = `
      position: fixed;
      top: 20%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 2em;
      color: #FFD700;
      z-index: 10000;
      text-align: center;
      max-width: 80%;
    `;
    document.body.appendChild(testQuestion);

    // Create test answers
    const testAnswers = [];
    for (let i = 0; i < 4; i++) {
      const answer = document.createElement('div');
      answer.style.cssText = `
        position: fixed;
        top: ${40 + i * 8}%;
        left: ${25 + (i % 2) * 50}%;
        transform: translateX(-50%);
        font-size: 1.5em;
        color: white;
        background: rgba(0, 43, 92, 0.8);
        padding: 15px 30px;
        border-radius: 10px;
        border: 2px solid rgba(255, 215, 0, 0.3);
        z-index: 10000;
        min-width: 300px;
        text-align: center;
      `;
      answer.textContent = `${['A', 'B', 'C', 'D'][i]}: Test Answer ${i + 1}`;
      document.body.appendChild(answer);
      testAnswers.push(answer);
    }

    return { testQuestion, testAnswers };
  };

  const cleanupTestElements = () => {
    // Clean up any test elements
    document.querySelectorAll('[style*="z-index: 10000"]').forEach(el => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
  };

  if (!isVisible) return null;

  return (
    <div className={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modalContent} style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
        <GlassPanel title="🎬 Animation Control Center">
          
          {/* Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <span style={{ color: '#FFD700', fontWeight: 'bold' }}>Animation System</span>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: config.enabled ? '#4CAF50' : '#FF6B35',
                boxShadow: `0 0 10px ${config.enabled ? '#4CAF50' : '#FF6B35'}`
              }}></div>
              <span style={{ color: config.enabled ? '#4CAF50' : '#FF6B35', fontSize: '14px' }}>
                {config.enabled ? 'ACTIVE' : 'DISABLED'}
              </span>
            </div>
            <button 
              className={styles.secondaryBtn}
              onClick={onClose}
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              ✕ Close
            </button>
          </div>

          {/* Master Controls */}
          <div className={styles.controlSection} style={{ marginBottom: '25px' }}>
            <h3 style={{ color: '#FFD700', marginBottom: '15px' }}>Master Controls</h3>
            <div className={styles.buttonGrid}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px', 
                color: 'white',
                cursor: 'pointer',
                padding: '12px',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 215, 0, 0.3)'
              }}>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => updateConfig({ enabled: e.target.checked })}
                  style={{ transform: 'scale(1.2)' }}
                />
                <span>Enable Animations</span>
              </label>
              
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px', 
                color: 'white',
                cursor: 'pointer',
                padding: '12px',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 215, 0, 0.3)'
              }}>
                <input
                  type="checkbox"
                  checked={config.soundEnabled}
                  onChange={(e) => updateConfig({ soundEnabled: e.target.checked })}
                  style={{ transform: 'scale(1.2)' }}
                />
                <span>Enable Sound Effects</span>
              </label>
            </div>

            {/* Animation Speed Control */}
            <div style={{ marginTop: '15px' }}>
              <label style={{ color: '#FFD700', display: 'block', marginBottom: '8px' }}>
                Animation Speed: {Math.round(config.speed * 100)}%
              </label>
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.25"
                value={config.speed}
                onChange={(e) => updateConfig({ speed: parseFloat(e.target.value) })}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: `linear-gradient(to right, #FFD700 0%, #FFD700 ${config.speed * 50}%, rgba(255, 215, 0, 0.3) ${config.speed * 50}%, rgba(255, 215, 0, 0.3) 100%)`,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginTop: '5px' }}>
                <span>25%</span>
                <span>50%</span>
                <span>100%</span>
                <span>150%</span>
                <span>200%</span>
              </div>
            </div>

            {/* Performance Mode */}
            <div style={{ marginTop: '15px' }}>
              <label style={{ color: '#FFD700', display: 'block', marginBottom: '8px' }}>
                Performance Mode:
              </label>
              <select
                value={config.performance}
                onChange={(e) => updateConfig({ performance: e.target.value as 'high' | 'medium' | 'low' })}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 215, 0, 0.3)',
                  backgroundColor: '#333',
                  color: 'white',
                  fontSize: '14px'
                }}
              >
                <option value="high">High Quality (Best visuals)</option>
                <option value="medium">Medium Quality (Balanced)</option>
                <option value="low">Low Quality (Performance first)</option>
              </select>
            </div>
          </div>

          {/* Test Animation Controls */}
          <div className={styles.controlSection} style={{ marginBottom: '25px' }}>
            <h3 style={{ color: '#FFD700', marginBottom: '15px' }}>Test Animations</h3>
            <p style={{ color: '#ccc', fontSize: '14px', marginBottom: '15px' }}>
              Click any button to test the animation independently. 
              {lastAnimation && <span style={{ color: '#4CAF50' }}> Last tested: {lastAnimation}</span>}
            </p>
            
            <div className={styles.buttonGrid}>
              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Curtain Open', animationAPI.curtainOpen)}
              >
                🎭 Test Curtain Open
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Typewriter', async () => {
                  const { testQuestion } = createTestElements();
                  await animationAPI.typeQuestion(testQuestion, 'This is a test question with typewriter effect!');
                  setTimeout(cleanupTestElements, 3000);
                })}
              >
                ⌨️ Test Typewriter
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Answer Reveals', async () => {
                  const { testAnswers } = createTestElements();
                  await animationAPI.revealAnswers(testAnswers);
                  setTimeout(cleanupTestElements, 5000);
                })}
              >
                📝 Test Answer Reveals
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Lock-in Drama', async () => {
                  const { testAnswers } = createTestElements();
                  await animationAPI.lockInDrama(testAnswers[1]); // Test with answer B
                  setTimeout(cleanupTestElements, 3000);
                })}
              >
                🎭 Test Lock-in Drama
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Celebration', animationAPI.celebrate)}
              >
                🎉 Test Celebration
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Wrong Answer', animationAPI.wrongAnswer)}
              >
                😞 Test Wrong Answer
              </button>

              <button
                className={`${styles.secondaryBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode || !config.enabled}
                onClick={() => testAnimation('Slide Transition', async () => {
                  const { testQuestion } = createTestElements();
                  testQuestion.className = 'question-panel'; // Ensure proper class
                  await animationAPI.slideNext();
                  setTimeout(cleanupTestElements, 4000);
                })}
              >
                🔄 Test Slide Transition
              </button>

              <button
                className={`${styles.dangerBtn} ${isTestMode ? styles.disabledBtn : ''}`}
                disabled={isTestMode}
                onClick={() => {
                  animationAPI.stopAll();
                  cleanupTestElements();
                  setLastAnimation('Emergency Stop');
                }}
              >
                🛑 Emergency Stop
              </button>
            </div>
          </div>

          {/* Manual Trigger Controls */}
          <div className={styles.controlSection} style={{ marginBottom: '25px' }}>
            <h3 style={{ color: '#FFD700', marginBottom: '15px' }}>Manual Triggers</h3>
            <p style={{ color: '#ccc', fontSize: '14px', marginBottom: '15px' }}>
              Use these controls during the live show to manually trigger effects.
            </p>
            
            <div className={styles.buttonGrid}>
              <button
                className={`${styles.primaryBtn} ${!config.enabled ? styles.disabledBtn : ''}`}
                disabled={!config.enabled}
                onClick={() => gameApi.triggerAnimation('curtain_open')}
              >
                🎭 Force Curtain Open
              </button>

              <button
                className={`${styles.primaryBtn} ${!config.enabled ? styles.disabledBtn : ''}`}
                disabled={!config.enabled}
                onClick={() => gameApi.triggerAnimation('celebration')}
              >
                🎉 Force Celebration
              </button>

              <button
                className={`${styles.primaryBtn} ${!config.enabled ? styles.disabledBtn : ''}`}
                disabled={!config.enabled}
                onClick={() => gameApi.triggerAnimation('wrong_answer')}
              >
                😞 Force Wrong Answer
              </button>

              <button
                className={`${styles.primaryBtn} ${!config.enabled ? styles.disabledBtn : ''}`}
                disabled={!config.enabled}
                onClick={() => gameApi.triggerAnimation('dramatic_lock')}
              >
                🎭 Force Dramatic Lock
              </button>
            </div>
          </div>

          {/* Animation Status */}
          <div className={styles.controlSection}>
            <h3 style={{ color: '#FFD700', marginBottom: '15px' }}>System Status</h3>
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 215, 0, 0.2)',
              borderRadius: '8px',
              padding: '15px',
              fontSize: '14px'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', color: '#ccc' }}>
                <div><strong style={{ color: '#FFD700' }}>Animations:</strong> {config.enabled ? 'Enabled' : 'Disabled'}</div>
                <div><strong style={{ color: '#FFD700' }}>Sound:</strong> {config.soundEnabled ? 'Enabled' : 'Disabled'}</div>
                <div><strong style={{ color: '#FFD700' }}>Speed:</strong> {Math.round(config.speed * 100)}%</div>
                <div><strong style={{ color: '#FFD700' }}>Performance:</strong> {config.performance.charAt(0).toUpperCase() + config.performance.slice(1)}</div>
                <div><strong style={{ color: '#FFD700' }}>Test Mode:</strong> {isTestMode ? 'Active' : 'Inactive'}</div>
                <div><strong style={{ color: '#FFD700' }}>Canvas Confetti:</strong> Available</div>
              </div>
              
              {lastAnimation && (
                <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(76, 175, 80, 0.2)', borderRadius: '4px' }}>
                  <strong style={{ color: '#4CAF50' }}>Last Animation:</strong> {lastAnimation}
                </div>
              )}
            </div>
          </div>

        </GlassPanel>
      </div>
    </div>
  );
};

export default AnimationControlPanel;