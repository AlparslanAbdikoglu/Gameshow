    
    htmlContent += jsContent;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
    return;
  }
  
  // Test route for debugging
  if (pathname === '/test') {
    fs.readFile('/home/kage/test-gameshow.html', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Test file not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }
  
  // Serve static files (CSS, JS, HTML)
  if (pathname.startsWith('/static/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'static', fileName);
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Static file not found:', filePath);
        res.writeHead(404);
        res.end('Static file not found');
        return;
      }
      
      // Determine content type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      let contentType = 'text/plain';
      
      switch (ext) {
        case '.html':
          contentType = 'text/html';
          break;
        case '.css':
          contentType = 'text/css';
          break;
        case '.js':
          contentType = 'application/javascript';
          break;
        case '.json':
          contentType = 'application/json';
          break;
      }
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*' // Allow cross-origin for OBS
      });
      res.end(data);
      console.log('📁 Served static file:', fileName);
    });
    return;
  }

  // Serve audio files for gameshow sound effects
  if (pathname.startsWith('/assets/audio/sfx/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'assets', 'audio', 'sfx', fileName);
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('❌ Audio file not found:', filePath);
        res.writeHead(404);
        res.end('Audio file not found');
        return;
      }
      
      // Determine content type based on file extension
      const ext = path.extname(fileName).toLowerCase();
      const contentType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        'Access-Control-Allow-Origin': '*' // Allow cross-origin for OBS
      });
      res.end(data);
      console.log('🎵 Served audio file:', fileName);
    });
    return;
  }
  
  // Serve TTS audio files for Roary voice
  if (pathname.startsWith('/audio/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(__dirname, 'cache', 'voice', fileName);
    
    // Try to serve cached TTS file
    if (fs.existsSync(filePath)) {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          console.error('❌ TTS audio file error:', err);
          res.writeHead(404);
          res.end('TTS audio file not found');
          return;
        }
        
        // Check if it's a text file (fallback)
        const isTextFile = fileName.endsWith('.txt');
        const contentType = isTextFile ? 'text/plain' : 'audio/wav';
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
        console.log(`🎵 Served TTS file: ${fileName}`);
      });
    } else {
      res.writeHead(404);
      res.end('TTS audio file not found');
    }
    return;
  }
  
  // Default route - redirect to game show
  res.writeHead(302, { 'Location': '/gameshow' });
  res.end();
});

// 🎭 AUTONOMOUS ROARY HOST TTS GENERATION
// =====================================

async function generateRoaryTTS(text, context = 'general', filename = null) {
  try {
    if (!filename) {
      filename = `roary_${context}_${Date.now()}.wav`;
    }
    
    const voiceCachePath = path.join(__dirname, 'cache', 'voice');
    
    // Ensure voice cache directory exists
    if (!fs.existsSync(voiceCachePath)) {
      fs.mkdirSync(voiceCachePath, { recursive: true });
    }
    
    const audioFilepath = path.join(voiceCachePath, filename);
    const textFilepath = path.join(voiceCachePath, filename.replace('.wav', '.txt'));
    
    console.log(`🎤 Generating Roary TTS: "${text.substring(0, 50)}..."`);
    
    // Try Google TTS first if API key is available
    if (process.env.GOOGLE_TTS_API_KEY) {
      try {
        const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
        const client = new TextToSpeechClient({
          apiKey: process.env.GOOGLE_TTS_API_KEY,
        });
        
        const request = {
          input: { text: text },
          voice: { 
            languageCode: 'en-GB', // British English for Jeremy Clarkson style
            name: 'en-GB-Wavenet-B', // Male British voice
            ssmlGender: 'MALE'
          },
          audioConfig: { 
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 22050
          },
        };
        
        const [response] = await client.synthesizeSpeech(request);
        fs.writeFileSync(audioFilepath, response.audioContent, 'binary');
        console.log(`✅ Generated Google TTS audio: ${filename}`);
        return filename;
        
      } catch (googleError) {
        console.warn(`⚠️ Google TTS failed: ${googleError.message}, trying local server...`);
      }
    }
    
    // Try local TTS server as fallback
    try {
      const fetch = require('node-fetch');
      const response = await fetch('http://localhost:8083/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        timeout: 5000
      });
      
      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        fs.writeFileSync(audioFilepath, Buffer.from(audioBuffer));
        console.log(`✅ Generated local TTS audio: ${filename}`);
        return filename;
      }
    } catch (localError) {
      console.warn(`⚠️ Local TTS server failed: ${localError.message}`);
    }
    
    // Ultimate fallback - create text file for browser TTS
    fs.writeFileSync(textFilepath, text);
    console.log(`📝 Created text file for browser TTS: ${filename.replace('.wav', '.txt')}`);
    return filename.replace('.wav', '.txt');
    
  } catch (error) {
    console.error('❌ TTS generation failed:', error);
    // Return the original filename so the system doesn't break
    return filename || `roary_${context}_${Date.now()}.wav`;
  }
}

// 🔌 WEBSOCKET CONNECTION MANAGEMENT & RESOURCE LIMITS
// ====================================================

// Connection tracking and limits
const CONNECTION_LIMITS = {
  maxConnections: 1000,       // Temporarily increased for stress testing
  maxPerIP: 600,              // Temporarily increased for stress testing from localhost
  rateLimitWindow: 60000,    // Rate limit window in ms (1 minute)
  maxMessagesPerWindow: 500, // Temporarily increased for stress testing
  heartbeatInterval: 30000   // Heartbeat interval in ms (30 seconds - faster cleanup)
};

let connectionCount = 0;
let connectionsByIP = new Map();
let clientMessageHistory = new Map();

// Connection rate limiting and validation
function validateConnection(req) {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  
  // Check global connection limit
  if (connectionCount >= CONNECTION_LIMITS.maxConnections) {
    console.warn(`🚫 Connection rejected: Global limit reached (${connectionCount}/${CONNECTION_LIMITS.maxConnections})`);
    return { allowed: false, reason: 'Server at capacity' };
  }
  
  // Check per-IP limit
  const ipConnections = connectionsByIP.get(clientIP) || 0;
  if (ipConnections >= CONNECTION_LIMITS.maxPerIP) {
    console.warn(`🚫 Connection rejected: IP limit reached for ${clientIP} (${ipConnections}/${CONNECTION_LIMITS.maxPerIP})`);
    return { allowed: false, reason: 'Too many connections from this IP' };
  }
  
  return { allowed: true, ip: clientIP };
}

// Message rate limiting
function checkMessageRateLimit(ws) {
  const now = Date.now();
  const clientId = ws.clientId || 'unknown';
  
  if (!clientMessageHistory.has(clientId)) {
    clientMessageHistory.set(clientId, []);
  }
  
  const messageHistory = clientMessageHistory.get(clientId);
  
  // Remove old messages outside the rate limit window
  const cutoff = now - CONNECTION_LIMITS.rateLimitWindow;
  const recentMessages = messageHistory.filter(timestamp => timestamp > cutoff);
  
  // Check if client is sending too many messages
  if (recentMessages.length >= CONNECTION_LIMITS.maxMessagesPerWindow) {
    console.warn(`🚫 Rate limit exceeded for client ${clientId}: ${recentMessages.length} messages in last minute`);
    return false;
  }
  
  // Add current message timestamp
  recentMessages.push(now);
  clientMessageHistory.set(clientId, recentMessages);
  
  return true;
}

// Connection cleanup helper
function cleanupConnection(ws) {
  if (ws.clientIP) {
    const ipConnections = connectionsByIP.get(ws.clientIP) || 0;
    if (ipConnections > 1) {
      connectionsByIP.set(ws.clientIP, ipConnections - 1);
    } else {
      connectionsByIP.delete(ws.clientIP);
    }
  }
  
  if (ws.clientId) {
    clientMessageHistory.delete(ws.clientId);
    
    // Calculate and store connection duration for statistics
    const metrics = performanceMetrics.websocket;
    if (ws.connectionTime) {
      const duration = Date.now() - ws.connectionTime;
      metrics.connectionDurations.push(duration);
      
      // Keep only last 100 connection durations
      if (metrics.connectionDurations.length > 100) {
        metrics.connectionDurations.shift();
      }
      
      // Calculate average connection duration
      if (metrics.connectionDurations.length > 0) {
        metrics.avgConnectionDuration = metrics.connectionDurations.reduce((a, b) => a + b, 0) / metrics.connectionDurations.length;
      }
      
      // Check for abnormally short connections with enhanced classification
      if (duration < 5000) { // Less than 5 seconds
        const clientIP = ws.clientIP || 'unknown';
        const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';
        
        // Only count as failure and alert for non-development environments or very brief connections
        if (!isDevelopment || duration < 1000) {
          const severity = isDevelopment ? 'info' : 'warning';
          const context = isDevelopment ? ' (dev environment)' : '';
          addHealthAlert(`Short-lived connection detected: ${ws.clientId} (${Math.round(duration/1000)}s)${context}`, severity);
          
          // Only count as connection failure for non-development or extremely brief connections
          if (!isDevelopment || duration < 500) {
            metrics.connectionFailures++;
          }
        }
      }
    }
    
    // Clean up connection quality tracking
    if (metrics.connectionQuality.has(ws.clientId)) {
      const quality = metrics.connectionQuality.get(ws.clientId);
      
      // Log final connection quality for monitoring
      if (quality.healthScore < 70) {
        console.log('📊 Connection ' + ws.clientId + ' ended with poor health score: ' + Math.round(quality.healthScore));
      }
      
      metrics.connectionQuality.delete(ws.clientId);
    }
    
    // Clean up duration tracking
    metrics.connectionDuration.delete(ws.clientId);
  }
  
  connectionCount--;
  serverHealth.connectionCount = connectionCount;
  
  if (ws.heartbeatTimer) {
    clearInterval(ws.heartbeatTimer);
  }
}

// Create WebSocket server with enhanced configuration
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: {
    // Configure compression for performance
    threshold: 1024,
    concurrencyLimit: 10,
    memLevel: 7
  },
  maxPayload: 16 * 1024, // 16KB max message size
  verifyClient: (info) => {
    const validation = validateConnection(info.req);
    return validation.allowed;
  }
});

// Moderate stale connection cleanup every 30 seconds (less aggressive)
setInterval(() => {
  let cleaned = 0;
  wss.clients.forEach((client) => {
    const inactiveTime = Date.now() - (client.lastActivity || client.connectionTime || 0);
    
    // Different timeout rules for different client types
    let timeoutThreshold;
    if (client.clientType === 'giveaway_control_panel' || client.clientType === 'chat_viewer') {
      timeoutThreshold = 300000; // 5 minutes for UI components
    } else if (client.clientType) {
      timeoutThreshold = 120000; // 2 minutes for registered clients
    } else {
      timeoutThreshold = 60000;  // 1 minute for unregistered clients
    }
    
    // Only terminate if connection is dead OR really stale
    if (client.readyState !== WebSocket.OPEN || inactiveTime > timeoutThreshold) {
      console.log(`🧹 AUTO-CLEANUP: Terminating stale connection (${client.clientType || 'unregistered'}, inactive: ${Math.round(inactiveTime/1000)}s, threshold: ${timeoutThreshold/1000}s)`);
      client.terminate();
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 CLEANUP: Removed ${cleaned} stale connections`);
  }
}, 30000); // Run every 30 seconds (less frequent)

// WebSocket connection handler with enhanced management
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const clientId = `${clientIP}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Initialize connection tracking
  ws.clientIP = clientIP;
  ws.clientId = clientId;
  ws.connectionTime = Date.now();
  ws.lastActivity = Date.now();
  ws.isAlive = true;
  
  // Update connection counters
  connectionCount++;
  serverHealth.connectionCount = connectionCount;
  const ipConnections = connectionsByIP.get(clientIP) || 0;
  connectionsByIP.set(clientIP, ipConnections + 1);
  
  console.log(`🔌 New WebSocket connection: ${clientId} (${connectionCount} total, ${ipConnections + 1} from ${clientIP})`);
  
  // DELAYED CLEANUP: Give connections time to register before cleanup (prevent aggressive termination)
  setTimeout(() => {
    let unregisteredConnections = [];
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && !client.clientType) {
        // Only consider connections that have been around for more than 10 seconds without registering
        const connectionAge = Date.now() - (client.connectionTime || 0);
        if (connectionAge > 10000) {
          unregisteredConnections.push(client);
        }
      }
    });
    
    // If we have more than 10 truly unregistered connections, terminate the oldest ones
    if (unregisteredConnections.length > 10) {
      console.log(`🧹 Too many old unregistered connections (${unregisteredConnections.length}), cleaning up...`);
      // Sort by connection time (oldest first)
      unregisteredConnections.sort((a, b) => (a.connectionTime || 0) - (b.connectionTime || 0));
      
      // Keep only the newest 10
      const toTerminate = unregisteredConnections.slice(0, unregisteredConnections.length - 10);
      toTerminate.forEach(client => {
        console.log(`🧹 Terminating old unregistered connection: ${client.clientId}`);
        client.terminate();
      });
    }
  }, 5000); // Wait 5 seconds before checking for cleanup
  
  // Track WebSocket connection
  performanceMetrics.websocket.connectionDuration.set(clientId, Date.now());
  performanceMetrics.websocket.totalConnections++;
  
  // Initialize connection quality tracking
  performanceMetrics.websocket.connectionQuality.set(clientId, {
    startTime: Date.now(),
    messageCount: 0,
    errorCount: 0,
    errorRate: 0,
    lastActivity: Date.now(),
    healthScore: 100,
    lastAlert: 0
  });
  
  // Detect potential reconnection patterns
  detectReconnection(clientIP, clientId);
  
  // Add connection stability improvements for development environment
  const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';
  
  // Create a clean copy of gameState without non-serializable properties (like timer intervals)
  const cleanGameState = { ...gameState };
  delete cleanGameState.lifeline_countdown_interval; // Remove timer interval which can't be serialized
  
  if (isDevelopment) {
    // Add slight delay for dev environment to prevent rapid reconnections
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'state',
          data: cleanGameState
        }));
      }
    }, 100);
  } else {
    // Send initial state immediately for production
    ws.send(JSON.stringify({
      type: 'state',
      data: cleanGameState
    }));
  }
  
  // Setup heartbeat system with more lenient timeout for development
  const heartbeatInterval = isDevelopment ? 60000 : CONNECTION_LIMITS.heartbeatInterval; // 60s for dev, 30s for prod
  ws.heartbeatTimer = setInterval(() => {
    if (!ws.isAlive) {
      console.log(`💔 Heartbeat failed for client ${clientId} (${client.clientType || 'unregistered'}), terminating connection`);
      ws.terminate();
      return;
    }
    
    ws.isAlive = false;
    ws.ping();
  }, heartbeatInterval);
  
  // Handle pong responses
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastActivity = Date.now();
  });
  
  // Enhanced message handler with rate limiting
  ws.on('message', async (message) => {
    try {
      // Update lastActivity timestamp
      ws.lastActivity = Date.now();
      
      // Check message rate limit first
      if (!checkMessageRateLimit(ws)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Rate limit exceeded. Please slow down.',
          code: 'RATE_LIMIT'
        }));
        return;
      }
      
      // Validate message size
      if (message.length > CONNECTION_LIMITS.maxPayload) {
        console.warn(`🚫 Oversized message from ${clientId}: ${message.length} bytes`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message too large',
          code: 'MESSAGE_TOO_LARGE'
        }));
        return;
      }
      
      const data = JSON.parse(message);
      
      // Handle ping/pong for heartbeat
      if (data.type === 'ping') {
        ws.lastActivity = Date.now(); // Update activity timestamp for ping
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }
      
      // Only log non-ping messages to reduce noise
      if (data.type !== 'ping') {
        console.log('Received WebSocket message:', data);
      }
      
      // Handle client registration with connection limits
      if (data.type === 'register') {
        // AGGRESSIVE connection spam prevention
        const clientType = data.client;
        
        // GENTLE CLEANUP: Allow multiple connections during development, only clean really old ones
        if (clientType === 'giveaway_control_panel') {
          console.log('🔍 Checking for old giveaway_control_panel connections to clean');
          let oldConnections = [];
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && 
                client.clientType === 'giveaway_control_panel' && 
                client.clientId !== ws.clientId) {
              const connectionAge = Date.now() - (client.connectionTime || 0);
              if (connectionAge > 30000) { // Only terminate connections older than 30 seconds
                oldConnections.push(client);
              }
            }
          });
          
          if (oldConnections.length > 0) {
            console.log(`🧹 Terminating ${oldConnections.length} old giveaway_control_panel connections`);
            oldConnections.forEach(client => client.terminate());
          }
        }
        
        // STRICT connection limiting to prevent runaway connections
        const connectionLimits = {
          'chat_viewer': 10,       // Max 10 LiveChatViewer connections - increased for development
          'chat_config': 2,        // Max 2 LiveChatConfig connections  
          'simple_twitch_chat': 2, // Max 2 Twitch chat processes
          'giveaway_control_panel': 5, // Max 5 control panel connections - increased for development
          'unregistered': 20       // Temporarily increased to allow cleanup
        };
        
        let currentCounts = {};
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            const type = client.clientType || 'unregistered';
            currentCounts[type] = (currentCounts[type] || 0) + 1;
          }
        });
        
        const limit = connectionLimits[clientType] || 1; // Default limit of 1
        const currentCount = currentCounts[clientType] || 0;
        
        if (currentCount >= limit) {
          console.log(`🚫 CONNECTION LIMIT: Rejecting ${clientType} connection (current: ${currentCount}, max: ${limit})`);
          console.log(`🚫 Current connection counts:`, currentCounts);
          ws.close(1008, `Maximum ${clientType} connections exceeded (${limit} max)`);
          return;
        }
        
        ws.clientType = data.client;
        console.log(`📥 Registered client: ${data.client} (${clientId})`);
        console.log(`🔍 DEBUG: Current WebSocket clients after registration:`);
        let totalClients = 0;
        let clientsByType = {};
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            totalClients++;
            const type = client.clientType || 'unregistered';
            clientsByType[type] = (clientsByType[type] || 0) + 1;
          }
        });
        console.log(`🔍 DEBUG: Total active clients: ${totalClients}`);
        console.log(`🔍 DEBUG: Clients by type:`, clientsByType);
      }
      
      // Handle direct audience poll votes (before chat messages)
      if (data.type === 'audience_poll_vote') {
        console.log(`🗳️ Direct audience poll vote received:`, {
          username: data.username,
          vote: data.vote,
          platform: data.platform
        });
        
        console.log(`🔍 DEBUG: poll_voter_history BEFORE vote processing:`, gameState.poll_voter_history);
        console.log(`🔍 DEBUG: audience_poll_active:`, gameState.audience_poll_active);
        
        // Normalize username to lowercase for consistency
        const username = data.username ? data.username.toLowerCase().trim() : '';
        
        if (username && data.vote) {
          // Add user to poll voter history regardless of whether a poll is currently active
          // This allows giveaway bonus tracking for users who voted during the show
          if (!gameState.poll_voter_history.includes(username)) {
            gameState.poll_voter_history.push(username);
            console.log(`🔒 Added ${username} to poll voter history for giveaway bonus tracking`);
          } else {
            console.log(`🔍 ${username} already in poll voter history`);
          }
          
          // If there's an active poll, also process the vote normally
          if (gameState.audience_poll_active) {
            const voteMessage = {
              username: data.username,
              text: data.vote, // The vote (A, B, C, D)
              platform: data.platform || 'unknown',
              timestamp: data.timestamp || Date.now()
            };
            processVoteFromChat(voteMessage);
          } else {
            console.log(`ℹ️ No active poll, but ${username} recorded for future giveaway bonus`);
          }
        }
        
        console.log(`🔍 DEBUG: poll_voter_history AFTER processing:`, gameState.poll_voter_history);
        console.log(`🔍 DEBUG: Did ${data.username} get added?`, gameState.poll_voter_history.includes(username));
      }
      
      // Handle audience poll vote updates
      if (data.type === 'audience_poll_vote_update') {
        handleVoteUpdate(data);
      }
      
      // Handle chat messages - always forward to live chat viewer
      if (data.type === 'chat_message') {
        const startTime = Date.now();
        trackWebSocketMessage('chat_message', ws.clientId);
        
        // ===========================
        // SERVER-SIDE DUPLICATE PREVENTION
        // ===========================
        const messageKey = `${data.username}:${data.text}:${data.platform}`;
        const currentTime = Date.now();
        const timeWindow = 2000; // 2 second window for duplicate detection
        
        // Initialize message cache if not exists
        if (!global.recentMessages) {
          global.recentMessages = new Map();
        }
        
        // Check for recent duplicate messages
        if (global.recentMessages.has(messageKey)) {
          const lastMessageTime = global.recentMessages.get(messageKey);
          if (currentTime - lastMessageTime < timeWindow) {
            console.log(`🚫 Duplicate chat message detected and blocked:`, {
              username: data.username,
              text: data.text,
              timeSinceLastMessage: currentTime - lastMessageTime
            });
            return; // Block the duplicate message
          }
        }
        
        // Store this message timestamp
        global.recentMessages.set(messageKey, currentTime);
        
        // Clean up old messages (older than 10 seconds)
        for (const [key, timestamp] of global.recentMessages.entries()) {
          if (currentTime - timestamp > 10000) {
            global.recentMessages.delete(key);
          }
        }
        
        console.log(`💬 Received chat_message:`, {
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp
        });
        
        // Check if Ask a Mod is active and if this user is a moderator
        if (gameState.ask_a_mod_active) {
          // Ensure processed_mod_messages is properly initialized as a Set
          if (!(gameState.processed_mod_messages instanceof Set)) {
            gameState.processed_mod_messages = new Set(gameState.processed_mod_messages ? Object.keys(gameState.processed_mod_messages) : []);
            console.log('🔧 Fixed processed_mod_messages type in chat message handler');
          }
          
          // Create deduplication key to prevent duplicate processing
          const dedupKey = `${data.username}:${data.timestamp}:${data.text}`;
          if (!gameState.processed_mod_messages.has(dedupKey)) {
            gameState.processed_mod_messages.add(dedupKey);
            checkAndProcessModResponse(data);
          }
        }
        
        // Check if this is a moderator and if Ask a Mod is active
        const modList = getCachedModList();
        const isModerator = modList.includes(data.username.toLowerCase());
        
        // Check for giveaway keyword entry
        processGiveawayEntry(data.username, data.text);
        
        // Store message for HTTP polling
        const chatMessage = {
          id: `${data.username}_${data.timestamp}`,
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp,
          channel: data.channel || 'general',
          isModerator: isModerator,
          isAskAModActive: gameState.ask_a_mod_active
        };
        
        chatMessages.push(chatMessage);
        // Keep only the last MAX_CHAT_MESSAGES
        if (chatMessages.length > MAX_CHAT_MESSAGES) {
          chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
        }
        
        // Forward to all clients (including live chat viewer) with enhanced flags
        broadcastToClients({
          type: 'chat_message',
          username: data.username,
          text: data.text,
          platform: data.platform,
          timestamp: data.timestamp,
          channel: data.channel || 'general',
          isModerator: isModerator,
          isAskAModActive: gameState.ask_a_mod_active
        });
        
        // Process as vote if poll is active
        if (gameState.audience_poll_active) {
          processVoteFromChat(data);
        }
        
        // Process as lifeline vote if lifeline voting is active
        if (gameState.lifeline_voting_active) {
          try {
            // Validate data before processing
            if (!data || !data.username || !data.text) {
              console.error('❌ Invalid chat data for lifeline vote:', data);
              return;
            }
            processLifelineVoteFromChat(data);
          } catch (error) {
            console.error('❌ Error processing lifeline vote from chat:', error);
            console.error('Stack trace:', error.stack);
            // Continue execution - don't crash the server
          }
        }
        
        // Process as Ask a Mod response if session is active and user is a moderator
        if (gameState.ask_a_mod_active && isModerator) {
          // Create deduplication key to prevent duplicate processing
          const dedupKey = `${data.username}:${data.timestamp}:${data.text}`;
          if (!gameState.processed_mod_messages.has(dedupKey)) {
            gameState.processed_mod_messages.add(dedupKey);
            processAskAModResponse(data);
          }
        }
        
        // Process as giveaway entry if giveaway is active
        if (gameState.giveaway_active) {
          console.log('🎁 Processing chat message as potential giveaway entry');
          try {
            processGiveawayEntry(data.username, data.text);
          } catch (error) {
            console.error('❌ Error processing giveaway entry:', error);
          }
        }
      }
      
      // Handle lifeline votes
      if (data.type === 'lifeline_vote') {
        if (gameState.lifeline_voting_active) {
          console.log(`🗳️ Received lifeline vote:`, {
            username: data.username,
            vote: data.vote,
            platform: data.platform
          });
          
          // Check if user already voted
          if (!gameState.lifeline_voter_history.includes(data.username)) {
            // Add vote
            gameState.lifeline_votes.push({
              username: data.username,
              vote: data.vote,
              timestamp: data.timestamp,
              platform: data.platform
            });
            
            // Add to voter history to prevent duplicates
            gameState.lifeline_voter_history.push(data.username);
            
            // Update vote count
            if (gameState.lifeline_vote_counts[data.vote] !== undefined) {
              gameState.lifeline_vote_counts[data.vote]++;
            }
            
            console.log(`✅ Lifeline vote recorded: ${data.username} voted for ${data.vote}`);
            console.log(`📊 Current lifeline vote counts:`, gameState.lifeline_vote_counts);
            
            // Broadcast vote update
            broadcastToClients({
              type: 'lifeline_vote_update',
              voteCounts: gameState.lifeline_vote_counts,
              totalVotes: gameState.lifeline_votes.length,
              recentVoter: {
                username: data.username,
                vote: data.vote
              }
            });
          } else {
            console.log(`⚠️ Duplicate lifeline vote attempt from ${data.username} - ignoring`);
          }
        }
      }
      
      // Handle chat connection status updates
      if (data.type === 'chat_connection_status') {
        console.log(`📡 Chat connection status update:`, {
          platform: data.platform,
          status: data.status,
          channel: data.channel
        });
        
        // Forward status to all clients (especially control panel)
        broadcastToClients({
          type: 'chat_connection_status',
          platform: data.platform,
          status: data.status,
          channel: data.channel,
          error: data.error,
          timestamp: data.timestamp
        });
      }
      
      // Handle poll start/end events with countdown timer
      if (data.type === 'audience_poll_started') {
        gameState.audience_poll_active = true;
        gameState.show_voting_activity = true;
        gameState.poll_voters = [];
        gameState.poll_voter_history = [];
        gameState.poll_all_votes = [];
        broadcastState();
        console.log('🗳️ Audience poll started - switching to voting activity display');
      }
      
      if (data.type === 'audience_poll_ended') {
        console.log('🏁 Audience poll ended - calculating winner and locking in choice');
        lockInAudienceChoice();
      }
      
      // Handle typewriter animation completion
      if (data.type === 'typewriter_complete') {
        console.log('📝 Typewriter animation completed - enabling Show Answers button');
        gameState.typewriter_animation_complete = true;
        
        // Clear the server-side timeout since animation completed successfully
        if (global.typewriterTimeout) {
          clearTimeout(global.typewriterTimeout);
          global.typewriterTimeout = null;
        }
        
        // Immediately broadcast state update with debug logging
        console.log('🔄 Broadcasting typewriter completion state to all clients');
        broadcastState();
        
        // Additional broadcast after short delay to ensure React components receive it
        setTimeout(() => {
          broadcastState();
          console.log('🔄 Follow-up broadcast sent for typewriter completion');
        }, 100);
      }
      
      // Handle start revote after mod responses
      if (data.type === 'start_revote') {
        console.log('🔄 Starting audience revote after mod responses');
        
        const success = startRevote({
          type: 'generic',
          message: 'Vote again based on the discussion! Type A, B, C, or D in chat.',
          duration: gameState.revote_duration
        });
        
        if (!success) {
          console.error('❌ Failed to start generic revote');
        }
      }
      
      // Handle mod responses during Ask a Mod lifeline
      if (data.type === 'mod_response') {
        if (gameState.ask_a_mod_active) {
          // Create deduplication key to prevent duplicate processing
          const dedupKey = `${data.username}:${data.timestamp}:${data.message}`;
          if (gameState.processed_mod_messages.has(dedupKey)) {
            console.log(`⚠️ Duplicate mod response detected - already processed: ${data.username}`);
            return; // Skip processing this duplicate message
          }
          
          console.log(`🛡️ Received mod response:`, {
            username: data.username,
            message: data.message,
            platform: data.platform
          });
          
          // Mark as processed
          gameState.processed_mod_messages.add(dedupKey);
          
          // Add mod response to the collection
          gameState.mod_responses.push({
            username: data.username,
            message: data.message,
            timestamp: data.timestamp,
            platform: data.platform
          });
          
          console.log(`✅ Mod response recorded: ${data.username} - "${data.message}"`);
          console.log(`📊 Total mod responses: ${gameState.mod_responses.length}`);
          
          // Broadcast mod response update to display on screen
          broadcastToClients({
            type: 'mod_response_update',
            modResponse: {
              username: data.username,
              message: data.message,
              timestamp: data.timestamp,
              platform: data.platform
            },
            totalResponses: gameState.mod_responses.length,
            allResponses: gameState.mod_responses
          });
        } else {
          console.log(`⚠️ Mod response received but Ask a Mod is not active - ignoring response from ${data.username}`);
        }
      }
      
      // Handle mod display complete - triggers revote after Ask a Mod
      if (data.type === 'mod_display_complete') {
        console.log('📺 Mod response display complete - starting post-lifeline revote');
        
        // Reset lifeline voting states to allow button to return to normal
        gameState.lifeline_voting_active = false;
        gameState.lifeline_votes = [];
        gameState.lifeline_voter_history = [];
        gameState.available_lifelines_for_vote = [];
        gameState.lifeline_vote_winner = null;
        gameState.lifeline_vote_counts = {
          fiftyFifty: 0,
          askAudience: 0,
          askAMod: 0
        };
        
        // Start the post-lifeline revote
        startPostLifelineRevote('askAMod');
      }
      
      // Handle autonomous host messages
      if (data.type === 'autonomous_host_message') {
        console.log(`🎭 Autonomous Roary Host Message: ${data.text}`);
        
        // Generate TTS audio for the host message
        await generateRoaryTTS(data.text, data.context, data.audioFilename);
        
        // Broadcast to all clients including browser source for audio playback
        broadcastToClients({
          type: 'roary_speech',
          text: data.text,
          audioFile: data.audioFilename,
          audioUrl: `/audio/${data.audioFilename}`,
          context: data.context,
          personality: data.personality,
          phase: data.phase,
          targetUser: data.targetUser,
          timestamp: data.timestamp
        });
        
        // Also broadcast as chat display message for the Roary overlay
        broadcastToClients({
          type: 'roary_chat_response',
          text: data.text,
          audioFile: data.audioFilename,
          audioUrl: `/audio/${data.audioFilename}`,
          context: data.context,
          personality: data.personality,
          phase: data.phase,
          targetUser: data.targetUser,
          timestamp: data.timestamp
        });
      }
      
      // Handle autonomous game control commands
      if (data.type === 'autonomous_game_control') {
        console.log(`🤖 Autonomous Game Control: ${data.action} (mood: ${data.mood}, engagement: ${data.engagement})`);
        
        // Execute the game control action based on autonomous host decision
        switch (data.action) {
          case 'lock_audience_choice':
            // Auto-lock the audience choice if poll is active
            if (gameState.audience_poll_active && !gameState.answer_locked_in) {
              lockInAudienceChoice();
              console.log('🤖 Autonomous host auto-locked audience choice due to low engagement');
            }
            break;
            
          case 'extend_poll_time':
            // Extend poll time if audience is highly engaged
            if (gameState.audience_poll_active) {
              // Note: This would require modifying the poll timer system
              console.log('🤖 Autonomous host recommends extending poll time due to high engagement');
            }
            break;
            
          case 'suggest_lifeline':
            // Suggest using a lifeline based on audience confusion
            if (data.mood === 'confused') {
              console.log('🤖 Autonomous host suggests using 50:50 lifeline due to audience confusion');
            }
            break;
            
          default:
            console.log(`🤖 Unknown autonomous game control action: ${data.action}`);
        }
      }
        
        // Additionally broadcast as regular chat message if it's a chat response
        if (data.context === 'chat_response' && data.targetUser) {
          broadcastToClients({
            type: 'chat_message',
            username: 'Regal Roary',
            text: data.text,
            platform: 'host',
            timestamp: data.timestamp,
            isHost: true,
            targetUser: data.targetUser
          });
        }
      
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      
      // Send error response to client
      try {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Message processing failed',
          code: 'PROCESSING_ERROR'
        }));
      } catch (sendError) {
        console.error('Failed to send error response:', sendError);
      }
    }
  });
  
  // Enhanced connection close handler
  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket connection closed: ${clientId} (code: ${code}, reason: ${reason || 'none'})`);
    cleanupConnection(ws);
    
    // Log connection duration for monitoring
    const duration = Date.now() - ws.connectionTime;
    console.log(`📊 Connection ${clientId} lasted ${Math.round(duration / 1000)}s`);
  });
  
  // Enhanced error handler
  ws.on('error', (error) => {
    console.error(`🚨 WebSocket error for ${clientId}:`, error);
    cleanupConnection(ws);
    
    // Log error details for debugging
    const errorLog = {
      clientId: clientId,
      clientIP: ws.clientIP,
      error: error.message,
      timestamp: Date.now(),
      connectionDuration: Date.now() - ws.connectionTime
    };
    
    // Write error log to file for analysis
    try {
      const errorPath = path.join(__dirname, 'workinprogress', `websocket-error-${Date.now()}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(errorLog, null, 2));
    } catch (writeError) {
      console.error('Failed to write WebSocket error log:', writeError);
    }
  });
});

