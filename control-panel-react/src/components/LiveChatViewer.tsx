import React, { useState, useEffect, useRef, useCallback } from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';
import { API_BASE_URL, WS_BASE_URL } from '../config';

interface ChatMessage {
  id: string;
  username: string;
  text: string;
  platform: 'twitch' | 'youtube' | 'system';
  timestamp: number;
  isRoaryResponse?: boolean;
  badges?: string[];
  color?: string;
  isModerator?: boolean;
  isVip?: boolean;
  isAskAModResponse?: boolean;
  suggestedAnswer?: string;
}

interface LiveChatViewerProps {
  disabled?: boolean;
}

// Singleton WebSocket manager to ensure only one connection
let sharedWebSocket: WebSocket | null = null;
let messageHandlers: Set<(message: ChatMessage) => void> = new Set();
let connectionPromise: Promise<void> | null = null;
let instanceCounter = 0;

declare global {
  interface Window {
    TWITCH_EMOTES?: { [key: string]: string };
  }
}

const getInitialTwitchEmotes = () => {
  if (typeof window !== 'undefined' && window.TWITCH_EMOTES) {
    return window.TWITCH_EMOTES;
  }
  return {};
};

// Function to process emotes in text
const processEmotes = (text: string, emotes: { [key: string]: string }): React.ReactNode => {
  if (!text) {
    return '';
  }

  const sortedEmotes = Object.keys(emotes).sort((a, b) => b.length - a.length);
  if (sortedEmotes.length === 0) {
    return text;
  }

  // Sort emote keywords by length (longest first) to avoid partial replacements
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  // Create a regex pattern for all emotes
  const emotePattern = new RegExp(`\\b(${sortedEmotes.join('|')})\\b`, 'g');
  
  let match;
  while ((match = emotePattern.exec(text)) !== null) {
    // Add text before the emote
    if (match.index > lastIndex) {
      elements.push(text.substring(lastIndex, match.index));
    }
    
    // Add the emote as an image
    const emote = match[1];
    elements.push(
      <img 
        key={`${match.index}-${emote}`}
        src={emotes[emote]}
        alt={emote} 
        style={{ 
          display: 'inline-block',
          width: '24px',
          height: '24px',
          verticalAlign: 'middle',
          margin: '0 2px'
        }}
      />
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text
  if (lastIndex < text.length) {
    elements.push(text.substring(lastIndex));
  }
  
  return elements.length > 0 ? <>{elements}</> : text;
};

const LiveChatViewer: React.FC<LiveChatViewerProps> = React.memo(({ disabled = false }) => {
  // Generate truly unique instance ID
  const instanceId = useRef(`LCV_${Date.now()}_${performance.now()}_${++instanceCounter}`);
  
  console.log(`💬 [INIT] Starting LiveChatViewer instance ${instanceId.current}`);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('connecting');
  const [isExpanded, setIsExpanded] = useState(true);
  const [messageCount, setMessageCount] = useState({ twitch: 0, youtube: 0, system: 0, total: 0 });
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [twitchChatEnabled, setTwitchChatEnabled] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [twitchEmotes, setTwitchEmotes] = useState<{ [key: string]: string }>(() => getInitialTwitchEmotes());
  // Remove local WebSocket ref - we'll use the shared one
  // const wsRef = useRef<WebSocket | null>(null);
  
  // Moderator management state with localStorage persistence
  const [moderatorList, setModeratorList] = useState<string[]>(() => {
    // Load moderators from localStorage on component mount
    try {
      const savedMods = localStorage.getItem('kimbillionaire_moderators');
      if (savedMods) {
        const parsed = JSON.parse(savedMods);
        console.log('💾 Loaded moderators from localStorage:', parsed);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Error loading moderators from localStorage:', error);
    }
    return [];
  });
  const [isModeratorDropdownOpen, setIsModeratorDropdownOpen] = useState(false);
  const [newModName, setNewModName] = useState('');
  
  // VIP management state with localStorage persistence
  const [vipList, setVipList] = useState<string[]>(() => {
    try {
      const savedVips = localStorage.getItem('kimbillionaire_vips');
      if (savedVips) {
        const parsed = JSON.parse(savedVips);
        console.log('💎 Loaded VIPs from localStorage:', parsed);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Error loading VIPs from localStorage:', error);
    }
    return [];
  });
  const [isVipDropdownOpen, setIsVipDropdownOpen] = useState(false);
  const [newVipName, setNewVipName] = useState('');
  // Removed unused showModDropdown and isModLoading variables

  // Host chat input state
  const [hostMessage, setHostMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const MAX_RECONNECT_ATTEMPTS = 5;
  const reconnectAttemptsRef = useRef(0);

  // processEmotes helper defined above handles Twitch emote replacement

  // Message handler
  const handleMessage = useCallback((chatMessage: ChatMessage) => {
    console.log('💬 [MESSAGE] Received message for processing:', chatMessage);
    
    const messageWithFlags = {
      ...chatMessage,
      isModerator: moderatorList.includes(chatMessage.username.toLowerCase()),
      isVip: vipList.includes(chatMessage.username.toLowerCase())
    };

    setMessages(prev => {
      const exists = prev.some(msg => msg.id === messageWithFlags.id);
      if (exists) {
        console.log('💬 Duplicate message detected, ignoring:', messageWithFlags.id);
        return prev;
      }
      return [...prev.slice(-99), messageWithFlags];
    });

    // Update message counts
    setMessageCount(prev => ({
      ...prev,
      [chatMessage.platform]: prev[chatMessage.platform] + 1,
      total: prev.total + 1
    }));

    // Auto-scroll to bottom
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }, 50);
  }, [moderatorList, vipList]);

  // Fetch mods and VIPs from server on component mount
  useEffect(() => {
    const fetchModsAndVips = async () => {
      try {
        console.log('📡 Fetching mods/VIPs from:', `${API_BASE_URL}/api/mods`);
        
        // Fetch moderators from server
        const modsResponse = await fetch(`${API_BASE_URL}/api/mods`);
        console.log('📡 Mods response status:', modsResponse.status);
        
        if (modsResponse.ok) {
          const modsData = await modsResponse.json();
          console.log('📡 Mods data received:', modsData);
          
          if (modsData.success && Array.isArray(modsData.mods)) {
            console.log('🛡️ Loaded moderators from server:', modsData.mods);
            setModeratorList(modsData.mods);
          }
        } else {
          console.warn('⚠️ Failed to fetch moderators from server, status:', modsResponse.status);
        }
        
        // Fetch VIPs from server
        const vipsResponse = await fetch(`${API_BASE_URL}/api/vips`);
        console.log('📡 VIPs response status:', vipsResponse.status);
        
        if (vipsResponse.ok) {
          const vipsData = await vipsResponse.json();
          console.log('📡 VIPs data received:', vipsData);
          
          if (vipsData.success && Array.isArray(vipsData.vips)) {
            console.log('💎 Loaded VIPs from server:', vipsData.vips);
            setVipList(vipsData.vips);
          }
        } else {
          console.warn('⚠️ Failed to fetch VIPs from server, status:', vipsResponse.status);
        }
      } catch (error) {
        console.error('❌ Error fetching mods/VIPs from server:', error);
        if (error instanceof Error) {
          console.error('❌ Error details:', error.message);
        }
      }
    };
    
    // Add a small delay to ensure server is ready
    setTimeout(() => {
      fetchModsAndVips();
    }, 1000);
  }, []); // Run once on mount
  
  // Function to sync moderator list with server
  const updateModeratorList = async (newList: string[]) => {
    setModeratorList(newList);
    try {
      const response = await fetch(`${API_BASE_URL}/api/mods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mods: newList })
      });
      if (response.ok) {
        console.log('✅ Moderator list synced with server');
      } else {
        console.warn('⚠️ Failed to sync moderator list with server');
      }
    } catch (error) {
      console.error('❌ Error syncing moderator list:', error);
    }
  };
  
  // Function to sync VIP list with server
  const updateVipList = async (newList: string[]) => {
    setVipList(newList);
    try {
      const response = await fetch(`${API_BASE_URL}/api/vips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vips: newList })
      });
      if (response.ok) {
        console.log('✅ VIP list synced with server');
      } else {
        console.warn('⚠️ Failed to sync VIP list with server');
      }
    } catch (error) {
      console.error('❌ Error syncing VIP list:', error);
    }
  };

  useEffect(() => {
    if (Object.keys(twitchEmotes).length > 0) {
      return;
    }

    const controller = new AbortController();

    fetch(`${API_BASE_URL}/api/twitch-emotes`, { signal: controller.signal })
      .then(response => response.json())
      .then(data => {
        const nextEmotes = data?.emotes || data;
        setTwitchEmotes(nextEmotes);
        if (typeof window !== 'undefined') {
          window.TWITCH_EMOTES = nextEmotes;
        }
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          console.error('⚠️ Failed to load Twitch emotes from API:', error);
        }
      });

    return () => controller.abort();
  }, [twitchEmotes]);

  // Save moderators to localStorage whenever the list changes
  useEffect(() => {
    try {
      localStorage.setItem('kimbillionaire_moderators', JSON.stringify(moderatorList));
      console.log('💾 Saved moderators to localStorage:', moderatorList);
    } catch (error) {
      console.error('Error saving moderators to localStorage:', error);
    }
  }, [moderatorList]);

  // Save VIPs to localStorage whenever the list changes
  useEffect(() => {
    try {
      localStorage.setItem('kimbillionaire_vips', JSON.stringify(vipList));
      console.log('💾 Saved VIPs to localStorage:', vipList);
    } catch (error) {
      console.error('Error saving VIPs to localStorage:', error);
    }
  }, [vipList]);

  // Singleton WebSocket connection management
  const connectWebSocket = useCallback(() => {
    console.log(`💬 [${instanceId.current}] Checking WebSocket connection to ${WS_BASE_URL}`);
    
    // If already connected, just register this component's handler
    if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
      console.log(`💬 [${instanceId.current}] Using existing WebSocket connection`);
      setIsConnected(true);
      setConnectionStatus('connected');
      messageHandlers.add(handleMessage);
      return;
    }
    
    // If connection is in progress, wait for it
    if (connectionPromise) {
      console.log(`💬 [${instanceId.current}] Waiting for existing connection attempt`);
      connectionPromise.then(() => {
        if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
          setIsConnected(true);
          setConnectionStatus('connected');
          messageHandlers.add(handleMessage);
        }
      });
      return;
    }

    console.log(`💬 [${instanceId.current}] Creating new shared WebSocket connection to ${WS_BASE_URL}`);
    setConnectionStatus('connecting');
    setReconnectAttempt(reconnectAttemptsRef.current);
    
    // Create connection promise to prevent multiple simultaneous attempts
    connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        console.log(`💬 [${instanceId.current}] Attempting WebSocket connection to: ${WS_BASE_URL}`);
        sharedWebSocket = new WebSocket(WS_BASE_URL);
        console.log(`💬 [${instanceId.current}] WebSocket object created, readyState:`, sharedWebSocket.readyState);

        sharedWebSocket.onopen = () => {
          console.log('💬 ✅ [CONNECTION] Shared WebSocket connected successfully');
          reconnectAttemptsRef.current = 0;
          connectionPromise = null;
          
          // IMMEDIATELY register as chat viewer - don't wait
          console.log('💬 [REGISTRATION] Registering as chat_viewer immediately...');
          
          const registrationMessage = {
            type: 'register',
            client: 'chat_viewer',
            instanceId: instanceId.current
          };
          console.log('💬 [REGISTRATION] Sending registration message:', registrationMessage);
          
          // Add a small delay to ensure WebSocket is fully established
          setTimeout(() => {
            try {
              // Send registration with validation
              if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
                sharedWebSocket.send(JSON.stringify(registrationMessage));
                console.log('💬 ✅ [REGISTRATION] Registration message sent successfully');
                
                // Only after successful registration, update status
                setIsConnected(true);
                setConnectionStatus('connected');
                
                // Notify all waiting components
                resolve();
              } else {
                console.error('💬 ❌ [REGISTRATION] WebSocket not open, state:', sharedWebSocket?.readyState);
                reject(new Error('WebSocket not in OPEN state'));
                return;
              }
            } catch (error) {
              console.error('💬 ❌ [REGISTRATION] Exception sending registration:', error);
              reject(error);
            }
          }, 100); // 100ms delay to ensure connection is stable
        };

        sharedWebSocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('💬 [MESSAGE] Shared WebSocket message received:', message.type);
            
            if (message.type === 'chat_message') {
              console.log('💬 [MESSAGE] Broadcasting to', messageHandlers.size, 'handlers');
              
              // Ensure message has required fields
              const processedMessage: ChatMessage = {
                id: message.id || `${message.username || 'anonymous'}_${message.timestamp || Date.now()}`,
                username: message.username || 'Anonymous',
                text: message.text || '[No message]',
                platform: message.platform || 'unknown' as any,
                timestamp: message.timestamp || Date.now(),
                isModerator: message.isModerator || false
              };
              
              // Notify all registered handlers
              messageHandlers.forEach(handler => {
                handler(processedMessage);
              });
            } else if (message.type === 'mod_response') {
              console.log('🛡️ [MOD_RESPONSE] Ask a Mod response received from:', message.response?.username);
              
              // Process Ask a Mod response and display as special chat message
              const modResponse = message.response;
              if (modResponse) {
                const askAModMessage: ChatMessage = {
                  id: `mod_${modResponse.username}_${modResponse.timestamp}`,
                  username: modResponse.username,
                  text: `🛡️ ${modResponse.message}`,
                  platform: modResponse.platform || 'twitch' as any,
                  timestamp: modResponse.timestamp,
                  isModerator: true,
                  isAskAModResponse: true,
                  suggestedAnswer: modResponse.suggestedAnswer
                };
                
                console.log('🛡️ [MOD_RESPONSE] Broadcasting Ask a Mod response to', messageHandlers.size, 'handlers');
                
                // Notify all registered handlers
                messageHandlers.forEach(handler => {
                  handler(askAModMessage);
                });
              }
            }
          } catch (error) {
            console.error('💬 Error parsing WebSocket message:', error);
          }
        };

        sharedWebSocket.onerror = (event) => {
          console.error('💬 ❌ [ERROR] WebSocket error event occurred');
          
          // Get the current WebSocket state safely
          const ws = sharedWebSocket;
          if (ws) {
            const readyState = ws.readyState;
            const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
            const stateName = stateNames[readyState] || 'UNKNOWN';
            
            console.error('  - readyState:', readyState, `(${stateName})`);
            console.error('  - connecting to:', WS_BASE_URL);
          } else {
            console.error('  - WebSocket object is null');
          }
          
          // Note: WebSocket error events don't contain much information for security reasons
          console.error('  - event type:', event.type);
          console.error('  - instance:', instanceId.current);
          
          // Update connection status (this will affect all components using the shared connection)
          setConnectionStatus('error');
          
          // Don't reject immediately - error events are often followed by close events
          // The close handler will handle the rejection and reconnection logic
        };

        sharedWebSocket.onclose = (event) => {
          console.log('💬 🔌 [CONNECTION] Shared WebSocket connection closed:');
          console.log('  - Code:', event.code);
          console.log('  - Reason:', event.reason || '(no reason provided)');
          console.log('  - Clean:', event.wasClean);
          console.log('  - URL:', WS_BASE_URL);
          
          sharedWebSocket = null;
          connectionPromise = null;
          
          // Notify all components using the shared connection
          setIsConnected(false);
          setConnectionStatus('error');
          
          // Clear all handlers on connection close
          messageHandlers.clear();
          
          // Handle reconnection based on close code
          const isNormalClosure = event.code === 1000 || event.code === 1001;
          
          if (!isNormalClosure && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 + (reconnectAttemptsRef.current * 2000), 10000);
            console.log(`💬 [RECONNECT] Scheduling reconnection in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              connectionPromise = null; // Clear the promise before reconnecting
              connectWebSocket();
            }, delay);
          } else if (isNormalClosure) {
            console.log('💬 [CONNECTION] Normal closure, not attempting reconnection');
          } else {
            console.error('💬 ❌ [CONNECTION] Max reconnection attempts reached. Connection failed permanently.');
          }
        };
      } catch (error) {
        console.error('💬 ❌ [ERROR] Exception creating WebSocket:', error);
        connectionPromise = null;
        sharedWebSocket = null;
        
        // Schedule retry for creation failures
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 + (reconnectAttemptsRef.current * 2000), 10000);
          console.log(`💬 [RECONNECT] Will retry after creation error in ${delay}ms`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        }
        
        reject(error);
      }
    });
    
    // Add this component's handler after connection setup
    connectionPromise.then(() => {
      messageHandlers.add(handleMessage);
      setIsConnected(true);
      setConnectionStatus('connected');
    }).catch(() => {
      setConnectionStatus('error');
    });
  }, [handleMessage]); // Only depend on handleMessage which is memoized

  // Initialize connection on mount
  useEffect(() => {
    // Capture the current instance ID at the start of the effect
    const currentInstanceId = instanceId.current;
    
    console.log(`💬 [SETUP] Initializing connection for instance ${currentInstanceId}`);
    console.log(`📊 Initial states:`, { 
      isConnected, 
      connectionStatus,
      WS_BASE_URL,
      API_BASE_URL 
    });
    
    connectWebSocket();
    
    // Auto-connect to Twitch chat on mount
    if (!twitchChatEnabled) {
      console.log('🚀 Auto-connecting to Twitch chat on mount...');
      // Use a small delay to ensure component is fully mounted
      setTimeout(() => {
        connectAndStartChat();
      }, 500);
    }
    
    // Add a timer to check connection state after mount
    const checkTimer = setTimeout(() => {
      console.log(`📊 Connection state after 3s:`, { 
        isConnected, 
        connectionStatus,
        sharedWebSocket: sharedWebSocket ? 'exists' : 'null',
        readyState: sharedWebSocket?.readyState 
      });
    }, 3000);

    return () => {
      console.log(`💬 [CLEANUP] Cleaning up instance ${currentInstanceId}`);
      clearTimeout(checkTimer);
      
      // Remove this component's handler
      messageHandlers.delete(handleMessage);
      
      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // If this was the last handler, close the shared connection
      if (messageHandlers.size === 0 && sharedWebSocket) {
        console.log('💬 [CLEANUP] Last handler removed, closing shared WebSocket');
        sharedWebSocket.close();
        sharedWebSocket = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run on mount

  // Unified connect and start functionality
  const connectAndStartChat = async () => {
    setIsToggling(true);
    setOperationStatus(null);
    
    try {
      if (twitchChatEnabled) {
        // If chat is running, stop and disconnect
        setOperationStatus('Stopping chat process...');
        const response = await fetch(`${API_BASE_URL}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'twitch_chat_stop' }),
        });
        
        if (response.ok) {
          setOperationStatus('Disconnecting from Twitch...');
          // Also disconnect the configuration
          await fetch(`${API_BASE_URL}/api/polling/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'disconnect' })
          });
          
          setTwitchChatEnabled(false);
          setOperationStatus('✅ Successfully disconnected');
          console.log('✅ Twitch chat stopped and disconnected');
        }
      } else {
        // Connect and start process: First save config, then start chat
        console.log('🔄 Starting unified connect and start process...');
        
        setOperationStatus('Configuring connection to k1m6a...');
        // Step 1: Save configuration with k1m6a as default channel
        const configResponse = await fetch(`${API_BASE_URL}/api/polling/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_config',
            config: {
              twitch: {
                channel: 'k1m6a', // Default channel
                username: 'justinfan12345'
              },
              youtube: {
                apiKey: '',
                liveChatId: '',
                pollingInterval: 5000
              },
              isActive: true
            }
          })
        });

        if (!configResponse.ok) {
          throw new Error('Failed to save chat configuration');
        }
        
        console.log('✅ Chat configuration saved');
        setOperationStatus('Starting chat monitoring...');
        
        // Step 2: Start the Twitch chat process
        const chatResponse = await fetch(`${API_BASE_URL}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'twitch_chat_start' }),
        });
        
        if (chatResponse.ok) {
          setTwitchChatEnabled(true);
          setOperationStatus('✅ Connected and monitoring k1m6a chat');
          console.log('✅ Chat connected and started successfully');
        } else {
          throw new Error('Failed to start chat process');
        }
      }
      
      // Clear status after 3 seconds
      setTimeout(() => setOperationStatus(null), 3000);
      
    } catch (error) {
      console.error('❌ Error in unified chat operation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setOperationStatus(`❌ ${errorMessage}`);
      setTimeout(() => setOperationStatus(null), 5000);
    } finally {
      setIsToggling(false);
    }
  };

  // Send host message functionality
  const sendHostMessage = async () => {
    if (!hostMessage.trim() || isSendingMessage) return;

    console.log('📤 Attempting to send host message:', hostMessage);
    console.log('📊 Connection state:', { isConnected, connectionStatus });

    setIsSendingMessage(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'send_host_message',
          message: hostMessage.trim()
        }),
      });

      if (response.ok) {
        setHostMessage('');
        console.log('✅ Host message sent successfully');
        // Message will appear via WebSocket broadcast from server
      } else {
        console.error('❌ Server rejected host message:', response.status);
      }
    } catch (error) {
      console.error('❌ Error sending host message:', error);
      alert('Failed to send message. Please check server connection.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#00ff00';
      case 'connecting': return '#ffaa00';
      case 'error': return '#ff0000';
      default: return '#888888';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return reconnectAttempt < MAX_RECONNECT_ATTEMPTS ? 'Reconnecting...' : 'Failed';
      default: return 'Disconnected';
    }
  };

  return (
    <GlassPanel title="Live Chat Viewer" className={styles.chatPanel}>
      <div className={styles.liveChatViewer}>
        {/* Header with connection status and controls */}
        <div className={styles.chatHeader}>
          <div className={styles.connectionStatus}>
            <div 
              className={styles.statusIndicator} 
              style={{ backgroundColor: getConnectionStatusColor() }}
            />
            <span className={styles.statusText}>
              {getConnectionStatusText()}
              {reconnectAttempt > 0 && ` (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`}
            </span>
          </div>
          
          <div className={styles.chatControls}>
            <button
              className={twitchChatEnabled ? styles.dangerBtn : styles.primaryBtn}
              onClick={connectAndStartChat}
              disabled={isToggling}
              style={{ 
                padding: '4px 8px', 
                fontSize: '11px',
                opacity: isToggling ? 0.5 : 1,
                cursor: isToggling ? 'not-allowed' : 'pointer'
              }}
              title={twitchChatEnabled ? 'Stop chat and disconnect from Twitch' : 'Connect to Twitch and start chat monitoring'}
            >
              {isToggling ? '⏳ Working...' : (twitchChatEnabled ? '🛑 Stop & Disconnect' : '🚀 Connect & Start')}
            </button>
            
            <button
              className={styles.secondaryBtn}
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              {isExpanded ? '📦 Collapse' : '📖 Expand'}
            </button>
          </div>
        </div>

        {/* Operation Status Display */}
        {operationStatus && (
          <div style={{
            marginBottom: '10px',
            padding: '8px 12px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#3b82f6',
            textAlign: 'center'
          }}>
            {operationStatus}
          </div>
        )}

        {/* Message counts */}
        <div className={styles.messageStats}>
          <span>Total: {messageCount.total}</span>
          <span>Twitch: {messageCount.twitch}</span>
          <span>YouTube: {messageCount.youtube}</span>
          <span>System: {messageCount.system}</span>
        </div>

        {/* Moderator management - Dropdown Style */}
        <div className={styles.moderatorSection} style={{ marginTop: '10px', position: 'relative' }}>
          <h4 style={{ fontSize: '12px', marginBottom: '5px' }}>Moderators</h4>
          
          {/* Compact dropdown button */}
          <button
            onClick={() => setIsModeratorDropdownOpen(!isModeratorDropdownOpen)}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
              color: '#FFD700',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}
          >
            <span>🛡️ Moderators ({moderatorList.length})</span>
            <span style={{ transform: isModeratorDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {/* Dropdown content */}
          {isModeratorDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '0',
              right: '0',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
              padding: '8px',
              zIndex: 1000,
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
            }}>
              {/* Add moderator input */}
              <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Add moderator username..."
                  value={newModName}
                  onChange={(e) => setNewModName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newModName.trim()) {
                      const modName = newModName.trim().toLowerCase();
                      if (!moderatorList.includes(modName)) {
                        updateModeratorList([...moderatorList, modName]);
                        setNewModName('');
                      }
                    }
                  }}
                  style={{ 
                    flex: 1, 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
                <button
                  onClick={() => {
                    if (newModName.trim()) {
                      const modName = newModName.trim().toLowerCase();
                      if (!moderatorList.includes(modName)) {
                        updateModeratorList([...moderatorList, modName]);
                        setNewModName('');
                      }
                    }
                  }}
                  disabled={!newModName.trim()}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    opacity: newModName.trim() ? 1 : 0.5,
                    cursor: newModName.trim() ? 'pointer' : 'not-allowed'
                  }}
                  className={styles.primaryBtn}
                >
                  Add
                </button>
              </div>
              
              {/* Scrollable moderator list */}
              <div style={{ 
                maxHeight: '120px', 
                overflowY: 'auto',
                overflowX: 'hidden'
              }}>
                {moderatorList.length === 0 ? (
                  <div style={{ 
                    color: '#888', 
                    fontSize: '11px', 
                    textAlign: 'center', 
                    padding: '8px' 
                  }}>
                    No moderators added yet
                  </div>
                ) : (
                  moderatorList.map((mod, index) => (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        marginBottom: '2px',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        border: '1px solid rgba(255, 215, 0, 0.2)',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ color: '#FFD700' }}>🛡️ {mod}</span>
                      <button
                        onClick={() => updateModeratorList(moderatorList.filter((_, i) => i !== index))}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '14px',
                          borderRadius: '2px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* VIP management - Dropdown Style */}
        <div className={styles.vipSection} style={{ marginTop: '10px', position: 'relative' }}>
          <h4 style={{ fontSize: '12px', marginBottom: '5px' }}>VIPs</h4>
          
          {/* Compact dropdown button */}
          <button
            onClick={() => setIsVipDropdownOpen(!isVipDropdownOpen)}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'rgba(255, 20, 147, 0.1)',
              border: '1px solid rgba(255, 20, 147, 0.3)',
              borderRadius: '6px',
              color: '#FF1493',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}
          >
            <span>💎 VIPs ({vipList.length})</span>
            <span style={{ transform: isVipDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {/* Dropdown content */}
          {isVipDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '0',
              right: '0',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 20, 147, 0.3)',
              borderRadius: '6px',
              padding: '8px',
              zIndex: 1000,
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
            }}>
              {/* Add VIP input */}
              <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Add VIP username..."
                  value={newVipName}
                  onChange={(e) => setNewVipName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newVipName.trim()) {
                      const vipName = newVipName.trim().toLowerCase();
                      if (!vipList.includes(vipName)) {
                        updateVipList([...vipList, vipName]);
                        setNewVipName('');
                      }
                    }
                  }}
                  style={{ 
                    flex: 1, 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 20, 147, 0.3)',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
                <button
                  onClick={() => {
                    if (newVipName.trim()) {
                      const vipName = newVipName.trim().toLowerCase();
                      if (!vipList.includes(vipName)) {
                        updateVipList([...vipList, vipName]);
                        setNewVipName('');
                      }
                    }
                  }}
                  disabled={!newVipName.trim()}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(255, 20, 147, 0.3)',
                    border: '1px solid rgba(255, 20, 147, 0.5)',
                    borderRadius: '4px',
                    color: '#FF1493',
                    opacity: newVipName.trim() ? 1 : 0.5,
                    cursor: newVipName.trim() ? 'pointer' : 'not-allowed'
                  }}
                  className={styles.primaryBtn}
                >
                  Add
                </button>
              </div>
              
              {/* Scrollable VIP list */}
              <div style={{ 
                maxHeight: '120px', 
                overflowY: 'auto',
                overflowX: 'hidden'
              }}>
                {vipList.length === 0 ? (
                  <div style={{ 
                    color: '#888', 
                    fontSize: '11px', 
                    textAlign: 'center', 
                    padding: '8px' 
                  }}>
                    No VIPs added yet
                  </div>
                ) : (
                  vipList.map((vip, index) => (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        marginBottom: '2px',
                        backgroundColor: 'rgba(255, 20, 147, 0.1)',
                        border: '1px solid rgba(255, 20, 147, 0.2)',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ color: '#FF1493' }}>💎 {vip}</span>
                      <button
                        onClick={() => updateVipList(vipList.filter((_, i) => i !== index))}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '14px',
                          borderRadius: '2px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chat messages container */}
        {isExpanded && (
          <div 
            ref={chatContainerRef}
            className={styles.chatContainer}
            style={{ 
              height: '400px', 
              overflowY: 'auto',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '8px',
              padding: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.2)'
            }}
          >
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                {connectionStatus === 'connected' ? 'Waiting for messages...' : 'Not connected to chat'}
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={styles.chatMessage} style={{ marginBottom: '8px' }}>
                  <div className={styles.messageHeader}>
                    <span 
                      className={styles.username}
                      style={{ 
                        color: msg.username === 'HOST' ? '#FFD700' : (msg.isModerator ? '#00ff00' : (msg.isVip ? '#FF1493' : '#ffffff')),
                        fontWeight: msg.username === 'HOST' || msg.isModerator || msg.isVip ? 'bold' : 'normal'
                      }}
                    >
                      {msg.username === 'HOST' && '👑'} {msg.isModerator && '🛡️'} {msg.isVip && '💎'} {msg.username}
                    </span>
                    <span className={styles.platform} style={{ color: '#888', fontSize: '10px' }}>
                      [{msg.platform}]
                    </span>
                    <span className={styles.timestamp} style={{ color: '#666', fontSize: '10px' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className={styles.messageContent} style={{ color: '#ddd', marginTop: '2px' }}>
                    {processEmotes(msg.text, twitchEmotes)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Host message input - moved to bottom like Twitch */}
        {isExpanded && (
          <div className={styles.hostMessageInput} style={{ marginTop: '10px' }}>
            {/* Connection status indicator */}
            {!isConnected && (
              <div style={{ 
                fontSize: '11px', 
                color: '#ff6b6b', 
                marginBottom: '5px',
                textAlign: 'center'
              }}>
                ⚠️ WebSocket not connected - messages will be queued
              </div>
            )}
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                placeholder="Send a message"
                value={hostMessage}
                onChange={(e) => setHostMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendHostMessage()}
                disabled={isSendingMessage}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: '13px',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  border: '1px solid rgba(255, 215, 0, 0.2)',
                  borderRadius: '4px',
                  color: '#fff',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  cursor: isSendingMessage ? 'not-allowed' : 'text'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(255, 215, 0, 0.5)';
                  e.target.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                  e.target.style.boxShadow = '0 0 0 2px rgba(255, 215, 0, 0.2)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 215, 0, 0.2)';
                  e.target.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                onClick={sendHostMessage}
                disabled={isSendingMessage || !hostMessage.trim()}
                style={{
                  padding: '10px 20px',
                  fontSize: '13px',
                  backgroundColor: (isSendingMessage || !hostMessage.trim()) ? 'rgba(100, 100, 100, 0.3)' : 'rgba(130, 80, 255, 0.8)',
                  border: 'none',
                  borderRadius: '4px',
                  color: (isSendingMessage || !hostMessage.trim()) ? '#666' : '#fff',
                  cursor: (isSendingMessage || !hostMessage.trim()) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  fontWeight: '600'
                }}
                onMouseEnter={(e) => {
                  if (!isSendingMessage && hostMessage.trim()) {
                    e.currentTarget.style.backgroundColor = 'rgba(130, 80, 255, 0.9)';
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = (isSendingMessage || !hostMessage.trim()) ? 'rgba(100, 100, 100, 0.3)' : 'rgba(130, 80, 255, 0.8)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {isSendingMessage ? 'Sending...' : 'Chat'}
              </button>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
});

export default LiveChatViewer;

// Set display name for debugging
LiveChatViewer.displayName = 'LiveChatViewer';