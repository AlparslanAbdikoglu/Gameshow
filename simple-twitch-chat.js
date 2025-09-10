#!/usr/bin/env node

/**
 * Simple Twitch IRC Chat Integration for Kimbillionaire
 * Connects to Twitch IRC and forwards messages to bridge server
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ===========================
// DUPLICATE PROCESS PREVENTION
// ===========================

const PID_FILE = path.join(__dirname, 'simple-twitch-chat.pid');

function checkForExistingProcess() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
            
            // Check if process is still running
            try {
                process.kill(existingPid, 0); // Signal 0 just checks if process exists
                console.log(`🚫 Another instance already running (PID: ${existingPid}). Exiting to prevent duplicates.`);
                process.exit(1);
            } catch (error) {
                // Process doesn't exist, clean up stale PID file
                console.log(`🧹 Cleaning up stale PID file for non-existent process ${existingPid}`);
                fs.unlinkSync(PID_FILE);
            }
        }
        
        // Write our PID to the file
        fs.writeFileSync(PID_FILE, process.pid.toString());
        console.log(`🔒 Created process lock (PID: ${process.pid})`);
        
        // Clean up PID file on exit
        process.on('exit', () => {
            try {
                if (fs.existsSync(PID_FILE)) {
                    fs.unlinkSync(PID_FILE);
                    console.log('🧹 Cleaned up process lock file');
                }
            } catch (error) {
                // Ignore cleanup errors
            }
        });
        
        // Handle termination signals
        ['SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2'].forEach((signal) => {
            process.on(signal, () => {
                console.log(`🛑 Received ${signal}, cleaning up...`);
                try {
                    if (fs.existsSync(PID_FILE)) {
                        fs.unlinkSync(PID_FILE);
                    }
                } catch (error) {
                    // Ignore cleanup errors
                }
                process.exit(0);
            });
        });
        
    } catch (error) {
        console.error('❌ Error checking for existing process:', error.message);
        process.exit(1);
    }
}

// Check for duplicates before starting
checkForExistingProcess();

class SimpleTwitchChat {
    constructor(config = {}) {
        // Load config from polling-config.json if exists
        this.loadConfigFromFile();
        
        // Prioritize config file, then provided config, then defaults
        this.config = {
            channel: this.loadedConfig?.channel || config.channel || 'KageWins',
            username: this.loadedConfig?.username || config.username || 'justinfan12345',
            bridgeUrl: config.bridgeUrl || 'ws://localhost:8081'
        };
        
        this.twitchSocket = null;
        this.bridgeSocket = null;
        
        // Enhanced connection management
        this.twitchReconnectAttempts = 0;
        this.bridgeReconnectAttempts = 0;
        this.lastTwitchReconnectTime = 0;
        this.lastBridgeReconnectTime = 0;
        
        // Connection quality monitoring
        this.connectionMetrics = {
            twitchLatency: 0,
            bridgeLatency: 0,
            lastTwitchResponse: Date.now(),
            lastBridgeResponse: Date.now(),
            twitchConnectionQuality: 'good', // good, degraded, poor
            bridgeConnectionQuality: 'good'
        };
        
        // Connection state tracking
        this.isShuttingDown = false;
        this.modList = [];
        this.askAModActive = false;
        this.lastPingTime = Date.now();
        this.heartbeatInterval = null;
        this.healthCheckInterval = null;
        
        // Enhanced heartbeat settings
        this.heartbeatFrequency = 30000; // 30 seconds instead of 60
        this.connectionTimeout = 90000; // 90 seconds timeout instead of 300
        this.qualityCheckFrequency = 15000; // Check connection quality every 15 seconds
    }

    loadConfigFromFile() {
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, 'polling-config.json');
            const configData = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configData);
            
            this.loadedConfig = {
                channel: config.config?.twitch?.channel || config.twitch?.channel,
                username: config.config?.twitch?.username || config.twitch?.username
            };
            
            console.log(`📋 Loaded config from file: Channel=${this.loadedConfig.channel}, Username=${this.loadedConfig.username}`);
        } catch (error) {
            console.log('⚠️ Could not load polling-config.json, using defaults:', error.message);
            this.loadedConfig = {};
        }
    }

    async start() {
        console.log('🎮 Starting Enhanced Simple Twitch Chat Integration...');
        console.log(`📺 Channel: ${this.config.channel}`);
        console.log(`🔧 Enhanced Features: Unlimited reconnection, Quality monitoring, 30s heartbeat`);
        
        this.startTime = Date.now();
        this.isShuttingDown = false;
        
        try {
            await this.connectToBridge();
            await this.connectToTwitch();
            console.log('✅ Enhanced chat integration is live!');
            
            // Start periodic health reporting
            setTimeout(() => {
                this.reportHealthStatus();
            }, 5000); // Initial health report after 5 seconds
            
        } catch (error) {
            console.error('❌ Failed to start chat integration:', error);
            console.log('🔄 Will continue attempting to connect...');
        }
    }

    async handleConfigUpdate(newConfig) {
        console.log('🔄 Config update received from bridge server');
        console.log('📋 Received config structure:', JSON.stringify(newConfig, null, 2));
        
        // Check if Twitch channel changed
        const oldChannel = this.config.channel;
        const newChannel = newConfig.config?.twitch?.channel || newConfig.twitch?.channel;
        
        if (newChannel && newChannel !== oldChannel) {
            console.log(`📺 Channel change detected: ${oldChannel} → ${newChannel}`);
            
            // Store old channel for proper disconnection
            this.oldChannel = oldChannel;
            
            // Update local config
            this.config.channel = newChannel;
            this.config.username = newConfig.config?.twitch?.username || newConfig.twitch?.username || this.config.username;
            
            // Reconnect to new channel
            await this.reconnectToNewChannel();
        } else {
            console.log('📝 Config updated but no channel change required');
        }
    }

    async reconnectToNewChannel() {
        console.log(`🔄 Reconnecting to new channel: ${this.config.channel}`);
        
        try {
            // First, leave the current channel
            if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
                const channelToLeave = this.oldChannel || this.config.channel;
                console.log(`📤 Leaving channel: #${channelToLeave}`);
                this.twitchSocket.send(`PART #${channelToLeave.toLowerCase()}`);
                
                // Remove all event listeners to prevent duplicate handling
                this.twitchSocket.onmessage = null;
                this.twitchSocket.onclose = null;
                this.twitchSocket.onerror = null;
                
                // Close the socket
                this.twitchSocket.close();
                this.twitchSocket = null;
            }
            
            // Wait a moment for clean disconnect
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Reset reconnect attempts for new connection
            this.reconnectAttempts = 0;
            
            // Connect to new channel
            await this.connectToTwitch();
            console.log(`✅ Successfully switched to channel: ${this.config.channel}`);
            
        } catch (error) {
            console.error('❌ Failed to reconnect to new channel:', error);
            // Try to reconnect in 5 seconds
            setTimeout(() => this.reconnectToNewChannel(), 5000);
        }
    }

    async connectToBridge() {
        return new Promise((resolve, reject) => {
            if (this.isShuttingDown) {
                console.log('🛑 Bridge connection cancelled - system is shutting down');
                reject(new Error('System shutting down'));
                return;
            }

            console.log(`🔗 Connecting to bridge server... (attempt ${this.bridgeReconnectAttempts + 1})`);
            
            try {
                this.bridgeSocket = new WebSocket(this.config.bridgeUrl);
                
                // Set bridge connection timeout
                const bridgeTimeout = setTimeout(() => {
                    if (this.bridgeSocket.readyState === WebSocket.CONNECTING) {
                        console.log('⏰ Bridge connection timeout - will operate independently');
                        this.bridgeSocket.close();
                        // Don't reject - allow Twitch connection to proceed independently
                        resolve();
                    }
                }, 10000); // 10 second timeout for bridge
                
                this.bridgeSocket.onopen = () => {
                    clearTimeout(bridgeTimeout);
                    console.log('✅ Connected to bridge server');
                    
                    // Update metrics
                    this.connectionMetrics.lastBridgeResponse = Date.now();
                    this.connectionMetrics.bridgeConnectionQuality = 'good';
                    this.bridgeReconnectAttempts = 0;
                    
                    // Small delay to ensure WebSocket is fully ready
                    setTimeout(() => {
                        // Register as chat integration client
                        if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
                            this.bridgeSocket.send(JSON.stringify({ 
                                type: 'register', 
                                client: 'simple_twitch_chat' 
                            }));
                            console.log('📥 Registered with bridge server as simple_twitch_chat');
                        } else {
                            console.warn('⚠️ Bridge socket not ready for registration');
                        }
                    }, 100); // 100ms delay
                    
                    resolve();
                };
                
                // Listen for config updates from bridge server
                this.bridgeSocket.onmessage = (event) => {
                    // Update bridge response time
                    this.connectionMetrics.lastBridgeResponse = Date.now();
                    this.updateConnectionQuality('bridge');
                    
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'config_updated') {
                            console.log('🔄 Received config update from bridge server');
                            const config = message.config;
                            
                            // Check if this is a disconnect action
                            if (config && config.action === 'disconnect') {
                                console.log('📴 Disconnect command received');
                                this.disconnect();
                            } else {
                                this.handleConfigUpdate(message.config).catch(error => {
                                    console.error('❌ Error handling config update:', error);
                                });
                            }
                        } else if (message.type === 'mod_list_updated') {
                            console.log('🛡️ Received mod list update from bridge server');
                            this.modList = message.modList || [];
                            console.log(`🛡️ Updated mod list: ${this.modList.join(', ')}`);
                        } else if (message.type === 'ask_a_mod_activated') {
                            console.log('🛡️ Ask a Mod activated');
                            this.askAModActive = true;
                            console.log(`🛡️ Monitoring messages from ${this.modList.length} moderators for 30 seconds`);
                        } else if (message.type === 'ask_a_mod_ended') {
                            console.log('🛡️ Ask a Mod ended');
                            this.askAModActive = false;
                        } else if (message.type === 'ping') {
                            // Respond to heartbeat ping from bridge server
                            if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
                                this.bridgeSocket.send(JSON.stringify({ 
                                    type: 'pong', 
                                    timestamp: Date.now() 
                                }));
                                // Uncomment for debugging: console.log('🏓 Responded to bridge server ping');
                            }
                        }
                    } catch (error) {
                        console.error('Error parsing bridge message:', error);
                    }
                };
                
                this.bridgeSocket.onclose = () => {
                    clearTimeout(bridgeTimeout);
                    console.log('📡 Bridge connection lost - Twitch will continue independently');
                    this.connectionMetrics.bridgeConnectionQuality = 'poor';
                    
                    // Schedule bridge reconnection (but don't block Twitch)
                    if (!this.isShuttingDown) {
                        this.scheduleBridgeReconnect();
                    }
                };
                
                this.bridgeSocket.onerror = (error) => {
                    clearTimeout(bridgeTimeout);
                    console.log('❌ Bridge connection error (will operate independently):', error.message);
                    this.connectionMetrics.bridgeConnectionQuality = 'poor';
                    
                    // For first attempt, resolve anyway (allow Twitch to work independently)
                    if (this.bridgeReconnectAttempts === 0) {
                        resolve();
                    } else {
                        this.scheduleBridgeReconnect();
                    }
                };
                
            } catch (error) {
                console.log('❌ Failed to create bridge WebSocket (will operate independently):', error.message);
                // Allow system to continue without bridge
                resolve();
            }
        });
    }
    
    // Bridge reconnection with exponential backoff
    scheduleBridgeReconnect() {
        if (this.isShuttingDown) return;
        
        this.bridgeReconnectAttempts++;
        const delay = Math.min(5000 * Math.pow(1.5, this.bridgeReconnectAttempts - 1), 120000); // Max 2 minutes
        
        console.log(`🔄 Scheduling bridge reconnection in ${Math.round(delay/1000)}s (attempt ${this.bridgeReconnectAttempts})`);
        
        setTimeout(async () => {
            if (this.isShuttingDown) return;
            try {
                await this.connectToBridge();
            } catch (error) {
                console.log('❌ Bridge reconnection failed, will retry...');
            }
        }, delay);
    }

    async connectToTwitch() {
        return new Promise((resolve, reject) => {
            if (this.isShuttingDown) {
                console.log('🛑 Connection cancelled - system is shutting down');
                reject(new Error('System shutting down'));
                return;
            }

            console.log(`🎮 Connecting to Twitch IRC... (attempt ${this.twitchReconnectAttempts + 1})`);
            const connectionStartTime = Date.now();
            
            try {
                this.twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
                
                // Set connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.twitchSocket.readyState === WebSocket.CONNECTING) {
                        console.log('⏰ Twitch connection timeout - closing and retrying');
                        this.twitchSocket.close();
                        this.scheduleTwitchReconnect('timeout');
                    }
                }, 15000); // 15 second connection timeout
                
                this.twitchSocket.onopen = () => {
                    clearTimeout(connectionTimeout);
                    const connectionTime = Date.now() - connectionStartTime;
                    console.log(`✅ Connected to Twitch IRC (${connectionTime}ms)`);
                    
                    // Update connection metrics
                    this.connectionMetrics.lastTwitchResponse = Date.now();
                    this.connectionMetrics.twitchConnectionQuality = 'good';
                    this.twitchReconnectAttempts = 0; // Reset on successful connection
                    
                    // Small delay to ensure WebSocket is fully ready
                    setTimeout(() => {
                        if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
                            // Anonymous login
                            this.twitchSocket.send('PASS oauth:fake_oauth_token');
                            this.twitchSocket.send(`NICK ${this.config.username}`);
                            this.twitchSocket.send(`JOIN #${this.config.channel.toLowerCase()}`);
                            console.log(`📥 Joined channel: #${this.config.channel}`);
                            
                            // Notify bridge server of successful connection (if available)
                            this.notifyBridgeOfTwitchStatus('connected');
                            
                            // Start enhanced monitoring
                            this.startEnhancedMonitoring();
                        } else {
                            console.warn('⚠️ Twitch socket not ready for login');
                            this.scheduleTwitchReconnect('socket_not_ready');
                        }
                    }, 100); // 100ms delay
                    
                    resolve();
                };

                this.twitchSocket.onmessage = (event) => {
                    // Update connection quality metrics
                    this.connectionMetrics.lastTwitchResponse = Date.now();
                    this.updateConnectionQuality('twitch');
                    this.handleTwitchMessage(event.data);
                };

                this.twitchSocket.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log(`🎮 Twitch IRC connection lost (code: ${event.code}, reason: ${event.reason || 'unknown'})`);
                    this.stopEnhancedMonitoring();
                    
                    // Update connection metrics
                    this.connectionMetrics.twitchConnectionQuality = 'poor';
                    
                    // Notify bridge server of disconnection (if available)
                    this.notifyBridgeOfTwitchStatus('disconnected', `Connection closed: ${event.code}`);
                    
                    // Schedule reconnection unless shutting down
                    if (!this.isShuttingDown) {
                        this.scheduleTwitchReconnect('disconnection', event.code);
                    }
                };

                this.twitchSocket.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    console.error('❌ Twitch IRC error:', error);
                    this.connectionMetrics.twitchConnectionQuality = 'poor';
                    
                    // Only reject if this is the first attempt, otherwise schedule reconnect
                    if (this.twitchReconnectAttempts === 0) {
                        reject(error);
                    } else {
                        this.scheduleTwitchReconnect('error');
                    }
                };
                
            } catch (error) {
                console.error('❌ Failed to create Twitch WebSocket:', error);
                this.scheduleTwitchReconnect('creation_error');
                reject(error);
            }
        });
    }

    handleTwitchMessage(data) {
        try {
            const lines = data.split('\r\n');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    // Handle PING with enhanced error recovery
                    if (line.startsWith('PING')) {
                        if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
                            this.twitchSocket.send('PONG :tmi.twitch.tv');
                            console.log('💓 Responded to Twitch PING');
                        } else {
                            console.warn('⚠️ Cannot respond to PING - connection not ready');
                            this.scheduleTwitchReconnect('ping_failed');
                        }
                        continue;
                    }
                    
                    // Handle Twitch IRC notices and errors
                    if (line.includes('NOTICE')) {
                        console.log('📢 Twitch Notice:', line);
                        
                        // Handle common IRC notices
                        if (line.includes('Login authentication failed')) {
                            console.error('🔐 Authentication failed - will reconnect with anonymous login');
                            this.scheduleTwitchReconnect('auth_failed');
                            return;
                        }
                        
                        if (line.includes('Error logging in') || line.includes('Invalid username')) {
                            console.error('👤 Username error - will retry with fallback');
                            this.config.username = 'justinfan' + Math.floor(Math.random() * 100000);
                            console.log(`🔄 Using fallback username: ${this.config.username}`);
                            this.scheduleTwitchReconnect('username_error');
                            return;
                        }
                        
                        if (line.includes('banned') || line.includes('suspended')) {
                            console.error('🚫 Account issue detected - switching to anonymous mode');
                            this.config.username = 'justinfan' + Math.floor(Math.random() * 100000);
                            this.scheduleTwitchReconnect('account_issue');
                            return;
                        }
                        
                        continue;
                    }
                    
                    // Handle connection errors
                    if (line.includes('RECONNECT')) {
                        console.log('🔄 Twitch server requested reconnection');
                        this.scheduleTwitchReconnect('server_restart');
                        return;
                    }
                    
                    // Handle server capacity issues
                    if (line.includes('ERROR') && line.includes('Read timeout')) {
                        console.warn('⏰ Server read timeout - will reconnect');
                        this.scheduleTwitchReconnect('read_timeout');
                        return;
                    }
                    
                    // Parse chat messages with enhanced error handling
                    const messageMatch = line.match(/:(\w+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #(\w+) :(.+)/);
                    if (messageMatch) {
                        const [, username, channel, message] = messageMatch;
                        
                        // Validate message components
                        if (!username || !channel || !message) {
                            console.warn('⚠️ Invalid message components, skipping:', { username, channel, message: message ? 'present' : 'missing' });
                            continue;
                        }
                        
                        // Verify we're in the correct channel
                        if (channel.toLowerCase() !== this.config.channel.toLowerCase()) {
                            console.warn(`⚠️ Message from wrong channel: ${channel} (expected: ${this.config.channel})`);
                            continue;
                        }
                        
                        this.processChatMessage({
                            username: username,
                            message: message.trim(),
                            channel: channel,
                            timestamp: Date.now()
                        });
                    } else if (line.includes('PRIVMSG') && !line.includes('tmi.twitch.tv')) {
                        console.warn('⚠️ Malformed PRIVMSG received:', line.substring(0, 100) + '...');
                    }
                    
                } catch (lineError) {
                    console.error('❌ Error processing IRC line:', lineError.message);
                    console.log('📝 Problematic line:', line.substring(0, 200));
                    // Continue processing other lines instead of failing completely
                }
            }
            
        } catch (error) {
            console.error('❌ Critical error in handleTwitchMessage:', error);
            
            // Check if this is a network-related error
            if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.log('🌐 Network error detected - scheduling reconnection');
                this.scheduleTwitchReconnect('network_error');
            } else if (error.name === 'SyntaxError') {
                console.log('📝 Data parsing error - connection may be corrupted');
                this.scheduleTwitchReconnect('data_corruption');
            } else {
                console.log('🔄 Unknown error - attempting recovery');
                this.scheduleTwitchReconnect('unknown_error');
            }
        }
    }

    processChatMessage(messageData) {
        try {
            // Validate message data
            if (!messageData || !messageData.username || !messageData.message) {
                console.warn('⚠️ Invalid message data received:', messageData);
                return;
            }
            
            console.log(`💬 Twitch/${messageData.username}: ${messageData.message}`);
            
            // Check if this is a mod message during Ask a Mod period
            const isModMessage = this.askAModActive && this.modList.includes(messageData.username.toLowerCase());
            
            if (isModMessage) {
                console.log(`🛡️ Mod response detected: ${messageData.username} - "${messageData.message}"`);
                
                // Send mod response to bridge server with error handling
                if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
                    try {
                        this.bridgeSocket.send(JSON.stringify({
                            type: 'mod_response',
                            platform: 'twitch',
                            username: messageData.username,
                            message: messageData.message,
                            timestamp: messageData.timestamp,
                            channel: messageData.channel
                        }));
                    } catch (bridgeError) {
                        console.error('❌ Failed to send mod response to bridge:', bridgeError.message);
                        // Don't reconnect bridge for individual message failures
                    }
                } else {
                    console.warn('📡 Bridge not available for mod response - message will be lost');
                }
            }
        } catch (error) {
            console.error('❌ Error processing chat message:', error);
            console.log('📝 Problematic message data:', messageData);
            // Continue execution rather than failing completely
        }
        
        try {
            // Check for lifeline vote commands with enhanced validation
            const upperMessage = messageData.message ? messageData.message.toUpperCase().trim() : '';
            let isLifelineVote = false;
            let lifelineVote = null;
            
            if (upperMessage) {
                // Check for lifeline voting commands - match user requirements: 50/50, VOTE, or MOD
                if (upperMessage === '50/50' || upperMessage === '50' || upperMessage === 'FIFTY' || upperMessage.includes('50')) {
                    lifelineVote = 'fiftyFifty';
                    isLifelineVote = true;
                } else if (upperMessage === 'VOTE' || upperMessage === 'REVOTE' || upperMessage.includes('VOTE')) {
                    lifelineVote = 'askAudience';
                    isLifelineVote = true;
                } else if (upperMessage === 'MOD' || upperMessage === 'ASK' || upperMessage.includes('MOD')) {
                    lifelineVote = 'phoneFriend';
                    isLifelineVote = true;
                }
            }
            
            // Send to bridge server with comprehensive error handling
            if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
                try {
                    if (isLifelineVote && lifelineVote) {
                        // Send lifeline vote
                        this.bridgeSocket.send(JSON.stringify({
                            type: 'lifeline_vote',
                            platform: 'twitch',
                            username: messageData.username,
                            vote: lifelineVote,
                            timestamp: messageData.timestamp,
                            channel: messageData.channel
                        }));
                        console.log(`🗳️ Lifeline vote detected: ${messageData.username} voted for ${lifelineVote}`);
                    }
                    
                    // Always send regular chat message for display
                    this.bridgeSocket.send(JSON.stringify({
                        type: 'chat_message',
                        platform: 'twitch',
                        username: messageData.username,
                        text: messageData.message,
                        timestamp: messageData.timestamp,
                        channel: messageData.channel
                    }));
                    
                } catch (bridgeError) {
                    console.error('❌ Failed to send message to bridge server:', bridgeError.message);
                    
                    // Check if bridge connection is actually broken
                    if (bridgeError.code === 'ENOTFOUND' || bridgeError.code === 'ECONNRESET' || bridgeError.message.includes('WebSocket')) {
                        console.log('📡 Bridge connection appears broken - will attempt reconnection');
                        this.scheduleBridgeReconnect();
                    }
                }
            } else {
                // Bridge not available - log but continue processing Twitch chat
                if (isLifelineVote) {
                    console.warn(`📡 Bridge unavailable - lifeline vote lost: ${messageData.username} → ${lifelineVote}`);
                }
                console.log('📡 Bridge unavailable - message sent to Twitch only');
            }
            
        } catch (processingError) {
            console.error('❌ Error processing message commands:', processingError);
            console.log('📝 Message that caused error:', {
                username: messageData.username,
                message: messageData.message?.substring(0, 100) || 'undefined'
            });
            // Continue execution - don't let message processing errors break the connection
        }
    }

    disconnect() {
        console.log('📴 Disconnecting from Twitch IRC...');
        
        if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
            // Send PART command to leave channel
            this.twitchSocket.send(`PART #${this.config.channel.toLowerCase()}`);
            
            // Notify bridge of disconnection
            if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
                this.bridgeSocket.send(JSON.stringify({
                    type: 'chat_connection_status',
                    platform: 'twitch',
                    status: 'disconnected',
                    channel: this.config.channel,
                    timestamp: Date.now()
                }));
            }
            
            // Remove event listeners
            this.twitchSocket.onmessage = null;
            this.twitchSocket.onclose = null;
            this.twitchSocket.onerror = null;
            
            // Close socket
            this.twitchSocket.close();
            this.twitchSocket = null;
        }
    }
    
    
    // Enhanced reconnection scheduler with adaptive backoff
    scheduleTwitchReconnect(reason = 'unknown', errorCode = null) {
        if (this.isShuttingDown) {
            console.log('🛑 Reconnection cancelled - system is shutting down');
            return;
        }

        this.twitchReconnectAttempts++;
        
        // Adaptive delay calculation based on failure type and attempt count
        let baseDelay = 2000; // Start with 2 seconds
        
        // Adjust base delay based on failure reason
        switch (reason) {
            case 'timeout':
            case 'creation_error':
                baseDelay = 5000; // Network issues need longer delays
                break;
            case 'disconnection':
                // WebSocket close codes indicate different severities
                if (errorCode === 1006) { // Abnormal closure
                    baseDelay = 3000;
                } else if (errorCode === 1001) { // Going away
                    baseDelay = 1000;
                } else {
                    baseDelay = 2000;
                }
                break;
            case 'error':
                baseDelay = 4000;
                break;
        }
        
        // Calculate exponential backoff with jitter
        const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, this.twitchReconnectAttempts - 1), 60000);
        const jitter = Math.random() * 1000; // Add up to 1 second of jitter
        const totalDelay = Math.floor(exponentialDelay + jitter);
        
        console.log(`🔄 Scheduling Twitch reconnection in ${totalDelay/1000}s (attempt ${this.twitchReconnectAttempts}, reason: ${reason})`);
        
        setTimeout(async () => {
            if (this.isShuttingDown) return;
            
            try {
                await this.connectToTwitch();
            } catch (error) {
                console.error(`❌ Twitch reconnection attempt ${this.twitchReconnectAttempts} failed:`, error);
                // The connectToTwitch method will schedule the next attempt
            }
        }, totalDelay);
    }
    
    // Helper method to notify bridge of Twitch status (independent of bridge connection)
    notifyBridgeOfTwitchStatus(status, details = '') {
        if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
            try {
                this.bridgeSocket.send(JSON.stringify({
                    type: 'chat_connection_status',
                    platform: 'twitch',
                    status: status,
                    channel: this.config.channel,
                    details: details,
                    connectionQuality: this.connectionMetrics.twitchConnectionQuality,
                    attempts: this.twitchReconnectAttempts,
                    timestamp: Date.now()
                }));
            } catch (error) {
                // Bridge notification failed, but don't let it affect Twitch connection
                console.log('📡 Bridge notification failed (continuing Twitch connection):', error.message);
            }
        }
    }
    
    // Connection quality monitoring
    updateConnectionQuality(connection) {
        const now = Date.now();
        
        if (connection === 'twitch') {
            const timeSinceResponse = now - this.connectionMetrics.lastTwitchResponse;
            
            if (timeSinceResponse < 30000) { // Less than 30 seconds
                this.connectionMetrics.twitchConnectionQuality = 'good';
            } else if (timeSinceResponse < 60000) { // Less than 60 seconds
                this.connectionMetrics.twitchConnectionQuality = 'degraded';
            } else { // More than 60 seconds
                this.connectionMetrics.twitchConnectionQuality = 'poor';
            }
        } else if (connection === 'bridge') {
            const timeSinceResponse = now - this.connectionMetrics.lastBridgeResponse;
            
            if (timeSinceResponse < 30000) {
                this.connectionMetrics.bridgeConnectionQuality = 'good';
            } else if (timeSinceResponse < 60000) {
                this.connectionMetrics.bridgeConnectionQuality = 'degraded';
            } else {
                this.connectionMetrics.bridgeConnectionQuality = 'poor';
            }
        }
    }
    
    // Enhanced monitoring system
    startEnhancedMonitoring() {
        this.stopEnhancedMonitoring(); // Clear any existing monitoring
        
        // Enhanced heartbeat
        this.heartbeatInterval = setInterval(() => {
            if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
                this.twitchSocket.send('PING :tmi.twitch.tv');
                console.log('💓 Twitch heartbeat sent');
            }
        }, this.heartbeatFrequency);
        
        // Connection quality check
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.qualityCheckFrequency);
        
        console.log('💓 Enhanced monitoring started (heartbeat: 30s, health check: 15s)');
    }
    
    stopEnhancedMonitoring() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        console.log('💔 Enhanced monitoring stopped');
    }
    
    // Perform proactive health checks
    performHealthCheck() {
        const now = Date.now();
        
        // Check Twitch connection health
        if (this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN) {
            const timeSinceLastResponse = now - this.connectionMetrics.lastTwitchResponse;
            
            // Update quality based on response time
            this.updateConnectionQuality('twitch');
            
            // Proactive reconnection for stale connections
            if (timeSinceLastResponse > this.connectionTimeout) {
                console.log(`⚠️ Twitch connection stale (${Math.round(timeSinceLastResponse/1000)}s) - forcing reconnection`);
                this.forceReconnectTwitch();
            } else if (timeSinceLastResponse > this.connectionTimeout * 0.7) {
                console.log(`⚠️ Twitch connection degrading (${Math.round(timeSinceLastResponse/1000)}s)`);
            }
        }
        
        // Report health status periodically (every 5 health checks = 75 seconds)
        if (Math.floor(now / this.qualityCheckFrequency) % 5 === 0) {
            this.reportHealthStatus();
        }
    }
    
    // Force reconnection for stale connections
    forceReconnectTwitch() {
        console.log('🔄 Forcing Twitch reconnection due to stale connection');
        
        if (this.twitchSocket) {
            // Remove event listeners to prevent double-reconnection
            this.twitchSocket.onclose = null;
            this.twitchSocket.onerror = null;
            this.twitchSocket.close();
            this.twitchSocket = null;
        }
        
        this.stopEnhancedMonitoring();
        
        // Reset attempts for forced reconnection
        this.twitchReconnectAttempts = 0;
        setTimeout(() => {
            this.connectToTwitch().catch(err => console.error('❌ Force reconnection failed:', err));
        }, 2000);
    }
    
    // Report overall system health
    reportHealthStatus() {
        const twitchStatus = this.twitchSocket ? this.twitchSocket.readyState : 'disconnected';
        const bridgeStatus = this.bridgeSocket ? this.bridgeSocket.readyState : 'disconnected';
        
        console.log(`📊 System Health Report:`);
        console.log(`   Twitch: ${twitchStatus === 1 ? '🟢 Connected' : '🔴 Disconnected'} (Quality: ${this.connectionMetrics.twitchConnectionQuality})`);
        console.log(`   Bridge: ${bridgeStatus === 1 ? '🟢 Connected' : '🟡 Independent'} (Quality: ${this.connectionMetrics.bridgeConnectionQuality})`);
        console.log(`   Uptime: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
        console.log(`   Twitch Reconnects: ${this.twitchReconnectAttempts}, Bridge Reconnects: ${this.bridgeReconnectAttempts}`);
    }
    
    cleanup() {
        console.log('🧹 Cleaning up chat integration...');
        
        this.isShuttingDown = true;
        this.stopEnhancedMonitoring();
        this.disconnect();
        
        if (this.bridgeSocket) {
            this.bridgeSocket.close();
        }
    }
}

// Start if run directly
if (require.main === module) {
    const chatIntegration = new SimpleTwitchChat({
        // Don't pass channel here - let constructor read from config file first
        username: 'justinfan12345'
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('🛑 Shutting down chat integration...');
        chatIntegration.cleanup();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        chatIntegration.cleanup();
        process.exit(0);
    });
    
    chatIntegration.start();
}

module.exports = SimpleTwitchChat;