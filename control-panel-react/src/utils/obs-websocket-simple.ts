/**
 * Simple OBS WebSocket client that bypasses obs-websocket-js library issues
 */

export class SimpleOBSWebSocket {
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private messageId: number = 1;
  private responseHandlers: Map<string, (data: any) => void> = new Map();
  
  async connect(host: string = 'localhost', port: number = 4455, password?: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `ws://${host}:${port}`;
        console.log(`🔌 Connecting to OBS WebSocket at ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = async () => {
          console.log('✅ WebSocket connection opened');
          
          // Add a small delay to ensure the connection is fully established
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Make sure the WebSocket is fully ready before sending
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Send identification message
            const identifyMessage = {
              op: 1, // Identify
              d: {
                rpcVersion: 1,
                authentication: password ? this.generateAuth(password) : undefined,
                eventSubscriptions: 0
              }
            };
            
            try {
              this.ws.send(JSON.stringify(identifyMessage));
            } catch (error) {
              console.error('Failed to send identification message:', error);
              reject(error);
            }
          } else {
            console.error('WebSocket not ready for sending');
            reject(new Error('WebSocket connection not ready'));
          }
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('📨 Received:', message);
            
            // Handle identification response
            if (message.op === 2) { // Identified
              this.isConnected = true;
              console.log('✅ Successfully identified with OBS');
              resolve(true);
            }
            
            // Handle request responses
            if (message.op === 7 && message.d.requestId) {
              const handler = this.responseHandlers.get(message.d.requestId);
              if (handler) {
                handler(message.d);
                this.responseHandlers.delete(message.d.requestId);
              }
            }
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        };
        
        this.ws.onerror = (event) => {
          console.error('❌ WebSocket error event occurred');
          this.isConnected = false;
          reject(new Error('WebSocket connection error'));
        };
        
        this.ws.onclose = () => {
          console.log('❌ WebSocket closed');
          this.isConnected = false;
        };
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            this.disconnect();
            reject(new Error('Connection timeout'));
          }
        }, 5000);
        
      } catch (error) {
        console.error('❌ Connection error:', error);
        reject(error);
      }
    });
  }
  
  private generateAuth(password: string): string {
    // For now, return empty string - OBS v5 uses a complex auth system
    // that requires salt and challenge from the server
    return '';
  }
  
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
  
  async sendRequest(requestType: string, requestData?: any): Promise<any> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to OBS');
    }
    
    // Check WebSocket readyState before sending
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not in OPEN state');
    }
    
    return new Promise((resolve, reject) => {
      const requestId = `req_${this.messageId++}`;
      
      const message = {
        op: 6, // Request
        d: {
          requestType,
          requestId,
          requestData: requestData || {}
        }
      };
      
      // Set up response handler
      this.responseHandlers.set(requestId, (response) => {
        if (response.requestStatus.result) {
          resolve(response.responseData);
        } else {
          reject(new Error(`OBS Error: ${response.requestStatus.comment}`));
        }
      });
      
      try {
        // Send request with error handling
        this.ws!.send(JSON.stringify(message));
      } catch (error) {
        // Clean up handler if send fails
        this.responseHandlers.delete(requestId);
        reject(error);
        return;
      }
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.responseHandlers.has(requestId)) {
          this.responseHandlers.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }
  
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
  
  // Convenience methods
  async setCurrentScene(sceneName: string): Promise<void> {
    await this.sendRequest('SetCurrentProgramScene', { sceneName });
  }
  
  async getSceneList(): Promise<string[]> {
    const response = await this.sendRequest('GetSceneList');
    return response.scenes.map((scene: any) => scene.sceneName);
  }
  
  async toggleSourceVisibility(sceneName: string, sourceName: string, visible: boolean): Promise<void> {
    // First get the scene item ID
    const sceneItems = await this.sendRequest('GetSceneItemList', { sceneName });
    const item = sceneItems.sceneItems.find((item: any) => item.sourceName === sourceName);
    
    if (item) {
      await this.sendRequest('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: visible
      });
    }
  }
}

// Export a singleton instance
export const simpleOBSWebSocket = new SimpleOBSWebSocket();