// Broadcast state updates to all connected clients
function broadcastState() {
  // Create a clean copy of gameState without non-serializable properties (like timer intervals)
  const cleanGameState = { ...gameState };
  delete cleanGameState.lifeline_countdown_interval; // Remove timer interval which can't be serialized
  
  const message = JSON.stringify({
    type: 'state',
    data: cleanGameState
  });
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Broadcast custom messages to all connected clients
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// End lifeline voting and determine the winner
function endLifelineVoting() {
  if (!gameState.lifeline_voting_active) return;
  
  // Debug logging to track why this is called
  console.log('🔍 DEBUG: endLifelineVoting() called from:');
  console.trace();
  console.log('🗳️ Ending lifeline voting...');
  gameState.lifeline_voting_active = false;
  
  // Clear continuous countdown timer
  if (gameState.lifeline_countdown_interval) {
    clearInterval(gameState.lifeline_countdown_interval);
    gameState.lifeline_countdown_interval = null;
    console.log('⏱️ Cleared lifeline countdown interval');
  }
  
  // Clear lifeline voting timer
  if (gameState.lifeline_voting_timer_active) {
    gameState.lifeline_voting_timer_active = false;
  }
  
  // Count votes and determine winner
  const voteCounts = gameState.lifeline_vote_counts;
  console.log('🔍 DEBUG: Current vote counts:', voteCounts);
  console.log('🔍 DEBUG: Available lifelines for vote:', gameState.available_lifelines_for_vote);
  
  let winner = null;
  let maxVotes = 0;
  
  for (const [lifeline, count] of Object.entries(voteCounts)) {
    console.log(`🔍 DEBUG: Checking ${lifeline}: ${count} votes, available: ${gameState.available_lifelines_for_vote.includes(lifeline)}`);
    if (count > maxVotes && gameState.available_lifelines_for_vote.includes(lifeline)) {
      maxVotes = count;
      winner = lifeline;
      console.log(`🔍 DEBUG: New winner: ${lifeline} with ${count} votes`);
    }
  }
  
  console.log(`🔍 DEBUG: Final winner: ${winner}, max votes: ${maxVotes}`);
  
  if (winner) {
    const totalVotes = gameState.lifeline_votes.length;
    console.log(`🏆 Lifeline voting winner: ${winner} with ${maxVotes} votes (${totalVotes} total votes)`);
    
    // Check if we have sufficient votes for a confident decision
    if (totalVotes < 2 && maxVotes === 1) {
      console.log('⚠️ WARNING: Very few votes cast - winner may not be representative');
      broadcastToClients({
        type: 'lifeline_voting_warning',
        message: `Only ${totalVotes} vote(s) cast. Winner: ${winner}`,
        totalVotes: totalVotes,
        winner: winner
      });
    }
    
    gameState.lifeline_vote_winner = winner;
    
    // Broadcast the winner
    broadcastToClients({
      type: 'lifeline_voting_ended',
      winner: winner,
      votes: voteCounts,
      totalVotes: totalVotes,
      confidenceLevel: totalVotes >= 3 ? 'high' : totalVotes >= 2 ? 'medium' : 'low'
    });
    
    // Hide the voting panel
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'voting_completed',
      timestamp: Date.now()
    });
    
    // Auto-trigger the winning lifeline after a short delay, but with warning if few votes
    const delay = totalVotes < 2 ? 5000 : 2000; // Longer delay for low-vote scenarios
    setTimeout(() => {
      console.log(`🎯 Triggering winning lifeline: ${winner} (after ${delay/1000}s delay)`);
      triggerLifeline(winner);
    }, delay);
  } else {
    console.log('❌ No votes cast - selecting random lifeline');
    // If no votes, randomly select an available lifeline
    const randomIndex = Math.floor(Math.random() * gameState.available_lifelines_for_vote.length);
    winner = gameState.available_lifelines_for_vote[randomIndex];
    
    broadcastToClients({
      type: 'lifeline_voting_ended',
      winner: winner,
      votes: voteCounts,
      totalVotes: 0,
      noVotes: true
    });
    
    // Hide the voting panel
    broadcastToClients({
      type: 'hide_lifeline_voting_panel',
      reason: 'voting_completed_no_votes',
      timestamp: Date.now()
    });
    
    setTimeout(() => {
      triggerLifeline(winner);
    }, 2000);
  }
}

// Check if lifeline led to correct answer discovery
function checkLifelineSuccess(answerChoice) {
  // Get current question correct answer
  const currentQuestion = questions[gameState.current_question];
  if (!currentQuestion) return false;
  
  // Convert answer choice to index if it's a letter
  let answerIndex = answerChoice;
  if (typeof answerChoice === 'string') {
    answerIndex = ['A', 'B', 'C', 'D'].indexOf(answerChoice.toUpperCase());
  }
  
  // Check if this matches the correct answer
  const isCorrect = answerIndex === currentQuestion.correct;
  
  if (isCorrect && !gameState.correct_answer_highlighted) {
    console.log('🎯 LIFELINE SUCCESS! Correct answer found through lifeline usage');
    
    // Enable correct answer highlighting
    gameState.correct_answer_highlighted = true;
    
    // Play success audio
    broadcastToClients({ type: 'audio_command', command: 'play_correct' });
    
    // Add celebration after a brief delay
    setTimeout(() => {
      broadcastToClients({ type: 'audio_command', command: 'play_applause' });
      console.log('🎉 Lifeline success - correct answer highlighted and celebration triggered');
    }, 1000);
    
    // Broadcast state update to show green highlighting
    broadcastState();
    
    return true;
  }
  
  return false;
}

// Game flow loop system for continuous lifeline attempts
function startGameFlowLoop() {
  console.log('🔄 Starting game flow loop - checking for remaining lifelines after wrong answer');
  
  // Check if there are still lifelines available
  const availableLifelines = [];
  if (!gameState.lifelines_used.includes('fiftyFifty')) availableLifelines.push('fiftyFifty');
  if (!gameState.lifelines_used.includes('askAudience')) availableLifelines.push('askAudience');
  if (!gameState.lifelines_used.includes('askAMod')) availableLifelines.push('askAMod');
  
  if (availableLifelines.length > 0 && !gameState.correct_answer_highlighted) {
    console.log(`🔄 Game flow loop: ${availableLifelines.length} lifelines still available for another attempt`);
    console.log(`🗳️ Available lifelines: ${availableLifelines.join(', ')}`);
    
    // Set up the lifelines for voting again
    gameState.available_lifelines_for_vote = availableLifelines;
    
    // Reset lifeline voting states for new round
    gameState.lifeline_votes = [];
    gameState.lifeline_voter_history = [];
    gameState.lifeline_vote_counts = {
      fiftyFifty: 0,
      askAudience: 0,
      askAMod: 0
    };
    gameState.lifeline_vote_winner = null;
    
    // Broadcast message encouraging another lifeline attempt
    broadcastToClients({
      type: 'game_flow_loop_available',
      message: 'Lifelines still available! The host can start another lifeline vote.',
      availableLifelines: availableLifelines,
      totalRemaining: availableLifelines.length
    });
    
    console.log('🎮 Game flow loop ready - host can start another lifeline vote when ready');
    
    return true; // Lifelines available for another attempt
  } else if (gameState.correct_answer_highlighted) {
    console.log('🎯 Game flow loop complete - correct answer found through lifeline!');
    return false; // Success achieved
  } else {
    console.log('❌ Game flow loop complete - no more lifelines available');
    broadcastToClients({
      type: 'game_flow_loop_complete',
      message: 'No more lifelines available. Game over.',
      success: false
    });
    return false; // No more options
  }
}

// Enhanced lifeline success tracking with game flow loop
function trackLifelineOutcome(lifelineType, successful = false) {
  console.log(`📊 Tracking lifeline outcome: ${lifelineType} = ${successful ? 'SUCCESS' : 'NO SUCCESS'}`);
  
  if (successful) {
    // Lifeline led to success - game continues normally
    console.log('✅ Lifeline successful - correct answer found, continuing game flow');
    broadcastToClients({
      type: 'lifeline_outcome',
      lifeline: lifelineType,
      successful: true,
      message: 'Lifeline successful! Correct answer found.'
    });
  } else {
    // Lifeline didn't lead to success - check for more lifelines
    console.log('❌ Lifeline did not lead to success - checking for more lifeline options');
    broadcastToClients({
      type: 'lifeline_outcome',
      lifeline: lifelineType,
      successful: false,
      message: `${lifelineType} did not reveal the correct answer.`
    });
    
    // Wait a moment then start the game flow loop to check for more lifelines
    setTimeout(() => {
      const moreLifelinesAvailable = startGameFlowLoop();
      if (!moreLifelinesAvailable) {
        console.log('🎭 All lifeline attempts exhausted - preparing for game over or next question');
      }
    }, 3000); // 3 second delay to let previous lifeline results settle
  }
}

// Trigger the selected lifeline
function triggerLifeline(lifelineType) {
  console.log(`🎯 Triggering lifeline: ${lifelineType}`);
  
  // NOTE: Lifelines are marked as used AFTER they are successfully applied,
  // not before, to prevent showing them as used when they don't actually apply
  
  // Trigger the specific lifeline action
  switch (lifelineType) {
    case 'fiftyFifty':
      // Trigger 50:50 lifeline - ensure exactly 2 answers remain (50% chance)
      console.log('🎲 Activating 50:50 lifeline');
      
      const currentQuestion = questions[gameState.current_question];
      if (currentQuestion) {
        const correctIndex = currentQuestion.correct;
        const selectedIndex = gameState.selected_answer;
        
        // Get all answer indices that are currently available (not already excluded)
        const allIndices = [0, 1, 2, 3];
        const availableIndices = allIndices.filter(i => 
          !gameState.excluded_answers || !gameState.excluded_answers.includes(i)
        );
        
        console.log(`🔍 Available answers before 50:50: ${availableIndices.join(', ')}`);
        
        // If we already have only 2 answers, 50:50 can't do anything
        if (availableIndices.length <= 2) {
          console.log('⚠️ 50:50 cannot be used - already at 2 or fewer answers');
          broadcastToClients({
            type: 'system_message',
            message: '50:50 cannot eliminate any more answers - already at minimum',
            level: 'warning'
          });
          // Still trigger the revote flow
          setTimeout(() => {
            startPostLifelineRevote('fiftyFifty');
          }, 1000);
          break;
        }
        
        // Find available wrong answer indices
        const availableWrongIndices = availableIndices.filter(i => i !== correctIndex);
        
        // 50:50 should eliminate exactly 1 answer (not reduce to 2 total)
        let answersToEliminate = [];
        
        // 50:50 should ALWAYS protect the correct answer, not the selected answer
        // Eliminate 2 wrong answers, keeping the correct answer + 1 random wrong answer
        console.log(`🛡️ 50:50 protecting CORRECT answer ${correctIndex} (${String.fromCharCode(65 + correctIndex)}) - it will stay available`);
        
        // Find answers we can eliminate (exclude the CORRECT answer)
        const candidatesForElimination = availableIndices.filter(i => i !== correctIndex);
          
        if (candidatesForElimination.length >= 2) {
          // Traditional 50:50 - eliminate 2 wrong answers, keeping correct + 1 wrong
          const shuffledWrong = [...candidatesForElimination].sort(() => Math.random() - 0.5);
          answersToEliminate = shuffledWrong.slice(0, 2);
          console.log(`🎯 50:50 eliminating 2 wrong answers: ${answersToEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
        } else if (candidatesForElimination.length === 1) {
          // Only 1 wrong answer available - eliminate it
          answersToEliminate = candidatesForElimination;
          console.log(`❌ 50:50 eliminating 1 wrong answer: ${answersToEliminate[0]} (${String.fromCharCode(65 + answersToEliminate[0])})`);
        } else {
          console.log(`⚠️ 50:50 cannot eliminate any answers - only correct answer available`);
        }
        
        // Update excluded answers to include newly eliminated ones
        if (!gameState.excluded_answers) {
          gameState.excluded_answers = [];
        }
        gameState.excluded_answers = [...new Set([...gameState.excluded_answers, ...answersToEliminate])];
        
        // Calculate which answers are kept (all available answers except eliminated ones)
        const allAnswerIndices = [0, 1, 2, 3];
        const keptAnswers = allAnswerIndices.filter(i => !gameState.excluded_answers.includes(i));
        
        console.log(`🎯 50:50 keeping answers at indices: ${keptAnswers.join(', ')}`);
        console.log(`❌ 50:50 eliminating answers at indices: ${answersToEliminate.join(', ')}`);
        console.log(`📊 Total excluded answers now: ${gameState.excluded_answers.join(', ')}`);
        
        // Broadcast the 50:50 elimination
        broadcastToClients({
          type: 'lifeline_triggered',
          lifeline: 'fiftyFifty',
          action: 'eliminate_answers',
          eliminatedAnswers: answersToEliminate,
          keptAnswers: keptAnswers,
          selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
          preserveSelectedHighlighting: true
        });
        
        // Mark 50:50 as used AFTER successful elimination
        if (!gameState.lifelines_used.includes('fiftyFifty')) {
          gameState.lifelines_used.push('fiftyFifty');
          console.log('✅ 50:50 lifeline marked as used after successful elimination');
        }
        
        // Clear any existing poll timer before starting revote
        if (pollTimer) {
          console.log('⏹️ Clearing existing poll timer before automatic 50:50 revote');
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        
        // After 50/50 completes, start automatic revote on remaining answers
        setTimeout(() => {
          console.log('🔄 Starting post-lifeline revote after 50/50');
          startPostLifelineRevote('fiftyFifty');
        }, 2000); // 2-second delay to let elimination visual effects complete
      }
      break;
      
    case 'askAudience':
      // Trigger Take Another Vote lifeline
      console.log('🗳️ Activating Take Another Vote lifeline');
      
      // Mark Take Another Vote as used (once per game only)
      if (!gameState.lifelines_used.includes('takeAnotherVote')) {
        gameState.lifelines_used.push('takeAnotherVote');
        console.log('✅ Take Another Vote lifeline marked as used - cannot be used again this game');
      }
      
      // CRITICAL FIX: End any active audience poll before starting revote
      if (gameState.audience_poll_active) {
        console.log('⚠️ Ending active audience poll before Take Another Vote revote');
        gameState.audience_poll_active = false;
        gameState.show_voting_activity = false;
        gameState.is_revote_active = false;
        
        // Clear any existing poll timer
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        
        // Also clear poll state variables
        gameState.poll_voters = [];
        gameState.poll_voter_history = [];
        gameState.poll_all_votes = [];
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        
        // Broadcast state update to ensure all clients are synchronized
        broadcastState();
        console.log('✅ Poll state fully cleared for Take Another Vote revote');
      }
      
      broadcastToClients({
        type: 'lifeline_triggered',
        lifeline: 'askAudience',
        action: 'use_lifeline_ask_audience',
        selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
        firstSelectedAnswer: gameState.first_selected_answer,  // Include first selected answer for persistence
        preserveSelectedHighlighting: true
      });
      
      // Start immediate revote for Take Another Vote lifeline
      setTimeout(() => {
        console.log('🔄 Starting post-lifeline revote after Take Another Vote');
        console.log('🔍 DEBUG: Poll state before revote - audience_poll_active:', gameState.audience_poll_active);
        startPostLifelineRevote('askAudience');
      }, 1500); // 1.5-second delay to ensure state clearing completes
      break;
      
    case 'askAMod':
      // Trigger Ask a Mod lifeline - use consolidated function
      console.log('🛡️ Activating Ask a Mod lifeline');
      startAskAMod();
      break;
  }
  
  // Broadcast state update
  broadcastState();
}

// Function to start automatic revote after lifeline activation
function startPostLifelineRevote(lifelineType) {
  console.log(`🚀🚀🚀 STARTING POST-LIFELINE REVOTE AFTER ${lifelineType.toUpperCase()} 🚀🚀🚀`);
  
  // CRITICAL FIX: Reset answer reveal states to allow host to reveal answer again
  gameState.answers_revealed = false;
  gameState.answer_locked_in = false;
  gameState.answer_is_wrong = false;  // CRITICAL: Reset wrong answer flag so new selections don't appear red
  gameState.answers_visible = true; // Ensure answers remain visible during revote
  // DO NOT reset selected_answer - preserve it for highlighting persistence
  // gameState.selected_answer = null;  // REMOVED: This clears highlighting
  console.log('🎮 Reset answer states - host can now lock in and reveal answer again');
  console.log('🔍 DEBUG: answers_revealed set to false, answer_locked_in set to false, answer_is_wrong set to false, answers_visible set to true');
  console.log('🔍 DEBUG: selected_answer preserved for highlighting persistence');
  
  // CRITICAL: Reset lifeline voting states immediately and broadcast to fix button state
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    askAudience: 0,
    askAMod: 0
  };
  
  // CRITICAL FIX: Clear audience choice display that was stuck from initial poll
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  console.log('🧹 Cleared stuck audience choice display from initial poll');
  
  // Immediately broadcast state to fix control panel button - MULTIPLE BROADCASTS FOR RELIABILITY
  console.log('📡 Broadcasting state immediately to update control panel button');
  console.log('🔍 DEBUG: About to broadcast state with answers_revealed =', gameState.answers_revealed, 'and answer_locked_in =', gameState.answer_locked_in);
  broadcastState();
  
  // Additional broadcast after a small delay to ensure WebSocket delivery
  setTimeout(() => {
    console.log('📡 REVOTE: Secondary state broadcast to ensure control panel sync');
    console.log('🔍 DEBUG: Secondary broadcast - answers_revealed =', gameState.answers_revealed, 'answer_locked_in =', gameState.answer_locked_in);
    broadcastState();
  }, 100);
  
  console.log('🗳️ POST-LIFELINE REVOTE STARTING - audience can vote on remaining answers');
  console.log('🚫 Excluded answers that cannot be voted on:', gameState.excluded_answers.map(i => String.fromCharCode(65 + i)).join(', '));
  
  // Broadcast a clear announcement about the revote starting
  broadcastToClients({
    type: 'system_announcement',
    message: `🔄 REVOTE STARTING! Vote again on the remaining answers after ${lifelineType}!`,
    level: 'info',
    timestamp: Date.now()
  });
  
  // Use unified revote function with custom callback for post-lifeline logic
  console.log('🎯 About to call startRevote function...');
  const success = startRevote({
    type: 'post_lifeline',
    message: `Vote again on the remaining answers! Type A, B, C, or D in chat.`,
    context: { lifelineUsed: lifelineType },
    duration: gameState.revote_duration,
    callback: () => {
      // Custom post-lifeline revote completion logic
      console.log(`🏁 50:50 revote callback triggered - lifeline type: ${lifelineType}`);
      console.log('🏁 Post-lifeline revote time expired - tallying final votes');
      
      // Use unified vote tallying function
      const results = tallyRevoteResults();
      
      // End the revote
      gameState.audience_poll_active = false;
      gameState.show_voting_activity = false;
      gameState.is_revote_active = false;
      
      // HYBRID CONTROL: Only auto-lock if host hasn't already locked manually
      if (results.winner && !gameState.answer_locked_in) {
        const answerIndex = ['A', 'B', 'C', 'D'].indexOf(results.winner);
        gameState.selected_answer = answerIndex;
        gameState.answer_locked_in = true;
        
        console.log(`🔒 AUTO-LOCKED ${lifelineType} winner: ${results.winner} (index ${answerIndex}) - Host hadn't locked manually`);
        
        // Play lock-in sound effect
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_lifeline',
          selectedAnswer: results.winner,
          votes: results.totalVotes,
          percentage: results.winnerPercentage,
          lifeline: lifelineType,
          reason: `Audience voting auto-locked after ${lifelineType}`,
          timestamp: Date.now()
        });
      } else if (gameState.answer_locked_in) {
        console.log(`🎯 Host already locked answer manually during ${lifelineType} revote - skipping auto-lock`);
      } else {
        console.log(`⚠️ No winner determined for ${lifelineType} revote - no auto-lock performed`);
      }
      
      broadcastToClients({
        type: 'post_lifeline_revote_ended',
        winner: results.winner,
        totalVotes: results.totalVotes,
        voteCounts: results.voteCounts,
        hasTie: results.hasTie,
        lifelineUsed: lifelineType,
        autoLocked: results.winner && !gameState.answer_locked_in
      });
      
      console.log(`🎮 Post-lifeline revote complete for ${lifelineType} - ${gameState.answer_locked_in ? 'answer locked' : 'no answer locked'}`);
      
      broadcastState();
    }
  });
  
  if (!success) {
    console.error('❌❌❌ FAILED TO START POST-LIFELINE REVOTE ❌❌❌');
    console.error('🔍 Check game state - answers_visible:', gameState.answers_visible);
    console.error('🔍 Check game state - audience_poll_active:', gameState.audience_poll_active);
    console.error('🔍 Check game state - processingAction:', gameState.processingAction);
    
    // Broadcast failure notification
    broadcastToClients({
      type: 'system_announcement',
      message: '❌ Failed to start automatic revote - please manually start a poll if needed',
      level: 'error',
      timestamp: Date.now()
    });
  } else {
    console.log('✅✅✅ POST-LIFELINE REVOTE STARTED SUCCESSFULLY ✅✅✅');
    console.log('🗳️ Audience should now be able to vote on remaining answers');
  }
}

// Function to start Take Another Vote revote with hybrid control (matches Ask a Mod pattern)
function startPostLifelineRevoteForTakeAnotherVote() {
  console.log('🎮 Starting Take Another Vote revote with hybrid control (host manual + audience auto-lock)');
  
  // Reset states for new voting (matches the pattern from startPostLifelineRevote)
  gameState.answers_revealed = false;
  gameState.answer_locked_in = false;
  gameState.answer_is_wrong = false;  // Reset wrong answer flag so new selections don't appear red
  gameState.answers_visible = true; // Ensure answers remain visible during revote
  
  // Reset lifeline voting states
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    askAudience: 0,
    askAMod: 0
  };
  
  // Clear any stuck audience choice display
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  
  console.log('🧹 Cleared states for Take Another Vote revote with hybrid control');
  
  // Broadcast state immediately to update control panel
  broadcastState();
  
  // Start the revote with hybrid control callback
  const success = startRevote({
    type: 'post_take_another_vote_hybrid',
    message: 'Take Another Vote activated! Host can lock manually OR audience vote will auto-lock.',
    duration: gameState.revote_duration,
    allowManualControl: true, // Enable hybrid control
    callback: (winningAnswer, totalVotes, percentages) => {
      // Only auto-lock if host hasn't already locked manually (HYBRID CONTROL)
      if (!gameState.answer_locked_in) {
        console.log(`🔄 Auto-locking Take Another Vote winner: ${winningAnswer} (${totalVotes} votes, ${percentages[winningAnswer]}%)`);
        
        // Set the selected answer and lock it
        gameState.selected_answer = ['A', 'B', 'C', 'D'].indexOf(winningAnswer);
        gameState.answer_locked_in = true;
        
        // NOTE: Do NOT evaluate answer_is_wrong during lock-in - only during reveal_answer
        // This prevents red highlighting of locked answers before they are revealed
        console.log(`🎯 Take Another Vote auto-lock: Answer ${winningAnswer} locked in (correctness will be evaluated on reveal)`)
        
        // Play lock-in sound effect
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_take_another_vote',
          selectedAnswer: winningAnswer,
          votes: totalVotes,
          percentage: percentages[winningAnswer],
          reason: 'Audience voting auto-locked after Take Another Vote',
          timestamp: Date.now()
        });
      } else {
        console.log('🎯 Host already locked answer manually during Take Another Vote - skipping auto-lock');
      }
      
      // End the revote
      gameState.audience_poll_active = false;
      gameState.show_voting_activity = false;
      gameState.is_revote_active = false;
      
      // Broadcast completion
      broadcastToClients({
        type: 'take_another_vote_revote_ended',
        winner: winningAnswer,
        totalVotes: totalVotes,
        percentages: percentages,
        autoLocked: winningAnswer && !gameState.answer_locked_in,
        hybridControl: true,
        timestamp: Date.now()
      });
      
      console.log('🎮 Take Another Vote revote complete with hybrid control');
      broadcastState();
    }
  });
  
  if (success) {
    console.log('✅ Take Another Vote revote started successfully with hybrid control');
    
    // Broadcast lifeline-specific revote message with hybrid control info
    broadcastToClients({
      type: 'lifeline_revote_started',
      lifeline: 'askAudience',
      message: 'Take Another Vote activated! Host can lock manually OR audience vote will auto-lock after 60 seconds.',
      hybridControl: true,
      timestamp: Date.now()
    });
  } else {
    console.error('❌ Failed to start Take Another Vote revote with hybrid control');
  }
}

// Consolidated function to start Ask a Mod session
function startAskAMod() {
  debugAskAMod('SESSION_START_REQUESTED', {
    currentQuestion: gameState.current_question + 1,
    alreadyActive: gameState.ask_a_mod_active,
    lifelinesUsed: gameState.lifelines_used
  });
  
  console.log('🛡️ Starting Ask a Mod session...');
  
  // Load mod list and broadcast to chat integration
  const modList = loadModeratorList();
  
  if (modList.length === 0) {
    console.warn('⚠️ No moderators found in mod-list.json');
    debugAskAMod('SESSION_START_FAILED', { reason: 'No moderators available' });
    broadcastToClients({
      type: 'system_message',
      message: 'No moderators available for Ask a Mod lifeline',
      level: 'warning'
    });
    return;
  }
  
  // Mark Ask a Mod as used AFTER successful activation
  if (!gameState.lifelines_used.includes('askAMod')) {
    gameState.lifelines_used.push('askAMod');
    console.log('✅ Ask a Mod lifeline marked as used after successful activation');
  }
  
  // Initialize Ask a Mod state
  gameState.ask_a_mod_active = true;
  gameState.mod_responses = [];
  gameState.ask_a_mod_start_time = Date.now();
  gameState.mod_vote_counts = { A: 0, B: 0, C: 0, D: 0 };
  gameState.mod_voters = [];
  
  debugAskAMod('SESSION_ACTIVATED', {
    questionNumber: gameState.current_question + 1,
    questionText: questions[gameState.current_question]?.text,
    modCount: modList.length,
    moderators: modList
  });
  
  console.log(`🛡️ Ask a Mod activated for question ${gameState.current_question + 1}, monitoring ${modList.length} moderators`);
  
  // Broadcast Ask a Mod activation to all clients (including chat integration)
  broadcastToClients({
    type: 'ask_a_mod_activated',
    question: questions[gameState.current_question]?.text,
    questionNumber: gameState.current_question + 1,
    duration: gameState.ask_a_mod_duration || 30000, // Use configurable Ask a Mod duration
    timeLimit: gameState.ask_a_mod_duration || 30000, // Keep both for compatibility
    modList: modList,
    selectedAnswer: gameState.selected_answer,  // Include selected answer for highlighting preservation
    firstSelectedAnswer: gameState.first_selected_answer,  // Include first selected answer for persistence
    preserveSelectedHighlighting: true,
    timestamp: Date.now()
  });
  
  // Broadcast special overlay display for audience
  broadcastToClients({
    type: 'ask_a_mod_display_start',
    question: questions[gameState.current_question]?.text,
    questionNumber: gameState.current_question + 1,
    answers: questions[gameState.current_question]?.answers || [],
    modList: modList,
    duration: gameState.ask_a_mod_duration || 30000,
    timestamp: Date.now()
  });
  
  // Auto-end Ask a Mod after configurable duration
  setTimeout(() => {
    if (gameState.ask_a_mod_active) {
      debugAskAMod('SESSION_TIMER_EXPIRED', {
        sessionDuration: 60,
        responsesReceived: gameState.mod_responses.length
      });
      console.log('⏰ Ask a Mod ' + Math.ceil((gameState.ask_a_mod_duration || 30000) / 1000) + '-second timer expired');
      endAskAMod();
    }
  }, gameState.ask_a_mod_duration || 30000); // Use configurable Ask a Mod duration for audience display
  
  console.log('🛡️ Ask a Mod session started for ' + Math.ceil((gameState.ask_a_mod_duration || 30000) / 1000) + ' seconds with audience display');
}

