const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // No proxy needed - control panel connects directly to localhost:8081
};