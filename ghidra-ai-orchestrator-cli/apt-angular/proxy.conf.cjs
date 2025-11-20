const target = process.env.APT_UI_BACKEND_URL ?? 'http://localhost:4000';

/**
 * Proxy configuration used by `ng serve` so the Angular-only dev server can
 * tunnel API/SSE traffic to the running apt-ui backend.
 */
module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 300000,
    logLevel: 'info',
    headers: {
      Connection: 'keep-alive'
    }
  }
};