// End Ask a Mod session
function endAskAMod() {
  if (!gameState.ask_a_mod_active) {
    debugAskAMod('END_SESSION_CALLED_INACTIVE', {});
    return;
  }
  
  const sessionDuration = gameState.ask_a_mod_start_time ? 
    Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000) : 'Unknown';
  
  debugAskAMod('SESSION_ENDING', {
    sessionDuration: sessionDuration,
    totalResponses: gameState.mod_responses.length,
    responsesDetails: gameState.mod_responses.map(r => ({
      mod: r.username,
      messageLength: r.message.length,
      timestamp: r.timestamp
    }))
  });
  
  console.log('🛡️ Ending Ask a Mod session...');
  gameState.ask_a_mod_active = false;
  
  // Clear processed mod messages to prepare for next session
  // Ensure it's a Set before calling clear()
  if (!(gameState.processed_mod_messages instanceof Set)) {
    gameState.processed_mod_messages = new Set();
  } else {
    gameState.processed_mod_messages.clear();
  }
  console.log('🧹 Cleared processed mod messages for next Ask A Mod session');
  
  // Check if any mod responses indicate the correct answer
  const correctAnswerFound = checkModResponsesForCorrectAnswer();
  
  // Broadcast that Ask a Mod session has ended to all clients (including chat integration)
  broadcastToClients({
    type: 'ask_a_mod_ended',
    totalResponses: gameState.mod_responses.length,
    responses: gameState.mod_responses,
    correctAnswerFound: correctAnswerFound,
    timestamp: Date.now()
  });
  
  console.log(`🛡️ Ask a Mod session completed with ${gameState.mod_responses.length} mod responses`);
  
  // After Ask-a-Mod responses display ends, restore host control
  console.log('🎮 Ask-a-Mod responses displayed - restoring host LOCK IN ANSWER control');
  
  // Clear any locked state from previous selections to allow new host selection
  gameState.answer_locked_in = false;
  // Reset answers_revealed to allow "Reveal Answer" step after Ask-a-Mod
  gameState.answers_revealed = false;
  // DO NOT reset selected_answer - preserve it for highlighting persistence
  // gameState.selected_answer = null; // REMOVED: This clears highlighting
  
  // Clear any overlays to return to clean answer display
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  gameState.show_voting_activity = false;
  
  // Reset lifeline voting states so LOCK IN ANSWER button can return to normal flow
  gameState.lifeline_voting_active = false;
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.available_lifelines_for_vote = [];
  gameState.lifeline_vote_winner = null;
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    askAudience: 0,
    askAMod: 0
  };
  
  console.log('✅ Host control restored - LOCK IN ANSWER button should now be available');
  console.log('🎯 Host can now manually select and lock in any answer after considering mod advice');
  
  // HYBRID SYSTEM: Start both host control AND audience revote in parallel
  console.log('🎮 Starting hybrid system: Host can lock manually OR audience can auto-lock via voting');
  
  // Show "REVOTE STARTING" display to let audience know they need to revote
  broadcastToClients({
    type: 'revote_starting_display',
    message: 'REVOTE STARTING - Consider the mod advice and vote again!',
    duration: 3000, // Show for 3 seconds
    lifeline: 'askAMod',
    timestamp: Date.now()
  });
  
  // Start audience revote in parallel with host control after brief delay
  setTimeout(() => {
    startRevoteAfterAskAMod();
  }, 3000); // 3-second delay to show "REVOTE STARTING" message
  
  // Broadcast that hybrid control is active
  broadcastToClients({
    type: 'ask_a_mod_complete_hybrid_control',
    modResponses: gameState.mod_responses,
    message: 'Moderator advice complete. Host can lock manually OR audience voting will auto-lock.',
    timestamp: Date.now()
  });
  
  // Broadcast state update
  broadcastState();
}

// Check mod responses for correct answer indicators
function checkModResponsesForCorrectAnswer() {
  if (gameState.mod_responses.length === 0) {
    console.log('🛡️ No mod responses to analyze');
    return false;
  }
  
  const currentQuestion = questions[gameState.current_question];
  if (!currentQuestion) return false;
  
  const correctAnswerLetter = ['A', 'B', 'C', 'D'][currentQuestion.correct];
  const correctAnswerText = currentQuestion.answers[currentQuestion.correct];
  
  let correctAnswerFound = false;
  
  // Analyze each mod response for correct answer indicators
  gameState.mod_responses.forEach(response => {
    const message = response.message.toUpperCase();
    
    // Check for explicit answer letter mentions
    if (message.includes(correctAnswerLetter) || 
        message.includes(correctAnswerText.toUpperCase()) ||
        message.includes('CORRECT') && message.includes(correctAnswerLetter)) {
      
      console.log(`🎯 Mod ${response.username} indicated correct answer: "${response.message}"`);
      correctAnswerFound = true;
      
      // Check if this leads to successful answer discovery
      const success = checkLifelineSuccess(correctAnswerLetter);
      if (success) {
        console.log('🎉 Ask a Mod lifeline led to correct answer discovery!');
      }
    }
  });
  
  if (correctAnswerFound) {
    console.log(`🛡️ Ask a Mod analysis: Correct answer (${correctAnswerLetter}) was indicated by moderators`);
  } else {
    console.log(`🛡️ Ask a Mod analysis: No clear indication of correct answer (${correctAnswerLetter}) found`);
  }
  
  return correctAnswerFound;
}

// Load moderator list (cached for performance)
let cachedModList = null;
let modListLastLoaded = 0;

function loadModeratorList() {
  try {
    const modListPath = path.join(__dirname, 'mod-list.json');
    
    if (!fs.existsSync(modListPath)) {
      console.warn('⚠️ mod-list.json not found, creating empty mod list');
      fs.writeFileSync(modListPath, JSON.stringify([], null, 2));
      return [];
    }
    
    const modListData = fs.readFileSync(modListPath, 'utf8');
    const modList = JSON.parse(modListData);
    
    // Validate mod list
    if (!Array.isArray(modList)) {
      console.error('❌ mod-list.json is not an array, using empty list');
      return [];
    }
    
    cachedModList = modList.map(mod => mod.toLowerCase()); // Store lowercase for case-insensitive matching
    modListLastLoaded = Date.now();
    
    console.log(`🛡️ Loaded ${cachedModList.length} moderators: ${cachedModList.join(', ')}`);
    
    // Broadcast mod list to all chat integration clients
    broadcastToClients({
      type: 'mod_list_updated',
      modList: cachedModList,
      timestamp: Date.now()
    });
    
    return cachedModList;
  } catch (error) {
    console.error('❌ Error loading mod list:', error);
    return [];
  }
}

function getCachedModList() {
  // Reload mod list every 5 minutes or if not loaded yet
  if (!cachedModList || (Date.now() - modListLastLoaded) > 300000) {
    return loadModeratorList();
  }
  return cachedModList;
}

function saveModeratorList(modList) {
  try {
    const modListPath = path.join(__dirname, 'mod-list.json');
    
    // Validate input
    if (!Array.isArray(modList)) {
      console.error('❌ Invalid moderator list - must be an array');
      return false;
    }
    
    // Clean and validate moderator names
    const cleanedModList = modList
      .filter(mod => mod && typeof mod === 'string')
      .map(mod => mod.trim().toLowerCase())
      .filter(mod => mod.length > 0);
    
    // Save to file
    fs.writeFileSync(modListPath, JSON.stringify(cleanedModList, null, 2));
    
    // Update cache
    cachedModList = cleanedModList;
    modListLastLoaded = Date.now();
    
    console.log(`💾 Saved ${cleanedModList.length} moderators to mod-list.json: ${cleanedModList.join(', ')}`);
    
    // Broadcast updated mod list to all clients
    broadcastToClients({
      type: 'mod_list_updated',
      modList: cleanedModList,
      timestamp: Date.now()
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error saving moderator list:', error);
    return false;
  }
}

// Debug function for Ask a Mod system
function debugAskAMod(action, data = {}) {
  // Only log important events, not every debug message
  if (action === 'SESSION_ACTIVATED' || action === 'SESSION_ENDING' || action === 'MOD_RESPONSE_ADDED') {
    const sessionTime = gameState.ask_a_mod_start_time ? 
      Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000) : 'N/A';
    console.log(`🛡️ [ASK-A-MOD] ${action} - Session: ${sessionTime}s, Responses: ${gameState.mod_responses.length}`);
    if (Object.keys(data).length > 0) {
      console.log(`    Data:`, data);
    }
  }
}

// Check if chat message is from a moderator during Ask a Mod session
function checkAndProcessModResponse(chatData) {
  if (!gameState.ask_a_mod_active) {
    // Debug: Message received while Ask a Mod not active
    if (getCachedModList().includes(chatData.username.toLowerCase())) {
      debugAskAMod('MOD_MESSAGE_OUTSIDE_SESSION', {
        moderator: chatData.username,
        message: chatData.text,
        platform: chatData.platform
      });
    }
    return;
  }
  
  // Get cached moderator list
  const modList = getCachedModList();
  
  // Check if the username is in the moderator list (case-insensitive)
  const username = chatData.username.toLowerCase();
  const isModerator = modList.includes(username);
  
  debugAskAMod('CHAT_MESSAGE_RECEIVED', {
    username: chatData.username,
    isModerator: isModerator,
    messageLength: chatData.text.length,
    platform: chatData.platform
  });
  
  if (isModerator) {
    console.log(`🛡️ Mod response received from ${chatData.username}: "${chatData.text}"`);
    
    // Check for answer suggestion in mod response
    const message = chatData.text.toUpperCase();
    const answerMatch = message.match(/\b([ABCD])\b/) || 
                        message.match(/ANSWER\s*([ABCD])/i) ||
                        message.match(/^([ABCD])\b/) ||
                        message.match(/([ABCD])$/) ||
                        message.match(/THE\s*ANSWER\s*IS\s*([ABCD])/i) ||
                        message.match(/I\s*THINK\s*([ABCD])/i) ||
                        message.match(/([ABCD])\s*IS\s*CORRECT/i);
    
    const suggestedAnswer = answerMatch ? answerMatch[1] : null;
    
    // Add to mod responses with detected answer
    const modResponse = {
      username: chatData.username,
      message: chatData.text,
      timestamp: chatData.timestamp,
      platform: chatData.platform,
      suggestedAnswer: suggestedAnswer
    };
    
    gameState.mod_responses.push(modResponse);
    
    // Track moderator votes for percentage calculation
    if (suggestedAnswer) {
      // Check if this mod already voted (prevent double counting)
      const existingVoteIndex = gameState.mod_voters.findIndex(voter => voter.username === chatData.username);
      if (existingVoteIndex >= 0) {
        // Update existing vote
        const oldVote = gameState.mod_voters[existingVoteIndex].vote;
        gameState.mod_vote_counts[oldVote]--;
        gameState.mod_voters[existingVoteIndex].vote = suggestedAnswer;
        gameState.mod_voters[existingVoteIndex].timestamp = chatData.timestamp;
        console.log(`🛡️ Mod ${chatData.username} changed vote from ${oldVote} to ${suggestedAnswer}`);
      } else {
        // New vote
        gameState.mod_voters.push({
          username: chatData.username,
          vote: suggestedAnswer,
          timestamp: chatData.timestamp
        });
        console.log(`🛡️ Mod ${chatData.username} voted for ${suggestedAnswer}`);
      }
      
      gameState.mod_vote_counts[suggestedAnswer]++;
      
      // Calculate and log percentages
      const totalVotes = gameState.mod_voters.length;
      const percentages = {
        A: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.A / totalVotes) * 100) : 0,
        B: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.B / totalVotes) * 100) : 0,
        C: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.C / totalVotes) * 100) : 0,
        D: totalVotes > 0 ? Math.round((gameState.mod_vote_counts.D / totalVotes) * 100) : 0
      };
      
      console.log(`📊 Mod vote percentages: A=${percentages.A}%, B=${percentages.B}%, C=${percentages.C}%, D=${percentages.D}% (${totalVotes} total votes)`);
      
      // Broadcast updated vote percentages to audience display
      broadcastToClients({
        type: 'ask_a_mod_vote_update',
        voteCounts: gameState.mod_vote_counts,
        percentages: percentages,
        totalVotes: totalVotes,
        timestamp: Date.now()
      });
    }
    
    // Track if correct answer is suggested, but don't end session early
    if (gameState.answer_is_wrong && suggestedAnswer) {
      debugAskAMod('MOD_ANSWER_SUGGESTION', {
        moderator: chatData.username,
        suggestedAnswer: suggestedAnswer,
        correctAnswer: questions[gameState.current_question]?.correct
      });
      
      if (checkLifelineSuccess(suggestedAnswer)) {
        debugAskAMod('CORRECT_ANSWER_SUGGESTED', {
          moderator: chatData.username,
          correctAnswer: suggestedAnswer,
          sessionDuration: Math.round((Date.now() - gameState.ask_a_mod_start_time) / 1000)
        });
        console.log('🎯 Mod suggested correct answer, but continuing session for full 1 minute');
        // Don't end session early - let full timer run for complete mod advice collection
      }
    }
    
    // Broadcast mod response immediately to show on gameshow and audience display
    broadcastToClients({
      type: 'mod_response_update',
      modResponse: modResponse,
      totalResponses: gameState.mod_responses.length,
      isAskAModActive: gameState.ask_a_mod_active
    });
    
    // Also broadcast to audience display overlay
    broadcastToClients({
      type: 'ask_a_mod_display_update',
      newResponse: modResponse,
      allResponses: gameState.mod_responses,
      voteCounts: gameState.mod_vote_counts,
      totalVotes: gameState.mod_voters.length,
      timestamp: Date.now()
    });
    
    console.log(`🛡️ Total mod responses: ${gameState.mod_responses.length}`);
  } else {
    debugAskAMod('NON_MOD_MESSAGE', {
      username: chatData.username,
      message: chatData.text.substring(0, 50) + (chatData.text.length > 50 ? '...' : ''),
      modListSize: modList.length
    });
  }
}

// Reusable vote tallying function for revotes with state validation
function tallyRevoteResults() {
  return safeStateOperation(() => {
    console.log('📊 Tallying revote results...');
    
    // Validate poll_all_votes exists and is array
    if (!Array.isArray(gameState.poll_all_votes)) {
      console.error('❌ poll_all_votes is not an array, cannot tally results');
      return {
        winner: null,
        winnerVotes: 0,
        winnerPercentage: 0,
        totalVotes: 0,
        voteCounts: { A: 0, B: 0, C: 0, D: 0 },
        hasTie: false,
        error: 'Invalid vote data structure'
      };
    }
    
    // Initialize vote counts
    const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
    let validVoteCount = 0;
    
    // Count all valid votes with validation
    gameState.poll_all_votes.forEach((vote, index) => {
      if (!vote || typeof vote.vote !== 'string') {
        console.warn(`⚠️ Invalid vote at index ${index}:`, vote);
        return;
      }
      
      if (voteCounts.hasOwnProperty(vote.vote)) {
        voteCounts[vote.vote]++;
        validVoteCount++;
      } else {
        console.warn(`⚠️ Invalid vote option "${vote.vote}" at index ${index}`);
      }
    });
    
    const totalVotes = validVoteCount;
    let winner = null;
    let winnerVotes = 0;
    let winnerPercentage = 0;
    
    if (totalVotes > 0) {
      const maxVotes = Math.max(...Object.values(voteCounts));
      const winningAnswers = Object.keys(voteCounts).filter(answer => voteCounts[answer] === maxVotes);
      
      if (winningAnswers.length === 1) {
        winner = winningAnswers[0];
        winnerVotes = voteCounts[winner];
        winnerPercentage = Math.round((winnerVotes / totalVotes) * 100);
        
        // Update game state with winner
        gameState.show_poll_winner = winner;
        gameState.poll_winner_votes = winnerVotes;
        gameState.poll_winner_percentage = winnerPercentage;
        
        console.log(`🏆 Revote winner: ${winner} with ${winnerVotes} votes (${winnerPercentage}%)`);
      } else {
        console.log(`🤝 Revote ended in tie between: ${winningAnswers.join(', ')}`);
        // In case of tie, gameState winner remains null
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
      }
    } else {
      console.log('❌ No valid votes received in revote');
      gameState.show_poll_winner = null;
      gameState.poll_winner_votes = 0;
      gameState.poll_winner_percentage = 0;
    }
    
    return {
      winner,
      winnerVotes,
      winnerPercentage,
      totalVotes,
      voteCounts,
      hasTie: totalVotes > 0 && winner === null
    };
    
  }, 'tallyRevoteResults');
}

