// Configuration for API and WebSocket connections
// Default to localhost, can be overridden with environment variables
// For WSL: set REACT_APP_API_HOST to your WSL IP address

const API_HOST = process.env.REACT_APP_API_HOST || 'localhost';
const API_PORT = process.env.REACT_APP_API_PORT || '8081';

// If we're in a browser context and not on localhost, use the current hostname
// This helps when accessing from different machines or network configurations
const getApiHost = () => {
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // Use the same hostname as the control panel but with the bridge server port
    console.log(`🌐 Using browser hostname for API: ${window.location.hostname}`);
    return window.location.hostname;
  }
  return API_HOST;
};

const actualApiHost = getApiHost();

export const API_BASE_URL = `http://${actualApiHost}:${API_PORT}`;
export const WS_BASE_URL = `ws://${actualApiHost}:${API_PORT}`;