// index.js - Entry point utama
import 'dotenv/config'
import { mkdirSync } from 'fs'
import config from './config.js'
import logger from './utils/logger.js'
import WAManager from './whatsapp/manager.js'
import TelegramBotHandler from './telegram/bot.js'

// ─── VALIDASI CONFIG ────────────────────────────────────────────────────────
function validateConfig() {
  const errors = []
  if (!config.telegram.token) errors.push('❌ TELEGRAM_BOT_TOKEN belum diset di .env')
  if (!config.telegram.adminIds.length) errors.push('❌ TELEGRAM_ADMIN_IDS belum diset di .env')

  if (errors.length) {
    console.error('\n' + errors.join('\n'))
    console.error('\n📝 Salin .env.example ke .env dan isi konfigurasinya!\n')
    process.exit(1)
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔════════════════════════════════════════╗
║   WA Multi-Account Telegram Manager   ║
║   Powered by @crysnovax/baileys       ║
║   Max Akun: ${String(config.whatsapp.maxAccounts).padEnd(3)} | Prefix: ${config.whatsapp.pairingPrefix} ║
╚════════════════════════════════════════╝
  `)

  validateConfig()

  // Buat folder yang dibutuhkan
  mkdirSync('./sessions', { recursive: true })
  mkdirSync('./auth', { recursive: true })

  logger.info(`🔧 Pairing prefix: ${config.whatsapp.pairingPrefix}`)
  logger.info(`📱 Max akun: ${config.whatsapp.maxAccounts}`)
  logger.info(`👤 Admin IDs: ${config.telegram.adminIds.join(', ')}`)

  // Inisialisasi Telegram bot (dulu)
  let telegramHandler = null

  // Inisialisasi WA Manager dengan callback event ke Telegram
  const manager = new WAManager((type, data) => {
    if (telegramHandler) {
      telegramHandler.handleWAEvent(type, data)
    }
  })

  // Start Telegram bot
  telegramHandler = new TelegramBotHandler(manager)

  logger.info('✅ Sistem siap! Semua perintah tersedia via Telegram.')
  logger.info(`💡 Kirim /help ke bot Telegram untuk memulai.`)

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.warn(`\n⚠️ Menerima ${signal}, menutup koneksi...`)
    const accounts = manager.listAccounts()
    for (const acc of accounts) {
      await manager.removeAccount(acc.phone, false) // disconnect tanpa hapus session
    }
    logger.info('👋 Shutdown selesai.')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err.message)
    logger.debug(err.stack)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason?.message || reason)
  })
}

main()
