/**
 * 🎬 Kimbillionaire Animation System
 * Broadcast-quality animations and sound effects for the game show
 */

const confetti = require('canvas-confetti');

// Animation configuration
export interface AnimationConfig {
  enabled: boolean;
  soundEnabled: boolean;
  speed: number; // 0.25 to 2.0
  performance: 'high' | 'medium' | 'low';
}

// Default animation settings
export const defaultAnimationConfig: AnimationConfig = {
  enabled: true,
  soundEnabled: true,
  speed: 1.0,
  performance: 'high'
};

// Sound system using Web Audio API
class SoundSystem {
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.3;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private async createTone(frequency: number, duration: number, type: OscillatorType = 'sine'): Promise<void> {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.type = type;

    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(this.masterVolume, this.audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  async playTypewriter(): Promise<void> {
    await this.createTone(800, 0.05, 'square');
  }

  async playAnswerReveal(): Promise<void> {
    await this.createTone(440, 0.3, 'sine');
  }

  async playDramaticPause(): Promise<void> {
    // Heartbeat effect
    for (let i = 0; i < 3; i++) {
      await this.createTone(60, 0.1, 'sine');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async playCelebration(): Promise<void> {
    // Ascending fanfare
    const notes = [262, 330, 392, 523]; // C, E, G, C (major chord)
    for (const note of notes) {
      this.createTone(note, 0.5, 'triangle');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async playWrongAnswer(): Promise<void> {
    await this.createTone(200, 1.0, 'sawtooth');
  }

  async playTransition(): Promise<void> {
    await this.createTone(660, 0.4, 'sine');
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }
}

// Global sound system instance
export const soundSystem = new SoundSystem();

// Animation control class
export class KimbillionaireAnimations {
  private config: AnimationConfig;
  private isAnimating = false;

  constructor(config: AnimationConfig = defaultAnimationConfig) {
    this.config = config;
  }

  updateConfig(newConfig: Partial<AnimationConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms / this.config.speed));
  }

  private async playSound(soundFn: () => Promise<void>): Promise<void> {
    if (this.config.soundEnabled) {
      try {
        await soundFn();
      } catch (error) {
        console.warn('Sound playback failed:', error);
      }
    }
  }

  // 🎭 Curtain Opening Animation
  async curtainOpen(): Promise<void> {
    if (!this.config.enabled) return;
    
    console.log('🎭 Playing curtain opening animation');
    
    // Create curtain overlay
    const curtainLeft = document.createElement('div');
    const curtainRight = document.createElement('div');
    
    const curtainStyle = `
      position: fixed;
      top: 0;
      width: 50vw;
      height: 100vh;
      background: linear-gradient(45deg, #8B0000, #4B0000);
      z-index: 9999;
      transition: transform 2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    `;
    
    curtainLeft.style.cssText = curtainStyle + 'left: 0; transform: translateX(0);';
    curtainRight.style.cssText = curtainStyle + 'right: 0; transform: translateX(0);';
    
    document.body.appendChild(curtainLeft);
    document.body.appendChild(curtainRight);
    
    await this.delay(100);
    
    // Open curtains
    curtainLeft.style.transform = 'translateX(-100%)';
    curtainRight.style.transform = 'translateX(100%)';
    
    await this.delay(2000);
    
    // Remove curtains
    document.body.removeChild(curtainLeft);
    document.body.removeChild(curtainRight);
  }

  // ⌨️ Typewriter Effect for Questions
  async typewriterEffect(element: HTMLElement, text: string): Promise<void> {
    if (!this.config.enabled) {
      element.textContent = text;
      return;
    }

    console.log('⌨️ Playing typewriter effect');
    
    element.textContent = '';
    element.style.position = 'relative';
    
    // Add cursor
    const cursor = document.createElement('span');
    cursor.textContent = '|';
    cursor.style.cssText = `
      animation: blink 1s infinite;
      color: #FFD700;
    `;
    
    // Add cursor CSS
    if (!document.getElementById('cursor-blink-style')) {
      const style = document.createElement('style');
      style.id = 'cursor-blink-style';
      style.textContent = `
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    element.appendChild(cursor);
    
    // Type characters
    for (let i = 0; i < text.length; i++) {
      element.textContent = text.substring(0, i + 1);
      element.appendChild(cursor);
      
      await this.playSound(() => soundSystem.playTypewriter());
      await this.delay(50);
    }
    
    // Remove cursor after a delay
    await this.delay(500);
    cursor.remove();
  }

  // 📝 Staggered Answer Reveals
  async revealAnswers(answerElements: HTMLElement[]): Promise<void> {
    if (!this.config.enabled) {
      answerElements.forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      return;
    }

    console.log('📝 Playing staggered answer reveals');
    
    // Hide all answers initially with smooth fade preparation
    answerElements.forEach((el, idx) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(50px) scale(0.9)';
      el.style.transition = 'all 1.2s cubic-bezier(0.4, 0.0, 0.2, 1)';
      // Add slight rotation for more dynamic feel
      el.style.transformOrigin = 'center center';
    });
    
    // Wait for initial setup
    await this.delay(500 / this.config.speed);
    
    // Reveal answers one by one with cinematic timing
    for (let index = 0; index < answerElements.length; index++) {
      const element = answerElements[index];
      
      // Longer delay between each answer for dramatic effect
      await this.delay(800 / this.config.speed);
      
      // Smooth, elegant reveal
      element.style.opacity = '1';
      element.style.transform = 'translateY(0) scale(1)';
      
      // Play subtle sound effect
      await this.playSound(() => soundSystem.playAnswerReveal());
      
      // Add subtle glow effect during reveal
      element.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.5)';
      
      // Remove glow after reveal
      setTimeout(() => {
        element.style.boxShadow = '';
        element.style.transition = 'box-shadow 0.8s ease-out';
      }, 600);
    }
    
    // Final pause for effect to settle
    await this.delay(300 / this.config.speed);
  }

  // 🎭 Dramatic Lock-in Effect
  async dramaticLockIn(selectedElement?: HTMLElement): Promise<void> {
    if (!this.config.enabled) return;
    
    console.log('🎭 Playing dramatic lock-in effect');
    
    // Create targeted spotlight overlay that highlights the selected answer
    const overlay = document.createElement('div');
    let spotlightPosition = 'center';
    
    // If we have a selected element, position spotlight on it
    if (selectedElement) {
      const rect = selectedElement.getBoundingClientRect();
      const centerX = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
      const centerY = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
      spotlightPosition = `${centerX}% ${centerY}%`;
    }
    
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: radial-gradient(ellipse 400px 200px at ${spotlightPosition}, transparent 0%, rgba(0, 0, 0, 0.4) 70%);
      z-index: 8888;
      opacity: 0;
      transition: opacity 1.5s ease;
      pointer-events: none;
    `;
    
    // Create "ANSWER LOCKED!" text
    const lockedText = document.createElement('div');
    lockedText.textContent = 'ANSWER LOCKED!';
    lockedText.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0) rotate(-10deg);
      font-size: 120px;
      font-weight: 900;
      font-family: 'Montserrat', sans-serif;
      color: #FFD700;
      text-shadow: 
        0 0 20px rgba(255, 215, 0, 0.8),
        0 0 40px rgba(255, 215, 0, 0.6),
        0 0 60px rgba(255, 215, 0, 0.4),
        4px 4px 8px rgba(0, 0, 0, 0.8);
      z-index: 9999;
      text-align: center;
      letter-spacing: 8px;
      opacity: 0;
      transition: all 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      pointer-events: none;
      text-transform: uppercase;
      background: linear-gradient(135deg, #FFD700, #FFA500);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(lockedText);
    
    // Fade in spotlight
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });
    
    // Animate "ANSWER LOCKED!" text
    setTimeout(() => {
      lockedText.style.opacity = '1';
      lockedText.style.transform = 'translate(-50%, -50%) scale(1.2) rotate(0deg)';
    }, 200);
    
    // Add dramatic impact shake
    setTimeout(() => {
      lockedText.style.transform = 'translate(-50%, -50%) scale(1) rotate(0deg)';
      lockedText.style.animation = 'lockedTextPulse 0.5s ease-out';
    }, 600);
    
    // Dramatically highlight the selected answer
    if (selectedElement) {
      // Store original styles to restore later
      const originalStyles = selectedElement.style.cssText;
      
      selectedElement.style.cssText += `
        animation: dramaticPulse 0.8s infinite alternate;
        z-index: 8890;
        position: relative;
        transform: scale(1.08) !important;
        border: 3px solid #FFD700 !important;
        background: rgba(255, 215, 0, 0.15) !important;
        box-shadow: 
          0 0 30px rgba(255, 215, 0, 0.8),
          0 0 60px rgba(255, 215, 0, 0.6),
          0 0 90px rgba(255, 215, 0, 0.4),
          inset 0 0 20px rgba(255, 215, 0, 0.2) !important;
      `;
      
      // Add enhanced pulse animation
      if (!document.getElementById('dramatic-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'dramatic-pulse-style';
        style.textContent = `
          @keyframes dramaticPulse {
            0% { 
              transform: scale(1.15);
              box-shadow: 
                0 0 40px rgba(255, 215, 0, 1.0),
                0 0 80px rgba(255, 215, 0, 0.8),
                0 0 120px rgba(255, 215, 0, 0.6),
                0 0 160px rgba(255, 215, 0, 0.4),
                inset 0 0 30px rgba(255, 215, 0, 0.3);
            }
            100% { 
              transform: scale(1.2);
              box-shadow: 
                0 0 50px rgba(255, 215, 0, 1.0),
                0 0 100px rgba(255, 215, 0, 0.9),
                0 0 150px rgba(255, 215, 0, 0.7),
                0 0 200px rgba(255, 215, 0, 0.5),
                inset 0 0 40px rgba(255, 215, 0, 0.4);
            }
          }
          @keyframes lockedTextPulse {
            0% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.1); }
            100% { transform: translate(-50%, -50%) scale(1); }
          }
        `;
        document.head.appendChild(style);
      }
      
      // Store reference to restore styles later
      (selectedElement as any).__originalStyles = originalStyles;
    }
    
    await this.playSound(() => soundSystem.playDramaticPause());
    
    // Keep text visible for impact
    await this.delay(2000);
    
    // Fade out text first
    lockedText.style.opacity = '0';
    lockedText.style.transform = 'translate(-50%, -50%) scale(0.8) rotate(10deg)';
    
    await this.delay(500);
    
    // Then fade out overlay
    overlay.style.opacity = '0';
    
    await this.delay(1000);
    
    // Clean up
    overlay.remove();
    lockedText.remove();
    if (selectedElement) {
      // Instead of restoring original styles, apply a subtle locked state
      selectedElement.style.cssText = '';
      selectedElement.style.border = '2px solid rgba(255, 215, 0, 0.6)';
      selectedElement.style.background = 'rgba(255, 215, 0, 0.1)';
      selectedElement.style.boxShadow = '0 0 15px rgba(255, 215, 0, 0.3)';
      selectedElement.style.transform = 'scale(1.02)';
      selectedElement.style.animation = 'subtle-locked-pulse 3s ease-in-out infinite alternate';
      
      // Add subtle pulse animation if not already added
      if (!document.getElementById('subtle-locked-style')) {
        const style = document.createElement('style');
        style.id = 'subtle-locked-style';
        style.textContent = `
          @keyframes subtle-locked-pulse {
            0% { 
              box-shadow: 0 0 15px rgba(255, 215, 0, 0.3);
              background: rgba(255, 215, 0, 0.1);
            }
            100% { 
              box-shadow: 0 0 25px rgba(255, 215, 0, 0.5);
              background: rgba(255, 215, 0, 0.15);
            }
          }
        `;
        document.head.appendChild(style);
      }
      
      delete (selectedElement as any).__originalStyles;
    }
  }

  // 🎉 Celebration Effect
  async celebrate(): Promise<void> {
    if (!this.config.enabled) return;
    
    console.log('🎉 Playing celebration effect');
    
    await this.playSound(() => soundSystem.playCelebration());
    
    // Multi-burst confetti
    const colors = ['#FFD700', '#FFA500', '#FFFFFF', '#4CAF50'];
    
    // First burst
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6, x: 0.5 },
      colors: colors,
      shapes: ['circle', 'square'],
      gravity: 0.8,
      drift: 0.1
    });
    
    await this.delay(200);
    
    // Second burst from left
    confetti({
      particleCount: 50,
      spread: 55,
      origin: { y: 0.7, x: 0.2 },
      colors: colors,
      angle: 60
    });
    
    await this.delay(200);
    
    // Third burst from right
    confetti({
      particleCount: 50,
      spread: 55,
      origin: { y: 0.7, x: 0.8 },
      colors: colors,
      angle: 120
    });
    
    await this.delay(300);
    
    // Final cascade
    confetti({
      particleCount: 200,
      spread: 100,
      origin: { y: 0.3, x: 0.5 },
      colors: colors,
      startVelocity: 45,
      gravity: 0.6
    });
  }

  // 😞 Wrong Answer Effect
  async wrongAnswer(): Promise<void> {
    if (!this.config.enabled) return;
    
    console.log('😞 Playing wrong answer effect');
    
    await this.playSound(() => soundSystem.playWrongAnswer());
    
    // Screen shake
    const gameContainer = document.querySelector('.gameshow-container') as HTMLElement;
    if (gameContainer) {
      gameContainer.style.cssText += `
        animation: screenShake 0.5s ease-in-out;
      `;
      
      // Add shake animation
      if (!document.getElementById('screen-shake-style')) {
        const style = document.createElement('style');
        style.id = 'screen-shake-style';
        style.textContent = `
          @keyframes screenShake {
            0%, 100% { transform: translateX(0); }
            10% { transform: translateX(-5px); }
            20% { transform: translateX(5px); }
            30% { transform: translateX(-3px); }
            40% { transform: translateX(3px); }
            50% { transform: translateX(-2px); }
            60% { transform: translateX(2px); }
            70% { transform: translateX(-1px); }
            80% { transform: translateX(1px); }
            90% { transform: translateX(0); }
          }
        `;
        document.head.appendChild(style);
      }
    }
    
    // Red flash overlay
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(255, 0, 0, 0.3);
      z-index: 9999;
      opacity: 1;
      transition: opacity 0.5s ease;
      pointer-events: none;
    `;
    
    document.body.appendChild(flash);
    
    await this.delay(100);
    flash.style.opacity = '0';
    
    await this.delay(500);
    flash.remove();
    
    // Clean up shake
    if (gameContainer) {
      setTimeout(() => {
        gameContainer.style.animation = '';
      }, 500);
    }
  }

  // 🔄 Slide Transition for Next Question
  async slideTransition(direction: 'left' | 'right' = 'left'): Promise<void> {
    if (!this.config.enabled) return;
    
    console.log(`🔄 Playing slide transition (${direction})`);
    
    await this.playSound(() => soundSystem.playTransition());
    
    const questionPanel = document.querySelector('.question-panel') as HTMLElement;
    if (!questionPanel) return;
    
    const slideDistance = direction === 'left' ? '-100%' : '100%';
    
    // Slide out
    questionPanel.style.cssText += `
      transition: transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      transform: translateX(${slideDistance});
    `;
    
    await this.delay(400);
    
    // Show "Get ready" message
    const readyMessage = document.createElement('div');
    readyMessage.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 3em;
      font-weight: bold;
      color: #FFD700;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.5s ease;
    `;
    readyMessage.textContent = 'Get ready for the next question!';
    
    document.body.appendChild(readyMessage);
    
    requestAnimationFrame(() => {
      readyMessage.style.opacity = '1';
    });
    
    await this.delay(1000);
    
    // Hide message
    readyMessage.style.opacity = '0';
    await this.delay(500);
    readyMessage.remove();
    
    // Slide back in from opposite side
    const returnDistance = direction === 'left' ? '100%' : '-100%';
    questionPanel.style.transform = `translateX(${returnDistance})`;
    
    await this.delay(100);
    
    questionPanel.style.transform = 'translateX(0)';
    await this.delay(800);
  }

  // 🛑 Emergency stop all animations
  stopAllAnimations(): void {
    console.log('🛑 Stopping all animations');
    
    // Remove any animation overlays
    document.querySelectorAll('[style*="z-index: 9999"], [style*="z-index: 8888"]').forEach(el => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    
    // Clear all animations
    document.querySelectorAll('*').forEach(el => {
      (el as HTMLElement).style.animation = '';
    });
    
    this.isAnimating = false;
  }

  // Get current animation status
  getStatus(): { isAnimating: boolean; config: AnimationConfig } {
    return {
      isAnimating: this.isAnimating,
      config: this.config
    };
  }
}

// Global animation system instance
export const kimbillionaireAnimations = new KimbillionaireAnimations();

// Utility functions for API integration
export const animationAPI = {
  curtainOpen: () => kimbillionaireAnimations.curtainOpen(),
  typeQuestion: (element: HTMLElement, text: string) => kimbillionaireAnimations.typewriterEffect(element, text),
  revealAnswers: (elements: HTMLElement[]) => kimbillionaireAnimations.revealAnswers(elements),
  lockInDrama: (selectedElement?: HTMLElement) => kimbillionaireAnimations.dramaticLockIn(selectedElement),
  celebrate: () => kimbillionaireAnimations.celebrate(),
  wrongAnswer: () => kimbillionaireAnimations.wrongAnswer(),
  slideNext: () => kimbillionaireAnimations.slideTransition('left'),
  updateConfig: (config: Partial<AnimationConfig>) => kimbillionaireAnimations.updateConfig(config),
  getStatus: () => kimbillionaireAnimations.getStatus(),
  stopAll: () => kimbillionaireAnimations.stopAllAnimations()
};

export default kimbillionaireAnimations;