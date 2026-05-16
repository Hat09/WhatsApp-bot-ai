// telegram/bot.js - Setup Telegram bot & jembatan event dari WA
import TelegramBot from 'node-telegram-bot-api'
import config from '../config.js'
import logger from '../utils/logger.js'
import { registerCommands, isAdmin, statusEmoji } from './commands.js'

export class TelegramBotHandler {
  constructor(manager) {
    this.manager = manager
    this.bot = new TelegramBot(config.telegram.token, { polling: true })
    this._setup()
  }

  _setup() {
    // Register semua command
    registerCommands(this.bot, this.manager)

    // Error handling polling
    this.bot.on('polling_error', (err) => {
      logger.error('Polling Telegram error:', err.message)
    })

    this.bot.on('error', (err) => {
      logger.error('Telegram error:', err.message)
    })

    logger.info('🤖 Telegram bot aktif')

    // Broadcast ke admin: bot online
    this._notifyAdmins('🚀 *WA Multi-Account Manager* aktif!\n\nKetik /help untuk melihat daftar command.')
  }

  // ─── TERIMA EVENT DARI WA MANAGER ──────────────────────────────────────
  handleWAEvent(type, data) {
    switch (type) {

      case 'pairing_code': {
        // ✅ Kirim pairing code ke semua admin via Telegram
        const msg =
          `🔑 *Pairing Code WA*\n\n` +
          `📱 Nomor: \`${data.phone}\`\n` +
          `🔐 Kode: \`${data.code}\`\n\n` +
          `*Cara pakai:*\n` +
          `1\\. Buka WhatsApp di HP nomor tersebut\n` +
          `2\\. Buka *Pengaturan* → *Perangkat Tertaut*\n` +
          `3\\. Pilih *Tautkan Perangkat*\n` +
          `4\\. Ketuk *Tautkan dengan nomor telepon*\n` +
          `5\\. Masukkan kode: \`${data.code}\`\n\n` +
          `⏱ Kode berlaku \\~60 detik`
        this._notifyAdmins(msg, { parse_mode: 'MarkdownV2' })
        break
      }

      case 'pairing_error': {
        this._notifyAdmins(
          `⚠️ *Pairing Error*\n\nNomor: \`${data.phone}\`\nError: ${data.message}`,
          { parse_mode: 'Markdown' }
        )
        break
      }

      case 'connected': {
        this._notifyAdmins(
          `✅ *Akun Terhubung!*\n\n📱 Nomor: \`${data.phone}\`\n\nAkun siap digunakan.`,
          { parse_mode: 'Markdown' }
        )
        break
      }

      case 'disconnected': {
        if (!data.loggedOut) {
          this._notifyAdmins(
            `🔴 *Akun Terputus*\n\n📱 Nomor: \`${data.phone}\`\nKode: ${data.code}\n\n🔄 Mencoba reconnect otomatis...`,
            { parse_mode: 'Markdown' }
          )
        }
        break
      }

      case 'logged_out': {
        this._notifyAdmins(
          `🚪 *Akun Logout*\n\n📱 Nomor: \`${data.phone}\`\n\nAkun telah logout dari WA. Tambahkan ulang dengan /addaccount jika diperlukan.`,
          { parse_mode: 'Markdown' }
        )
        break
      }

      case 'error': {
        this._notifyAdmins(
          `❌ *Error Akun*\n\n📱 Nomor: \`${data.phone}\`\nError: ${data.message}`,
          { parse_mode: 'Markdown' }
        )
        break
      }
    }
  }

  // ─── KIRIM NOTIFIKASI KE SEMUA ADMIN ─────────────────────────────────
  _notifyAdmins(text, opts = { parse_mode: 'Markdown' }) {
    for (const adminId of config.telegram.adminIds) {
      this.bot.sendMessage(adminId, text, opts).catch(err => {
        logger.warn(`Gagal kirim notif ke admin ${adminId}:`, err.message)
      })
    }
  }
}

export default TelegramBotHandler