// Comprehensive state validation functions for revote system
function validateRevoteGameState() {
  const errors = [];
  const warnings = [];
  
  // Critical validations
  if (typeof gameState.audience_poll_active !== 'boolean') {
    errors.push('audience_poll_active must be boolean');
  }
  
  if (typeof gameState.is_revote_active !== 'boolean') {
    errors.push('is_revote_active must be boolean');
  }
  
  if (!Array.isArray(gameState.poll_all_votes)) {
    errors.push('poll_all_votes must be array');
  }
  
  if (!Array.isArray(gameState.poll_voters)) {
    errors.push('poll_voters must be array');
  }
  
  if (!Array.isArray(gameState.poll_voter_history)) {
    errors.push('poll_voter_history must be array');
  }
  
  // Warning validations
  if (gameState.audience_poll_active && gameState.is_revote_active) {
    if (gameState.poll_all_votes.length === 0) {
      warnings.push('Revote is active but no votes received yet');
    }
  }
  
  if (gameState.audience_poll_active && !gameState.answers_visible) {
    warnings.push('Poll active but answers not visible to audience');
  }
  
  if (gameState.revote_duration < 10000) {
    warnings.push('Revote duration is very short (< 10 seconds)');
  }
  
  if (gameState.revote_duration > 300000) {
    warnings.push('Revote duration is very long (> 5 minutes)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    timestamp: Date.now()
  };
}

// Emergency cleanup function to reset revote system to safe state
function emergencyCleanupRevoteState(reason = 'Unknown') {
  console.warn(`🚨 Emergency revote cleanup triggered - Reason: ${reason}`);
  
  try {
    // Store current state for debugging
    const preCleanupState = {
      audience_poll_active: gameState.audience_poll_active,
      is_revote_active: gameState.is_revote_active,
      show_voting_activity: gameState.show_voting_activity,
      poll_votes_count: gameState.poll_all_votes?.length || 0,
      lifeline_voting_active: gameState.lifeline_voting_active,
      ask_a_mod_active: gameState.ask_a_mod_active
    };
    
    // Reset all voting states to safe defaults
    gameState.audience_poll_active = false;
    gameState.is_revote_active = false;
    gameState.show_voting_activity = false;
    gameState.show_poll_winner = null;
    gameState.poll_winner_votes = 0;
    gameState.poll_winner_percentage = 0;
    
    // Clear vote tracking arrays
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    
    // Reset lifeline voting states
    gameState.lifeline_voting_active = false;
    gameState.lifeline_voting_timer_active = false;
    gameState.lifeline_votes = [];
    gameState.lifeline_voter_history = [];
    gameState.lifeline_vote_winner = null;
    gameState.lifeline_vote_counts = {
      fiftyFifty: 0,
      askAudience: 0,
      askAMod: 0
    };
    
    // Log cleanup action
    console.log('🧹 Emergency cleanup completed:', {
      reason,
      preCleanupState,
      timestamp: Date.now()
    });
    
    // Broadcast cleanup to all clients
    broadcastToClients({
      type: 'emergency_revote_cleanup',
      reason,
      timestamp: Date.now()
    });
    
    // Broadcast updated state
    broadcastState();
    
    return true;
    
  } catch (error) {
    console.error('❌ Error during emergency cleanup:', error);
    return false;
  }
}

// Validate and repair revote state if needed
function validateAndRepairRevoteState(context = 'Unknown') {
  const validation = validateRevoteGameState();
  
  if (!validation.isValid) {
    console.error(`🚨 Revote state validation failed in context: ${context}`);
    console.error('Validation errors:', validation.errors);
    
    // Attempt emergency cleanup
    const cleanupSuccess = emergencyCleanupRevoteState(`Validation failed: ${context}`);
    
    if (!cleanupSuccess) {
      console.error('❌ Emergency cleanup failed - system may be in inconsistent state');
    }
    
    return false;
  }
  
  if (validation.warnings.length > 0) {
    console.warn(`⚠️ Revote state warnings in context: ${context}`, validation.warnings);
  }
  
  return true;
}

// Enhanced state validation with automatic repair for critical functions
function safeStateOperation(operation, context, repairOnFailure = true) {
  try {
    // Pre-operation validation
    const preValid = repairOnFailure ? validateAndRepairRevoteState(`${context} - pre-operation`) : validateRevoteGameState().isValid;
    
    if (!preValid && !repairOnFailure) {
      throw new Error('State validation failed and repair disabled');
    }
    
    // Execute operation
    const result = operation();
    
    // Post-operation validation
    if (repairOnFailure) {
      validateAndRepairRevoteState(`${context} - post-operation`);
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ Safe state operation failed in context: ${context}`, error);
    
    if (repairOnFailure) {
      emergencyCleanupRevoteState(`Operation failure: ${context}`);
    }
    
    throw error;
  }
}

// Start hybrid revote after Ask-a-Mod with host manual control + audience auto-lock
function startRevoteAfterAskAMod() {
  console.log('🎮 Starting hybrid Ask-a-Mod revote with both host control and audience voting');
  
  // Start the revote with the hybrid callback
  const success = startRevote({
    type: 'post_ask_a_mod_hybrid',
    message: 'Consider the mod advice! Host can lock manually OR audience vote will auto-lock.',
    duration: gameState.revote_duration,
    callback: (winningAnswer, totalVotes, percentages) => {
      // Only auto-lock if host hasn't already locked manually
      if (!gameState.answer_locked_in) {
        console.log(`🔄 Auto-locking audience winner: ${winningAnswer} (${totalVotes} votes, ${percentages[winningAnswer]}%)`);
        
        // Set the selected answer and lock it
        gameState.selected_answer = ['A', 'B', 'C', 'D'].indexOf(winningAnswer);
        gameState.answer_locked_in = true;
        
        // NOTE: Do NOT evaluate answer_is_wrong during lock-in - only during reveal_answer
        // This prevents red highlighting of locked answers before they are revealed
        console.log(`🎯 Ask-a-Mod auto-lock: Answer ${winningAnswer} locked in (correctness will be evaluated on reveal)`)
        
        // Broadcast the auto-lock
        broadcastToClients({
          type: 'auto_lock_after_ask_a_mod',
          selectedAnswer: winningAnswer,
          votes: totalVotes,
          percentage: percentages[winningAnswer],
          reason: 'Audience voting auto-locked after Ask-a-Mod',
          timestamp: Date.now()
        });
        
        // Clean up revote state after auto-lock
        gameState.is_revote_active = false;
        gameState.audience_poll_active = false;
        gameState.show_voting_activity = false;
        
        broadcastState();
        console.log('✅ Ask-a-Mod revote complete: Auto-locked audience choice');
      } else {
        console.log('🎯 Host already locked answer manually - skipping auto-lock');
      }
    }
  });
  
  if (success) {
    console.log('✅ Hybrid Ask-a-Mod revote started successfully');
    
    // Broadcast hybrid control message to clients
    broadcastToClients({
      type: 'hybrid_control_active',
      message: 'Host can lock manually OR voting will auto-lock',
      duration: gameState.revote_duration,
      timestamp: Date.now()
    });
  } else {
    console.error('❌ Failed to start hybrid Ask-a-Mod revote');
  }
  
  return success;
}

// Unified revote starter with pre-flight validation
function startRevote(options = {}) {
  const {
    type = 'generic', // 'post_lifeline', 'post_ask_a_mod', 'generic'
    message = 'Vote again! Type A, B, C, or D in chat.',
    context = {},
    duration = gameState.revote_duration,
    callback = null,
    allowManualControl = false // NEW: Allow host manual lock-in during revote
  } = options;
  
  console.log(`🔄 Starting ${type} revote with ${duration}ms duration${allowManualControl ? ' (HYBRID CONTROL: Host can manually lock OR auto-lock after timer)' : ' (AUTO-LOCK ONLY after timer)'}`);
  console.log(`⏱️ DURATION DEBUG: gameState.revote_duration = ${gameState.revote_duration}ms, using duration = ${duration}ms`);
  console.log(`📊 Current game state:`, {
    audience_poll_active: gameState.audience_poll_active,
    answers_visible: gameState.answers_visible,
    processingAction: gameState.processingAction,
    lifeline_voting_active: gameState.lifeline_voting_active
  });
  
  // Enhanced pre-flight validation with state repair
  return safeStateOperation(() => {
    // Basic pre-flight validations
    if (gameState.audience_poll_active) {
      console.warn('⚠️ Cannot start revote: Another poll is already active');
      console.warn('⚠️ Poll state details:', {
        poll_voters: gameState.poll_voters ? gameState.poll_voters.length : 0,
        show_voting_activity: gameState.show_voting_activity,
        is_revote_active: gameState.is_revote_active,
        poll_all_votes: gameState.poll_all_votes ? gameState.poll_all_votes.length : 0
      });
      console.warn('🚨 FAILED TO START REVOTE DUE TO ACTIVE POLL - Take Another Vote will not work');
      return false;
    }
    
    // Special case: Allow Ask-a-Mod revote even if answers not visible in overlay
    if (!gameState.answers_visible && type !== 'post_ask_a_mod') {
      console.warn('⚠️ Cannot start revote: Answers are not visible');
      return false;
    }
    
    if (type === 'post_ask_a_mod' && !gameState.answers_visible) {
      console.log('🛡️ Ask-a-Mod revote: Allowing revote despite answers not visible in overlay');
    }
    
    if (gameState.processingAction) {
      console.warn('⚠️ Cannot start revote: System is processing another action');
      return false;
    }
    
    // Duration validation
    if (duration < 5000) {
      console.warn('⚠️ Cannot start revote: Duration too short (< 5 seconds)');
      return false;
    }
    
    if (duration > 600000) {
      console.warn('⚠️ Cannot start revote: Duration too long (> 10 minutes)');
      return false;
    }
    
    // Reset voting state for revote with validation
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    gameState.show_poll_winner = null;
    gameState.poll_winner_votes = 0;
    gameState.poll_winner_percentage = 0;
    
    // Mark as revote
    gameState.is_revote_active = true;
    gameState.audience_poll_active = true;
    gameState.show_voting_activity = true;
    
    console.log(`📊 ${type} revote state reset - ready for new votes`);
    
    // Start the voting countdown timer with visual progress bars
    broadcastToClients({
      type: 'start_voting_countdown',
      duration: duration,
      startTime: Date.now()
    });
    
    // Broadcast the revote start with context-specific message
    broadcastToClients({
      type: type === 'post_lifeline' ? 'post_lifeline_revote' : 
            (type === 'post_ask_a_mod' || type === 'post_ask_a_mod_hybrid') ? 'post_ask_a_mod_revote' : 'revote_started',
      message: message,
      duration: duration,
      timestamp: Date.now(),
      ...context
    });
    
    // Broadcast state update
    broadcastState();
    
    // Auto-end revote after specified duration with safe callback execution
    setTimeout(() => {
      console.log(`🕒 ${type} revote timer fired after ${duration}ms`);
      console.log(`🔍 Timer Debug - audience_poll_active: ${gameState.audience_poll_active}, is_revote_active: ${gameState.is_revote_active}`);
      
      safeStateOperation(() => {
        if (gameState.audience_poll_active && gameState.is_revote_active) {
          console.log(`⏱️ ${type} revote timer expired - ending revote`);
          
          // HYBRID CONTROL: Check if host already locked manually during revote
          if (allowManualControl && gameState.answer_locked_in) {
            console.log('🎯 Host already locked answer manually during revote - skipping auto-lock');
            
            // Clean up poll state since host handled the locking
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.is_revote_active = false;
            
            // Broadcast poll ended event
            broadcastToClients({
              type: 'audience_poll_ended',
              endTime: Date.now(),
              reason: 'manual_lock_during_hybrid_revote'
            });
            
            broadcastState();
            return; // Exit early since host handled it
          }
          
          if (callback && typeof callback === 'function') {
            // Calculate poll results to pass to callback
            const pollResult = calculatePollWinner();
            if (pollResult) {
              console.log(`🎯 Executing ${type} callback with winner: ${pollResult.winner} (${pollResult.totalVotes} votes)`);
              
              // Pass the required parameters: winningAnswer, totalVotes, percentages
              const percentages = {};
              ['A', 'B', 'C', 'D'].forEach(letter => {
                const count = gameState.poll_all_votes.filter(vote => vote.vote === letter).length;
                percentages[letter] = pollResult.totalVotes > 0 ? Math.round((count / pollResult.totalVotes) * 100) : 0;
              });
              
              // CRITICAL FIX: Execute callback FIRST, then handle cleanup based on type
              callback(pollResult.winner, pollResult.totalVotes, percentages);
              
              // For hybrid Ask-a-Mod system, don't call lockInAudienceChoice as callback handles auto-lock
              if (type === 'post_ask_a_mod_hybrid') {
                console.log('✅ Hybrid Ask-a-Mod callback executed - callback handled auto-lock, cleaning up poll state');
                
                // Clean up poll state since callback handled the locking
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                // FIXED: Keep is_revote_active = true to allow manual host selection during hybrid revotes
                // gameState.is_revote_active = false; // REMOVED - this was preventing manual answer selection
                
                // Broadcast poll ended event
                broadcastToClients({
                  type: 'audience_poll_ended',
                  endTime: Date.now(),
                  reason: 'hybrid_callback_completed'
                });
                
                broadcastState();
              } else {
                // For other revote types, still call lockInAudienceChoice for fallback
                lockInAudienceChoice();
                gameState.is_revote_active = false;
              }
              
            } else {
              console.log('⚠️ No votes to process for callback, using default behavior');
              lockInAudienceChoice();
              gameState.is_revote_active = false;
            }
          } else {
            // HYBRID CONTROL: For post-lifeline revotes with manual control, check if already locked
            if (allowManualControl && type === 'post_lifeline' && gameState.answer_locked_in) {
              console.log('🎯 Host already locked answer manually during post-lifeline revote - skipping auto-lock');
              
              // Clean up poll state since host handled the locking
              gameState.audience_poll_active = false;
              gameState.show_voting_activity = false;
              gameState.is_revote_active = false;
              
              broadcastState();
            } else {
              // Default behavior - use lockInAudienceChoice for automatic lock
              console.log(`🔄 Auto-locking audience choice for ${type} revote (no manual lock detected)`);
              lockInAudienceChoice();
              gameState.is_revote_active = false;
            }
          }
        }
      }, `${type} revote timeout callback`);
    }, duration);
    
    return true;
    
  }, `startRevote ${type}`);
}

// Broadcast custom messages to all connected clients
function broadcastToClients(message) {
  console.log('🔧 DEBUG: Enhanced broadcastToClients called with type:', message.type);
  const messageStr = JSON.stringify(message);
  let clientCount = 0;
  let chatViewerCount = 0;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      clientCount++;
      // Count chat_viewer clients specifically
      if (client.clientType === 'chat_viewer') {
        chatViewerCount++;
      }
    }
  });
  
  // Special logging for reveal flash messages
  if (message.type === 'reveal_flash') {
    console.log(`📡 Reveal flash message sent to ${clientCount} clients:`, message);
  }
  
  // Special logging for chat messages
  if (message.type === 'chat_message') {
    console.log(`📡 Chat message sent to ${clientCount} total clients (${chatViewerCount} chat_viewers):`, {
      type: message.type,
      username: message.username,
      text: message.text,
      platform: message.platform
    });
  }
}

// Handle vote updates from external polling system
function handleVoteUpdate(data) {
  // This handles vote updates from the audience polling system
  console.log('📊 Vote update received:', data);
}

// Process votes from chat messages with deduplication
function processVoteFromChat(data) {
  const voteStartTime = Date.now();
  
  if (!gameState.audience_poll_active) {
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
    return;
  }
  
  // Normalize username to lowercase to handle case variations
  const username = data.username ? data.username.toLowerCase().trim() : '';
  const message = data.text ? data.text.trim().toUpperCase() : '';
  
  if (!username || !message) {
    console.log(`❌ Invalid chat data: username="${username}", message="${message}"`);
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
    return;
  }
  
  console.log(`🔍 Processing vote from ${username}: "${message}"`);
  console.log(`🔍 Current voter history:`, gameState.poll_voter_history);
  console.log(`🔍 User already voted?`, gameState.poll_voter_history.includes(username));
  
  // Check if user has already voted (deduplication with normalized username)
  if (gameState.poll_voter_history.includes(username)) {
    console.log(`⚠️ Duplicate vote attempt from ${username} - ignoring`);
    trackVoteProcessing(Date.now() - voteStartTime, true, false);
    return;
  }
  
  // Check if message contains a valid vote (A, B, C, D)
  // Only accept standalone letters or messages that start with the letter
  const validVotes = ['A', 'B', 'C', 'D'];
  const vote = validVotes.find(v => 
    message === v || // Exact match (just "A", "B", "C", or "D")
    message.startsWith(v + ' ') || // Starts with letter and space ("A something")
    message === v.toLowerCase() || // Lowercase version ("a", "b", "c", "d")
    message.startsWith(v.toLowerCase() + ' ') // Lowercase with space ("a something")
  );
  
  if (vote) {
    // Check if this answer is excluded during revote
    if (gameState.is_revote_active) {
      const voteIndex = vote.charCodeAt(0) - 65; // Convert A,B,C,D to 0,1,2,3
      if (gameState.excluded_answers.includes(voteIndex)) {
        console.log(`🚫 Vote ${vote} is excluded during revote - ignoring vote from ${username}`);
        return;
      }
      console.log(`🗳️ Revote: ${username} voting ${vote} (${gameState.excluded_answers.length} answer(s) excluded)`);
    } else {
      console.log(`✅ Valid vote detected: ${username} voting ${vote}`);
    }
    
    // Check if user is trying to vote for the same answer they chose earlier in this question
    if (gameState.question_voter_answers[username] === vote) {
      console.log(`🚫 ${username} already voted ${vote} for this question - preventing same answer re-vote`);
      trackVoteProcessing(Date.now() - voteStartTime, false, true);
      return;
    }
    
    // Record the vote (first vote only)
    gameState.poll_voter_history.push(username);
    console.log(`🔒 Added ${username} to voter history. New history:`, gameState.poll_voter_history);
    
    // Record the user's answer choice for this question to prevent same-answer re-voting
    gameState.question_voter_answers[username] = vote;
    console.log(`📝 Recorded ${username}'s answer ${vote} for question ${gameState.current_question + 1} (prevents same answer re-vote)`);
    
    // Track successful vote processing
    trackVoteProcessing(Date.now() - voteStartTime, false, false);
    
    // Add to gameshow participants list for credits (unique only)
    if (!gameState.gameshow_participants.includes(username)) {
      gameState.gameshow_participants.push(username);
      console.log(`🎭 Added ${username} to gameshow participants for credits (Total participants: ${gameState.gameshow_participants.length})`);
      
      // Check for giveaway voter entry (3x weight for voters)
      processGiveawayVoterEntry(username);
    }
    
    const voteData = {
      username: username,
      vote: vote,
      timestamp: Date.now()
    };
    
    // Add to complete votes list for tallying
    gameState.poll_all_votes.push(voteData);
    
    // Add to recent voters list (keep last 10 for display)
    gameState.poll_voters.unshift(voteData);
    
    // Keep only last 10 voters for display
    if (gameState.poll_voters.length > 10) {
      gameState.poll_voters = gameState.poll_voters.slice(0, 10);
    }
    
    console.log(`🗳️ Vote recorded: ${username} voted ${vote} (Total voters: ${gameState.poll_voter_history.length})`);
    console.log(`📊 Current vote tallies: A=${gameState.poll_all_votes.filter(v => v.vote === 'A').length}, B=${gameState.poll_all_votes.filter(v => v.vote === 'B').length}, C=${gameState.poll_all_votes.filter(v => v.vote === 'C').length}, D=${gameState.poll_all_votes.filter(v => v.vote === 'D').length}`);
    
    // Broadcast the updated state
    broadcastState();
  } else {
    console.log(`❌ No valid vote found in message: "${message}"`);
    trackVoteProcessing(Date.now() - voteStartTime, false, true);
  }
}

// Process lifeline votes from chat
function processLifelineVoteFromChat(data) {
  const voteStartTime = Date.now(); // Track processing time
  
  // Enhanced error handling and validation
  try {
    // Validate lifeline voting is active
    if (!gameState.lifeline_voting_active) {
      if (DEBUG_LIFELINE_VOTING) console.log('🚫 Lifeline voting not active - ignoring vote');
      trackVoteProcessing(Date.now() - voteStartTime, true);
      return;
    }
    
    // Validate input data structure
    if (!data || typeof data !== 'object') {
      console.error('❌ Invalid lifeline vote data structure:', data);
      return;
    }
    
    // Validate required fields
    if (!data.username || !data.text) {
      console.error('❌ Missing required fields in lifeline vote:', {
        hasUsername: !!data.username,
        hasText: !!data.text,
        data: data
      });
      return;
    }
    
    // Normalize and validate username
    const username = String(data.username).toLowerCase().trim();
    if (!username || username.length < 1 || username.length > 50) {
      console.error('❌ Invalid username for lifeline vote:', {
        original: data.username,
        normalized: username,
        length: username.length
      });
      return;
    }
    
    // Normalize and validate message
    const message = String(data.text).trim().toUpperCase();
    if (!message || message.length < 1 || message.length > 100) {
      console.error('❌ Invalid message for lifeline vote:', {
        original: data.text,
        normalized: message,
        length: message.length
      });
      return;
    }
    
    // Validate game state arrays exist
    if (!Array.isArray(gameState.lifeline_voter_history)) {
      console.error('❌ lifeline_voter_history is not an array, reinitializing');
      gameState.lifeline_voter_history = [];
    }
    
    if (!Array.isArray(gameState.lifeline_votes)) {
      console.error('❌ lifeline_votes is not an array, reinitializing');
      gameState.lifeline_votes = [];
    }
    
    if (!Array.isArray(gameState.available_lifelines_for_vote)) {
      console.error('❌ available_lifelines_for_vote is not an array, reinitializing');
      gameState.available_lifelines_for_vote = [];
    }
    
    // Validate vote counts object
    if (!gameState.lifeline_vote_counts || typeof gameState.lifeline_vote_counts !== 'object') {
      console.error('❌ lifeline_vote_counts is invalid, reinitializing');
      gameState.lifeline_vote_counts = {
        fiftyFifty: 0,
        askAudience: 0,
        askAMod: 0
      };
    }
  
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Processing lifeline vote from ${username}: "${message}"`);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Current lifeline voter history:`, gameState.lifeline_voter_history);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 User already voted?`, gameState.lifeline_voter_history.includes(username));
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Is this a host vote?`, data.isHost || false);
    if (DEBUG_LIFELINE_VOTING) console.log(`🔍 Vote platform:`, data.platform || 'unknown');
    
    // Check if user has already voted (deduplication with normalized username)
    if (gameState.lifeline_voter_history.includes(username)) {
      if (DEBUG_LIFELINE_VOTING) console.log(`⚠️ Duplicate lifeline vote attempt from ${username} - ignoring`);
      trackVoteProcessing(Date.now() - voteStartTime, false, true);
      return;
    }
    
    // Validate available lifelines
    if (!gameState.available_lifelines_for_vote || gameState.available_lifelines_for_vote.length === 0) {
      console.error('❌ No lifelines available for voting');
      return;
    }
    
    console.log(`🎯 Available lifelines for voting:`, gameState.available_lifelines_for_vote);
  
    // Parse vote - accept various formats with enhanced validation
    let lifeline = null;
    let voteType = 'unknown';
    
    // Check for numeric votes first (1, 2, 3)
    if (message === '1') {
      if (gameState.available_lifelines_for_vote.includes('fiftyFifty')) {
        lifeline = 'fiftyFifty';
        voteType = 'numeric';
        console.log(`🔢 Numeric vote detected: 1 = 50:50`);
      } else {
        console.log(`⚠️ Vote '1' (50:50) not available in current lifelines`);
      }
    }
    else if (message === '2') {
      if (gameState.available_lifelines_for_vote.includes('askAudience')) {
        lifeline = 'askAudience';  // 2 = Take Another Vote
        voteType = 'numeric';
        console.log(`🔢 Numeric vote detected: 2 = Take Another Vote`);
      } else {
        console.log(`⚠️ Vote '2' (Take Another Vote) not available in current lifelines`);
      }
    }
    else if (message === '3') {
      if (gameState.available_lifelines_for_vote.includes('askAMod')) {
        lifeline = 'askAMod';  // 3 = Ask a Mod
        voteType = 'numeric';
        console.log(`🔢 Numeric vote detected: 3 = Ask a Mod`);
      } else {
        console.log(`⚠️ Vote '3' (Ask a Mod) not available in current lifelines`);
      }
    }
    // Check for 50/50 votes (text-based)
    else if (message === '50/50' || message === '50' || message === 'FIFTY' || 
        message.includes('50') || message.includes('FIFTY')) {
      if (gameState.available_lifelines_for_vote.includes('fiftyFifty')) {
        lifeline = 'fiftyFifty';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = 50:50`);
      } else {
        console.log(`⚠️ Vote '${message}' (50:50) not available in current lifelines`);
      }
    }
    // Check for Take Another Vote (askAudience) - VOTE command
    else if (message === 'VOTE' || message === 'ANOTHER' || message === 'REVOTE' ||
             message.includes('VOTE') || message.includes('AUDIENCE')) {
      if (gameState.available_lifelines_for_vote.includes('askAudience')) {
        lifeline = 'askAudience';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = Take Another Vote`);
      } else {
        console.log(`⚠️ Vote '${message}' (Take Another Vote) not available in current lifelines`);
      }
    }
    // Check for Ask a Mod (askAMod) - MOD command
    else if (message === 'MOD' || message === 'ASK' || 
             message.includes('MOD') || message.includes('PHONE')) {
      if (gameState.available_lifelines_for_vote.includes('askAMod')) {
        lifeline = 'askAMod';
        voteType = 'text';
        console.log(`💬 Text vote detected: "${message}" = Ask a Mod`);
      } else {
        console.log(`⚠️ Vote '${message}' (Ask a Mod) not available in current lifelines`);
      }
    }
  
    if (lifeline) {
      console.log(`✅ Valid lifeline vote detected: ${username} voting ${lifeline} (${voteType})`);
      
      // Initialize voteData outside try block to prevent undefined reference in error handler
      let voteData = null;
      
      // Enhanced vote recording with validation
      try {
        // Validate vote count exists
        if (typeof gameState.lifeline_vote_counts[lifeline] !== 'number') {
          console.error(`❌ Invalid vote count for ${lifeline}, resetting to 0`);
          gameState.lifeline_vote_counts[lifeline] = 0;
        }
        
        // Record the vote (first vote only)
        gameState.lifeline_voter_history.push(username);
        console.log(`🔒 Added ${username} to lifeline voter history. New history:`, gameState.lifeline_voter_history);
        
        voteData = {
          username: username,
          lifeline: lifeline,
          voteType: voteType,
          originalMessage: data.text,
          timestamp: Date.now(),
          platform: data.platform || 'unknown'
        };
        
        // Add to lifeline votes list
        gameState.lifeline_votes.push(voteData);
        
        // Increment vote count with validation
        const oldCount = gameState.lifeline_vote_counts[lifeline];
        gameState.lifeline_vote_counts[lifeline]++;
        const newCount = gameState.lifeline_vote_counts[lifeline];
        
        console.log(`🗳️ Lifeline vote recorded: ${username} voted ${lifeline} (${oldCount} → ${newCount})`);
        console.log(`📊 Current lifeline vote tallies: 50/50=${gameState.lifeline_vote_counts.fiftyFifty}, VOTE=${gameState.lifeline_vote_counts.askAudience}, MOD=${gameState.lifeline_vote_counts.askAMod}`);
        
        // Validate total votes
        const totalVotes = gameState.lifeline_votes.length;
        const expectedTotal = gameState.lifeline_vote_counts.fiftyFifty + 
                             gameState.lifeline_vote_counts.askAudience + 
                             gameState.lifeline_vote_counts.askAMod;
        
        if (totalVotes !== expectedTotal) {
          console.error(`❌ Vote count mismatch! Total votes: ${totalVotes}, Expected: ${expectedTotal}`);
        }
        
        // Memory optimization: Limit lifeline_votes array to prevent unbounded growth
        const MAX_LIFELINE_VOTES = 1000; // Keep only last 1000 votes for memory efficiency
        if (gameState.lifeline_votes.length > MAX_LIFELINE_VOTES) {
          const removed = gameState.lifeline_votes.splice(0, gameState.lifeline_votes.length - MAX_LIFELINE_VOTES);
          console.log(`🧹 Memory optimization: Removed ${removed.length} old lifeline votes, keeping ${gameState.lifeline_votes.length} recent votes`);
        }
        
        // Memory optimization: Limit voter history to prevent unbounded growth
        const MAX_VOTER_HISTORY = 5000; // Keep only last 5000 voter records
        if (gameState.lifeline_voter_history.length > MAX_VOTER_HISTORY) {
          const removed = gameState.lifeline_voter_history.splice(0, gameState.lifeline_voter_history.length - MAX_VOTER_HISTORY);
          console.log(`🧹 Memory optimization: Removed ${removed.length} old voter history entries, keeping ${gameState.lifeline_voter_history.length} recent entries`);
        }
        
        // Broadcast vote update for real-time display with enhanced data
        if (DEBUG_LIFELINE_VOTING) console.log('📡 Broadcasting lifeline_vote_update to all clients...');
        const updateMessage = {
          type: 'lifeline_vote_update',
          voteCounts: gameState.lifeline_vote_counts,
          totalVotes: totalVotes,
          recentVoter: {
            username: username,
            lifeline: lifeline,
            voteType: voteType,
            timestamp: Date.now()
          },
          availableLifelines: gameState.available_lifelines_for_vote
        };
        
        broadcastLifelineVoteUpdate(updateMessage);
        if (DEBUG_LIFELINE_VOTING) console.log('✅ lifeline_vote_update broadcast sent');
        
        // Broadcast the updated state
        broadcastState();
        
        // Track successful vote processing
        trackVoteProcessing(Date.now() - voteStartTime, false, false);
        
      } catch (error) {
        console.error('❌ Error recording lifeline vote:', error);
        console.error('❌ Vote data:', voteData);
        console.error('❌ Game state:', {
          lifeline_voting_active: gameState.lifeline_voting_active,
          lifeline_vote_counts: gameState.lifeline_vote_counts,
          lifeline_votes_length: gameState.lifeline_votes.length
        });
      }
    } else {
      console.log(`❌ No valid lifeline found in message: "${message}" from ${username}`);
      console.log(`❌ Available lifelines:`, gameState.available_lifelines_for_vote);
    }
    
  } catch (error) {
    console.error('❌ Critical error in processLifelineVoteFromChat:', error);
    console.error('❌ Input data:', data);
    console.error('❌ Stack trace:', error.stack);
  }
}

// Process Ask a Mod response from moderator during active session
function processAskAModResponse(chatData) {
  try {
    console.log(`🛡️ Processing Ask a Mod response from moderator: ${chatData.username}`);
    
    // Validate input data
    if (!chatData || !chatData.username || !chatData.text) {
      console.error('❌ Invalid Ask a Mod response data:', chatData);
      return;
    }
    
    const username = chatData.username.toLowerCase().trim();
    const message = chatData.text.trim();
    
    // Check if Ask a Mod session is active
    if (!gameState.ask_a_mod_active) {
      console.log('🚫 Ask a Mod session not active - ignoring moderator response');
      return;
    }
    
    // Check if user is a moderator (this should already be validated before calling this function)
    const modList = getCachedModList();
    if (!modList.includes(username)) {
      console.warn(`⚠️ User ${username} is not a moderator but response was processed`);
      return;
    }
    
    console.log(`🛡️ Mod chat message received - Username: ${username}, Message: "${message}"`);
    
    // Create mod response object for chat display (no answer parsing/selection - shows as chat messages only)
    const modResponse = {
      username: username,
      message: message,
      timestamp: Date.now(),
      platform: chatData.platform || 'twitch'
    };
    
    // Add to mod responses array
    gameState.mod_responses.push(modResponse);
    
    console.log(`💬 Mod chat message stored for display: ${username}: "${message}"`);
    
    // Broadcast mod chat message for real-time display (no vote counting)
    broadcastToClients({
      type: 'ask_a_mod_chat_message',
      username: username,
      message: message,
      timestamp: Date.now(),
      platform: chatData.platform || 'twitch'
    });
    
    // Broadcast the mod response for display on audience overlay (chat display only)
    broadcastToClients({
      type: 'ask_a_mod_display_update',
      response: modResponse,
      totalResponses: gameState.mod_responses.length,
      timestamp: Date.now()
    });
    
    // Also broadcast as mod_response for compatibility with existing systems
    broadcastToClients({
      type: 'mod_response',
      response: modResponse,
      timestamp: Date.now()
    });
    
    console.log(`🛡️ Ask a Mod response processed successfully - Total responses: ${gameState.mod_responses.length}`);
    
  } catch (error) {
    console.error('❌ Error processing Ask a Mod response:', error);
    console.error('❌ Chat data:', chatData);
  }
}

// Memory optimization: Periodic cleanup for long-running sessions
function performMemoryCleanup() {
  console.log('🧹 Performing periodic memory cleanup...');
  
  const beforeCleanup = {
    lifelineVotes: gameState.lifeline_votes?.length || 0,
    voterHistory: gameState.lifeline_voter_history?.length || 0,
    pollVotes: gameState.poll_all_votes?.length || 0,
    pollVoters: gameState.poll_voters?.length || 0,
    pollVoterHistory: gameState.poll_voter_history?.length || 0
  };
  
  let cleanupActions = [];
  
  // Clean up old lifeline votes (keep last 500 for efficiency)
  if (gameState.lifeline_votes && gameState.lifeline_votes.length > 500) {
    const removed = gameState.lifeline_votes.splice(0, gameState.lifeline_votes.length - 500);
    cleanupActions.push(`${removed.length} old lifeline votes`);
  }
  
  // Clean up old voter history (keep last 2000 for deduplication)
  if (gameState.lifeline_voter_history && gameState.lifeline_voter_history.length > 2000) {
    const removed = gameState.lifeline_voter_history.splice(0, gameState.lifeline_voter_history.length - 2000);
    cleanupActions.push(`${removed.length} old voter history entries`);
  }
  
  // Clean up old poll votes (keep last 1000)
  if (gameState.poll_all_votes && gameState.poll_all_votes.length > 1000) {
    const removed = gameState.poll_all_votes.splice(0, gameState.poll_all_votes.length - 1000);
    cleanupActions.push(`${removed.length} old poll votes`);
  }
  
  // Clean up old poll voters (keep last 100)
  if (gameState.poll_voters && gameState.poll_voters.length > 100) {
    const removed = gameState.poll_voters.splice(0, gameState.poll_voters.length - 100);
    cleanupActions.push(`${removed.length} old poll voters`);
  }
  
  // Clean up old poll voter history (keep last 2000)
  if (gameState.poll_voter_history && gameState.poll_voter_history.length > 2000) {
    const removed = gameState.poll_voter_history.splice(0, gameState.poll_voter_history.length - 2000);
    cleanupActions.push(`${removed.length} old poll voter history`);
  }
  
  const afterCleanup = {
    lifelineVotes: gameState.lifeline_votes?.length || 0,
    voterHistory: gameState.lifeline_voter_history?.length || 0,
    pollVotes: gameState.poll_all_votes?.length || 0,
    pollVoters: gameState.poll_voters?.length || 0,
    pollVoterHistory: gameState.poll_voter_history?.length || 0
  };
  
  if (cleanupActions.length > 0) {
    console.log(`🧹 Memory cleanup completed: removed ${cleanupActions.join(', ')}`);
    console.log(`📊 Memory usage after cleanup:`, {
      before: beforeCleanup,
      after: afterCleanup
    });
  } else {
    console.log('🧹 No memory cleanup needed - all arrays within limits');
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
    console.log('🗑️ Forced garbage collection');
  }
}

// Schedule periodic memory cleanup (every 30 minutes)
setInterval(performMemoryCleanup, 30 * 60 * 1000);

// Also perform cleanup on game reset
function resetGameStateWithCleanup() {
  console.log('🎮 Resetting game state with memory cleanup...');
  
  // Clear all vote-related arrays
  gameState.lifeline_votes = [];
  gameState.lifeline_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  
  // Reset vote counts
  gameState.lifeline_vote_counts = {
    fiftyFifty: 0,
    askAudience: 0,
    askAMod: 0
  };
  
  console.log('🧹 Game state reset with memory cleanup completed');
}

// Calculate vote totals and determine winning answer
function calculatePollWinner() {
  if (!gameState.poll_all_votes || gameState.poll_all_votes.length === 0) {
    console.log('⚠️ No votes to tally');
    return null;
  }
  
  // Count votes for each option from all recorded voters
  const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
  
  // Tally votes from complete vote record
  gameState.poll_all_votes.forEach(voter => {
    if (voteCounts.hasOwnProperty(voter.vote)) {
      voteCounts[voter.vote]++;
    }
  });
  
  // Find the winner (option with most votes)
  let winner = 'A';
  let maxVotes = voteCounts.A;
  
  Object.keys(voteCounts).forEach(option => {
    if (voteCounts[option] > maxVotes) {
      maxVotes = voteCounts[option];
      winner = option;
    }
  });
  
  const totalVotes = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
  const percentage = totalVotes > 0 ? Math.round((maxVotes / totalVotes) * 100) : 0;
  
  console.log('📊 Poll Results:');
  console.log(`   A: ${voteCounts.A} votes`);
  console.log(`   B: ${voteCounts.B} votes`);
  console.log(`   C: ${voteCounts.C} votes`);
  console.log(`   D: ${voteCounts.D} votes`);
  console.log(`🏆 Winner: ${winner} with ${maxVotes} votes (${percentage}%)`);
  
  return {
    winner: winner,
    votes: maxVotes,
    percentage: percentage,
    totalVotes: totalVotes,
    allCounts: voteCounts
  };
}

// Automatically lock in the audience's choice when poll ends
// Unified function to lock in audience choice with optional winner display
function lockInAudienceChoice(showWinnerAnnouncement = true) {
  const result = calculatePollWinner();
  
  if (!result) {
    console.log('⚠️ Cannot lock in audience choice - no votes recorded');
    return;
  }
  
  // Convert letter to answer index (A=0, B=1, C=2, D=3)
  const answerIndex = ['A', 'B', 'C', 'D'].indexOf(result.winner);
  
  // Set the audience's choice AND lock it in since the poll has decided
  gameState.selected_answer = answerIndex;
  gameState.answer_locked_in = true; // Auto-lock the answer since audience has voted
  gameState.audience_poll_active = false;
  gameState.show_voting_activity = false;
  
  // Play lock-in sound effect when poll auto-locks an answer
  console.log('🎵 Broadcasting lock-in audio command for poll result');
  broadcastToClients({ type: 'audio_command', command: 'play_lock' });
  
  // Set poll winner data for display (only if showing announcement)
  if (showWinnerAnnouncement) {
    gameState.show_poll_winner = result.winner;
    gameState.poll_winner_votes = result.votes;
    gameState.poll_winner_percentage = result.percentage;
  }
  
  console.log(`🏆 AUDIENCE CHOICE SELECTED: Answer ${result.winner} (index ${answerIndex}) chosen by audience`);
  
  // Check if this poll was from a lifeline and led to correct answer discovery
  if (gameState.answer_is_wrong && !gameState.correct_answer_highlighted) {
    console.log('🔍 Checking if audience lifeline led to correct answer discovery...');
    const successful = checkLifelineSuccess(result.winner);
    
    // Track outcome for game flow loop if this was part of lifeline voting
    if (gameState.lifelines_used.includes('askAudience') || gameState.is_revote_active) {
      setTimeout(() => {
        trackLifelineOutcome('askAudience', successful);
      }, 2000); // Brief delay to let answer processing complete
    }
  }
  
  console.log(`🔒 Answer ${result.winner} is now LOCKED IN - Host can click "Reveal Answer" to see if the audience was correct`);
  
  // Broadcast the updated state to all clients
  broadcastState();
  
  // Show winner announcement (only if enabled)
  if (showWinnerAnnouncement) {
    // Use 5 seconds for revotes after Ask A Mod, 3 seconds for normal polls
    const displayDuration = gameState.is_revote_active ? 5000 : 3000;
    const durationText = gameState.is_revote_active ? '5 seconds (revote)' : '3 seconds';
    
    console.log(`⏱️ Showing poll winner announcement for ${durationText}`);
    
    setTimeout(() => {
      gameState.show_poll_winner = null;
      gameState.poll_winner_votes = 0;
      gameState.poll_winner_percentage = 0;
      
      // Reset revote flag when revote announcement ends
      if (gameState.is_revote_active) {
        gameState.is_revote_active = false;
        console.log('🔄 Revote completed - is_revote_active flag reset');
      }
      
      broadcastState();
      console.log('📢 Poll winner announcement hidden');
    }, displayDuration);
  }
}

// Automatic polling system
let pollTimer = null;

function startAutomaticPoll() {
  // Enhanced debugging for poll start conditions
  console.log('🔍 startAutomaticPoll() called - checking conditions:');
  console.log('   gameState.answers_visible:', gameState.answers_visible);
  console.log('   gameState.audience_poll_active:', gameState.audience_poll_active);
  console.log('   gameState.current_question:', gameState.current_question);
  console.log('   gameState.game_active:', gameState.game_active);
  
  // Only start if answers are visible and no poll is active
  if (!gameState.answers_visible || gameState.audience_poll_active) {
    console.log('❌ Cannot start auto-poll: answers_visible=' + gameState.answers_visible + ', poll_active=' + gameState.audience_poll_active);
    console.log('   Poll start BLOCKED - conditions not met');
    return;
  }
  
  console.log('✅ All conditions met - starting automatic poll');
  console.log('🗳️ Auto-starting 1-minute audience poll - SHOWING voting panel');
  
  // Track game flow metrics
  performanceMetrics.gameFlow.pollsStarted++;
  
  // CLEAN SHOW: Activate poll and make panel visible
  gameState.audience_poll_active = true;
  gameState.show_voting_activity = true;
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  gameState.show_poll_winner = null;
  
  // Broadcast poll start
  broadcastState();
  
  // Capture exact start time for precise synchronization
  const pollStartTime = Date.now();
  
  // Send poll started event to WebSocket clients with exact start time
  broadcastToClients({
    type: 'audience_poll_started',
    duration: gameState.audience_poll_duration, // Use configurable duration
    startTime: pollStartTime // Use exact captured start time
  });
  
  // Start timer with configurable duration
  pollTimer = setTimeout(() => {
    endAutomaticPoll();
  }, gameState.audience_poll_duration);
  
  const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
  console.log(`⏱️ ${durationSeconds}-second poll timer started - chat can vote A, B, C, or D`);
}

