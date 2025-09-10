import React, { useState, useEffect } from 'react';
import GlassPanel from './GlassPanel';
import { gameApi } from '../utils/api';
import styles from './KimbillionaireControlPanel.module.css';
import { API_BASE_URL, WS_BASE_URL } from '../config';

interface LiveChatConfigProps {
  onConfigUpdate?: (config: LiveChatConfigData) => void;
  disabled?: boolean;
}

interface LiveChatConfigData {
  twitchChannel: string;
  youtubeApiKey: string;
  youtubeLiveChatId: string;
  isActive: boolean;
}

const LiveChatConfig: React.FC<LiveChatConfigProps> = ({
  onConfigUpdate,
  disabled = false
}) => {
  const [config, setConfig] = useState<LiveChatConfigData>({
    twitchChannel: '',
    youtubeApiKey: '',
    youtubeLiveChatId: '',
    isActive: false
  });
  
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    twitch: 'disconnected' | 'connecting' | 'connected' | 'error';
    youtube: 'disconnected' | 'connecting' | 'connected' | 'error';
  }>({
    twitch: 'disconnected',
    youtube: 'disconnected'
  });
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [testResults, setTestResults] = useState<string | null>(null);

  // Load saved config on mount
  useEffect(() => {
    loadSavedConfig();
  }, []);

  // WebSocket connection for real-time status updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      try {
        console.log('📡 LiveChatConfig: Connecting to WebSocket for status updates');
        // Use configuration from config.js
        ws = new WebSocket(WS_BASE_URL);

        ws.onopen = () => {
          console.log('📡 LiveChatConfig: WebSocket connected');
          // Register as chat config client
          ws?.send(JSON.stringify({ type: 'register', client: 'chat_config' }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'chat_connection_status') {
              console.log('📡 LiveChatConfig received connection status:', message);
              
              // Update connection status based on actual bridge server status
              setConnectionStatus(prev => ({
                ...prev,
                twitch: message.platform === 'twitch' ? message.status : prev.twitch,
                youtube: message.platform === 'youtube' ? message.status : prev.youtube
              }));
              
              // Update overall connected state
              const isActuallyConnected = message.status === 'connected';
              if (message.platform === 'twitch') {
                setIsConnected(isActuallyConnected);
              }
              
              console.log(`🔄 LiveChatConfig status updated: ${message.platform} -> ${message.status}`);
            }
          } catch (error) {
            console.error('❌ LiveChatConfig: Error parsing WebSocket message:', error);
          }
        };

        ws.onclose = () => {
          console.log('📡 LiveChatConfig: WebSocket disconnected');
          ws = null;
          
          // Reconnect after 3 seconds
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (event) => {
          console.error('❌ LiveChatConfig: WebSocket error event occurred');
        };

      } catch (error) {
        console.error('❌ LiveChatConfig: Failed to connect WebSocket:', error);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      }
    };

    // Start WebSocket connection
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const loadSavedConfig = async () => {
    try {
      const data = await gameApi.getPollingConfig();
      setConfig({
        twitchChannel: data.twitch?.channel || '',
        youtubeApiKey: data.youtube?.apiKey || '',
        youtubeLiveChatId: data.youtube?.liveChatId || '',
        isActive: data.isActive || false
      });
      setIsConnected(data.isActive || false);
    } catch (error) {
      console.log('No existing config found, using defaults');
    }
  };

  const handleConfigChange = (field: keyof LiveChatConfigData, value: string | boolean) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    
    if (onConfigUpdate) {
      onConfigUpdate(newConfig);
    }
  };

  const saveAndActivateConfig = async () => {
    try {
      setConnectionStatus({ twitch: 'connecting', youtube: 'connecting' });
      
      const response = await fetch(`${API_BASE_URL}/api/polling/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update_config',
          config: {
            twitch: {
              channel: config.twitchChannel,
              username: 'justinfan12345' // Anonymous Twitch connection
            },
            youtube: {
              apiKey: config.youtubeApiKey,
              liveChatId: config.youtubeLiveChatId,
              pollingInterval: 5000
            },
            isActive: true
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Live chat config updated:', result);
        
        setConfig(prev => ({ ...prev, isActive: true }));
        setTestResults('✅ Configuration saved! Waiting for connection status...');
        
        // Set connecting status - real status will come via WebSocket
        setConnectionStatus({
          twitch: config.twitchChannel ? 'connecting' : 'disconnected',
          youtube: (config.youtubeApiKey && config.youtubeLiveChatId) ? 'connecting' : 'disconnected'
        });
        
        // Don't set isConnected=true automatically - wait for WebSocket status update
        
        // Clear test results after 5 seconds
        setTimeout(() => setTestResults(null), 5000);
      } else {
        throw new Error('Failed to save configuration');
      }
    } catch (error) {
      console.error('❌ Error saving config:', error);
      setTestResults('❌ Error saving configuration. Check console for details.');
      setConnectionStatus({ twitch: 'error', youtube: 'error' });
      setTimeout(() => setTestResults(null), 5000);
    }
  };

  const disconnectStreams = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/polling/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'disconnect'
        })
      });

      if (response.ok) {
        setConfig(prev => ({ ...prev, isActive: false }));
        setIsConnected(false);
        setConnectionStatus({ twitch: 'disconnected', youtube: 'disconnected' });
        setTestResults('📴 Live chat monitoring disconnected.');
        setTimeout(() => setTestResults(null), 3000);
      }
    } catch (error) {
      console.error('❌ Error disconnecting:', error);
    }
  };

  const testConnection = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/polling/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          twitchChannel: config.twitchChannel,
          youtubeApiKey: config.youtubeApiKey,
          youtubeLiveChatId: config.youtubeLiveChatId
        })
      });

      if (response.ok) {
        const result = await response.json();
        setTestResults(result.message || '✅ Connection test completed. Check console for details.');
      } else {
        setTestResults('❌ Connection test failed. Check your settings.');
      }
      setTimeout(() => setTestResults(null), 5000);
    } catch (error) {
      console.error('❌ Test error:', error);
      setTestResults('❌ Could not test connection. Ensure polling system is running.');
      setTimeout(() => setTestResults(null), 5000);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#10b981';
      case 'connecting': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Error';
      default: return 'Disconnected';
    }
  };

  return (
    <GlassPanel title="🌐 Live Chat Configuration">
      {/* Header with main controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '15px',
        padding: '6px 10px',
        background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
        border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`,
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>
            {isConnected ? '🟢' : '🔴'}
          </span>
          <span style={{ 
            color: isConnected ? '#10b981' : '#6b7280', 
            fontWeight: 'bold',
            fontSize: '14px'
          }}>
            {isConnected ? 'Live Chat Active' : 'Live Chat Disconnected'}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className={styles.secondaryBtn}
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ padding: '2px 8px', fontSize: '12px', minWidth: '100px' }}
          >
            {isExpanded ? 'Hide Settings' : 'Configure'}
          </button>
          
          <div style={{ 
            padding: '1px 6px', 
            fontSize: '10px', 
            color: '#888',
            fontStyle: 'italic',
            lineHeight: '1.2'
          }}>
            Use "Connect & Start" in Live Chat Viewer
          </div>
        </div>
      </div>

      {/* Platform Status Indicators */}
      <div style={{ 
        display: 'flex', 
        gap: '15px', 
        marginBottom: '15px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(connectionStatus.twitch)
          }} />
          <span style={{ color: '#fff' }}>
            Twitch: {getStatusText(connectionStatus.twitch)}
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(connectionStatus.youtube)
          }} />
          <span style={{ color: '#fff' }}>
            YouTube: {getStatusText(connectionStatus.youtube)}
          </span>
        </div>
      </div>

      {/* Expanded Configuration Panel */}
      {isExpanded && (
        <div style={{ marginTop: '15px' }}>
          <h4 style={{ color: '#FFD700', marginBottom: '15px', fontSize: '14px' }}>
            Stream Configuration
          </h4>
          
          {/* Twitch Configuration */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              color: '#fff', 
              display: 'block', 
              marginBottom: '5px', 
              fontSize: '13px',
              fontWeight: 'bold'
            }}>
              🎮 Twitch Channel Name:
            </label>
            <input
              type="text"
              value={config.twitchChannel}
              onChange={(e) => handleConfigChange('twitchChannel', e.target.value)}
              placeholder="e.g., kimbillionaire"
              disabled={disabled || isConnected}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                background: (disabled || isConnected) ? '#444' : '#333',
                color: 'white',
                opacity: (disabled || isConnected) ? 0.6 : 1
              }}
            />
            <small style={{ color: '#888', fontSize: '11px' }}>
              Just the username (without twitch.tv/)
            </small>
          </div>

          {/* YouTube Configuration */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              color: '#fff', 
              display: 'block', 
              marginBottom: '5px', 
              fontSize: '13px',
              fontWeight: 'bold'
            }}>
              📺 YouTube API Key:
            </label>
            <input
              type="password"
              value={config.youtubeApiKey}
              onChange={(e) => handleConfigChange('youtubeApiKey', e.target.value)}
              placeholder="AIza... (from Google Cloud Console)"
              disabled={disabled || isConnected}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                background: (disabled || isConnected) ? '#444' : '#333',
                color: 'white',
                opacity: (disabled || isConnected) ? 0.6 : 1
              }}
            />
            
            <label style={{ 
              color: '#fff', 
              display: 'block', 
              marginTop: '10px',
              marginBottom: '5px', 
              fontSize: '13px',
              fontWeight: 'bold'
            }}>
              📺 YouTube Live Chat ID:
            </label>
            <input
              type="text"
              value={config.youtubeLiveChatId}
              onChange={(e) => handleConfigChange('youtubeLiveChatId', e.target.value)}
              placeholder="Live chat ID from stream URL"
              disabled={disabled || isConnected}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                background: (disabled || isConnected) ? '#444' : '#333',
                color: 'white',
                opacity: (disabled || isConnected) ? 0.6 : 1
              }}
            />
            <small style={{ color: '#888', fontSize: '11px' }}>
              Get from YouTube Live Dashboard or stream URL
            </small>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
            <button
              className={styles.secondaryBtn}
              onClick={testConnection}
              disabled={disabled || (!config.twitchChannel && !(config.youtubeApiKey && config.youtubeLiveChatId))}
              style={{ flex: 1, padding: '8px 12px', fontSize: '12px' }}
            >
              Test Connection
            </button>
            
            <div style={{ 
              flex: 2, 
              padding: '8px 12px', 
              fontSize: '11px', 
              color: '#666',
              fontStyle: 'italic',
              textAlign: 'center',
              border: '1px dashed rgba(255, 215, 0, 0.2)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              💡 Use "Connect & Start" button in Live Chat Viewer to activate
            </div>
          </div>
        </div>
      )}

      {/* Test Results */}
      {testResults && (
        <div style={{
          marginTop: '15px',
          padding: '10px 12px',
          background: testResults.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          border: `1px solid ${testResults.includes('❌') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
          borderRadius: '6px',
          fontSize: '12px',
          color: testResults.includes('❌') ? '#ef4444' : '#10b981'
        }}>
          {testResults}
        </div>
      )}

      {/* Help Section */}
      <div style={{
        marginTop: '15px',
        padding: '10px 12px',
        background: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '6px',
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.8)'
      }}>
        <strong>💡 Quick Setup:</strong><br />
        • <strong>Twitch</strong>: Just enter your channel name<br />
        • <strong>YouTube</strong>: Get API key from Google Cloud Console + Live Chat ID from stream<br />
        • <strong>Both</strong>: Configure either or both platforms for maximum audience reach
      </div>
    </GlassPanel>
  );
};

export default LiveChatConfig;