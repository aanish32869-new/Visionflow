const fs = require('fs');
const path = require('path');

// Single centralized log file path
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(REPO_ROOT, 'logs', 'visionflow.log');

const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4
};

function formatMessage(level, service, module, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `${timestamp} | ${level.padEnd(8)} | ${service.padEnd(8)} | ${module.padEnd(15)} | ${message}\n`;
}

class Logger {
  constructor(service, module) {
    this.service = service;
    this.module = module;
  }

  log(level, message, metadata = null) {
    let msg = message;
    if (metadata) {
      if (metadata instanceof Error) {
        msg += `\nStack Trace:\n${metadata.stack}`;
      } else {
        msg += ` | Metadata: ${JSON.stringify(metadata)}`;
      }
    }

    const formatted = formatMessage(level, this.service, this.module, msg);
    
    // Write to console for visibility in standard output
    if (level === 'ERROR' || level === 'CRITICAL') {
      console.error(formatted.trim());
    } else {
      console.log(formatted.trim());
    }

    // Append to the centralized log file
    try {
      fs.appendFileSync(LOG_FILE, formatted);
    } catch (err) {
      console.error(`[LOGGER_FAIL] Could not write to ${LOG_FILE}: ${err.message}`);
    }
  }

  debug(msg, meta) { this.log('DEBUG', msg, meta); }
  info(msg, meta) { this.log('INFO', msg, meta); }
  warn(msg, meta) { this.log('WARNING', msg, meta); }
  error(msg, meta) { this.log('ERROR', msg, meta); }
  critical(msg, meta) { this.log('CRITICAL', msg, meta); }
}

module.exports = (service, module) => new Logger(service, module);