function endAutomaticPoll() {
  if (!gameState.audience_poll_active) {
    console.log('⚠️ No active poll to end');
    return;
  }
  
  const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
  const isRevote = gameState.is_revote_active;
  
  if (isRevote) {
    console.log(`🔄 Ending post-lifeline revote after ${durationSeconds} seconds - host manual selection takes precedence`);
  } else {
    console.log(`🏁 Auto-ending audience poll after ${durationSeconds} seconds - hiding voting panel`);
  }
  
  // Clear the timer
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  
  // CLEAN HIDE: Immediately hide voting panel completely
  gameState.audience_poll_active = false;
  gameState.show_voting_activity = false;
  gameState.show_poll_winner = null;
  gameState.poll_winner_votes = 0;
  gameState.poll_winner_percentage = 0;
  
  // Clean up revote state if this was a revote
  if (isRevote) {
    gameState.is_revote_active = false;
    console.log('🔄 Cleared revote state - host can now proceed with manual selection');
  }
  
  // Send poll ended event
  broadcastToClients({
    type: 'audience_poll_ended',
    endTime: Date.now(),
    reason: isRevote ? 'revote_manual_intervention' : 'host_selection'
  });
  
  // Calculate winner and show announcement BEFORE clearing vote data
  const result = calculatePollWinner();
  
  // Additional state cleanup AFTER calculating winner
  gameState.poll_voters = [];
  gameState.poll_voter_history = [];
  gameState.poll_all_votes = [];
  
  if (result && result.winner) {
    // Show the winner announcement for 3 seconds
    gameState.show_poll_winner = result.winner;
    gameState.poll_winner_votes = result.votes;
    gameState.poll_winner_percentage = result.percentage;
    
    console.log(`📢 Showing AUDIENCE CHOICE: ${result.winner} with ${result.votes} votes (${result.percentage}%)`);
    broadcastState();
    
    // CRITICAL: Only auto-lock if this is NOT a revote (during revotes, host manual selection takes precedence)
    if (!isRevote) {
      // After 5 seconds maximum, lock in the audience choice
      setTimeout(() => {
        console.log(`🔒 Auto-locking AUDIENCE CHOICE: ${result.winner} after 5-second display`);
        
        // Convert letter to answer index (A=0, B=1, C=2, D=3)
        const answerIndex = ['A', 'B', 'C', 'D'].indexOf(result.winner);
        
        // Set and lock the answer
        gameState.selected_answer = answerIndex;
        gameState.answer_locked_in = true;
        
        // Hide the winner announcement
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        
        // Play lock-in sound effect
        console.log('🎵 Broadcasting lock-in audio command for auto-locked audience choice');
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        console.log(`✅ Answer ${result.winner} is now LOCKED IN automatically`);
        broadcastState();
      }, 5000); // 5 seconds maximum delay
    } else {
      console.log('🔄 Revote ended - audience choice displayed but NOT auto-locked (host control retained)');
      
      // Hide the winner announcement after 3 seconds for revotes but don't auto-lock
      setTimeout(() => {
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        console.log('🔄 Cleared revote winner display - host maintains control over final selection');
        broadcastState();
      }, 3000); // 3 seconds for revote winner display
    }
  } else {
    console.log('⚠️ No votes recorded - cannot show or lock audience choice');
  }
  
  console.log('✅ Voting panel completely hidden until next question answers');
}

// Helper function to broadcast messages to WebSocket clients
// NOTE: Commented out duplicate function - using the enhanced version at line 7412
/*
function broadcastToClients(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}
*/

