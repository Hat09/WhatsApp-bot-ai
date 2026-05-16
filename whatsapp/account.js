// whatsapp/account.js - Handler satu akun WhatsApp (dengan dukungan blash)

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@crysnovax/baileys'
import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import pino from 'pino'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import config from '../config.js'
import logger from '../utils/logger.js'

export class WAAccount {
  constructor(phone, onEvent) {
    this.phone = phone
    this.jid = phone + '@s.whatsapp.net'
    this.sock = null
    this.status = 'disconnected' // disconnected | connecting | pairing | connected
    this.pairingCode = null
    this.retryCount = 0
    this.maxRetries = 5
    this.autoReadGroups = true   // Auto-read semua grup aktif by default
    this.aiBadge = true          // AI badge aktif by default
    this.groupCache = new NodeCache({ stdTTL: 300, useClones: false })
    this.onEvent = onEvent       // Callback ke manager/telegram
    this.sessionPath = resolve(config.whatsapp.sessionDir, phone)
    mkdirSync(this.sessionPath, { recursive: true })
  }

  // ─── CONNECT ─────────────────────────────────────────────────────────────
  async connect() {
    try {
      this.status = 'connecting'
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath)
      const { version } = await fetchLatestBaileysVersion()

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: config.whatsapp.browser,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        cachedGroupMetadata: async (jid) => this.groupCache.get(jid),
        getMessage: async (key) => this._messageStore?.get(key.id)?.message || undefined,
      })

      this._messageStore = new Map()
      this._attachEvents(saveCreds)
      logger.account(this.phone, '🔄 Menghubungkan...')
    } catch (err) {
      logger.error(`[${this.phone}] Gagal connect:`, err.message)
      this._emitEvent('error', { phone: this.phone, message: err.message })
    }
  }

  // ─── EVENTS ──────────────────────────────────────────────────────────────
  _attachEvents(saveCreds) {
    const sock = this.sock

    // Simpan credentials
    sock.ev.on('creds.update', saveCreds)

    // Update cache grup
    sock.ev.on('groups.update', async ([event]) => {
      try {
        const meta = await sock.groupMetadata(event.id)
        this.groupCache.set(event.id, meta)
      } catch {}
    })

    sock.ev.on('group-participants.update', async ({ id }) => {
      try {
        const meta = await sock.groupMetadata(id)
        this.groupCache.set(id, meta)
      } catch {}
    })

    // ── Connection update ─────────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'connecting') {
        // Request pairing code jika belum terdaftar
        if (!sock.authState.creds.registered) {
          this.status = 'pairing'
          try {
            await new Promise(r => setTimeout(r, 1500))
            const code = await sock.requestPairingCode(this.phone, config.whatsapp.pairingPrefix)
            this.pairingCode = code
            logger.account(this.phone, `🔑 Pairing code: ${code}`)
            this._emitEvent('pairing_code', { phone: this.phone, code })
          } catch (err) {
            logger.error(`[${this.phone}] Gagal request pairing code:`, err.message)
            this._emitEvent('pairing_error', { phone: this.phone, message: err.message })
          }
        }
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error)?.output?.statusCode
        const isLoggedOut = code === DisconnectReason.loggedOut

        this.status = 'disconnected'
        logger.account(this.phone, `❌ Koneksi terputus (kode: ${code})`)
        this._emitEvent('disconnected', { phone: this.phone, code, loggedOut: isLoggedOut })

        if (!isLoggedOut && this.retryCount < this.maxRetries) {
          this.retryCount++
          const delay = Math.min(1000 * 2 ** this.retryCount, 30000)
          logger.account(this.phone, `⏳ Retry ke-${this.retryCount} dalam ${delay / 1000}s...`)
          setTimeout(() => this.connect(), delay)
        } else if (isLoggedOut) {
          this._emitEvent('logged_out', { phone: this.phone })
        }
      }

      if (connection === 'open') {
        this.retryCount = 0
        this.status = 'connected'
        this.pairingCode = null
        logger.account(this.phone, '✅ Terhubung!')
        this._emitEvent('connected', { phone: this.phone })
      }
    })

    // ── Pesan masuk ───────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        if (!msg.message) continue

        // Simpan ke store (untuk reply)
        this._messageStore.set(msg.key.id, msg)
        if (this._messageStore.size > 500) {
          const firstKey = this._messageStore.keys().next().value
          this._messageStore.delete(firstKey)
        }

        const jid = msg.key.remoteJid
        const isGroup = jid?.endsWith('@g.us')
        const isFromBot = msg.key.fromMe

        // ✅ Auto-read semua pesan grup atau dari user lain
        if (this.autoReadGroups && !isFromBot) {
          try {
            await sock.readMessages([msg.key])
          } catch {}
        }
      }
    })
  }

  // ─── KIRIM PESAN (dengan AI badge) ───────────────────────────────────────
  async sendMessage(jid, content, options = {}) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error(`Akun ${this.phone} tidak terhubung`)
    }

    const messageOptions = { ...options }

    // ✅ AI Badge selalu aktif untuk fitur blash
    if (this.aiBadge) {
      content = { ...content, ai: true }
    }

    return await this.sock.sendMessage(jid, content, messageOptions)
  }

  // ─── SEND PRESENCE (Typing indicator) ─────────────────────────────────────
  async sendPresenceUpdate(presenceType, jid) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error(`Akun ${this.phone} tidak terhubung`)
    }
    return await this.sock.sendPresenceUpdate(presenceType, jid)
  }

  // ─── GETTER INFO ─────────────────────────────────────────────────────────
  async getGroups() {
    if (!this.sock || this.status !== 'connected') return []
    try {
      const groups = await this.sock.groupFetchAllParticipating()
      return Object.values(groups)
    } catch {
      return []
    }
  }

  getInfo() {
    return {
      phone: this.phone,
      status: this.status,
      autoReadGroups: this.autoReadGroups,
      aiBadge: this.aiBadge,
      pairingCode: this.pairingCode,
      retryCount: this.retryCount,
    }
  }

  // ─── DISCONNECT ───────────────────────────────────────────────────────────
  async disconnect(logout = false) {
    this.maxRetries = 0 // Cegah auto-reconnect
    if (this.sock) {
      if (logout) {
        await this.sock.logout().catch(() => {})
      } else {
        this.sock.end()
      }
    }
    this.status = 'disconnected'
    logger.account(this.phone, logout ? '🚪 Logout' : '🔌 Disconnect')
  }

  // ─── HELPER ──────────────────────────────────────────────────────────────
  _emitEvent(type, data) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(type, data)
    }
  }
}

export default WAAccount
