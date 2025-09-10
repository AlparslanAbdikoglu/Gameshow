import OBSWebSocket from 'obs-websocket-js';
import { simpleOBSWebSocket } from './obs-websocket-simple';

export interface OBSIntegrationType {
  connect: (host?: string, port?: number, password?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  showQuestion: () => Promise<boolean>;
  revealCorrectAnswer: () => Promise<boolean>;
  switchOverlay: (overlay: 'original' | 'v2') => Promise<boolean>;
  getConnectionStatus: () => boolean;
  listAvailableSources: () => Promise<void>;
  findBestSourceMatch: (configKey: keyof typeof OBS_CONFIG.alternativeNames) => Promise<string | null>;
}

// OBS Scene and Source configuration
const OBS_CONFIG = {
  scenes: {
    main: 'Kimbillionaire Main',
    question: 'Question Display',
    tradingView: 'Tradingview Chart'
  },
  sources: {
    correctAnswer: 'Correct Answer Highlight',
    moneyLadder: 'Money Ladder',
    celebration: 'Celebration Effects',
    lifeline50: 'Lifeline 50-50',
    lifelineAudience: 'Lifeline Ask Audience',
    lifelinePhone: 'Lifeline Phone'
  },
  // Alternative source names to try if primary names don't exist
  alternativeNames: {
    correctAnswer: [
      'Correct Answer Highlight',
      'Correct Answer',
      'Answer Highlight', 
      'Highlight',
      'Correct',
      'Winner Highlight',
      'Answer Glow'
    ]
  }
};

export class OBSIntegration implements OBSIntegrationType {
  private obs: OBSWebSocket;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private useSimpleClient: boolean = false;

