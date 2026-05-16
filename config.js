// config.js - Konfigurasi global sistem
import 'dotenv/config'
import { resolve } from 'path'

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminIds: (process.env.TELEGRAM_ADMIN_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .map(Number),
  },

  whatsapp: {
    maxAccounts: Math.min(parseInt(process.env.MAX_ACCOUNTS || '50'), 50),
    pairingPrefix: (process.env.PAIRING_PREFIX || 'SENDERZA').toUpperCase().slice(0, 8).padEnd(8, 'X'),
    sessionDir: resolve('./sessions'),
    // Identitas MacOS Chrome
    browser: ['Mac OS', 'Chrome', '120.0.0.0'],
  },

  debug: process.env.DEBUG === 'true',
}

export default config
