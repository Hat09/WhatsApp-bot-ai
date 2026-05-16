// utils/logger.js - Logger sederhana
import config from '../config.js'

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function timestamp() {
  return new Date().toLocaleString('id-ID', { hour12: false })
}

export const logger = {
  info: (msg, ...args) =>
    console.log(`${colors.green}[INFO]${colors.reset} ${colors.gray}${timestamp()}${colors.reset} ${msg}`, ...args),
  warn: (msg, ...args) =>
    console.log(`${colors.yellow}[WARN]${colors.reset} ${colors.gray}${timestamp()}${colors.reset} ${msg}`, ...args),
  error: (msg, ...args) =>
    console.log(`${colors.red}[ERROR]${colors.reset} ${colors.gray}${timestamp()}${colors.reset} ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (config.debug)
      console.log(`${colors.cyan}[DEBUG]${colors.reset} ${colors.gray}${timestamp()}${colors.reset} ${msg}`, ...args)
  },
  account: (phone, msg, ...args) =>
    console.log(`${colors.cyan}[WA:${phone}]${colors.reset} ${colors.gray}${timestamp()}${colors.reset} ${msg}`, ...args),
}

export default logger