  constructor() {
    this.obs = new OBSWebSocket();
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.obs.on('ConnectionOpened', () => {
      console.log('OBS WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.obs.on('ConnectionClosed', () => {
      console.log('OBS WebSocket disconnected');
      this.isConnected = false;
      // Disable auto-reconnect to prevent connection spam
      // this.handleReconnect();
    });

    this.obs.on('ConnectionError', (error) => {
      console.error('OBS WebSocket error:', error);
      this.isConnected = false;
      // Disable auto-reconnect to prevent connection spam
      // this.handleReconnect();
    });
  }

  private async handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect to OBS (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(async () => {
        try {
          await this.connect();
        } catch (error) {
          console.error('Reconnection failed:', error);
        }
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  async connect(
    host: string = 'localhost',
    port: number = 4455,
    password: string = ''
  ): Promise<boolean> {
    try {
      const wsUrl = `ws://${host}:${port}`;
      console.log(`🔌 Attempting to connect to OBS WebSocket at ${wsUrl}`);
      
      // Try different connection methods to handle protocol issues
      try {
        // First try with explicit protocol version
        await this.obs.connect(wsUrl, password || undefined, {
          rpcVersion: 1
        });
      } catch (firstError: any) {
        console.warn('First connection attempt failed, trying without options...');
        
        // If that fails, try without any options
        try {
          await this.obs.connect(wsUrl);
        } catch (secondError: any) {
          console.warn('Second connection attempt failed, trying simple WebSocket...');
          
          // If both fail, try the simple WebSocket client
          this.useSimpleClient = true;
          const connected = await simpleOBSWebSocket.connect(host, port, password);
          if (connected) {
            this.isConnected = true;
            console.log('✅ Connected using simple WebSocket client');
            return true;
          }
          throw secondError;
        }
      }
      
      console.log('✅ Successfully connected to OBS WebSocket');
      return true;
    } catch (error: any) {
      console.error('❌ Failed to connect to OBS:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        type: error.constructor.name,
        host,
        port,
        wsUrl: `ws://${host}:${port}`
      });
      
      // Provide helpful error messages
      if (error.message?.includes('ECONNREFUSED')) {
        console.error('💡 OBS WebSocket server is not running or not accessible at the specified address');
        console.error('   Please check:');
        console.error('   1. OBS is running');
        console.error('   2. OBS WebSocket plugin is installed and enabled');
        console.error('   3. WebSocket server is enabled in OBS Tools > WebSocket Server Settings');
        console.error('   4. The port (4455) matches your OBS WebSocket settings');
        console.error('   5. No firewall is blocking the connection');
      }
      
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      if (this.useSimpleClient) {
        await simpleOBSWebSocket.disconnect();
      } else {
        await this.obs.disconnect();
      }
      this.isConnected = false;
      this.useSimpleClient = false;
    }
  }

  async setCurrentScene(sceneName: string): Promise<boolean> {
    if (!this.isConnected) {
      console.warn('OBS not connected');
      return false;
    }

    try {
      await this.obs.call('SetCurrentProgramScene', { sceneName });
      return true;
    } catch (error) {
      console.error('Failed to set scene:', error);
      return false;
    }
  }

  async getSceneList(): Promise<string[]> {
    if (!this.isConnected) return [];

    try {
      const response = await this.obs.call('GetSceneList');
      return response.scenes.map((scene: any) => scene.sceneName);
    } catch (error) {
      console.error('Failed to get scene list:', error);
      return [];
    }
  }

  async toggleSourceVisibility(sourceName: string, visible?: boolean): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      const currentScene = await this.getCurrentScene();
      const sceneItemId = await this.getSceneItemId(sourceName);
      
      // If scene item not found, log info and return gracefully
      if (sceneItemId === 0) {
        console.log(`ℹ️ OBS: Source "${sourceName}" not found in scene "${currentScene}" - skipping`);
        return false; // Graceful failure for optional sources
      }
      
      if (visible !== undefined) {
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: currentScene,
          sceneItemId: sceneItemId,
          sceneItemEnabled: visible
        });
      } else {
        const currentVisibility = await this.getSourceVisibility(sourceName);
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: currentScene,
          sceneItemId: sceneItemId,
          sceneItemEnabled: !currentVisibility
        });
      }
      return true;
    } catch (error: any) {
      console.error('Failed to toggle source visibility:', error);
      if (error.message?.includes('No scene items were found')) {
        console.error(`💡 Tip: Make sure "${sourceName}" exists in your current OBS scene`);
      }
      return false;
    }
  }

  private async getCurrentScene(): Promise<string> {
    const response = await this.obs.call('GetCurrentProgramScene');
    return response.currentProgramSceneName;
  }

  private async getSceneItemId(sourceName: string): Promise<number> {
    const currentScene = await this.getCurrentScene();
    const response = await this.obs.call('GetSceneItemList', { sceneName: currentScene });
    const item = response.sceneItems.find((item: any) => item.sourceName === sourceName);
    return Number(item?.sceneItemId) || 0;
  }

  private async getSourceVisibility(sourceName: string): Promise<boolean> {
    try {
      const currentScene = await this.getCurrentScene();
      const sceneItemId = await this.getSceneItemId(sourceName);
      const response = await this.obs.call('GetSceneItemEnabled', {
        sceneName: currentScene,
        sceneItemId
      });
      return response.sceneItemEnabled;
    } catch (error) {
      console.error('Failed to get source visibility:', error);
      return false;
    }
  }

  getConnectionStatus(): boolean {
    if (this.useSimpleClient) {
      return simpleOBSWebSocket.getConnectionStatus();
    }
    return this.isConnected;
  }

  // Game-specific scene management
  async showQuestion(): Promise<boolean> {
    return await this.setCurrentScene(OBS_CONFIG.scenes.question);
  }


  async revealCorrectAnswer(): Promise<boolean> {
    console.log('🎯 OBS: Attempting to reveal correct answer...');
    
    // Try to find a correct answer source using smart matching
    const sourceName = await this.findBestSourceMatch('correctAnswer');
    if (!sourceName) {
      console.log('💡 Note: No correct answer highlight source found in OBS');
      await this.listAvailableSources();
      console.log('🔍 Please create a source for answer highlighting, or rename an existing source to one of these:');
      console.log('   • "Correct Answer Highlight", "Correct Answer", "Answer Highlight", "Highlight"');
      return false;
    }
    
    console.log(`✅ Using OBS source: "${sourceName}"`);
    const result = await this.toggleSourceVisibility(sourceName, true);
    return result;
  }

  async findBestSourceMatch(configKey: keyof typeof OBS_CONFIG.alternativeNames): Promise<string | null> {
    if (!this.isConnected) return null;
    
    try {
      const currentScene = await this.getCurrentScene();
      const response = await this.obs.call('GetSceneItemList', {
        sceneName: currentScene
      });
      
      const availableSources = response.sceneItems.map((item: any) => item.sourceName);
      const alternativeNames = OBS_CONFIG.alternativeNames[configKey] || [];
      
      // Try each alternative name in order of preference
      for (const altName of alternativeNames) {
        if (availableSources.includes(altName)) {
          return altName;
        }
      }
      
      // If no exact match, try partial matching (case-insensitive)
      for (const altName of alternativeNames) {
        const match = availableSources.find(source => 
          source.toLowerCase().includes(altName.toLowerCase()) ||
          altName.toLowerCase().includes(source.toLowerCase())
        );
        if (match) {
          console.log(`🔍 Found partial match: "${match}" for "${altName}"`);
          return match;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Failed to find source match:', error);
      return null;
    }
  }

  async listAvailableSources(): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      const currentScene = await this.getCurrentScene();
      const response = await this.obs.call('GetSceneItemList', {
        sceneName: currentScene
      });
      
      console.log(`📋 Available sources in scene "${currentScene}":`);
      response.sceneItems.forEach((item: any, index: number) => {
        console.log(`   ${index + 1}. "${item.sourceName}" (ID: ${item.sceneItemId}, Enabled: ${item.sceneItemEnabled})`);
      });
      
    } catch (error) {
      console.error('Failed to list available sources:', error);
    }
  }

  async showMoneyLadder(): Promise<boolean> {
    return await this.toggleSourceVisibility(OBS_CONFIG.sources.moneyLadder, true);
  }

  async updateCurrentAmount(amount: string): Promise<boolean> {
    // This would require text source updates in OBS
    // Implementation depends on specific OBS setup
    return true;
  }

  async showLifeline(lifelineName: string): Promise<boolean> {
    return await this.toggleSourceVisibility(`Lifeline ${lifelineName}`, true);
  }

  async hideLifeline(lifelineName: string): Promise<boolean> {
    return await this.toggleSourceVisibility(`Lifeline ${lifelineName}`, false);
  }

  async triggerCelebration(): Promise<boolean> {
    return await this.toggleSourceVisibility('Celebration Effects', true);
  }

  async stopCelebration(): Promise<boolean> {
    return await this.toggleSourceVisibility('Celebration Effects', false);
  }

  // Overlay Management
  async switchOverlay(overlay: 'original' | 'v2'): Promise<boolean> {
    const sceneName = overlay === 'original' ? 'Kimbillionaire Original' : 'Kimbillionaire V2.0';
    return await this.setCurrentScene(sceneName);
  }

  async updateOverlayElement(elementName: string, properties: any): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      // Update text sources
      if (properties.text !== undefined) {
        await this.obs.call('SetInputSettings', {
          inputName: elementName,
          inputSettings: { text: properties.text }
        });
      }

      // Update visibility
      if (properties.visible !== undefined) {
        await this.toggleSourceVisibility(elementName, properties.visible);
      }

      // Update position/transform
      if (properties.transform) {
        const sceneItemId = await this.getSceneItemId(elementName);
        await this.obs.call('SetSceneItemTransform', {
          sceneName: await this.getCurrentScene(),
          sceneItemId,
          sceneItemTransform: properties.transform
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to update overlay element:', error);
      return false;
    }
  }

  async updateBrowserSource(sourceName: string, url: string): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      await this.obs.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { url }
      });
      return true;
    } catch (error) {
      console.error('Failed to update browser source:', error);
      return false;
    }
  }

  async triggerSceneTransition(transitionName?: string): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      if (transitionName) {
        await this.obs.call('SetCurrentSceneTransition', { transitionName });
      }
      await this.obs.call('TriggerStudioModeTransition');
      return true;
    } catch (error) {
      console.error('Failed to trigger transition:', error);
      return false;
    }
  }
}

export const obsIntegration = new OBSIntegration();