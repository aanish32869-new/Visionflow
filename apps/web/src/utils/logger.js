/**
 * VisionFlow Frontend Logger
 * Prefixes logs for easy filtering and provides consistent level handling.
 */

const PREFIX = '[VisionFlow-FE]';

const logger = {
  debug: (msg, ...args) => {
    console.debug(`${PREFIX} [DEBUG] ${msg}`, ...args);
  },
  info: (msg, ...args) => {
    console.info(`${PREFIX} [INFO] ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`${PREFIX} [WARN] ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`${PREFIX} [ERROR] ${msg}`, ...args);
    // Optional: Send to backend for centralized logging
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'ERROR',
        service: 'FRONTEND',
        module: 'WEB_APP',
        message: msg,
        stack: args[0]?.stack || null
      })
    }).catch(err => console.debug('Failed to sync FE log to BE', err));
  },
  critical: (msg, ...args) => {
    console.error(`${PREFIX} [CRITICAL] ${msg}`, ...args);
    // Explicit sync for critical errors
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'CRITICAL',
        service: 'FRONTEND',
        module: 'WEB_APP',
        message: msg
      })
    }).catch(() => {});
  }
};

export default logger;