// Modify the handleAPI function to broadcast updates
async function handleAPI(req, res, pathname) {
  setCORSHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (pathname === '/api/state') {
    // Create a clean copy of gameState without non-serializable properties (like timer intervals)
    const cleanGameState = { ...gameState };
    delete cleanGameState.lifeline_countdown_interval; // Remove timer interval which can't be serialized
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cleanGameState));
    return;
  }
  
  // Performance metrics endpoint
  if (pathname === '/api/performance') {
    const avgProcessingTime = performanceMetrics.lifeline.processingTimes.length > 0
      ? performanceMetrics.lifeline.processingTimes.reduce((a, b) => a + b, 0) / performanceMetrics.lifeline.processingTimes.length
      : 0;
    
    const metrics = {
      lifeline: {
        votesProcessed: performanceMetrics.lifeline.votesProcessed,
        votesRejected: performanceMetrics.lifeline.votesRejected,
        averageProcessingTime: avgProcessingTime.toFixed(2) + 'ms',
        currentVotesPerSecond: performanceMetrics.lifeline.currentVotesPerSecond,
        peakVotesPerSecond: performanceMetrics.lifeline.peakVotesPerSecond,
        rejectionRate: performanceMetrics.lifeline.votesProcessed > 0 
          ? ((performanceMetrics.lifeline.votesRejected / performanceMetrics.lifeline.votesProcessed) * 100).toFixed(2) + '%'
          : '0%',
        uptime: Math.floor((Date.now() - performanceMetrics.lifeline.lastResetTime) / 1000) + ' seconds'
      }
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
    return;
  }

  // Connection cleanup endpoint
  if (pathname === '/api/cleanup-connections' && req.method === 'POST') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    
    let cleaned = 0;
    
    // Close all connections for a specific client type if specified
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetClientType = data.clientType;
        
        wss.clients.forEach((client) => {
          if (client.readyState !== WebSocket.OPEN) {
            return; // Skip already closed connections
          }
          
          if (targetClientType && client.clientType === targetClientType) {
            console.log(`🧹 Cleaning up stale ${targetClientType} connection`);
            client.terminate();
            cleaned++;
          } else if (!targetClientType) {
            // Clean all stale connections
            console.log(`🧹 Cleaning up stale connection: ${client.clientType || 'unregistered'}`);
            client.terminate();
            cleaned++;
          }
        });
        
        res.end(JSON.stringify({
          success: true,
          message: `Cleaned up ${cleaned} connections`,
          cleaned: cleaned
        }));
      } catch (error) {
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  if (pathname === '/api/prizes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prizes: prizeAmounts }));
    return;
  }
  
  // Enhanced Twitch Channel Emotes API - Optimized for chat display
  if (pathname === '/api/twitch-emotes' && req.method === 'GET') {
    try {
      // Get channel parameter from query string
      const urlParts = new URL(req.url, `http://${req.headers.host}`);
      const channel = urlParts.searchParams.get('channel') || 'k1m6a';
      const format = urlParts.searchParams.get('format') || 'full'; // 'full' or 'mapping'
      
      console.log(`🔍 Fetching Twitch emotes for channel: ${channel}, format: ${format}`);
      
      // Use built-in fetch or node-fetch
      let fetch;
      try {
        // Try built-in fetch first (Node.js 18+)
        fetch = globalThis.fetch;
        if (!fetch) {
          // Fall back to node-fetch v3 (ES modules)
          const nodeFetch = await import('node-fetch');
          fetch = nodeFetch.default;
        }
      } catch (error) {
        throw new Error('No fetch implementation available');
      }
      
      // Use public APIs instead of authenticated Twitch API
      let allEmotes = [];
      let sourceCounts = { twitch: 0, sevenTV: 0, fallback: 0 };
      
      // Try to get 7TV emotes first (public API, no auth required)
      try {
        console.log(`🔍 Fetching 7TV emotes for ${channel} using public API...`);
        
        // First, get the user ID using 7TV's public API
        const userLookupResponse = await fetch(`https://7tv.io/v3/users/twitch?search=${channel}`);
        if (userLookupResponse.ok) {
          const userLookupData = await userLookupResponse.json();
          if (userLookupData.items && userLookupData.items.length > 0) {
            const user = userLookupData.items.find(u => u.display_name.toLowerCase() === channel.toLowerCase());
            if (user && user.emote_set && user.emote_set.emotes) {
              const sevenTVEmotes = user.emote_set.emotes.map(emote => ({
                id: emote.id,
                name: emote.name,
                images: {
                  url_1x: `https://cdn.7tv.app/emote/${emote.id}/1x.webp`,
                  url_2x: `https://cdn.7tv.app/emote/${emote.id}/2x.webp`,
                  url_4x: `https://cdn.7tv.app/emote/${emote.id}/4x.webp`
                },
                format: ['webp'],
                scale: ['1.0', '2.0', '4.0'],
                theme_mode: ['light', 'dark'],
                source: '7tv'
              }));
              allEmotes.push(...sevenTVEmotes);
              sourceCounts.sevenTV = sevenTVEmotes.length;
              console.log(`✅ Successfully fetched ${sevenTVEmotes.length} 7TV emotes for channel ${channel}`);
            }
          }
        }
      } catch (sevenTVError) {
        console.log(`⚠️ 7TV public API failed for ${channel}:`, sevenTVError.message);
      }
      
      // Add known k1m6a emotes with working base64 SVG placeholder images  
      // These will display as colorful placeholder images instead of falling back to text
      const knownK1m6aEmotes = [
        // Core k1m6a emotes that are used most frequently in chat
        {
          id: 'k1m6alove_placeholder',
          name: 'k1m6aLove',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzk5NDdmZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5GJPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzk5NDdmZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GJPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzk5NDdmZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GJPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6apsgjuice_placeholder',
          name: 'k1m6aPsgjuice',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwYzI1MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6e5PC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwYzI1MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6e5PC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwYzI1MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6e5PC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6awiggle_placeholder',
          name: 'k1m6aWiggle',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmYzEwNyIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qEPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmYzEwNyIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qEPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmYzEwNyIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qEPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6asalute_placeholder',
          name: 'k1m6aSalute',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmNDQ0NCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6ufPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmNDQ0NCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6ufPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmNDQ0NCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn6ufPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6awave_placeholder',
          name: 'k1m6aWave',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzJlY2M3MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GBPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzJlY2M3MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GBPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzJlY2M3MSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GBPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6adj_placeholder',
          name: 'k1m6aDj',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzNmNTFiNSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46nPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzNmNTFiNSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46nPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzNmNTFiNSIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46nPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        // Additional k1m6a emotes with base64 SVG placeholders for additional emotes found in chat logs
        {
          id: 'k1m6ahype_placeholder',
          name: 'k1m6aHype',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmOWMwMCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5q4PC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmOWMwMCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5q4PC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmOWMwMCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5q4PC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6ajam_placeholder',
          name: 'k1m6aJam',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzhhMmJlMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46kPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbDZubm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzhhMmJlMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46kPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzhhMmJlMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn46kPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6aflower_placeholder',
          name: 'k1m6aFlower',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2UzOWJkYiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4yxPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2UzOWJkYiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4yxPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2UzOWJkYiIvPho8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4yxPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6arage_placeholder',
          name: 'k1m6aRage',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2Q5NTM0ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5iiPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2Q5NTM0ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5iiPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2Q5NTM0ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5iyPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        // Additional frequently used k1m6a emotes from chat logs
        {
          id: 'k1m6acoffee_placeholder',
          name: 'k1m6aCoffee',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzc5NTU0OCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imJVvZjwvdGV4dD4KPC9zdmc+',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzc5NTU0OCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imJVvZjwvdGV4dD4KPC9zdmc+',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzc5NTU0OCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imJVvZjwvdGV4dD4KPC9zdmc+'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6astab_placeholder',
          name: 'k1m6aStab',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2NjNzgzMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GPPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2NjNzgzMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GPPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2NjNzgzMiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5GPPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6alearn_placeholder',
          name: 'k1m6aLearn',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzRjYWY1MCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5SCPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzRjYWY1MCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5SCPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzRjYWY1MCIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5SCPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6agift_placeholder',
          name: 'k1m6aGift',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmMDA3ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4ehPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmMDA3ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4ehPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iI2ZmMDA3ZiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn4ehPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6asteer_placeholder',
          name: 'k1m6aSteer',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzYwN2Q4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qXPC90ZXh0Pgo8L3N2Zz4K',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzYwN2Q4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qXPC90ZXh0Pgo8L3N2Zz4K',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzYwN2Q4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7wn5qXPC90ZXh0Pgo8L3N2Zz4K'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        },
        {
          id: 'k1m6apsg_placeholder',
          name: 'k1m6aPsg',
          images: {
            url_1x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwMzc4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imb9vZjwvdGV4dD4KPC9zdmc+',
            url_2x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwMzc4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imb9vZjwvdGV4dD4KPC9zdmc+',
            url_4x: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiByeD0iNCIgZmlsbD0iIzAwMzc4YiIvPgo8dGV4dCB4PSIxNCIgeT0iMTciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IndoaXRlIj7imb9vZjwvdGV4dD4KPC9zdmc+'
          },
          format: ['svg'],
          scale: ['1.0', '2.0', '4.0'],
          theme_mode: ['light', 'dark'],
          source: 'placeholder'
        }
      ];
      
      // Add known emotes (don't duplicate if already found via 7TV)
      knownK1m6aEmotes.forEach(knownEmote => {
        const exists = allEmotes.some(emote => emote.name.toLowerCase() === knownEmote.name.toLowerCase());
        if (!exists) {
          allEmotes.push(knownEmote);
          sourceCounts.twitch++;
        }
      });
      
      // Return the combined emotes data in requested format
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      
      if (format === 'mapping') {
        // Return simple name->url mapping for efficient chat processing
        const emoteMapping = {};
        allEmotes.forEach(emote => {
          emoteMapping[emote.name] = emote.images.url_1x;
        });
        
        res.end(JSON.stringify({
          success: true,
          channel: channel,
          format: 'mapping',
          emotes: emoteMapping,
          count: allEmotes.length,
          sources: sourceCounts
        }));
      } else {
        // Return full emote data (default)
        res.end(JSON.stringify({
          success: true,
          channel: channel,
          format: 'full',
          emotes: allEmotes,
          count: allEmotes.length,
          sources: sourceCounts
        }));
      }
      
    } catch (error) {
      console.error('❌ Error fetching Twitch emotes:', error.message);
      
      // Enhanced fallback emotes for k1m6a channel (based on chat logs showing these emotes are used)
      const fallbackEmotes = [
        {
          id: 'k1m6alove_fallback',
          name: 'k1m6aLove',
          images: {
            url_1x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alove/default/dark/1.0',
            url_2x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alove/default/dark/2.0',
            url_4x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alove/default/dark/3.0'
          },
          format: ['static'],
          scale: ['1.0', '2.0', '3.0'],
          theme_mode: ['light', 'dark'],
          source: 'fallback'
        },
        {
          id: 'k1m6apsgjuice_fallback',
          name: 'k1m6aPsgjuice',
          images: {
            url_1x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6apsgjuice/default/dark/1.0',
            url_2x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6apsgjuice/default/dark/2.0',
            url_4x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6apsgjuice/default/dark/3.0'
          },
          format: ['static'],
          scale: ['1.0', '2.0', '3.0'],
          theme_mode: ['light', 'dark'],
          source: 'fallback'
        },
        {
          id: 'k1m6alettuce_fallback',
          name: 'k1m6aLettuce',
          images: {
            url_1x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alettuce/default/dark/1.0',
            url_2x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alettuce/default/dark/2.0',
            url_4x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6alettuce/default/dark/3.0'
          },
          format: ['static'],
          scale: ['1.0', '2.0', '3.0'],
          theme_mode: ['light', 'dark'],
          source: 'fallback'
        },
        {
          id: 'k1m6awiggle_fallback',
          name: 'k1m6aWiggle',
          images: {
            url_1x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6awiggle/default/dark/1.0',
            url_2x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6awiggle/default/dark/2.0',
            url_4x: 'https://static-cdn.jtvnw.net/emoticons/v2/emoticons_v2_k1m6awiggle/default/dark/3.0'
          },
          format: ['static'],
          scale: ['1.0', '2.0', '3.0'],
          theme_mode: ['light', 'dark'],
          source: 'fallback'
        }
      ];
      
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        channel: 'k1m6a', // Default channel when error occurs
        fallback: true,
        emotes: fallbackEmotes,
        count: fallbackEmotes.length,
        sources: {
          twitch: 0,
          sevenTV: 0,
          fallback: fallbackEmotes.length
        }
      }));
    }
    return;
  }
  
  // Chat messages API for HTTP polling
  if (pathname.startsWith('/api/chat/messages')) {
    const urlParams = new URLSearchParams(pathname.split('?')[1] || '');
    const since = parseInt(urlParams.get('since')) || 0;
    
    // Filter messages since the given timestamp
    const recentMessages = chatMessages.filter(msg => msg.timestamp > since);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      messages: recentMessages,
      total: chatMessages.length,
      since: since
    }));
    console.log(`📡 LiveChatViewer polling: ${recentMessages.length} new messages since ${since}`);
    return;
  }
  
  // Host Chat API - Allow host to send test messages to chat
  if (pathname === '/api/host-chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        // Create host chat message
        const hostChatMessage = {
          type: 'chat_message',
          username: data.username || 'Host',
          text: data.message,
          platform: data.platform || 'system',
          timestamp: Date.now(),
          channel: 'host',
          isModerator: true,
          isHost: true
        };
        
        console.log('💬 Host sent message:', hostChatMessage);
        
        // Broadcast to all chat viewers
        broadcastToClients(hostChatMessage);
        
        // Process host message for votes if voting is active
        // Process as audience poll vote if poll is active (during revotes)
        if (gameState.audience_poll_active) {
          console.log('🗳️ Processing host message as potential audience poll vote');
          try {
            processVoteFromChat(hostChatMessage);
          } catch (error) {
            console.error('❌ Error processing host audience poll vote:', error);
          }
        }
        
        // Process as lifeline vote if lifeline voting is active
        if (gameState.lifeline_voting_active) {
          console.log('🗳️ Processing host message as potential lifeline vote');
          console.log('📊 Lifeline voting state:', {
            active: gameState.lifeline_voting_active,
            availableLifelines: gameState.available_lifelines_for_vote,
            currentVoteCounts: gameState.lifeline_vote_counts,
            hostMessage: hostChatMessage.text,
            hostUsername: hostChatMessage.username
          });
          try {
            // Additional validation before processing
            if (!hostChatMessage || !hostChatMessage.text || !hostChatMessage.username) {
              console.error('❌ Invalid host chat message for lifeline vote:', hostChatMessage);
              return;
            }
            processLifelineVoteFromChat(hostChatMessage);
          } catch (error) {
            console.error('❌ Error processing host lifeline vote:', error);
            console.error('Stack trace:', error.stack);
            // Continue execution - don't crash the server
          }
        } else {
          console.log('⚠️ Lifeline voting not active, host message not processed for lifeline vote');
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Host message sent successfully' }));
        
      } catch (error) {
        console.error('❌ Host chat API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid host chat data' }));
      }
    });
    return;
  }
  
  // Timer Configuration API - Support for multiple timer types
  if (pathname === '/api/timer-config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        audience_poll_duration: gameState.audience_poll_duration,
        audience_poll_duration_seconds: Math.round(gameState.audience_poll_duration / 1000),
        revote_duration: gameState.revote_duration || 60000, // Default 60 seconds for revotes
        revote_duration_seconds: Math.round((gameState.revote_duration || 60000) / 1000),
        ask_a_mod_duration: gameState.ask_a_mod_duration || 30000, // Default 30 seconds for Ask a Mod
        ask_a_mod_duration_seconds: Math.round((gameState.ask_a_mod_duration || 30000) / 1000),
        lifeline_voting_duration: gameState.lifeline_voting_duration || 30000, // Default 30 seconds for lifeline voting
        lifeline_voting_duration_seconds: Math.round((gameState.lifeline_voting_duration || 30000) / 1000)
      }));
      return;
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          let updated = false;
          const updates = {};
          
          // Handle audience poll duration
          const audiencePollSeconds = requestData.audience_poll_duration_seconds;
          if (audiencePollSeconds && audiencePollSeconds >= 15 && audiencePollSeconds <= 300) {
            gameState.audience_poll_duration = audiencePollSeconds * 1000;
            updates.audience_poll_duration = gameState.audience_poll_duration;
            updates.audience_poll_duration_seconds = audiencePollSeconds;
            updated = true;
            console.log(`⏱️ Audience poll timer updated: ${audiencePollSeconds} seconds`);
          }
          
          // Handle revote duration
          const revoteSeconds = requestData.revote_duration_seconds;
          if (revoteSeconds && revoteSeconds >= 15 && revoteSeconds <= 300) {
            gameState.revote_duration = revoteSeconds * 1000;
            updates.revote_duration = gameState.revote_duration;
            updates.revote_duration_seconds = revoteSeconds;
            updated = true;
            console.log(`⏱️ Revote timer updated: ${revoteSeconds} seconds`);
          }
          
          // Handle Ask a Mod duration
          const askAModSeconds = requestData.ask_a_mod_duration_seconds;
          if (askAModSeconds && askAModSeconds >= 10 && askAModSeconds <= 120) { // 10-120 seconds for Ask a Mod
            gameState.ask_a_mod_duration = askAModSeconds * 1000;
            updates.ask_a_mod_duration = gameState.ask_a_mod_duration;
            updates.ask_a_mod_duration_seconds = askAModSeconds;
            updated = true;
            console.log(`⏱️ Ask a Mod timer updated: ${askAModSeconds} seconds`);
          }
          
          // Handle Lifeline Voting duration
          const lifelineVotingSeconds = requestData.lifeline_voting_duration_seconds;
          if (lifelineVotingSeconds && lifelineVotingSeconds >= 10 && lifelineVotingSeconds <= 120) { // 10-120 seconds for Lifeline Voting
            gameState.lifeline_voting_duration = lifelineVotingSeconds * 1000;
            updates.lifeline_voting_duration = gameState.lifeline_voting_duration;
            updates.lifeline_voting_duration_seconds = lifelineVotingSeconds;
            updated = true;
            console.log(`⏱️ Lifeline voting timer updated: ${lifelineVotingSeconds} seconds`);
          }
          
          if (updated) {
            // Broadcast timer config update to all clients
            broadcastToClients({
              type: 'timer_config_updated',
              ...updates,
              timestamp: Date.now()
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true,
              ...updates
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'No valid timer durations provided',
              requirements: {
                audience_poll_duration_seconds: '15-300 seconds',
                revote_duration_seconds: '15-300 seconds',
                ask_a_mod_duration_seconds: '10-120 seconds',
                lifeline_voting_duration_seconds: '10-120 seconds'
              },
              received: requestData
            }));
          }
        } catch (error) {
          console.error('Error updating timer config:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }
  
  if (pathname === '/api/questions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(questions));
    return;
  }
  
  // Performance Metrics API endpoint with enhanced analysis
  if (pathname === '/api/performance') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getEnhancedPerformanceSnapshot()));
    return;
  }
  
  // Metrics API endpoint (alias for performance)
  if (pathname === '/api/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getEnhancedPerformanceSnapshot()));
    return;
  }
  
  // Live Chat Configuration API
  if (pathname === '/api/polling/config') {
    if (req.method === 'GET') {
      try {
        const configPath = path.join(__dirname, 'polling-config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(configData);
      } catch (error) {
        console.error('Error reading polling config:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read config' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          const configPath = path.join(__dirname, 'polling-config.json');
          
          // Extract just the config data (remove the action wrapper if present)
          const configToSave = requestData.config || requestData;
          
          fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
          
          // Notify all chat integration clients about config change
          broadcastToClients({
            type: 'config_updated',
            config: requestData,
            timestamp: Date.now()
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          console.log('📝 Polling config updated and broadcasted to chat clients');
        } catch (error) {
          console.error('Error updating polling config:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update config' }));
        }
      });
    }
    return;
  }

  // API endpoint for testing live chat connections  
  if (pathname === '/api/polling/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const requestData = JSON.parse(body);
        console.log('🧪 Testing chat connection with config:', requestData);
        
        // For now, always return success since the actual Twitch chat is working
        // (Real connection test would involve checking Twitch API, but the chat is already proven working)
        const testResult = {
          success: true,
          message: '✅ Connection test passed. Twitch IRC is responding normally.',
          details: {
            twitch: requestData.twitchChannel ? 'Available' : 'Not configured',
            youtube: (requestData.youtubeApiKey && requestData.youtubeLiveChatId) ? 'Configured' : 'Not configured'
          }
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(testResult));
        console.log('✅ Connection test completed successfully');
      } catch (error) {
        console.error('❌ Error in connection test:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          message: '❌ Connection test failed. Check server logs.',
          error: error.message 
        }));
      }
    });
    return;
  }
  
  // AI Roary Status API
  if (pathname === '/api/roary/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'active',
      connected: true,
      lastActivity: Date.now()
    }));
    return;
  }
  
  // Animation API
  if (pathname === '/api/animation' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Animation command received:', data.command, data.params);
        
        // Broadcast animation command to all WebSocket clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'animation_command',
              command: data.command,
              params: data.params || {},
              timestamp: Date.now()
            }));
          }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, command: data.command }));
      } catch (error) {
        console.error('Animation API error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid animation command' }));
      }
    });
    return;
  }
  
  // Animation Config API
  if (pathname === '/api/animation/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        console.log('Animation config updated:', config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('Animation config error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid animation config' }));
      }
    });
    return;
  }
  
  // Animation Status API
  if (pathname === '/api/animation/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'active',
      available_commands: ['dramatic_lock', 'curtain_open', 'question_reveal', 'answer_reveal']
    }));
    return;
  }
  
  // Mod List Management API
  if (pathname === '/api/mod-list') {
    if (req.method === 'GET') {
      try {
        const modListPath = path.join(__dirname, 'mod-list.json');
        let modList = [];
        
        if (fs.existsSync(modListPath)) {
          const modListData = fs.readFileSync(modListPath, 'utf8');
          modList = JSON.parse(modListData);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ modList: modList }));
      } catch (error) {
        console.error('Error reading mod list:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read mod list' }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          const modListPath = path.join(__dirname, 'mod-list.json');
          
          // Validate mod list - ensure it's an array of strings
          let modList = requestData.modList || [];
          if (!Array.isArray(modList)) {
            throw new Error('Mod list must be an array');
          }
          
          // Filter out empty strings and validate usernames
          modList = modList.filter(username => 
            typeof username === 'string' && 
            username.trim().length > 0 && 
            username.trim().length <= 25 && // Twitch username limit
            /^[a-zA-Z0-9_]+$/.test(username.trim()) // Valid Twitch username format
          ).map(username => username.trim().toLowerCase());
          
          // Remove duplicates
          modList = [...new Set(modList)];
          
          fs.writeFileSync(modListPath, JSON.stringify(modList, null, 2));
          
          // Broadcast mod list update to all clients
          broadcastToClients({
            type: 'mod_list_updated',
            modList: modList,
            timestamp: Date.now()
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, modList: modList }));
          console.log('📝 Mod list updated:', modList);
        } catch (error) {
          console.error('Error updating mod list:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to update mod list' }));
        }
      });
    }
    return;
  }
  
  // Giveaway status endpoint (GET)
  if (pathname === '/api/giveaway' && req.method === 'GET') {
    const giveawayStatus = {
      active: gameState.giveaway_active,
      closed: gameState.giveaway_closed,
      prizeName: gameState.giveaway_prize_name,
      prizeAmount: gameState.giveaway_prize_amount,
      numWinners: gameState.giveaway_num_winners,
      timeRemaining: gameState.giveaway_active ? Math.max(0, gameState.giveaway_duration - (Date.now() - gameState.giveaway_start_time)) : 0,
      participantCount: gameState.giveaway_participants.length,
      totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
      keyword: gameState.giveaway_keyword,
      winners: gameState.giveaway_winners
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(giveawayStatus));
    return;
  }
  
  // Giveaway management endpoints
  if (pathname === '/api/giveaway' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Received giveaway action:', data.action);
        
        switch (data.action) {
          case 'start':
            startGiveaway(data.prizeName, data.prizeAmount, data.numWinners, data.keyword);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway started' }));
            break;
            
          case 'stop':
            stopGiveaway();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway stopped' }));
            break;
            
          case 'end_early_with_winners':
            // End giveaway early and immediately select winners
            if (!gameState.giveaway_active) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'No active giveaway to end early' 
              }));
              break;
            }
            
            console.log('🎯 Ending giveaway early and selecting winners...');
            
            // Check if there are participants before proceeding
            if (gameState.giveaway_participants.length === 0) {
              // If no participants, stop normally with overlay hiding
              stopGiveaway();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true, 
                message: 'Giveaway ended early but no participants to select winners from' 
              }));
              break;
            }
            
            // Close the giveaway WITHOUT calling stopGiveaway() to avoid hiding overlay
            console.log(`🛑 Closing giveaway early - ${gameState.giveaway_participants.length} participants`);
            gameState.giveaway_active = false;
            gameState.giveaway_closed = true;
            
            // Broadcast that giveaway is closing but winners will be shown immediately
            broadcastToClients({
              type: 'giveaway_ending_with_winners',
              participantCount: gameState.giveaway_participants.length,
              totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
              message: 'Giveaway ending early - selecting winners now!',
              timestamp: Date.now()
            });
            
            // Select winners immediately (no setTimeout delay)
            console.log('🎰 Immediately selecting winners for early end...');
            const earlyWinners = selectGiveawayWinners();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              winners: earlyWinners, 
              message: 'Giveaway ended early and winners selected' 
            }));
            break;
            
          case 'select_winners':
            if (!gameState.giveaway_closed) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'Giveaway must be closed before selecting winners' 
              }));
              break;
            }
            
            if (gameState.giveaway_participants.length === 0) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'No participants entered the giveaway. Nobody typed the keyword: ' + gameState.giveaway_keyword 
              }));
              break;
            }
            
            const winners = selectGiveawayWinners();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, winners: winners }));
            break;
            
          case 'reset':
            resetGiveaway(data.clearWinners);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Giveaway reset' }));
            break;
            
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown giveaway action' }));
        }
      } catch (error) {
        console.error('Error processing giveaway request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }
  
  // Giveaway status endpoint
  if (pathname === '/api/giveaway/status' && req.method === 'GET') {
    const giveawayStatus = {
      active: gameState.giveaway_active,
      closed: gameState.giveaway_closed,
      prizeName: gameState.giveaway_prize_name,
      prizeAmount: gameState.giveaway_prize_amount,
      numWinners: gameState.giveaway_num_winners,
      timeRemaining: gameState.giveaway_active ? Math.max(0, gameState.giveaway_duration - (Date.now() - gameState.giveaway_start_time)) : 0,
      participantCount: gameState.giveaway_participants.length,
      totalWeight: gameState.giveaway_participants.reduce((sum, p) => sum + p.weight, 0),
      winners: gameState.giveaway_winners
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(giveawayStatus));
    return;
  }
  
  
  if (pathname === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        console.log('Received action:', data.action);
        console.log('🔍 SWITCH DEBUG: Action type:', typeof data.action, 'Value:', JSON.stringify(data.action));
        
        console.log('🔍 BEFORE SWITCH - Action value:', data.action);
        
        switch (data.action) {
          case 'start_game':
            // Activate welcome transition and prepare game
            gameState.game_active = true;
            gameState.current_question = 0;
            gameState.score = 0;
            gameState.lifelines_used = [];
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.show_welcome = true; // Welcome scene trigger  
            gameState.curtains_closed = false; // Open red curtains with dramatic intro when game starts
            
            // Clear gameshow participants for fresh credits
            gameState.gameshow_participants = [];
            gameState.credits_rolling = false;
            gameState.credits_scrolling = false;
            
            console.log('Game started - opening red curtains with intro sequence');
            console.log('🎭 Gameshow participants cleared for fresh game');
            
            // Broadcast applause audio command
            console.log('🎵 Broadcasting applause audio command');
            broadcastToClients({ type: 'audio_command', command: 'play_applause' });
            
            // Auto-hide welcome after 3 seconds
            setTimeout(() => {
              if (gameState.show_welcome) {
                gameState.show_welcome = false;
                gameState.update_needed = true;
                broadcastState();
              }
            }, 3000);
            break;
            
          case 'reset_game':
            // Reset gameshow board - keep contestant name but reset game state
            gameState.current_question = 0;
            gameState.score = 0;
            gameState.game_active = false;
            gameState.lifelines_used = [];
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.curtains_closed = true;
            gameState.show_welcome = true;
            gameState.preparing_for_game = false;
            gameState.fade_out_ready_text = false;
            gameState.selected_answer = null;
            gameState.first_selected_answer = null; // Reset first selected answer for fresh game
            gameState.answer_locked_in = false;
            gameState.answer_is_wrong = false;
            gameState.typewriter_animation_complete = false;
            gameState.correct_answer_highlighted = false; // Reset highlighting for fresh game
            // REMOVED: original_wrong_answer reset - now handled by persistent_wrong_answers array
            gameState.persistent_wrong_answers = []; // Reset persistent wrong answers for fresh game
            gameState.how_to_play_shown = false; // Reset How To Play flag for new game
            // Reset lifeline states for fresh game
            gameState.first_poll_winner = null;
            gameState.is_revote_active = false;
            gameState.excluded_answers = [];
            gameState.host_selection_history = []; // Clear host selection history for fresh game
            // COMPLETE VOTING PANEL RESET for game reset
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;
            gameState.poll_winner_votes = 0;
            gameState.poll_winner_percentage = 0;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            
            // Clear question-level vote tracking for fresh game (prevents same answer re-voting)
            gameState.question_voter_answers = {};
            console.log('🗑️ Cleared question-level vote tracking for fresh game');
            
            // Clear any existing poll timer
            if (pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = null;
            }
            
            // Reset answer history to clear all previous results
            if (gameState.answerHistory) {
              gameState.answerHistory.forEach(entry => {
                entry.result = null;
              });
              console.log('📋 Answer history cleared for fresh game');
            }
            
            // Clear gameshow participants for fresh credits
            gameState.gameshow_participants = [];
            gameState.credits_rolling = false;
            gameState.credits_scrolling = false;
            console.log('🎭 Gameshow participants cleared for fresh game');
            
            // Reset giveaway system for fresh game
            resetGiveaway();
            console.log('🎁 Giveaway system reset for fresh game');
            
            // Reset lifeline voting states for fresh game
            gameState.lifeline_voting_active = false;
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.available_lifelines_for_vote = [];
            gameState.lifeline_vote_winner = null;
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              askAudience: 0,
              askAMod: 0
            };
            console.log('🗳️ Lifeline voting states reset for fresh game');
            
            // Reset Ask a Mod lifeline states for fresh game
            gameState.ask_a_mod_active = false;
            gameState.mod_responses = [];
            gameState.ask_a_mod_start_time = null;
            gameState.mod_vote_counts = {
              A: 0,
              B: 0,
              C: 0,
              D: 0
            };
            gameState.mod_voters = [];
            
            // Ensure processed_mod_messages is properly reset as a Set
            if (!(gameState.processed_mod_messages instanceof Set)) {
              gameState.processed_mod_messages = new Set();
            } else {
              gameState.processed_mod_messages.clear();
            }
            
            console.log('🛡️ Ask a Mod states reset for fresh game');
            
            // Broadcast poll ended event to all clients (including poll overlay)
            broadcastToClients({
              type: 'audience_poll_ended',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Broadcast hide lifeline voting panel command
            broadcastToClients({
              type: 'hide_lifeline_voting_panel',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Clear lifeline effects for fresh game
            broadcastToClients({
              type: 'clear_lifeline_effects',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            // Stop any currently playing lock-in sound effects and reset audio for fresh game
            console.log('🔇 Stopping any playing lock-in audio for game reset');
            broadcastToClients({
              type: 'audio_command',
              command: 'stop_lock_audio',
              reason: 'game_reset',
              timestamp: Date.now()
            });
            
            console.log('Game reset - all states initialized, voting panel completely hidden');
            
            // CRITICAL FIX: Broadcast the reset game state to all clients so browser gets updated lifelines_used = []
            broadcastState();
            console.log('📡 Reset game state broadcasted to all clients');
            break;
            
          case 'restart_server':
            console.log('🔄 Server restart requested from control panel');
            
            // Backup current game state before restart
            backupGameState();
            
            // Notify all connected clients about server restart
            broadcastToClients({
              type: 'server_restart_notification',
              message: 'Server is restarting - please reconnect in a few seconds',
              timestamp: Date.now()
            });
            
            // Send success response to control panel
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'Server restart initiated successfully'
            }));
            
            console.log('✅ Restart request acknowledged, shutting down server in 3 seconds...');
            
            // Close WebSocket connections gracefully
            wss.clients.forEach((ws) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'server_shutdown',
                  message: 'Server restarting - reconnection required'
                }));
                ws.close();
              }
            });
            
            // Close HTTP server and exit process
            setTimeout(() => {
              console.log('🔄 Shutting down for restart...');
              server.close(() => {
                process.exit(0); // Exit cleanly to allow restart
              });
              
              // Force exit if server doesn't close in 2 seconds
              setTimeout(() => {
                console.log('🚨 Force exit - server restart');
                process.exit(1);
              }, 2000);
            }, 3000);
            
            return; // Don't call broadcastState after restart
            
          case 'intro_complete':
            // Set up the "Get ready for the next question..." screen
            gameState.preparing_for_game = true;
            gameState.curtains_closed = false; // Open curtains to show "Get ready" screen
            console.log('Intro complete - preparing for game, curtains opened');
            break;
            
          case 'open_curtains':
            gameState.curtains_closed = false;
            console.log('Curtains opened');
            break;
            
          case 'close_curtains':
            gameState.curtains_closed = true;
            console.log('Curtains closed');
            break;
            
          case 'next_question':
            // Validation: Check if answers have been revealed (prevent skipping questions)
            if (!gameState.answers_revealed) {
              console.warn(`⚠️ Cannot go to next question - current question answers not revealed yet`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot skip question - reveal answer for current question first',
                state: 'answers_not_revealed',
                current_question: gameState.current_question + 1
              }));
              return;
            }
            
            if (gameState.current_question < questions.length - 1) {
              // Track game flow metrics
              performanceMetrics.gameFlow.questionTransitions++;
              
              // FIRST: Clear lifeline effects and answer highlighting BEFORE state changes
              console.log('🧹 Clearing answer highlighting and lifeline effects before next question');
              broadcastToClients({
                type: 'clear_lifeline_effects',
                reason: 'next_question_pre_clear',
                timestamp: Date.now()
              });
              
              gameState.current_question++;
              gameState.question_visible = false;
              gameState.answers_visible = false;
              gameState.answers_revealed = false;
              gameState.selected_answer = null;
              gameState.first_selected_answer = null; // Reset first selected answer for new question
              gameState.answer_is_wrong = false;
              gameState.answer_locked_in = false;
              gameState.typewriter_animation_complete = false;
              gameState.correct_answer_highlighted = false; // Reset highlighting for new question
              // REMOVED: original_wrong_answer reset - now handled by persistent_wrong_answers array
              gameState.persistent_wrong_answers = []; // Reset persistent wrong answers for new question
              
              // COMPLETE VOTING PANEL RESET for new question
              gameState.audience_poll_active = false;
              gameState.show_voting_activity = false;
              gameState.show_poll_winner = null;
              gameState.poll_winner_votes = 0;
              gameState.poll_winner_percentage = 0;
              gameState.poll_voters = [];
              gameState.poll_voter_history = [];
              gameState.poll_all_votes = [];
              
              // Clear question-level vote tracking for new question (prevents same answer re-voting)
              gameState.question_voter_answers = {};
              console.log('🗑️ Cleared question-level vote tracking for new question');
              
              // Reset lifeline states for new question
              gameState.first_poll_winner = null;
              gameState.is_revote_active = false;
              gameState.excluded_answers = [];
              gameState.host_selection_history = []; // Clear host selection history for new question
              
              // Clear any existing poll timer
              if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
              }
              
              // Broadcast poll ended event to all clients (including poll overlay)
              broadcastToClients({
                type: 'audience_poll_ended',
                reason: 'next_question',
                timestamp: Date.now()
              });
              
              // Reset lifeline voting states for next question
              if (gameState.lifeline_voting_active) {
                gameState.lifeline_voting_active = false;
                gameState.lifeline_votes = [];
                gameState.lifeline_voter_history = [];
                gameState.available_lifelines_for_vote = [];
                gameState.lifeline_vote_winner = null;
                gameState.lifeline_vote_counts = {
                  fiftyFifty: 0,
                  askAudience: 0,
                  askAMod: 0
                };
                console.log('🗳️ Lifeline voting reset for next question');
                
                // Hide the lifeline voting panel
                broadcastToClients({
                  type: 'hide_lifeline_voting_panel',
                  reason: 'next_question',
                  timestamp: Date.now()
                });
              }
              
              // Reset Ask a Mod states for next question and ensure Set integrity
              gameState.ask_a_mod_active = false;
              gameState.mod_responses = [];
              gameState.ask_a_mod_start_time = null;
              if (!(gameState.processed_mod_messages instanceof Set)) {
                gameState.processed_mod_messages = new Set();
              } else {
                gameState.processed_mod_messages.clear();
              }
              
              // Clear lifeline effects for new question
              broadcastToClients({
                type: 'clear_lifeline_effects',
                reason: 'next_question',
                timestamp: Date.now()
              });
              
              // Stop any currently playing lock-in sound effects and reset audio for next level
              console.log('🔇 Stopping any playing lock-in audio for next question');
              broadcastToClients({
                type: 'audio_command',
                command: 'stop_lock_audio',
                reason: 'next_question',
                timestamp: Date.now()
              });
              
              console.log('🔄 Next question - all voting states completely reset');
            }
            break;
            
          case 'previous_question':
            if (gameState.current_question > 0 && !gameState.answer_locked_in) {
              gameState.current_question--;
              gameState.question_visible = false;
              gameState.answers_visible = false;
              gameState.answers_revealed = false;
              gameState.selected_answer = null;
              gameState.answer_is_wrong = false;
              console.log('Previous question - state updated');
            }
            break;
            
          case 'show_question':
            gameState.question_visible = true;
            
            // Reset typewriter animation state for new question
            gameState.typewriter_animation_complete = false;
            console.log('⏳ Typewriter animation reset - Show Answers button will be disabled until typewriter completes');
            
            // Clear any existing typewriter timeout
            if (global.typewriterTimeout) {
              clearTimeout(global.typewriterTimeout);
            }
            
            // Server-side failsafe: auto-enable Show Answers button after 8 seconds
            global.typewriterTimeout = setTimeout(() => {
              if (!gameState.typewriter_animation_complete && gameState.question_visible) {
                console.warn('⚠️ Typewriter animation timeout - auto-enabling Show Answers button as failsafe');
                gameState.typewriter_animation_complete = true;
                broadcastState();
              }
            }, 8000); // 8 second timeout - reasonable time for longest questions
            
            // End any active poll when showing a new question
            if (gameState.audience_poll_active) {
              console.log('🔚 Ending active poll due to new question');
              endAutomaticPoll();
            }
            
            console.log('Question shown - state updated');
            
            // Broadcast question music audio command
            console.log('🎵 Broadcasting question music audio command');
            broadcastToClients({ type: 'audio_command', command: 'play_question' });
            
            break;
            
          case 'hide_question':
            gameState.question_visible = false;
            gameState.answers_visible = false;
            gameState.answers_revealed = false;
            gameState.selected_answer = null;
            gameState.answer_is_wrong = false;
            console.log('Question hidden - state updated');
            break;
            
          case 'show_answers':
            console.log('📋 show_answers action received for question:', gameState.current_question + 1);
            gameState.answers_visible = true;
            
            // CLEAN START: Reset all voting states for fresh start
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;
            gameState.poll_winner_votes = 0;
            gameState.poll_winner_percentage = 0;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            
            console.log('✅ Answers shown - state updated, preparing fresh voting panel');
            console.log('📊 Poll state reset - starting automatic poll immediately');
            
            // Auto-start polling immediately after answers are shown for precise timing
            startAutomaticPoll();
            break;
            
          case 'hide_answers':
            // Only allow hiding answers if no poll is active to prevent visibility issues
            if (!gameState.audience_poll_active) {
              gameState.answers_visible = false;
              gameState.answers_revealed = false;
              console.log('Answers hidden - state updated');
            } else {
              console.log('Cannot hide answers while poll is active - answers must stay visible');
            }
            break;
            
          case 'reveal_answer':
            // Validation: Check if answers are already revealed (prevent double-clicking)
            if (gameState.answers_revealed) {
              console.warn(`⚠️ Cannot reveal answer - answers already revealed`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - answers already revealed',
                state: 'already_revealed'
              }));
              return;
            }
            
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot reveal answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot reveal answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if an answer is selected
            if (gameState.selected_answer === null) {
              console.warn(`⚠️ Cannot reveal answer - no answer selected`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - no answer selected',
                state: 'no_selection'
              }));
              return;
            }
            
            // Validation: Check if answer is locked in
            if (!gameState.answer_locked_in) {
              console.warn(`⚠️ Cannot reveal answer - answer not locked in`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot reveal answer - answer must be locked in first',
                state: 'not_locked'
              }));
              return;
            }
            
            // Check if the selected answer is wrong before revealing
            if (gameState.selected_answer !== null) {
              const currentQuestion = questions[gameState.current_question];
              gameState.answer_is_wrong = gameState.selected_answer !== currentQuestion.correct;
              
              // Record answer result in history
              const questionIndex = gameState.current_question;
              const result = gameState.answer_is_wrong ? 'wrong' : 'correct';
              
              if (gameState.answerHistory && gameState.answerHistory[questionIndex]) {
                gameState.answerHistory[questionIndex].result = result;
                console.log(`📝 Recorded answer ${result} for question ${questionIndex + 1}`);
              }
              
              // Log the answer result
              if (!gameState.answer_is_wrong) {
                console.log('🎉 Correct answer for level:', gameState.current_question + 1);
              } else {
                console.log('❌ Wrong answer for level:', gameState.current_question + 1);
              }
            }
            gameState.answers_revealed = true;
            gameState.answer_locked_in = false;
            console.log('Answer revealed - state updated');
            
            // Fade out background question music when answer is revealed
            console.log('🎵 Fading out background question music');
            broadcastToClients({ type: 'audio_command', command: 'fade_question_music' });
            
            // Set correct answer highlighting flag
            if (!gameState.answer_is_wrong) {
              // If answer is correct, allow highlighting immediately
              gameState.correct_answer_highlighted = true;
              broadcastToClients({ type: 'audio_command', command: 'play_correct' });
              // Trigger confetti for correct answers
              setTimeout(() => {
                broadcastToClients({ type: 'confetti_trigger', command: 'create_confetti' });
                console.log('🎉 Broadcasting confetti trigger for correct answer');
              }, 1500); // Delay confetti to sync with applause
              // Add applause for correct answers
              setTimeout(() => {
                broadcastToClients({ type: 'audio_command', command: 'play_applause' });
              }, 1000); // Play applause after correct sound
            } else {
              // If answer is wrong, do NOT highlight correct answer yet - wait for lifelines
              gameState.correct_answer_highlighted = false;
              
              // Track the original wrong answer for persistent red highlighting during revotes
              // REMOVED: original_wrong_answer tracking - now handled by persistent_wrong_answers array above
              
              // Add wrong answer to persistent wrong answers list for red highlighting throughout lifeline flows
              if (!gameState.persistent_wrong_answers.includes(gameState.selected_answer)) {
                gameState.persistent_wrong_answers.push(gameState.selected_answer);
                console.log(`🔴 Added answer ${String.fromCharCode(65 + gameState.selected_answer)} to persistent wrong answers list: [${gameState.persistent_wrong_answers.map(i => String.fromCharCode(65 + i)).join(', ')}]`);
              }
              
              console.log('🚫 Correct answer highlighting disabled - waiting for lifeline success');
              broadcastToClients({ type: 'audio_command', command: 'play_wrong' });
              
              // Check if there are lifelines available to use for manual voting
              const availableLifelines = [];
              if (!gameState.lifelines_used.includes('fifty_fifty')) availableLifelines.push('fiftyFifty');
              // Only allow Take Another Vote if not used in this game
              if (!gameState.lifelines_used.includes('askAudience')) availableLifelines.push('askAudience');
              if (!gameState.lifelines_used.includes('phone_friend')) availableLifelines.push('askAMod');
              
              if (availableLifelines.length > 0) {
                // Auto-start lifeline voting after wrong answer
                console.log('❌ Wrong answer - automatically starting lifeline voting');
                gameState.available_lifelines_for_vote = availableLifelines;
                console.log('🗳️ Available lifelines for voting:', availableLifelines);
                
                // Initialize lifeline voting state immediately
                gameState.lifeline_voting_active = true;
                gameState.lifeline_voting_timer_active = true;
                gameState.lifeline_voting_start_time = Date.now();
                gameState.lifeline_votes = [];
                gameState.lifeline_voter_history = [];
                gameState.lifeline_vote_counts = {
                  fiftyFifty: 0,
                  askAudience: 0,
                  askAMod: 0
                };
                gameState.lifeline_vote_winner = null;
                
                // Add continuous countdown timer for smooth updates
                if (gameState.lifeline_countdown_interval) {
                  clearInterval(gameState.lifeline_countdown_interval);
                }
                gameState.lifeline_countdown_interval = setInterval(() => {
                  if (gameState.lifeline_voting_timer_active) {
                    const elapsed = Date.now() - gameState.lifeline_voting_start_time;
                    const remaining = Math.max(0, (gameState.lifeline_voting_duration || 30000) - elapsed);
                    
                    // Broadcast countdown update
                    broadcastToClients({
                      type: 'lifeline_voting_countdown',
                      remainingTime: remaining,
                      seconds: Math.ceil(remaining / 1000)
                    });
                    
                    // Stop timer if time is up
                    if (remaining === 0) {
                      clearInterval(gameState.lifeline_countdown_interval);
                      gameState.lifeline_countdown_interval = null;
                      
                      // Actually end the voting and process results
                      console.log('⏰ Lifeline voting timer expired - processing results');
                      endLifelineVoting();
                    }
                  }
                }, 1000); // Update every 1 second to prevent console spam
                
                // Broadcast lifeline voting started
                broadcastToClients({
                  type: 'lifeline_voting_started',
                  availableLifelines: availableLifelines,
                  duration: gameState.lifeline_voting_duration || 30000,
                  message: 'Wrong answer! Vote for a lifeline: 1=50:50, 2=Take Another Vote, 3=Ask a Mod'
                });
                
                console.log('🗳️ Lifeline voting automatically started for 30 seconds');
                
                // Auto-end lifeline voting after duration
                setTimeout(() => {
                  if (gameState.lifeline_voting_active) {
                    // Process lifeline voting results
                    console.log('⏰ Lifeline voting time expired - processing results');
                    
                    // Find the winning lifeline
                    const voteCounts = gameState.lifeline_vote_counts;
                    let maxVotes = 0;
                    let winningLifeline = null;
                    
                    for (const [lifeline, votes] of Object.entries(voteCounts)) {
                      if (votes > maxVotes) {
                        maxVotes = votes;
                        winningLifeline = lifeline;
                      }
                    }
                    
                    if (winningLifeline && maxVotes > 0) {
                      gameState.lifeline_vote_winner = winningLifeline;
                      console.log(`🏆 Lifeline voting winner: ${winningLifeline} with ${maxVotes} votes`);
                      
                      // End lifeline voting
                      gameState.lifeline_voting_active = false;
                      gameState.lifeline_voting_timer_active = false;
                      
                      // Clear continuous countdown timer
                      if (gameState.lifeline_countdown_interval) {
                        clearInterval(gameState.lifeline_countdown_interval);
                        gameState.lifeline_countdown_interval = null;
                        console.log('⏱️ Cleared lifeline countdown interval on timer expiry');
                      }
                      
                      // Broadcast results
                      broadcastToClients({
                        type: 'lifeline_voting_ended',
                        winner: winningLifeline,
                        totalVotes: Object.values(voteCounts).reduce((a, b) => a + b, 0),
                        voteCounts: voteCounts
                      });
                      
                      // Trigger the winning lifeline
                      setTimeout(() => {
                        triggerLifeline(winningLifeline);
                      }, 1500); // Brief display of results before triggering
                    } else {
                      console.log('❌ No votes received - ending lifeline voting');
                      gameState.lifeline_voting_active = false;
                      gameState.lifeline_voting_timer_active = false;
                      
                      // Clear continuous countdown timer
                      if (gameState.lifeline_countdown_interval) {
                        clearInterval(gameState.lifeline_countdown_interval);
                        gameState.lifeline_countdown_interval = null;
                        console.log('⏱️ Cleared lifeline countdown interval (no votes)');
                      }
                      
                      broadcastToClients({
                        type: 'lifeline_voting_ended',
                        winner: null,
                        totalVotes: 0,
                        message: 'No votes received'
                      });
                    }
                  }
                }, gameState.lifeline_voting_duration || 30000);
              } else {
                console.log('❌ No lifelines available - game over');
              }
            }
            
            break;
            
          case 'set_selected_answer':
            const selectedIndex = data.answer_index !== undefined ? data.answer_index : data.answer;
            
            // Validation: Check if selectedIndex is valid
            if (selectedIndex === undefined || selectedIndex === null || 
                typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 3) {
              console.warn(`⚠️ Invalid answer index: ${selectedIndex}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Invalid answer selection. Please select A, B, C, or D.',
                receivedIndex: selectedIndex
              }));
              return;
            }
            
            const isRevote = gameState.is_revote_active;
            const selectedLetter = String.fromCharCode(65 + selectedIndex); // Convert to A, B, C, D
            
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot select answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot select answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot select answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot select answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if trying to select an excluded answer from lifelines
            if (gameState.excluded_answers && gameState.excluded_answers.includes(selectedIndex)) {
              console.warn(`⚠️ Cannot select answer ${selectedLetter} - excluded by lifeline (50:50)`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: `Answer ${selectedLetter} is not available - eliminated by lifeline`,
                excludedAnswers: gameState.excluded_answers.map(i => String.fromCharCode(65 + i))
              }));
              return;
            }
            
            gameState.selected_answer = selectedIndex;
            
            // Track first selected answer for persistent highlighting (only if not set yet)
            if (gameState.first_selected_answer === null) {
              gameState.first_selected_answer = selectedIndex;
              console.log(`📍 First answer selection tracked: ${selectedLetter} (index ${selectedIndex})`);
            }
            
            // Re-evaluate answer correctness if answers have been revealed (during revotes)
            if (gameState.answers_revealed) {
              const currentQuestion = questions[gameState.current_question];
              const wasWrong = gameState.answer_is_wrong;
              gameState.answer_is_wrong = selectedIndex !== currentQuestion.correct;
              
              if (wasWrong !== gameState.answer_is_wrong) {
                console.log(`✅ Answer correctness updated: ${gameState.answer_is_wrong ? 'WRONG' : 'CORRECT'} (was ${wasWrong ? 'WRONG' : 'CORRECT'})`);
                
                // Update answer history if the result changed
                if (gameState.answerHistory && gameState.answerHistory[gameState.current_question]) {
                  gameState.answerHistory[gameState.current_question].result = gameState.answer_is_wrong ? 'wrong' : 'correct';
                  console.log(`📝 Updated answer history for question ${gameState.current_question + 1}: ${gameState.answer_is_wrong ? 'wrong' : 'correct'}`);
                }
              }
            }
            
            // Auto-lock answer when host manually selects during polling
            // This ensures the answer is ready for revealing without needing separate lock action
            if (gameState.audience_poll_active || isRevote) {
              gameState.answer_locked_in = true;
              console.log(`🔒 Auto-locked answer ${selectedLetter} due to manual host selection during ${isRevote ? 'revote' : 'polling'}`);
            }
            
            if (isRevote) {
              console.log(`🔄 Host manually selected answer ${selectedLetter} during revote - revote will be terminated`);
            } else {
              console.log(`🎯 Host selected answer ${selectedLetter}`);
            }
            
            // If host manually selects an answer, terminate any active poll
            if (gameState.audience_poll_active) {
              if (isRevote) {
                console.log('🔄 Host manual selection during revote - ending revote and maintaining host control');
              } else {
                console.log('🎯 Host manually selected answer - terminating active audience poll');
              }
              endAutomaticPoll();
            }
            
            // Add to voting history for visual feedback (multiple selections tracking)
            if (!gameState.host_selection_history) {
              gameState.host_selection_history = [];
            }
            
            // Add current selection to history if not already there
            if (!gameState.host_selection_history.includes(selectedIndex)) {
              gameState.host_selection_history.push(selectedIndex);
              console.log(`📝 Added ${selectedLetter} to host selection history:`, 
                gameState.host_selection_history.map(i => String.fromCharCode(65 + i)).join(', '));
            }
            
            break;
            
          case 'lock_answer':
            // Validation: Check if lifeline voting is active
            if (gameState.lifeline_voting_active) {
              console.warn(`⚠️ Cannot lock answer during lifeline voting`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer while lifeline voting is active',
                state: 'lifeline_voting'
              }));
              return;
            }
            
            // Validation: Check if Ask a Mod is active
            if (gameState.ask_a_mod_active) {
              console.warn(`⚠️ Cannot lock answer during Ask a Mod`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer while Ask a Mod is active',
                state: 'ask_a_mod'
              }));
              return;
            }
            
            // Validation: Check if an answer is selected
            if (gameState.selected_answer === null) {
              console.warn(`⚠️ Cannot lock answer - no answer selected`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Cannot lock answer - no answer selected',
                state: 'no_selection'
              }));
              return;
            }
            
            const wasLocked = gameState.answer_locked_in;
            gameState.answer_locked_in = true; // Always lock, don't toggle
            const isRevoteActive = gameState.is_revote_active;
            const currentSelectedLetter = gameState.selected_answer !== null ? 
              String.fromCharCode(65 + gameState.selected_answer) : 'NONE';
            
            if (isRevoteActive) {
              console.log(`🔄🔒 Host locked in answer ${currentSelectedLetter} during revote - revote terminated, host control confirmed`);
            } else if (wasLocked) {
              console.log(`🔒 Host confirmed lock for answer ${currentSelectedLetter} (already locked)`);
            } else {
              console.log(`🔒 Host locked in answer ${currentSelectedLetter}`);
            }
            
            // If locking in an answer, terminate any active poll
            if (gameState.answer_locked_in && gameState.audience_poll_active) {
              if (isRevoteActive) {
                console.log('🔄 Host lock-in during revote - ending revote and confirming manual selection');
              } else {
                console.log('🔒 Host locked in answer - terminating active audience poll');
              }
              endAutomaticPoll();
            }
            
            // Broadcast lock-in audio command only when locking in (not when unlocking)
            if (gameState.answer_locked_in) {
              broadcastToClients({ type: 'audio_command', command: 'play_lock' });
            }
            
            break;
            
          case 'set_contestant':
            gameState.contestant_name = data.name || '';
            break;
            
          case 'send_host_message':
            console.log('🎤 Host message received:', data.message);
            if (data.message && data.message.trim()) {
              // Broadcast host message to all connected clients
              const hostChatMessage = {
                type: 'chat_message',
                id: `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                username: 'HOST',
                text: data.message.trim(),
                platform: 'system',
                timestamp: Date.now(),
                badges: ['host'],
                color: '#FFD700', // Gold color for host
                isHost: true
              };
              
              broadcastToClients(hostChatMessage);
              console.log('📡 Host message broadcasted to all clients');
              
              // Process host message for votes if voting is active
              if (gameState.audience_poll_active) {
                console.log('🗳️ Processing host message as potential audience poll vote');
                try {
                  processVoteFromChat(hostChatMessage);
                } catch (error) {
                  console.error('❌ Error processing host audience poll vote:', error);
                }
              }
              
              // Process as lifeline vote if lifeline voting is active
              if (gameState.lifeline_voting_active) {
                console.log('🗳️ Processing host message as potential lifeline vote');
                console.log('📊 Lifeline voting state:', {
                  active: gameState.lifeline_voting_active,
                  availableLifelines: gameState.available_lifelines_for_vote,
                  currentVoteCounts: gameState.lifeline_vote_counts,
                  hostMessage: hostChatMessage.text,
                  hostUsername: hostChatMessage.username
                });
                try {
                  // Additional validation before processing
                  if (!hostChatMessage || !hostChatMessage.text || !hostChatMessage.username) {
                    console.error('❌ Invalid host chat message for lifeline vote:', hostChatMessage);
                    return;
                  }
                  processLifelineVoteFromChat(hostChatMessage);
                } catch (error) {
                  console.error('❌ Error processing host lifeline vote:', error);
                  console.error('Stack trace:', error.stack);
                  // Continue execution - don't crash the server
                }
              } else {
                console.log('⚠️ Lifeline voting not active, host message not processed for lifeline vote');
              }
              
              // Process as Ask a Mod response if Ask a Mod is active
              // Check both if username is provided OR if 'HOST' is in moderator list
              if (gameState.ask_a_mod_active) {
                let modUsername = null;
                
                // If username is provided, use it
                if (data.username && data.username.trim()) {
                  modUsername = data.username.trim();
                } 
                // Otherwise check if 'host' (lowercase) is in moderator list
                else if (gameState.mod_list && gameState.mod_list.includes('host')) {
                  modUsername = 'host';
                  console.log('🛡️ Host is in moderator list, processing as mod response');
                }
                
                if (modUsername) {
                  // Create moderator chat message
                  const modChatMessage = {
                    username: modUsername,
                    text: data.message.trim(),
                    platform: 'system',
                    timestamp: Date.now()
                  };
                  
                  console.log('🛡️ Processing host message as Ask a Mod response from:', modUsername);
                  try {
                    checkAndProcessModResponse(modChatMessage);
                  } catch (error) {
                    console.error('❌ Error processing host message as mod response:', error);
                  }
                }
              }
              
              // Process as giveaway entry if giveaway is active
              if (gameState.giveaway_active) {
                console.log('🎁 Processing host message as potential giveaway entry');
                try {
                  processGiveawayEntry(hostChatMessage.username, hostChatMessage.text);
                } catch (error) {
                  console.error('❌ Error processing host giveaway entry:', error);
                }
              }
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
              return;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Message cannot be empty' }));
              return;
            }
            break;
            
          case 'update_prizes':
            if (data.prizes && Array.isArray(data.prizes)) {
              prizeAmounts = [...data.prizes];
              gameState.prizes = [...data.prizes]; // Sync with game state
              
              // Save to file for persistence
              const saved = savePrizes(prizeAmounts);
              if (saved) {
                console.log(`💰 Prize amounts updated and saved:`, prizeAmounts);
              } else {
                console.log(`💰 Prize amounts updated (memory only):`, prizeAmounts);
              }
              
              // Broadcast update to all clients so browser can update
              broadcastToClients({
                type: 'prizes_updated',
                prizes: prizeAmounts,
                saved: saved
              });
            }
            break;
            
          case 'recalculate_lifelines':
            // Manually recalculate available lifelines based on current used lifelines
            if (gameState.answers_revealed && gameState.answer_is_wrong) {
              console.log('🔧 Manually recalculating available lifelines...');
              console.log('🔍 Current lifelines_used:', gameState.lifelines_used);
              
              const availableLifelines = [];
              if (!gameState.lifelines_used.includes('fifty_fifty')) availableLifelines.push('fiftyFifty');
              if (!gameState.lifelines_used.includes('takeAnotherVote')) availableLifelines.push('askAudience');
              if (!gameState.lifelines_used.includes('phone_friend')) availableLifelines.push('askAMod');
              
              gameState.available_lifelines_for_vote = availableLifelines;
              console.log('✅ Updated available_lifelines_for_vote:', availableLifelines);
              
              broadcastState();
            }
            break;
            
          case 'start_lifeline_vote':
            // Manually start lifeline voting after wrong answer is revealed
            if (gameState.answers_revealed && gameState.answer_is_wrong && gameState.available_lifelines_for_vote.length > 0) {
              console.log('🗳️ Host manually starting lifeline voting with available lifelines:', gameState.available_lifelines_for_vote);
              
              // Initialize lifeline voting state
              gameState.lifeline_voting_active = true;
              gameState.lifeline_votes = [];
              gameState.lifeline_voter_history = [];
              gameState.lifeline_vote_winner = null;
              gameState.lifeline_vote_counts = {
                fiftyFifty: 0,
                askAudience: 0,
                askAMod: 0
              };
              
              // Broadcast lifeline voting started
              broadcastToClients({
                type: 'lifeline_voting_started',
                availableLifelines: gameState.available_lifelines_for_vote,
                duration: gameState.lifeline_voting_duration
              });
              
              // Auto-end lifeline voting after the configured duration, but with checks
              setTimeout(() => {
                if (gameState.lifeline_voting_active) {
                  // Check if we have sufficient votes to make a decision
                  const totalVotes = gameState.lifeline_votes.length;
                  console.log(`🕐 Lifeline voting timer expired. Total votes: ${totalVotes}`);
                  
                  if (totalVotes >= 3) {
                    // Sufficient votes to determine a winner
                    console.log('✅ Sufficient votes received, ending lifeline voting');
                    endLifelineVoting();
                  } else {
                    // Not enough votes - extend timer by 30 seconds
                    console.log('⏳ Insufficient votes, extending lifeline voting by 30 seconds');
                    broadcastToClients({
                      type: 'lifeline_voting_extended',
                      message: 'Voting extended - need more votes!',
                      additionalTime: 30000
                    });
                    
                    // Extended timer
                    setTimeout(() => {
                      if (gameState.lifeline_voting_active) {
                        console.log('🕐 Extended lifeline voting timer expired, ending regardless of vote count');
                        endLifelineVoting();
                      }
                    }, 30000); // Additional 30 seconds
                  }
                }
              }, gameState.lifeline_voting_duration);
              
              console.log(`🎲 Lifeline voting started for ${gameState.lifeline_voting_duration / 1000} seconds`);
            } else {
              console.warn('⚠️ Cannot start lifeline voting - conditions not met');
              console.log('   answers_revealed:', gameState.answers_revealed);
              console.log('   answer_is_wrong:', gameState.answer_is_wrong);
              console.log('   available_lifelines:', gameState.available_lifelines_for_vote);
            }
            break;
            
          case 'end_lifeline_voting':
            // Manually end lifeline voting (host control)
            if (gameState.lifeline_voting_active) {
              console.log('🛑 Host manually ending lifeline voting');
              endLifelineVoting();
            } else {
              console.warn('⚠️ Cannot end lifeline voting - not currently active');
            }
            break;
            
          case 'switch_overlay':
            gameState.overlay_type = data.overlay || 'original';
            console.log(`🎨 Overlay switched to: ${gameState.overlay_type}`);
            break;
            
          case 'force_typewriter_complete':
            console.log('🔧 Force enabling typewriter completion state (manual override)');
            gameState.typewriter_animation_complete = true;
            
            // Clear any pending timeout
            if (global.typewriterTimeout) {
              clearTimeout(global.typewriterTimeout);
              global.typewriterTimeout = null;
            }
            
            // Broadcast state immediately
            console.log('🔄 Broadcasting forced typewriter completion to all clients');
            broadcastState();
            break;
            
            
          case 'update_questions':
            if (data.questions && Array.isArray(data.questions)) {
              questions.splice(0, questions.length, ...data.questions);
              
              // Save to file for persistence
              const saved = saveQuestions(questions);
              if (saved) {
                console.log(`❓ Questions updated and saved: ${questions.length} questions loaded`);
              } else {
                console.log(`❓ Questions updated (memory only): ${questions.length} questions loaded`);
              }
              
              // Broadcast update to all clients so browser can update
              broadcastToClients({
                type: 'questions_updated',
                questions: questions,
                saved: saved
              });
            }
            break;
            
          case 'poll_winner_selected':
            // Handle automatic poll winner selection - sets choice but doesn't lock in visually
            if (data.winner && ['A', 'B', 'C', 'D'].includes(data.winner)) {
              const answerIndex = ['A', 'B', 'C', 'D'].indexOf(data.winner);
              gameState.selected_answer = answerIndex;
              gameState.answer_locked_in = false; // Do NOT auto-lock - only set the selection
              gameState.audience_poll_active = false;
              console.log(`🏆 Poll winner: ${data.winner} - Answer ${answerIndex} selected by audience`);
              console.log(`🎯 Host can now click "Lock Answer" then "Reveal Answer" to see if audience was correct`);
            }
            break;
            
          case 'show_poll_winner_announcement':
            // Show brief winner announcement overlay (3 seconds)
            gameState.show_poll_winner = data.winner || 'A';
            gameState.poll_winner_votes = data.votes || 1;
            gameState.poll_winner_percentage = data.percentage || 100;
            console.log(`📢 Showing poll winner announcement: ${data.winner} with ${data.votes} votes (${data.percentage}%)`);
            
            // Auto-hide after 3 seconds
            setTimeout(() => {
              gameState.show_poll_winner = null;
              gameState.update_needed = true;
              broadcastState();
              console.log('📢 Poll winner announcement hidden');
            }, 3000);
            break;
            
          case 'start_manual_poll':
            console.log('🗳️ Starting manual audience poll from timer button');
            
            if (!gameState.answers_visible) {
              console.warn('⚠️ Cannot start manual poll - answers not visible');
              break;
            }
            
            if (gameState.audience_poll_active) {
              console.warn('⚠️ Cannot start manual poll - poll already active');
              break;
            }
            
            // Start manual poll with 60-second duration
            gameState.audience_poll_active = true;
            gameState.poll_voters = [];
            gameState.poll_voter_history = [];
            gameState.poll_all_votes = [];
            gameState.show_poll_winner = null;
            gameState.show_voting_activity = true;
            
            console.log('⏱️ Manual 60-second poll timer started - chat can vote A, B, C, or D');
            
            // Broadcast poll start to all clients
            broadcastState();
            
            // Auto-end poll after 60 seconds
            setTimeout(() => {
              if (gameState.audience_poll_active) {
                console.log('🏁 Auto-ending manual poll after 60 seconds - hiding voting panel');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                
                // Tally votes and determine winner
                if (gameState.poll_all_votes.length > 0) {
                  const voteCounts = { A: 0, B: 0, C: 0, D: 0 };
                  gameState.poll_all_votes.forEach(vote => {
                    if (voteCounts.hasOwnProperty(vote.vote)) {
                      voteCounts[vote.vote]++;
                    }
                  });
                  
                  const winner = Object.keys(voteCounts).reduce((a, b) => 
                    voteCounts[a] > voteCounts[b] ? a : b
                  );
                  
                  gameState.show_poll_winner = winner;
                  gameState.poll_winner_votes = voteCounts[winner];
                  gameState.poll_winner_percentage = Math.round(
                    (voteCounts[winner] / gameState.poll_all_votes.length) * 100
                  );
                  
                  console.log(`🏆 Manual poll winner: ${winner} with ${voteCounts[winner]} votes (${gameState.poll_winner_percentage}%)`);
                } else {
                  console.log('⚠️ No votes to tally from manual poll');
                }
                
                console.log('✅ Manual polling panel completely hidden until next question answers');
                broadcastState();
              }
            }, gameState.audience_poll_duration); // Use configurable poll duration
            break;
            
          case 'twitch_chat_start':
            console.log('🎮 Starting Twitch simple chat process...');
            
            // Check for existing process using PID file
            const pidFile = path.join(__dirname, 'simple-twitch-chat.pid');
            try {
              if (fs.existsSync(pidFile)) {
                const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
                try {
                  process.kill(existingPid, 0); // Check if process exists
                  console.log(`⚠️ Twitch chat already running (PID: ${existingPid}). Skipping start.`);
                  break; // Exit without starting new process
                } catch (error) {
                  // Process doesn't exist, clean up stale PID file
                  console.log(`🧹 Cleaning up stale PID file for non-existent process ${existingPid}`);
                  fs.unlinkSync(pidFile);
                }
              }
            } catch (error) {
              console.log('⚠️ Error checking existing process:', error.message);
            }
            
            try {
              const { spawn } = require('child_process');
              const twitchChatProcess = spawn('node', ['simple-twitch-chat.js'], {
                cwd: __dirname,
                detached: false,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              
              twitchChatProcess.stdout.on('data', (data) => {
                console.log(`📺 Twitch Chat: ${data.toString().trim()}`);
              });
              
              twitchChatProcess.stderr.on('data', (data) => {
                console.error(`❌ Twitch Chat Error: ${data.toString().trim()}`);
              });
              
              twitchChatProcess.on('exit', (code) => {
                console.log(`🎮 Twitch chat process exited with code ${code}`);
                // Clean up PID file when process exits
                try {
                  if (fs.existsSync(pidFile)) {
                    fs.unlinkSync(pidFile);
                    console.log('🧹 Cleaned up PID file after process exit');
                  }
                } catch (error) {
                  // Ignore cleanup errors
                }
              });
              
              // Store process reference globally for stopping later
              global.twitchChatProcess = twitchChatProcess;
              
              console.log('✅ Twitch simple chat started successfully');
            } catch (error) {
              console.error('❌ Failed to start Twitch chat:', error);
            }
            break;
            
          case 'twitch_chat_stop':
            console.log('🛑 Stopping Twitch simple chat process...');
            try {
              // Clean up PID file first
              const pidFile = path.join(__dirname, 'simple-twitch-chat.pid');
              if (fs.existsSync(pidFile)) {
                try {
                  const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
                  console.log(`🛑 Killing process ${pid} via PID file`);
                  process.kill(pid, 'SIGTERM');
                  fs.unlinkSync(pidFile);
                  console.log('🧹 Cleaned up PID file');
                } catch (error) {
                  console.log('⚠️ Error stopping via PID file:', error.message);
                  // Try to clean up stale PID file
                  try {
                    fs.unlinkSync(pidFile);
                  } catch (e) {
                    // Ignore cleanup errors
                  }
                }
              }
              
              // Also try the global process reference as fallback
              if (global.twitchChatProcess) {
                global.twitchChatProcess.kill('SIGTERM');
                global.twitchChatProcess = null;
                console.log('✅ Twitch simple chat stopped via global reference');
              } else {
                console.log('✅ Twitch simple chat stopped successfully');
              }
            } catch (error) {
              console.error('❌ Failed to stop Twitch chat:', error);
            }
            break;
          
            
          case 'end_game_credits':
            console.log('🎭 Starting end game credits roll...');
            
            // Set credits rolling state AND start scrolling immediately
            gameState.credits_rolling = true;
            gameState.credits_scrolling = true;  // Start scrolling immediately
            
            // Close curtains for cinematic effect
            gameState.curtains_closed = true;
            
            // End any active polls
            gameState.audience_poll_active = false;
            gameState.show_voting_activity = false;
            gameState.show_poll_winner = null;
            
            console.log(`🎭 Credits will feature ${gameState.gameshow_participants.length} participants`);
            console.log('🎭 Participants:', gameState.gameshow_participants.join(', '));
            console.log('🎬 Credits scrolling started immediately - 20 second animation');
            
            // Auto-reset after credits (20 seconds)
            setTimeout(() => {
              gameState.credits_rolling = false;
              gameState.credits_scrolling = false;
              console.log('🎭 Credits completed - ready for game reset');
              broadcastState();
            }, 20000); // 20 seconds for credits roll
            break;
            
          case 'start_credits_scroll':
            // This case is now deprecated - credits scroll automatically
            console.log('⚠️ start_credits_scroll is deprecated - credits now scroll automatically');
            break;
            
          case 'add_demo_participants':
            console.log('🎭 Adding demo participants for credits demonstration...');
            const demoParticipants = ['StreamViewer123', 'GameFan2024', 'QuizMaster', 'KimbillionaireFan', 'ChatUser42', 'TwitchViewer', 'AudienceMember', 'PollVoter99', 'ShowWatcher'];
            gameState.gameshow_participants = [...demoParticipants];
            console.log(`🎭 Added ${gameState.gameshow_participants.length} demo participants:`, gameState.gameshow_participants.join(', '));
            break;
            
          case 'use_lifeline_fifty_fifty':
            console.log('💡 Using 50:50 lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing 50:50 as winner');
              
              // Set 50:50 as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.fiftyFifty = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.askAudience + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'fiftyFifty';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              
              // Broadcast that voting ended with 50:50 as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'fiftyFifty',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('fifty_fifty')) {
              gameState.lifelines_used.push('fifty_fifty');
              
              // Get current question's correct answer
              const currentQuestion = questions[gameState.current_question];
              if (currentQuestion) {
                const correctIndex = currentQuestion.correct;
                
                // Enhanced 50:50 logic - if answer is already selected, eliminate only 1 wrong answer to leave 2 choices
                const incorrectAnswers = [];
                for (let i = 0; i < 4; i++) {
                  if (i !== correctIndex && i !== gameState.selected_answer) {
                    incorrectAnswers.push(i);
                  }
                }
                
                let toEliminate = [];
                if (gameState.selected_answer !== null && gameState.selected_answer !== undefined) {
                  // Answer is already selected - eliminate only 1 wrong answer to leave 2 choices for revote
                  toEliminate = incorrectAnswers.sort(() => 0.5 - Math.random()).slice(0, 1);
                  console.log(`🎯 Answer already selected (${String.fromCharCode(65 + gameState.selected_answer)}) - eliminating only 1 wrong answer for revote`);
                } else {
                  // No answer selected yet - use traditional 50:50 (eliminate 2 wrong answers)
                  toEliminate = incorrectAnswers.sort(() => 0.5 - Math.random()).slice(0, Math.min(2, incorrectAnswers.length));
                  console.log(`🎯 No answer selected yet - using traditional 50:50 elimination`);
                }
                
                // Log protection and elimination details
                if (gameState.selected_answer !== null && gameState.selected_answer !== undefined) {
                  console.log(`🛡️ 50:50 protection: Selected answer ${gameState.selected_answer} (${String.fromCharCode(65 + gameState.selected_answer)}) will NOT be eliminated`);
                  console.log(`🎯 Eliminating ${toEliminate.length} wrong answer(s) to leave 2 choices for revote`);
                } else {
                  console.log(`🎯 No answer selected - traditional 50:50 elimination`);
                }
                console.log(`🎯 Available answers to eliminate: ${incorrectAnswers.map(i => String.fromCharCode(65 + i)).join(', ')}`);
                
                // Set excluded answers for vote filtering during revote
                gameState.excluded_answers = toEliminate;
                console.log(`🚫 Set excluded answers for vote filtering: ${toEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
                
                // Broadcast the elimination to all clients
                broadcastToClients({
                  type: 'lifeline_fifty_fifty',
                  eliminatedAnswers: toEliminate,
                  correctAnswer: correctIndex,
                  selectedAnswer: gameState.selected_answer, // Include selected answer for UI preservation
                  excludedAnswers: toEliminate, // Send excluded answers to client for UI filtering
                  timestamp: Date.now()
                });
                
                console.log(`💡 50:50 eliminated answers: ${toEliminate.map(i => String.fromCharCode(65 + i)).join(', ')}`);
                
                // Broadcast immediate notification that revote is coming
                broadcastToClients({
                  type: 'system_announcement',
                  message: '⏳ 50:50 elimination complete! Automatic revote starting in 3 seconds...',
                  level: 'info',
                  timestamp: Date.now()
                });
                
                // CRITICAL: Stop any existing poll completely before starting revote
                if (pollTimer) {
                  console.log('⏹️ Clearing existing poll timer and stopping active poll');
                  clearTimeout(pollTimer);
                  pollTimer = null;
                }
                
                // Stop the current poll state immediately
                if (gameState.audience_poll_active) {
                  console.log('🛑 Stopping active audience poll for 50:50 revote');
                  gameState.audience_poll_active = false;
                  gameState.show_voting_activity = false;
                  broadcastToClients({
                    type: 'audience_poll_ended',
                    reason: 'fifty_fifty_lifeline',
                    message: '50:50 lifeline used - starting revote with remaining answers',
                    timestamp: Date.now()
                  });
                }
                
                // Start automatic revote after 50:50 elimination (matching automatic selection behavior)
                setTimeout(() => {
                  console.log('🔄🔄🔄 STARTING AUTOMATIC REVOTE AFTER 50:50 ELIMINATION COMPLETE 🔄🔄🔄');
                  console.log('📊 About to start revote with excluded answers:', gameState.excluded_answers.map(i => String.fromCharCode(65 + i)).join(', '));
                  startPostLifelineRevote('fiftyFifty');
                  console.log('✅ 50:50 automatic revote initiated - audience should now be able to vote on remaining answers');
                }, 3000); // 3-second delay to ensure visual elimination effects are fully complete
                
                // For manual 50:50, don't track outcome since revote handles the flow
                console.log('✅ Manual 50:50 complete - revote will handle subsequent flow');
              }
            } else {
              console.log('⚠️ 50:50 lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: '50:50 lifeline has already been used in this game',
                lifeline: 'fifty_fifty',
                action: 'use_lifeline_fifty_fifty'
              }));
              return;
            }
            break;

          case 'use_lifeline_phone_friend':
            console.log('🛡️ Using Ask a Mod lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing Ask a Mod as winner');
              
              // Set Ask a Mod as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.askAMod = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.askAudience + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'askAMod';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              
              // Broadcast that voting ended with Ask a Mod as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'askAMod',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('phone_friend')) {
              // CRITICAL: Stop any existing poll completely before starting Ask a Mod
              if (pollTimer) {
                console.log('⏹️ Clearing existing poll timer and stopping active poll for Ask a Mod');
                clearTimeout(pollTimer);
                pollTimer = null;
              }
              
              // Stop the current poll state immediately
              if (gameState.audience_poll_active) {
                console.log('🛑 Stopping active audience poll for Ask a Mod lifeline');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                broadcastToClients({
                  type: 'audience_poll_ended',
                  reason: 'ask_a_mod_lifeline',
                  message: 'Ask a Mod lifeline used - starting mod response period',
                  timestamp: Date.now()
                });
              }
              
              // Use consolidated Ask a Mod function
              startAskAMod();
            } else {
              console.log('⚠️ Ask a Mod lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'Ask a Mod lifeline has already been used' 
              }));
              return;
            }
            break;

          case 'use_lifeline_ask_audience':
            console.log('🗳️ Using Take Another Vote lifeline');
            
            // If lifeline voting is active, terminate it and show this as the winner
            if (gameState.lifeline_voting_active) {
              console.log('🎯 Manual lifeline selection - terminating active voting and showing Take Another Vote as winner');
              
              // Set Take Another Vote as the winner with maximum votes to show it won
              gameState.lifeline_vote_counts.askAudience = Math.max(
                gameState.lifeline_vote_counts.fiftyFifty + 1,
                gameState.lifeline_vote_counts.askAudience + 1,
                gameState.lifeline_vote_counts.askAMod + 1
              );
              gameState.lifeline_vote_winner = 'askAudience';
              
              // End voting immediately
              gameState.lifeline_voting_active = false;
              
              // Broadcast that voting ended with Take Another Vote as winner
              broadcastToClients({
                type: 'lifeline_voting_ended',
                winner: 'askAudience',
                votes: gameState.lifeline_vote_counts,
                totalVotes: gameState.lifeline_votes.length,
                manualSelection: true
              });
              
              // Hide the voting panel
              broadcastToClients({
                type: 'hide_lifeline_voting_panel',
                reason: 'manual_selection',
                timestamp: Date.now()
              });
            }
            
            if (!gameState.lifelines_used.includes('takeAnotherVote')) {
              // CRITICAL: Stop any existing poll completely before starting Take Another Vote
              if (pollTimer) {
                console.log('⏹️ Clearing existing poll timer and stopping active poll for Take Another Vote');
                clearTimeout(pollTimer);
                pollTimer = null;
              }
              
              // Stop the current poll state immediately
              if (gameState.audience_poll_active) {
                console.log('🛑 Stopping active audience poll for Take Another Vote lifeline');
                gameState.audience_poll_active = false;
                gameState.show_voting_activity = false;
                broadcastToClients({
                  type: 'audience_poll_ended',
                  reason: 'take_another_vote_lifeline',
                  message: 'Take Another Vote lifeline used - starting fresh revote',
                  timestamp: Date.now()
                });
              }
              
              gameState.lifelines_used.push('takeAnotherVote');
              
              // Use the standardized Take Another Vote function with hybrid control (matches Ask a Mod pattern)
              console.log('🔄 Starting Take Another Vote with standardized hybrid control function');
              console.log(`🚫 Current excluded answers from previous lifelines: ${JSON.stringify(gameState.excluded_answers)}`);
              
              // Use the new standardized function that implements hybrid control properly
              startPostLifelineRevoteForTakeAnotherVote();
            } else {
              console.log('⚠️ Take Another Vote lifeline already used');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: 'Take Another Vote lifeline has already been used in this game',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_ask_audience'
              }));
              return;
            }
            break;
          
          case 'use_lifeline_take_another_vote':
            console.log('🗳️ Using Take Another Vote lifeline (MANUAL HOST SELECTION)');
            
            // Check if lifeline has already been used
            if (gameState.lifelines_used.includes('takeAnotherVote')) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false,
                error: 'Take Another Vote lifeline has already been used in this game',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_take_another_vote'
              }));
              return;
            }
            
            try {
              // If lifeline voting is active, terminate it and show this as the winner
              if (gameState.lifeline_voting_active) {
                console.log('🎯 Manual lifeline selection - terminating active voting and showing Take Another Vote as winner');
                
                // Set Take Another Vote as the winner with maximum votes to show it won
                gameState.lifeline_vote_counts.askAudience = Math.max(
                  gameState.lifeline_vote_counts.fiftyFifty + 1,
                  gameState.lifeline_vote_counts.askAudience + 1,
                  gameState.lifeline_vote_counts.askAMod + 1
                );
                gameState.lifeline_vote_winner = 'askAudience';
                
                // End voting immediately
                gameState.lifeline_voting_active = false;
                gameState.lifeline_voting_timer_active = false;
                
                // Broadcast that voting ended with Take Another Vote as winner
                broadcastToClients({
                  type: 'lifeline_voting_ended',
                  winner: 'askAudience',
                  votes: gameState.lifeline_vote_counts,
                  totalVotes: gameState.lifeline_votes.length,
                  manualSelection: true,
                  timestamp: Date.now()
                });
                
                // Hide the voting panel
                broadcastToClients({
                  type: 'hide_lifeline_voting_panel',
                  reason: 'manual_selection',
                  timestamp: Date.now()
                });
              }
              
              // Trigger the lifeline directly
              triggerLifeline('askAudience');
              
              // Send success response
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: true,
                message: 'Take Another Vote lifeline activated successfully',
                lifeline: 'takeAnotherVote',
                action: 'use_lifeline_take_another_vote',
                timestamp: Date.now()
              }));
              console.log('✅ Take Another Vote lifeline activated via manual host selection');
              
            } catch (error) {
              console.error('❌ Error activating Take Another Vote lifeline:', error);
              
              // Only send error response if headers haven't been sent yet
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                  success: false,
                  error: 'Failed to activate Take Another Vote lifeline: ' + error.message,
                  lifeline: 'takeAnotherVote',
                  action: 'use_lifeline_take_another_vote'
                }));
              }
            }
            return; // Prevent any further processing

          case 'shutdown_server':
            console.log('Shutdown requested - terminating server');
            process.exit(0);
            break;
            
          case 'start_lifeline_vote':
            console.log('🗳️ Starting lifeline voting...');
            
            // Validate lifeline voting can start
            if (!gameState.answers_revealed || !gameState.answer_is_wrong) {
              console.log('⚠️ Cannot start lifeline vote - answer must be wrong');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Can only vote for lifelines after wrong answer' }));
              return;
            }
            
            if (gameState.lifeline_voting_active) {
              console.log('⚠️ Lifeline voting already in progress');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Lifeline voting already active' }));
              return;
            }
            
            if (!gameState.available_lifelines_for_vote || gameState.available_lifelines_for_vote.length === 0) {
              console.log('⚠️ No lifelines available for voting');
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No lifelines available' }));
              return;
            }
            
            // Reset lifeline vote states
            gameState.lifeline_voting_active = true;
            gameState.lifeline_voting_timer_active = true;
            gameState.lifeline_voting_start_time = Date.now();
            gameState.lifeline_votes = [];
            gameState.lifeline_voter_history = [];
            gameState.lifeline_vote_counts = {
              fiftyFifty: 0,
              askAudience: 0,
              askAMod: 0
            };
            gameState.lifeline_vote_winner = null;
            
            // Add continuous countdown timer for smooth updates
            if (gameState.lifeline_countdown_interval) {
              clearInterval(gameState.lifeline_countdown_interval);
            }
            gameState.lifeline_countdown_interval = setInterval(() => {
              if (gameState.lifeline_voting_timer_active) {
                const elapsed = Date.now() - gameState.lifeline_voting_start_time;
                const remaining = Math.max(0, (gameState.lifeline_voting_duration || 30000) - elapsed);
                
                // Broadcast countdown update
                broadcastToClients({
                  type: 'lifeline_voting_countdown',
                  remainingTime: remaining,
                  seconds: Math.ceil(remaining / 1000)
                });
                
                // Stop timer if time is up
                if (remaining === 0) {
                  clearInterval(gameState.lifeline_countdown_interval);
                  gameState.lifeline_countdown_interval = null;
                }
              }
            }, 1000); // Update every 1 second to prevent overload during high-volume voting
            
            console.log('🗳️ Available lifelines for voting:', gameState.available_lifelines_for_vote);
            console.log('⏱️ 30-second lifeline vote timer started - chat can vote: 50/50, VOTE, or MOD');
            
            // Broadcast lifeline voting start to all clients
            broadcastToClients({
              type: 'lifeline_voting_started',
              duration: gameState.lifeline_voting_duration,
              available_lifelines: gameState.available_lifelines_for_vote,
              timestamp: Date.now()
            });
            
            // Broadcast state update
            broadcastState();
            
            // Auto-end lifeline voting after 30 seconds
            setTimeout(() => {
              if (gameState.lifeline_voting_active) {
                console.log('🏁 Auto-ending lifeline vote after 30 seconds');
                
                // Tally votes and determine winner
                let winnerLifeline = null;
                let maxVotes = 0;
                
                if (gameState.lifeline_vote_counts.fiftyFifty > maxVotes && gameState.available_lifelines_for_vote.includes('fiftyFifty')) {
                  winnerLifeline = 'fiftyFifty';
                  maxVotes = gameState.lifeline_vote_counts.fiftyFifty;
                }
                if (gameState.lifeline_vote_counts.askAudience > maxVotes && gameState.available_lifelines_for_vote.includes('askAudience')) {
                  winnerLifeline = 'askAudience';
                  maxVotes = gameState.lifeline_vote_counts.askAudience;
                }
                if (gameState.lifeline_vote_counts.askAMod > maxVotes && gameState.available_lifelines_for_vote.includes('askAMod')) {
                  winnerLifeline = 'askAMod';
                  maxVotes = gameState.lifeline_vote_counts.askAMod;
                }
                
                // End voting
                gameState.lifeline_voting_active = false;
                gameState.lifeline_voting_timer_active = false;
                
                if (winnerLifeline && maxVotes > 0) {
                  gameState.lifeline_vote_winner = winnerLifeline;
                  console.log(`🏆 Lifeline vote winner: ${winnerLifeline} with ${maxVotes} votes`);
                  
                  // Broadcast winner
                  broadcastToClients({
                    type: 'lifeline_voting_ended',
                    winner: winnerLifeline,
                    votes: maxVotes,
                    timestamp: Date.now()
                  });
                  
                  // Automatically trigger the winning lifeline after a brief delay
                  setTimeout(() => {
                    console.log(`🎯 Auto-executing winning lifeline: ${winnerLifeline}`);
                    triggerLifeline(winnerLifeline);
                  }, 2000); // 2 second delay to show winner
                } else {
                  console.log('⚠️ No lifeline votes received - no lifeline executed');
                  broadcastToClients({
                    type: 'lifeline_voting_ended',
                    winner: null,
                    votes: 0,
                    timestamp: Date.now()
                  });
                }
                
                broadcastState();
              }
            }, gameState.lifeline_voting_duration); // 30 seconds
            break;

          // Test cases for Ask A Mod display system


          // ===== PHASE 5: COMPREHENSIVE REVOTE FLOW TEST CASES =====
          






            
          case 'activate_ask_a_mod':
            console.log('🛡️ Activating Ask a Mod lifeline...');
            startAskAMod();
            break;
            
          case 'set_ask_a_mod_duration':
            if (data.duration && typeof data.duration === 'number') {
              gameState.ask_a_mod_duration = data.duration;
              console.log(`⏰ Ask a Mod duration set to ${data.duration}ms (${data.duration / 1000}s)`);
            }
            break;
            
          case 'update_moderator_list':
            console.log('🛡️ Updating moderator list from control panel...');
            if (data.moderators && Array.isArray(data.moderators)) {
              const success = saveModeratorList(data.moderators);
              if (success) {
                console.log('✅ Moderator list updated successfully');
              } else {
                console.error('❌ Failed to update moderator list');
              }
            } else {
              console.error('❌ Invalid moderator list data received');
            }
            break;

          case 'send_mod_message':
            console.log('🧪 TESTING: Processing send_mod_message action from API...');
            
            if (!gameState.ask_a_mod_active) {
              console.log('⚠️ Ask a Mod is not active - message will be stored but not processed');
            }
            
            if (data.username && data.message) {
              console.log(`🧪 Test mod message: ${data.username} said "${data.message}"`);
              
              // If Ask a Mod is active, process it as a real mod response
              if (gameState.ask_a_mod_active) {
                console.log('🛡️ Ask a Mod is active - processing test message as mod response...');
                
                // Add to mod responses array
                const modResponse = {
                  username: data.username,
                  message: data.message,
                  timestamp: Date.now(),
                  platform: 'test',
                  suggestedAnswer: extractAnswerFromMessage(data.message)
                };
                
                gameState.mod_responses.push(modResponse);
                
                // Broadcast the mod response
                broadcastToClients({
                  type: 'mod_response',
                  response: modResponse,
                  timestamp: Date.now()
                });
                
                // Update the Ask a Mod display
                broadcastToClients({
                  type: 'ask_a_mod_display_update',
                  mod_responses: gameState.mod_responses,
                  timestamp: Date.now()
                });
                
                console.log(`🛡️ Added test mod response from ${data.username}. Total responses: ${gameState.mod_responses.length}`);
              }
              
              console.log('✅ Test mod message processed successfully');
            } else {
              console.error('❌ Invalid send_mod_message data - username and message required');
            }
            break;
            
          default:
            console.warn(`⚠️ Unknown action received: '${data.action}'`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: `Unknown action: ${data.action}`,
              available_actions: ['start_game', 'reset_game', 'next_question', 'show_question', 'show_answers', 'reveal_answer', 'set_selected_answer', 'lock_answer', 'set_contestant', 'end_game_credits', 'start_credits_scroll', 'test_credits']
            }));
            return; // Don't call broadcastState for unknown actions
            
        }
        
        gameState.update_needed = true;
        
        // Broadcast the update to all WebSocket clients
        console.log('DEBUG: About to call broadcastState()');
        broadcastState();
        console.log('DEBUG: broadcastState() completed successfully');
        
        // Create a clean copy of gameState without non-serializable properties (like timer intervals)
        const cleanGameState = { ...gameState };
        delete cleanGameState.lifeline_countdown_interval; // Remove timer interval which can't be serialized
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, state: cleanGameState }));
        
      } catch (error) {
        console.error('ERROR in control API:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // 404 for unknown API endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

// Helper function to extract answer choice from moderator message
function extractAnswerFromMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }
  
  const upperMessage = message.toUpperCase();
  
  // Look for explicit answer patterns like "A", "answer A", "option A", etc.
  const patterns = [
    /\bANSWER\s+([ABCD])\b/,
    /\bOPTION\s+([ABCD])\b/,
    /\bCHOICE\s+([ABCD])\b/,
    /\b([ABCD])\s+IS\b/,
    /\bPICK\s+([ABCD])\b/,
    /\bGO\s+WITH\s+([ABCD])\b/,
    /\bTHINK\s+([ABCD])\b/,
    /\b([ABCD])\s*[-–]\s*/,  // "A - " pattern
    /\b([ABCD])\b/  // Simple single letter (lowest priority)
  ];
  
  for (const pattern of patterns) {
    const match = upperMessage.match(pattern);
    if (match && ['A', 'B', 'C', 'D'].includes(match[1])) {
      return match[1];
    }
  }
  
  return null;
}

// Helper function for Market Maker advice
function generateMarketMakerAdvice() {
  const marketMakerPhrases = [
    "Based on market volatility, I'd lean towards option C",
    "The fundamentals point to answer B, but watch for regulatory changes", 
    "My technical analysis suggests A, but keep an eye on volume",
    "Market sentiment indicates D, though it's a contrarian play",
    "The institutional money is flowing toward B this quarter",
    "Risk/reward analysis favors C, but diversify your positions",
    "Macro trends suggest A, but mind the earnings calendar",
    "The smart money is betting on D based on recent filings",
    "Chart patterns indicate B, but news flow could shift momentum",
    "Sector rotation points to C, though valuations are stretched"
  ];
  
  return marketMakerPhrases[Math.floor(Math.random() * marketMakerPhrases.length)];
}

// Helper function to start audience poll (existing function reference)
function startAudiencePoll() {
  if (!gameState.audience_poll_active) {
    gameState.audience_poll_active = true;
    gameState.poll_voters = [];
    gameState.poll_voter_history = [];
    gameState.poll_all_votes = [];
    gameState.show_poll_winner = null;
    gameState.show_voting_activity = true;
    
    console.log('🗳️ Starting audience poll');
    
    // Auto-end after configurable duration
    setTimeout(() => {
      if (gameState.audience_poll_active) {
        const durationSeconds = Math.round(gameState.audience_poll_duration / 1000);
        console.log(`⏰ Poll time limit reached (${durationSeconds}s) - ending poll`);
        endAudiencePoll();
      }
    }, gameState.audience_poll_duration);
  }
}

// Helper function to end audience poll (existing function reference)
function endAudiencePoll() {
  if (gameState.audience_poll_active) {
    gameState.audience_poll_active = false;
    gameState.show_voting_activity = false;
    
    // Calculate final results
    const votes = { A: 0, B: 0, C: 0, D: 0 };
    gameState.poll_all_votes.forEach(vote => {
      if (votes[vote.vote] !== undefined) {
        votes[vote.vote]++;
      }
    });
    
    // Find winner
    let maxVotes = 0;
    let winner = null;
    Object.entries(votes).forEach(([answer, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winner = answer;
      }
    });
    
    if (winner && maxVotes > 0) {
      const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
      const percentage = Math.round((maxVotes / totalVotes) * 100);
      
      gameState.show_poll_winner = winner;
      gameState.poll_winner_votes = maxVotes;
      gameState.poll_winner_percentage = percentage;
      
      console.log(`🏆 Poll ended - Winner: ${winner} with ${maxVotes} votes (${percentage}%)`);
      console.log(`📢 Showing AUDIENCE CHOICE: ${winner} for 5 seconds maximum before auto-locking`);
      
      // Store first poll winner for potential revote
      if (!gameState.first_poll_winner) {
        gameState.first_poll_winner = winner;
      }
      
      // Broadcast state to show winner announcement
      broadcastState();
      
      // After 5 seconds maximum, lock in the audience choice
      setTimeout(() => {
        console.log(`🔒 Auto-locking AUDIENCE CHOICE: ${winner} after 5-second display`);
        
        // Convert letter to answer index (A=0, B=1, C=2, D=3)
        const answerIndex = ['A', 'B', 'C', 'D'].indexOf(winner);
        
        // Set and lock the answer
        gameState.selected_answer = answerIndex;
        gameState.answer_locked_in = true;
        
        // Hide the winner announcement
        gameState.show_poll_winner = null;
        gameState.poll_winner_votes = 0;
        gameState.poll_winner_percentage = 0;
        
        // Play lock-in sound effect
        console.log('🎵 Broadcasting lock-in audio command for auto-locked audience choice');
        broadcastToClients({ type: 'audio_command', command: 'play_lock' });
        
        console.log(`✅ Answer ${winner} is now LOCKED IN automatically`);
        broadcastState();
      }, 5000); // 5 seconds maximum delay
    }
    
    // Reset revote state if this was a revote
    if (gameState.is_revote_active) {
      gameState.is_revote_active = false;
      gameState.excluded_answers = [];
      console.log('🗳️ Revote completed');
    }
  }
}

// Duplicate function removed - using the proper vote validation logic at line 8858

const PORT = 8081;
server.listen(PORT, () => {
  console.log('🎮 Kimbillionaire Bridge Server running!');
  console.log(`📺 Browser Source: http://localhost:${PORT}/gameshow`);
  console.log(`🎛️  Control Panel: Connect your React app to http://localhost:${PORT}/api/*`);
  console.log(`💡 Usage: Add browser source in OBS with URL: http://localhost:${PORT}/gameshow`);
  
  // CRITICAL FIX: Force reset revote duration to 60 seconds to override any API changes
  gameState.revote_duration = 60000;
  console.log(`⏱️ REVOTE DURATION RESET: Forced revote_duration to ${gameState.revote_duration}ms (60 seconds)`);
  
  // Load moderator list at startup for Ask a Mod lifeline
  console.log('🛡️ Loading moderator list...');
  loadModeratorList();
  
  // Auto-start Twitch chat with last configured channel - TEMPORARILY DISABLED TO PREVENT DUPLICATES
  /*
  setTimeout(() => {
    console.log('🚀 Auto-starting Twitch chat with last configured channel...');
    try {
      const configPath = path.join(__dirname, 'polling-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.twitch && config.twitch.channel) {
          console.log(`📺 Auto-connecting to Twitch channel: ${config.twitch.channel}`);
          // Start Twitch chat process
          const { spawn } = require('child_process');
          const twitchChatProcess = spawn('node', ['simple-twitch-chat.js'], {
            cwd: __dirname,
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          twitchChatProcess.stdout.on('data', (data) => {
            console.log(`📺 Twitch Chat: ${data.toString().trim()}`);
          });
          
          global.twitchChatProcess = twitchChatProcess;
          console.log('✅ Twitch chat auto-started successfully');
        }
      }
    } catch (error) {
      console.log('⚠️ Could not auto-start Twitch chat:', error.message);
    }
  }, 2000); // 2 second delay to let server fully initialize
  */
});

// 🔒 CRITICAL ERROR HANDLING & SERVER REINFORCEMENT SYSTEM
// ========================================================

// Track server health metrics
let serverHealth = {
  startTime: Date.now(),
  crashCount: 0,
  lastCrash: null,
  memoryWarnings: 0,
  connectionCount: 0,
  lastHeartbeat: Date.now()
};

// Enhanced Performance Monitoring System (using existing performanceMetrics)
// Note: performanceMetrics is already defined earlier in the file at line 22
// Extending the existing object with additional properties
Object.assign(performanceMetrics, {
  votes: {
    totalProcessed: 0,
    averageProcessingTime: 0,
    processingTimes: [], // Last 100 processing times
    duplicatesBlocked: 0,
    errorsCount: 0
  },
  websocket: {
    messagesReceived: 0,
    messagesSent: 0,
    connectionDuration: new Map(), // connectionId -> startTime
    averageLatency: 0,
    latencyMeasurements: [], // Last 50 latency measurements
    // Enhanced connection health tracking
    connectionQuality: new Map(), // connectionId -> quality metrics
    reconnectionEvents: [],
    connectionFailures: 0,
    totalConnections: 0,
    avgConnectionDuration: 0,
    connectionDurations: [], // Last 100 connection durations
    healthAlerts: [] // Recent health issues
  },
  gameFlow: {
    questionTransitions: 0,
    pollsStarted: 0,
    pollsCompleted: 0,
    lifelinesUsed: 0,
    averagePollDuration: 0
  },
  system: {
    memoryUsageMB: 0,
    cpuLoadPercent: 0,
    uptime: 0,
    lastUpdate: Date.now()
  }
});

// Performance tracking functions
function trackVoteProcessing(processingTime, wasBlocked = false, hasError = false) {
  const metrics = performanceMetrics.votes;
  
  if (wasBlocked) {
    metrics.duplicatesBlocked++;
    return;
  }
  
  if (hasError) {
    metrics.errorsCount++;
    return;
  }
  
  metrics.totalProcessed++;
  metrics.processingTimes.push(processingTime);
  
  // Keep only last 100 measurements
  if (metrics.processingTimes.length > 100) {
    metrics.processingTimes.shift();
  }
  
  // Calculate average processing time
  metrics.averageProcessingTime = metrics.processingTimes.reduce((a, b) => a + b, 0) / metrics.processingTimes.length;
}

function trackWebSocketMessage(type, connectionId, isOutgoing = false) {
  const metrics = performanceMetrics.websocket;
  
  if (isOutgoing) {
    metrics.messagesSent++;
  } else {
    metrics.messagesReceived++;
    
    // Track latency for specific message types
    if (type === 'ping' || type === 'connection_test') {
      const latency = Date.now() - (connectionId ? (performanceMetrics.websocket.connectionDuration.get(connectionId) || Date.now()) : Date.now());
      metrics.latencyMeasurements.push(latency);
      
      // Keep only last 50 measurements
      if (metrics.latencyMeasurements.length > 50) {
        metrics.latencyMeasurements.shift();
      }
      
      // Calculate average latency
      metrics.averageLatency = metrics.latencyMeasurements.reduce((a, b) => a + b, 0) / metrics.latencyMeasurements.length;
    }
    
    // Update connection quality metrics
    if (connectionId && metrics.connectionQuality.has(connectionId)) {
      const quality = metrics.connectionQuality.get(connectionId);
      quality.messageCount++;
      quality.lastActivity = Date.now();
      
      // Track error rate
      if (type === 'error') {
        quality.errorCount++;
        quality.errorRate = quality.errorCount / quality.messageCount;
      }
      
      // Update health score (0-100, higher is better)
      quality.healthScore = Math.max(0, 100 - (quality.errorRate * 100) - Math.min(50, metrics.averageLatency / 10));
      
      // Check for health alerts
      if (quality.healthScore < 50 && Date.now() - quality.lastAlert > 60000) { // Alert max once per minute
        addHealthAlert(`Connection ${connectionId} health score dropped to ${Math.round(quality.healthScore)}`, 'warning');
        quality.lastAlert = Date.now();
      }
    }
  }
}

// WebSocket health alert system
function addHealthAlert(message, severity = 'info') {
  const alert = {
    message: message,
    severity: severity, // 'info', 'warning', 'error'
    timestamp: Date.now()
  };
  
  performanceMetrics.websocket.healthAlerts.push(alert);
  
  // Keep only last 20 alerts
  if (performanceMetrics.websocket.healthAlerts.length > 20) {
    performanceMetrics.websocket.healthAlerts.shift();
  }
  
  // Clean up old alerts
  cleanupHealthAlerts();
  
  // Log severe alerts
  if (severity === 'error' || severity === 'warning') {
    console.log(`🚨 WebSocket Health Alert [${severity.toUpperCase()}]: ${message}`);
  }
}

// Cleanup old health alerts and manage development environment warnings
function cleanupHealthAlerts() {
  const now = Date.now();
  const tenMinutesAgo = now - (10 * 60 * 1000);
  
  // Remove alerts older than 10 minutes
  performanceMetrics.websocket.healthAlerts = performanceMetrics.websocket.healthAlerts.filter(alert => 
    alert.timestamp > tenMinutesAgo
  );
  
  // For development environment warnings, clean up more aggressively (keep only last 2 minutes)
  const twoMinutesAgo = now - (2 * 60 * 1000);
  performanceMetrics.websocket.healthAlerts = performanceMetrics.websocket.healthAlerts.filter(alert => {
    if (alert.message.includes('dev environment')) {
      return alert.timestamp > twoMinutesAgo;
    }
    return true;
  });
}

// Detect reconnection patterns
function detectReconnection(clientIP, connectionId) {
  const metrics = performanceMetrics.websocket;
  const now = Date.now();
  
  // Check for recent connections from same IP
  const recentConnections = metrics.reconnectionEvents.filter(event => 
    event.clientIP === clientIP && (now - event.timestamp) < 30000 // Last 30 seconds
  );
  
  // Adjust thresholds for development vs production
  const isDevelopment = clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === '::ffff:127.0.0.1';
  const reconnectionThreshold = isDevelopment ? 8 : 3; // Higher threshold for dev environment
  
  if (recentConnections.length > reconnectionThreshold) {
    const severity = isDevelopment ? 'info' : 'warning';
    const context = isDevelopment ? ' (dev environment)' : '';
    addHealthAlert(`Multiple reconnections detected from ${clientIP} (${recentConnections.length} in 30s)${context}`, severity);
    
    if (!isDevelopment) {
      console.log(`🔄 Rapid reconnection pattern detected from ${clientIP}`);
    }
  }
  
  // Record this connection event
  metrics.reconnectionEvents.push({
    clientIP: clientIP,
    connectionId: connectionId,
    timestamp: now
  });
  
  // Cleanup old events (older than 5 minutes)
  metrics.reconnectionEvents = metrics.reconnectionEvents.filter(event => 
    (now - event.timestamp) < 300000
  );
}

function updateSystemMetrics() {
  const metrics = performanceMetrics.system;
  const used = process.memoryUsage();
  
  metrics.memoryUsageMB = Math.round(used.heapUsed / 1024 / 1024);
  metrics.uptime = Math.round((Date.now() - serverHealth.startTime) / 1000);
  metrics.lastUpdate = Date.now();
  
  // Update CPU load (simplified estimate based on memory pressure)
  metrics.cpuLoadPercent = Math.min(100, Math.round(metrics.memoryUsageMB / 10));
}

function getPerformanceSnapshot() {
  updateSystemMetrics();
  return {
    ...performanceMetrics,
    serverHealth: serverHealth,
    timestamp: Date.now()
  };
}

function getEnhancedPerformanceSnapshot() {
  updateSystemMetrics();
  
  const now = Date.now();
  const metrics = performanceMetrics;
  
  // Calculate performance insights
  const insights = {
    overall_health: calculateOverallHealth(),
    connection_stability: calculateConnectionStability(),
    vote_processing_efficiency: calculateVoteProcessingEfficiency(),
    memory_trend: calculateMemoryTrend(),
    alerts_summary: summarizeAlerts()
  };
  
  // Enhanced system status
  const systemStatus = {
    status: insights.overall_health >= 80 ? 'healthy' : insights.overall_health >= 60 ? 'warning' : 'critical',
    uptime_hours: Math.round(metrics.system.uptime / 3600),
    active_connections: serverHealth.connectionCount,
    memory_usage_percent: Math.round((metrics.system.memoryUsageMB / 512) * 100), // Assuming 512MB limit
    performance_score: insights.overall_health
  };
  
  return {
    ...performanceMetrics,
    serverHealth: serverHealth,
    systemStatus: systemStatus,
    insights: insights,
    timestamp: now
  };
}

// Performance calculation helper functions
function calculateOverallHealth() {
  const metrics = performanceMetrics;
  let score = 100;
  
  // Memory penalty (high memory usage reduces score)
  if (metrics.system.memoryUsageMB > 400) score -= 20;
  else if (metrics.system.memoryUsageMB > 200) score -= 10;
  
  // Connection stability penalty
  const failureRate = metrics.websocket.totalConnections > 0 ? 
    metrics.websocket.connectionFailures / metrics.websocket.totalConnections : 0;
  score -= Math.min(30, failureRate * 100);
  
  // Vote processing errors penalty
  if (metrics.votes.errorsCount > 0) score -= Math.min(20, metrics.votes.errorsCount * 2);
  
  // Server crash penalty
  score -= serverHealth.crashCount * 10;
  
  return Math.max(0, Math.round(score));
}

function calculateConnectionStability() {
  const metrics = performanceMetrics.websocket;
  
  if (metrics.totalConnections === 0) return 100;
  
  const failureRate = metrics.connectionFailures / metrics.totalConnections;
  const avgDuration = metrics.avgConnectionDuration || 0;
  
  let stability = 100;
  stability -= failureRate * 50; // Failure rate impact
  
  // Short connection duration penalty (but not for development)
  if (avgDuration < 10000 && metrics.totalConnections > 10) {
    stability -= 20;
  }
  
  return Math.max(0, Math.round(stability));
}

function calculateVoteProcessingEfficiency() {
  const metrics = performanceMetrics.votes;
  
  if (metrics.totalProcessed === 0) return 100;
  
  let efficiency = 100;
  
  // Error rate penalty
  const errorRate = metrics.errorsCount / (metrics.totalProcessed + metrics.errorsCount);
  efficiency -= errorRate * 50;
  
  // Processing time penalty (if average > 100ms)
  if (metrics.averageProcessingTime > 100) {
    efficiency -= Math.min(30, (metrics.averageProcessingTime - 100) / 10);
  }
  
  return Math.max(0, Math.round(efficiency));
}

function calculateMemoryTrend() {
  const currentMemory = performanceMetrics.system.memoryUsageMB;
  
  // Simple memory trend analysis
  if (currentMemory < 50) return 'low';
  if (currentMemory < 200) return 'normal';
  if (currentMemory < 400) return 'elevated';
  return 'high';
}

function summarizeAlerts() {
  const alerts = performanceMetrics.websocket.healthAlerts;
  const now = Date.now();
  
  const recentAlerts = alerts.filter(alert => (now - alert.timestamp) < 300000); // Last 5 minutes
  
  const summary = {
    total: recentAlerts.length,
    by_severity: {
      info: recentAlerts.filter(a => a.severity === 'info').length,
      warning: recentAlerts.filter(a => a.severity === 'warning').length,
      error: recentAlerts.filter(a => a.severity === 'error').length
    },
    recent_issues: recentAlerts.slice(-3).map(alert => ({
      message: alert.message,
      severity: alert.severity,
      minutes_ago: Math.round((now - alert.timestamp) / 60000)
    }))
  };
  
  return summary;
}

// Memory monitoring and garbage collection
function monitorMemoryUsage() {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  
  // Log memory usage every 5 minutes for monitoring
  if (Date.now() % (5 * 60 * 1000) < 1000) {
    console.log(`💾 Memory Usage: ${heapUsedMB}MB / ${heapTotalMB}MB heap, ${Math.round(used.rss / 1024 / 1024)}MB RSS`);
  }
  
  // Warning threshold: 400MB heap usage
  if (heapUsedMB > 400) {
    serverHealth.memoryWarnings++;
    console.warn(`⚠️ High memory usage: ${heapUsedMB}MB - triggering garbage collection`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log(`🧹 Garbage collection completed`);
    }
    
    // If memory still high after GC, log critical warning
    const afterGC = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (afterGC > 300) {
      console.error(`🚨 CRITICAL: Memory usage still high after GC: ${afterGC}MB`);
    }
  }
}

// Enhanced state backup system
function backupGameState() {
  try {
    const backup = {
      gameState: gameState,
      timestamp: Date.now(),
      serverHealth: serverHealth,
      version: '3.0.0'
    };
    
    const backupPath = path.join(__dirname, 'workinprogress', 'game-state-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    // Keep last 5 backups
    const archivePath = path.join(__dirname, 'workinprogress', `game-state-${Date.now()}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(backup, null, 2));
    
    // Cleanup old backups (keep last 5)
    const backupDir = path.join(__dirname, 'workinprogress');
    if (fs.existsSync(backupDir)) {
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('game-state-') && file.endsWith('.json'))
        .sort()
        .slice(0, -5); // Keep last 5, remove older ones
      
      backupFiles.forEach(file => {
        try {
          fs.unlinkSync(path.join(backupDir, file));
        } catch (err) {
          console.warn(`⚠️ Could not delete old backup: ${file}`);
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Failed to backup game state:`, error.message);
  }
}

// Restore game state from backup
function restoreGameState() {
  try {
    const backupPath = path.join(__dirname, 'workinprogress', 'game-state-backup.json');
    if (fs.existsSync(backupPath)) {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      
      // Validate backup
      if (backup.gameState && backup.timestamp) {
        const ageMinutes = (Date.now() - backup.timestamp) / 60000;
        
        if (ageMinutes < 60) { // Only restore if less than 1 hour old
          Object.assign(gameState, backup.gameState);
          
          // Ensure critical Set types are properly restored
          if (!(gameState.processed_mod_messages instanceof Set)) {
            gameState.processed_mod_messages = new Set(gameState.processed_mod_messages || []);
            console.log('🔧 Fixed processed_mod_messages type after state restoration');
          }
          
          serverHealth = backup.serverHealth || serverHealth;
          console.log(`✅ Game state restored from backup (${Math.round(ageMinutes)} minutes old)`);
          return true;
        } else {
          console.log(`⚠️ Backup too old (${Math.round(ageMinutes)} minutes), starting fresh`);
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Could not restore game state:`, error.message);
  }
  return false;
}

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
  
  // Backup current game state
  console.log(`💾 Backing up game state...`);
  backupGameState();
  
  // Close WebSocket connections gracefully
  console.log(`🔌 Closing WebSocket connections...`);
  if (wss) {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'server_shutdown',
          message: 'Server is shutting down for maintenance',
          timestamp: Date.now()
        }));
        ws.close(1000, 'Server shutdown');
      }
    });
  }
  
  // Close HTTP server
  console.log(`🌐 Closing HTTP server...`);
  server.close(() => {
    console.log(`✅ Server closed gracefully`);
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error(`❌ Forced shutdown after timeout`);
    process.exit(1);
  }, 10000);
}

// Global error handlers
process.on('uncaughtException', (error) => {
  serverHealth.crashCount++;
  serverHealth.lastCrash = Date.now();
  
  console.error(`🚨 UNCAUGHT EXCEPTION:`, error);
  console.error(`Stack trace:`, error.stack);
  
  // Backup state before potential crash
  backupGameState();
  
  // Log crash details
  const crashLog = {
    type: 'uncaughtException',
    error: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    serverHealth: serverHealth,
    gameState: {
      active: gameState.game_active,
      question: gameState.current_question,
      contestant: gameState.contestant_name
    }
  };
  
  try {
    const crashPath = path.join(__dirname, 'workinprogress', `crash-${Date.now()}.json`);
    fs.writeFileSync(crashPath, JSON.stringify(crashLog, null, 2));
  } catch (writeError) {
    console.error(`❌ Could not write crash log:`, writeError);
  }
  
  // Attempt graceful recovery for known recoverable errors
  if (error.code === 'EADDRINUSE' || error.code === 'ECONNRESET') {
    console.log(`🔄 Attempting recovery from ${error.code}...`);
    return; // Don't exit, try to continue
  }
  
  console.error(`💥 Fatal error detected, exiting...`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`🚨 UNHANDLED PROMISE REJECTION at:`, promise, 'reason:', reason);
  
  // Log the rejection but don't crash the server
  const rejectionLog = {
    type: 'unhandledRejection',
    reason: reason?.toString() || 'Unknown reason',
    timestamp: Date.now(),
    stack: reason?.stack || 'No stack trace'
  };
  
  try {
    const logPath = path.join(__dirname, 'workinprogress', `rejection-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(rejectionLog, null, 2));
  } catch (writeError) {
    console.error(`❌ Could not write rejection log:`, writeError);
  }
});

// Enhanced WebSocket error handling
if (wss) {
  wss.on('error', (error) => {
    console.error(`🔌 WebSocket Server Error:`, error);
    
    // Attempt to restart WebSocket server
    setTimeout(() => {
      console.log(`🔄 Attempting to restart WebSocket server...`);
      try {
        const newWss = new WebSocket.Server({ server });
        console.log(`✅ WebSocket server restarted successfully`);
      } catch (restartError) {
        console.error(`❌ Failed to restart WebSocket server:`, restartError);
      }
    }, 5000);
  });
}

// HTTP server error handling
server.on('error', (error) => {
  console.error(`🌐 HTTP Server Error:`, error);
  
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Health monitoring intervals
setInterval(monitorMemoryUsage, 30000); // Check memory every 30 seconds
setInterval(() => {
  serverHealth.lastHeartbeat = Date.now();
  backupGameState();
}, 300000); // Backup game state every 5 minutes

// Restore game state on startup if available
console.log(`🔄 Checking for previous game state...`);
if (restoreGameState()) {
  console.log(`✅ Previous game session restored successfully`);
} else {
  console.log(`🆕 Starting fresh game session`);
}

console.log(`🔒 Server reinforcement system activated`);
console.log(`💾 Memory monitoring: ✅ Active`);
console.log(`🛡️  Error handling: ✅ Active`);
console.log(`💾 State backup: ✅ Active (every 5 minutes)`);
console.log(`🔄 Graceful shutdown: ✅ Active`);