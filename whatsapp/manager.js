// whatsapp/manager.js - Manager multi-akun WhatsApp (max 50)
import { mkdirSync, existsSync, rmSync } from 'fs'
import { resolve } from 'path'
import config from '../config.js'
import logger from '../utils/logger.js'
import { WAAccount } from './account.js'

export class WAManager {
  constructor(onEvent) {
    this.accounts = new Map()       // phone → WAAccount
    this.onEvent = onEvent          // Callback ke Telegram bot
    mkdirSync(config.whatsapp.sessionDir, { recursive: true })
  }

  // ─── TAMBAH AKUN ─────────────────────────────────────────────────────────
  async addAccount(phone) {
    phone = phone.replace(/[^0-9]/g, '')

    if (this.accounts.has(phone)) {
      return { success: false, message: `Akun ${phone} sudah ada.` }
    }
    if (this.accounts.size >= config.whatsapp.maxAccounts) {
      return { success: false, message: `Batas maksimal ${config.whatsapp.maxAccounts} akun tercapai.` }
    }

    const account = new WAAccount(phone, (type, data) => this._handleAccountEvent(type, data))
    this.accounts.set(phone, account)
    await account.connect()

    logger.info(`➕ Akun ${phone} ditambahkan (total: ${this.accounts.size})`)
    return { success: true, message: `Akun ${phone} sedang menghubungkan...` }
  }

  // ─── HAPUS AKUN ──────────────────────────────────────────────────────────
  async removeAccount(phone, deleteSession = true) {
    phone = phone.replace(/[^0-9]/g, '')
    const account = this.accounts.get(phone)
    if (!account) return { success: false, message: `Akun ${phone} tidak ditemukan.` }

    await account.disconnect(true)
    this.accounts.delete(phone)

    if (deleteSession) {
      const sessionPath = resolve(config.whatsapp.sessionDir, phone)
      if (existsSync(sessionPath)) rmSync(sessionPath, { recursive: true, force: true })
      logger.info(`🗑️ Session ${phone} dihapus`)
    }

    return { success: true, message: `Akun ${phone} berhasil dihapus.` }
  }

  // ─── RECONNECT AKUN ───────────────────────────────────────────────────────
  async reconnectAccount(phone) {
    phone = phone.replace(/[^0-9]/g, '')
    const account = this.accounts.get(phone)
    if (!account) return { success: false, message: `Akun ${phone} tidak ditemukan.` }

    account.retryCount = 0
    account.maxRetries = 5
    await account.disconnect(false)
    await new Promise(r => setTimeout(r, 1000))
    await account.connect()

    return { success: true, message: `Akun ${phone} sedang reconnect...` }
  }

  // ─── LIST AKUN ────────────────────────────────────────────────────────────
  listAccounts() {
    return Array.from(this.accounts.values()).map(a => a.getInfo())
  }

  // ─── TOGGLE FITUR ─────────────────────────────────────────────────────────
  setAutoRead(phone, enabled) {
    phone = phone.replace(/[^0-9]/g, '')
    const account = phone === 'all' ? null : this.accounts.get(phone)

    if (phone === 'all') {
      for (const acc of this.accounts.values()) acc.autoReadGroups = enabled
      return { success: true, message: `Auto-read ${enabled ? 'ON' : 'OFF'} untuk semua akun.` }
    }
    if (!account) return { success: false, message: `Akun ${phone} tidak ditemukan.` }
    account.autoReadGroups = enabled
    return { success: true, message: `Auto-read ${enabled ? 'ON' : 'OFF'} untuk ${phone}.` }
  }

  setAIBadge(phone, enabled) {
    phone = phone.replace(/[^0-9]/g, '')
    if (phone === 'all') {
      for (const acc of this.accounts.values()) acc.aiBadge = enabled
      return { success: true, message: `AI Badge ${enabled ? 'ON' : 'OFF'} untuk semua akun.` }
    }
    const account = this.accounts.get(phone)
    if (!account) return { success: false, message: `Akun ${phone} tidak ditemukan.` }
    account.aiBadge = enabled
    return { success: true, message: `AI Badge ${enabled ? 'ON' : 'OFF'} untuk ${phone}.` }
  }

  // ─── KIRIM PESAN (dari satu akun) ─────────────────────────────────────────
  async sendFromAccount(phone, targetJid, content) {
    phone = phone.replace(/[^0-9]/g, '')
    const account = this.accounts.get(phone)
    if (!account) throw new Error(`Akun ${phone} tidak ditemukan.`)
    return await account.sendMessage(targetJid, content)
  }

  // ─── BROADCAST (dari semua akun connected) ────────────────────────────────
  async broadcast(targetJid, content, delayMs = 2500) {
    const results = []
    for (const account of this.accounts.values()) {
      if (account.status !== 'connected') {
        results.push({ phone: account.phone, success: false, reason: 'offline' })
        continue
      }
      try {
        await account.sendMessage(targetJid, content)
        results.push({ phone: account.phone, success: true })
      } catch (err) {
        results.push({ phone: account.phone, success: false, reason: err.message })
      }
      await new Promise(r => setTimeout(r, delayMs + Math.random() * 500))
    }
    return results
  }

  // ─── GET GRUP AKUN ────────────────────────────────────────────────────────
  async getAccountGroups(phone) {
    phone = phone.replace(/[^0-9]/g, '')
    const account = this.accounts.get(phone)
    if (!account) throw new Error(`Akun ${phone} tidak ditemukan.`)
    return await account.getGroups()
  }

  // ─── EVENT HANDLER ────────────────────────────────────────────────────────
  _handleAccountEvent(type, data) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(type, data)
    }
  }

  // ─── STATS ────────────────────────────────────────────────────────────────
  getStats() {
    const all = this.listAccounts()
    return {
      total: all.length,
      connected: all.filter(a => a.status === 'connected').length,
      connecting: all.filter(a => a.status === 'connecting').length,
      pairing: all.filter(a => a.status === 'pairing').length,
      disconnected: all.filter(a => a.status === 'disconnected').length,
      maxSlots: config.whatsapp.maxAccounts,
      freeSlots: config.whatsapp.maxAccounts - all.length,
    }
  }
}

export default WAManager
