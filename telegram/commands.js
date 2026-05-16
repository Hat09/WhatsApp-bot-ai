// telegram/commands.js - Command Telegram dengan fitur blash parallel

import config from '../config.js'
import logger from '../utils/logger.js'

// ─── HELPER FORMAT ────────────────────────────────────────────────────────
export function statusEmoji(status) {
  return { connected: '🟢', connecting: '🟡', pairing: '🔵', disconnected: '🔴' }[status] || '⚫'
}

function escMd(text) {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

// ─── STATE MACHINE PERCAKAPAN (per userId) ────────────────────────────────
const sessions = new Map()
const blashSessions = new Map() // Tracker untuk blash yang sedang berjalan

const setSession   = (uid, step, data = {}) => sessions.set(uid, { step, data })
const getSession   = (uid) => sessions.get(uid) || null
const clearSession = (uid) => sessions.delete(uid)

// ─── BLASH SESSION MANAGER ────────────────────────────────────────────────
export class BlashManager {
  constructor() {
    this.activeBlashes = new Map() // blashId -> { status, config, results }
  }

  createBlash(userId) {
    const blashId = `blash_${userId}_${Date.now()}`
    this.activeBlashes.set(blashId, {
      status: 'idle',
      config: {},
      results: {},
      loopCount: 0,
      isRunning: false,
      currentLoopStats: { success: 0, fail: 0, pending: 0 },
    })
    return blashId
  }

  getBlash(blashId) {
    return this.activeBlashes.get(blashId)
  }

  deleteBlash(blashId) {
    this.activeBlashes.delete(blashId)
  }

  getActive(userId) {
    for (const [id, blash] of this.activeBlashes) {
      if (id.includes(`blash_${userId}`)) return id
    }
    return null
  }
}

const blashManager = new BlashManager()

// ─── DAFTAR COMMAND ───────────────────────────────────────────────────────
export const commandList = `
*📋 DAFTAR COMMAND*

*Manajemen Akun*
/addaccount \`<nomor>\` — Tambah akun WA baru
/removeaccount \`<nomor>\` — Hapus akun WA
/reconnect \`<nomor>\` — Reconnect akun
/listaccounts — Daftar semua akun
/status — Status ringkas semua akun
/stats — Statistik sistem

*Grup*
/groups \`<nomor>\` — Daftar grup akun tertentu

*Pengaturan \\(berlaku untuk SEMUA akun\\)*
/autoread on — Aktifkan auto\\-read semua grup
/autoread off — Matikan auto\\-read semua grup
/aibadge on — Aktifkan AI badge semua pesan
/aibadge off — Matikan AI badge semua pesan

*Pesan \\(interaktif\\)*
/kirim — Kirim pesan dari 1 akun
/broadcast — Kirim pesan dari semua akun

*Blash \\(Chat Loop Auto Parallel\\)*
/blash — Mulai fitur blash interaktif
/blashstop — Hentikan blash yang sedang berjalan
/blashstatus — Cek status blash real\\-time

/batal — Batalkan aksi yang sedang berjalan
/help — Tampilkan menu ini
`

// ─── REGISTER SEMUA COMMAND ───────────────────────────────────────────────
export function registerCommands(bot, manager) {

  // ── /start & /help ───────────────────────────────────────────────────────
  bot.onText(/^\/(start|help)$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    bot.sendMessage(msg.chat.id, commandList, { parse_mode: 'MarkdownV2' })
  })

  // ── /batal ────────────────────────────────────────────────────────────────
  bot.onText(/^\/batal$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    
    // Stop blash jika ada
    const blashId = blashManager.getActive(msg.from.id)
    if (blashId) {
      const blash = blashManager.getBlash(blashId)
      blash.isRunning = false
      blashManager.deleteBlash(blashId)
      bot.sendMessage(msg.chat.id, '🛑 Blash dihentikan.')
    }
    
    if (getSession(msg.from.id)) {
      clearSession(msg.from.id)
      bot.sendMessage(msg.chat.id, '🚫 Aksi dibatalkan.')
    } else {
      bot.sendMessage(msg.chat.id, '💡 Tidak ada aksi yang sedang berjalan.')
    }
  })

  // ── /addaccount <nomor> ───────────────────────────────────────────────────
  bot.onText(/^\/addaccount(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const phone = (match[1] || '').replace(/[^0-9]/g, '')
    if (!phone || phone.length < 8)
      return bot.sendMessage(msg.chat.id, '❌ Format salah\\. Contoh: `/addaccount 6281234567890`', { parse_mode: 'MarkdownV2' })
    const w = await bot.sendMessage(msg.chat.id, `⏳ Memproses akun *${escMd(phone)}*\\.\\.\\.`, { parse_mode: 'MarkdownV2' })
    const result = await manager.addAccount(phone)
    bot.editMessageText(
      result.success
        ? `✅ ${escMd(result.message)}\n\n🔑 Pairing code akan segera dikirim\\.`
        : `❌ ${escMd(result.message)}`,
      { chat_id: msg.chat.id, message_id: w.message_id, parse_mode: 'MarkdownV2' }
    )
  })

  // ── /removeaccount <nomor> ────────────────────────────────────────────────
  bot.onText(/^\/removeaccount(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const phone = (match[1] || '').replace(/[^0-9]/g, '')
    if (!phone)
      return bot.sendMessage(msg.chat.id, '❌ Sertakan nomor\\. Contoh: `/removeaccount 628xxx`', { parse_mode: 'MarkdownV2' })
    const result = await manager.removeAccount(phone)
    bot.sendMessage(msg.chat.id, result.success ? `✅ ${result.message}` : `❌ ${result.message}`)
  })

  // ── /reconnect <nomor> ────────────────────────────────────────────────────
  bot.onText(/^\/reconnect(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const phone = (match[1] || '').replace(/[^0-9]/g, '')
    if (!phone)
      return bot.sendMessage(msg.chat.id, '❌ Sertakan nomor\\. Contoh: `/reconnect 628xxx`', { parse_mode: 'MarkdownV2' })
    const result = await manager.reconnectAccount(phone)
    bot.sendMessage(msg.chat.id, result.success ? `✅ ${result.message}` : `❌ ${result.message}`)
  })

  // ── /listaccounts ─────────────────────────────────────────────────────────
  bot.onText(/^\/listaccounts$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const accounts = manager.listAccounts()
    if (!accounts.length)
      return bot.sendMessage(msg.chat.id, '📭 Belum ada akun yang ditambahkan\\.', { parse_mode: 'MarkdownV2' })
    const lines = accounts.map((a, i) => {
      const em = statusEmoji(a.status)
      const ar = a.autoReadGroups ? '📖' : '📕'
      const ai = a.aiBadge ? '🤖' : '👤'
      return `${i + 1}\\. ${em} \`${escMd(a.phone)}\` ${ar}${ai} \\| _${escMd(a.status)}_`
    })
    bot.sendMessage(msg.chat.id,
      `*📱 Daftar Akun WA \\(${accounts.length}/${config.whatsapp.maxAccounts}\\)*\n\n${lines.join('\n')}\n\n📖\\=Auto\\-read ON \\| 🤖\\=AI Badge ON`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  // ── /status ───────────────────────────────────────────────────────────────
  bot.onText(/^\/status$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const s = manager.getStats()
    bot.sendMessage(msg.chat.id,
      `*📊 Status Sistem*\n\n🟢 Connected: *${s.connected}*\n🟡 Connecting: *${s.connecting}*\n🔵 Pairing: *${s.pairing}*\n🔴 Disconnected: *${s.disconnected}*\n─────────────────\n📱 Total Akun: *${s.total}/${s.maxSlots}*\n🆓 Slot Kosong: *${s.freeSlots}*`,
      { parse_mode: 'Markdown' }
    )
  })

  // ── /stats ────────────────────────────────────────────────────────────────
  bot.onText(/^\/stats$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const accounts = manager.listAccounts()
    const s = manager.getStats()
    bot.sendMessage(msg.chat.id,
      `*📈 Statistik*\n\n🟢 Online: ${s.connected} | 🔴 Offline: ${s.disconnected}\n🟡 Connecting: ${s.connecting} | 🔵 Pairing: ${s.pairing}\n\n🤖 AI Badge ON: ${accounts.filter(a => a.aiBadge).length}/${s.total} akun\n📖 Auto-Read ON: ${accounts.filter(a => a.autoReadGroups).length}/${s.total} akun\n\n📱 Slot: ${s.total}/${s.maxSlots} | Prefix: \`${config.whatsapp.pairingPrefix}\``,
      { parse_mode: 'Markdown' }
    )
  })

  // ── /groups <nomor> ───────────────────────────────────────────────────────
  bot.onText(/^\/groups(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const phone = (match[1] || '').replace(/[^0-9]/g, '')
    if (!phone)
      return bot.sendMessage(msg.chat.id, '❌ Sertakan nomor\\. Contoh: `/groups 628xxx`', { parse_mode: 'MarkdownV2' })
    const wait = await bot.sendMessage(msg.chat.id, '⏳ Mengambil daftar grup\\.\\.\\.', { parse_mode: 'MarkdownV2' })
    try {
      const groups = await manager.getAccountGroups(phone)
      if (!groups.length)
        return bot.editMessageText('📭 Akun tidak bergabung di grup manapun.', { chat_id: msg.chat.id, message_id: wait.message_id })
      const chunks = []
      for (let i = 0; i < groups.length; i += 40) chunks.push(groups.slice(i, i + 40))
      await bot.editMessageText(
        `*📋 Grup ${escMd(phone)} \\(${groups.length} grup\\)*`,
        { chat_id: msg.chat.id, message_id: wait.message_id, parse_mode: 'MarkdownV2' }
      )
      for (const chunk of chunks) {
        const lines = chunk.map((g, i) => `${i + 1}\\. *${escMd(g.subject)}*\n   \`${escMd(g.id)}\``)
        await bot.sendMessage(msg.chat.id, lines.join('\n\n'), { parse_mode: 'MarkdownV2' })
      }
    } catch (err) {
      bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: msg.chat.id, message_id: wait.message_id })
    }
  })

  // ── /autoread on|off ──────────────────────────────────────────────────────
  bot.onText(/^\/autoread\s+(on|off)$/i, (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const enabled = match[1].toLowerCase() === 'on'
    manager.setAutoRead('all', enabled)
    bot.sendMessage(msg.chat.id,
      `${enabled ? '📖' : '📕'} *Auto\\-read ${enabled ? 'ON' : 'OFF'}* untuk semua akun\\.`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  bot.onText(/^\/autoread$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    bot.sendMessage(msg.chat.id, '❓ Gunakan `/autoread on` atau `/autoread off`', { parse_mode: 'Markdown' })
  })

  // ── /aibadge on|off ───────────────────────────────────────────────────────
  bot.onText(/^\/aibadge\s+(on|off)$/i, (msg, match) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    clearSession(msg.from.id)
    const enabled = match[1].toLowerCase() === 'on'
    manager.setAIBadge('all', enabled)
    bot.sendMessage(msg.chat.id,
      `${enabled ? '🤖' : '👤'} *AI Badge ${enabled ? 'ON' : 'OFF'}* untuk semua akun\\.`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  bot.onText(/^\/aibadge$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    bot.sendMessage(msg.chat.id, '❓ Gunakan `/aibadge on` atau `/aibadge off`', { parse_mode: 'Markdown' })
  })

  // ════��═══════════════════════════════════════════════════════════════════
  // ✅ /kirim  —  flow interaktif 3 langkah
  // ════════════════════════════════════════════════════════════════════════
  bot.onText(/^\/kirim$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    const accounts = manager.listAccounts().filter(a => a.status === 'connected')
    if (!accounts.length)
      return bot.sendMessage(msg.chat.id, '❌ Tidak ada akun WA yang terhubung saat ini\\.', { parse_mode: 'MarkdownV2' })
    const list = accounts.map((a, i) => `${i + 1}\\. \`${escMd(a.phone)}\``).join('\n')
    setSession(msg.from.id, 'kirim_1', {})
    bot.sendMessage(msg.chat.id,
      `📤 *Kirim Pesan* — Langkah 1 dari 3\n\n*Akun aktif:*\n${list}\n\n✏️ Ketik *nomor akun pengirim*:\n_contoh: 6281234567890_\n\n/batal untuk membatalkan`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  // ════════════════════════════════════════════════════════════════════════
  // ✅ /broadcast  —  flow interaktif 2 langkah
  // ════════════════════════════════════════════════════════════════════════
  bot.onText(/^\/broadcast$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    const stats = manager.getStats()
    if (stats.connected === 0)
      return bot.sendMessage(msg.chat.id, '❌ Tidak ada akun WA yang terhubung\\.', { parse_mode: 'MarkdownV2' })
    setSession(msg.from.id, 'bc_1', {})
    bot.sendMessage(msg.chat.id,
      `📡 *Broadcast* — Langkah 1 dari 2\n\n✅ *${stats.connected} akun* siap mengirim\\.\n\n✏️ Ketik *nomor tujuan*:\n_contoh: 6281234567890_\n\n/batal untuk membatalkan`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  // ════════════════════════════════════════════════════════════════════════
  // ✅ /blash  —  Flow interaktif fitur blash (PARALLEL)
  // ════════════════════════════════════════════════════════════════════════
  bot.onText(/^\/blash$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    const accounts = manager.listAccounts().filter(a => a.status === 'connected')
    if (accounts.length < 2)
      return bot.sendMessage(msg.chat.id, '❌ Minimal perlu 2 akun yang terhubung untuk blash\\.', { parse_mode: 'MarkdownV2' })
    
    const blashId = blashManager.createBlash(msg.from.id)
    setSession(msg.from.id, 'blash_1', { blashId })
    
    const list = accounts.map((a, i) => `${i + 1}\\. \`${escMd(a.phone)}\``).join('\n')
    bot.sendMessage(msg.chat.id,
      `🚀 *Blash Setup* — Langkah 1 dari 3\n\n*${accounts.length} Akun Terhubung:*\n${list}\n\n📄 Silakan upload file \\*\\.txt dengan format:\n\`\`\`\nAkun1: pesan untuk akun 1\nAkun2: pesan untuk akun 2\nAkun3: pesan untuk akun 3\n\`\`\`\n\n/batal untuk membatalkan`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  // ────────────────────────────────────────────────────────────────────────
  // Handle file upload untuk blash
  // ────────────────────────────────────────────────────────────────────────
  bot.on('document', async (msg) => {
    if (!isAdmin(msg.from.id)) return
    const session = getSession(msg.from.id)
    if (!session || session.step !== 'blash_1') return

    const { blashId } = session.data
    const blash = blashManager.getBlash(blashId)
    
    try {
      const file = await bot.getFile(msg.document.file_id)
      const filePath = file.file_path
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`
      
      // Download dan parse file
      const response = await fetch(fileUrl)
      const text = await response.text()
      const lines = text.split('\n').filter(l => l.trim())
      
      const messages = {}
      const accounts = manager.listAccounts().filter(a => a.status === 'connected')
      
      // Parse file
      for (const line of lines) {
        const match = line.match(/^Akun(\d+):\s*(.+)$/)
        if (match) {
          const idx = parseInt(match[1]) - 1
          if (idx >= 0 && idx < accounts.length) {
            messages[accounts[idx].phone] = match[2].trim()
          }
        }
      }
      
      if (Object.keys(messages).length === 0) {
        return bot.sendMessage(msg.chat.id, '❌ Format file tidak valid\\. Gunakan: `Akun1: pesan`', { parse_mode: 'MarkdownV2' })
      }
      
      blash.config.messages = messages
      blash.config.accounts = accounts
      
      setSession(msg.from.id, 'blash_2', { blashId })
      const preview = Object.entries(messages).map(([phone, msg]) => `\`${escMd(phone)}\`: _${escMd(msg.slice(0, 40))}${msg.length > 40 ? '\\.\\.\\.' : ''}_`).join('\n')
      
      bot.sendMessage(msg.chat.id,
        `✅ File terkirim\\! Ditemukan *${Object.keys(messages).length}* akun\n\n${preview}\n\n🚀 *Blash Setup* — Langkah 2 dari 3\n\nSet *jeda antar loop* \\(detik\\):\n_contoh: 5 \\(bisa 0\\-unlimited\\)_\n\n/batal untuk membatalkan`,
        { parse_mode: 'MarkdownV2' }
      )
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error parsing file: ${err.message}`)
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // Handler pesan bebas — melanjutkan flow aktif
  // ────────────────────────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return
    if (!msg.text || msg.text.startsWith('/')) return
    const uid = msg.from.id
    const session = getSession(uid)
    if (!session) return
    const input = msg.text.trim()

    // ─── /kirim langkah 1: nomor akun pengirim ───────────────────────────
    if (session.step === 'kirim_1') {
      const phone = input.replace(/[^0-9]/g, '')
      const found = manager.listAccounts().find(a => a.phone === phone && a.status === 'connected')
      if (!found)
        return bot.sendMessage(msg.chat.id,
          `❌ Akun \`${escMd(phone)}\` tidak ditemukan atau offline\\. Coba lagi atau /batal`,
          { parse_mode: 'MarkdownV2' }
        )
      setSession(uid, 'kirim_2', { fromPhone: phone })
      bot.sendMessage(msg.chat.id,
        `✅ Pengirim: \`${escMd(phone)}\`\n\n📤 *Kirim Pesan* — Langkah 2 dari 3\n\n✏️ Ketik *nomor tujuan*:\n_contoh: 6281234567890_\n\n/batal untuk membatalkan`,
        { parse_mode: 'MarkdownV2' }
      )
    }

    // ─── /kirim langkah 2: nomor tujuan ──────────────────────────────────
    else if (session.step === 'kirim_2') {
      const num = input.replace(/[^0-9]/g, '')
      if (num.length < 8)
        return bot.sendMessage(msg.chat.id,
          `❌ Nomor tidak valid\\. Coba lagi atau /batal`, { parse_mode: 'MarkdownV2' }
        )
      setSession(uid, 'kirim_3', { ...session.data, targetJid: num + '@s.whatsapp.net' })
      bot.sendMessage(msg.chat.id,
        `✅ Tujuan: \`${escMd(num)}\`\n\n📤 *Kirim Pesan* — Langkah 3 dari 3\n\n✏️ Ketik *isi pesan*:\n\n/batal untuk membatalkan`,
        { parse_mode: 'MarkdownV2' }
      )
    }

    // ─── /kirim langkah 3: isi pesan → kirim ─────────────────────────────
    else if (session.step === 'kirim_3') {
      const { fromPhone, targetJid } = session.data
      clearSession(uid)
      const wait = await bot.sendMessage(msg.chat.id, '⏳ Mengirim\\.\\.\\.', { parse_mode: 'MarkdownV2' })
      try {
        await manager.sendFromAccount(fromPhone, targetJid, { text: input })
        const toNum = targetJid.replace('@s.whatsapp.net', '')
        bot.editMessageText(
          `✅ *Pesan Terkirim\\!*\n\n📤 Dari: \`${escMd(fromPhone)}\`\n📥 Ke: \`${escMd(toNum)}\`\n💬 _${escMd(input.slice(0, 80))}${input.length > 80 ? '\\.\\.\\.' : ''}_`,
          { chat_id: msg.chat.id, message_id: wait.message_id, parse_mode: 'MarkdownV2' }
        )
      } catch (err) {
        bot.editMessageText(
          `❌ Gagal kirim: ${escMd(err.message)}`,
          { chat_id: msg.chat.id, message_id: wait.message_id, parse_mode: 'MarkdownV2' }
        )
      }
    }

    // ─── /broadcast langkah 1: nomor tujuan ──────────────────────────────
    else if (session.step === 'bc_1') {
      const num = input.replace(/[^0-9]/g, '')
      if (num.length < 8)
        return bot.sendMessage(msg.chat.id,
          `❌ Nomor tidak valid\\. Coba lagi atau /batal`, { parse_mode: 'MarkdownV2' }
        )
      setSession(uid, 'bc_2', { targetJid: num + '@s.whatsapp.net' })
      const stats = manager.getStats()
      bot.sendMessage(msg.chat.id,
        `✅ Tujuan: \`${escMd(num)}\`\n📡 Akan dikirim dari *${stats.connected} akun*\n\n📡 *Broadcast* — Langkah 2 dari 2\n\n✏️ Ketik *isi pesan broadcast*:\n\n/batal untuk membatalkan`,
        { parse_mode: 'MarkdownV2' }
      )
    }

    // ─── /broadcast langkah 2: isi pesan → broadcast ─────────────────────
    else if (session.step === 'bc_2') {
      const { targetJid } = session.data
      clearSession(uid)
      const stats = manager.getStats()
      const wait = await bot.sendMessage(msg.chat.id,
        `📡 Broadcasting dari *${stats.connected} akun*\\.\\.\\. ⏳`,
        { parse_mode: 'MarkdownV2' }
      )
      const results = await manager.broadcast(targetJid, { text: input })
      const ok   = results.filter(r => r.success).length
      const fail = results.filter(r => !r.success).length
      const toNum = targetJid.replace('@s.whatsapp.net', '')
      const failLines = results.filter(r => !r.success)
        .map(r => `  \\• \`${escMd(r.phone)}\`: ${escMd(r.reason)}`).join('\n')
      bot.editMessageText(
        `📡 *Broadcast Selesai\\!*\n\n📥 Ke: \`${escMd(toNum)}\`\n💬 _${escMd(input.slice(0, 60))}${input.length > 60 ? '\\.\\.\\.' : ''}_\n\n✅ Berhasil: *${ok}* akun\n❌ Gagal: *${fail}* akun` +
        (failLines ? `\n\n*Detail gagal:*\n${failLines}` : ''),
        { chat_id: msg.chat.id, message_id: wait.message_id, parse_mode: 'MarkdownV2' }
      )
    }

    // ─── /blash langkah 2: jeda loop ──────────────────────────────────────
    else if (session.step === 'blash_2') {
      const { blashId } = session.data
      const blash = blashManager.getBlash(blashId)
      const delay = parseInt(input)
      
      if (isNaN(delay) || delay < 0) {
        return bot.sendMessage(msg.chat.id, '❌ Masukkan angka valid \\(0\\-unlimited\\)\\.', { parse_mode: 'MarkdownV2' })
      }
      
      blash.config.loopDelay = delay
      setSession(uid, 'blash_3', { blashId })
      
      bot.sendMessage(msg.chat.id,
        `✅ Jeda loop: *${delay}* detik\n\n🚀 *Blash Setup* — Langkah 3 dari 3\n\nBerapa banyak *loop* yang ingin dijalankan\\?\n_contoh: 5 \\(atau unlimited\\)_\n\n/batal untuk membatalkan`,
        { parse_mode: 'MarkdownV2' }
      )
    }

    // ─── /blash langkah 3: jumlah loop → mulai ────────────────────────────
    else if (session.step === 'blash_3') {
      const { blashId } = session.data
      const blash = blashManager.getBlash(blashId)
      let loopCount = Infinity
      
      if (input.toLowerCase() !== 'unlimited') {
        loopCount = parseInt(input)
        if (isNaN(loopCount) || loopCount < 1) {
          return bot.sendMessage(msg.chat.id, '❌ Masukkan angka \\(minimal 1\\) atau "unlimited"\\.', { parse_mode: 'MarkdownV2' })
        }
      }
      
      clearSession(uid)
      blash.config.totalLoops = loopCount
      blash.isRunning = true
      blash.loopCount = 0
      
      const loopText = loopCount === Infinity ? 'unlimited' : loopCount
      const loopDelay = blash.config.loopDelay
      const accountCount = blash.config.accounts.length
      
      bot.sendMessage(msg.chat.id,
        `🚀 *Blash Dimulai\\!*\n\n📝 Loop: *${loopText}*\n⏱️ Jeda: *${loopDelay}s*\n👥 Akun: *${accountCount}* \\(PARALLEL\\)\n🤖 AI Badge: *ON*\n📖 Auto Read: *ON*\n🌙 Auto Stop: *01:00\\-06:00 WIB*\n\nUntuk stop: /blashstop\nStatus: /blashstatus`,
        { parse_mode: 'MarkdownV2' }
      )
      
      // Start blash loop (PARALLEL)
      startBlashLoopParallel(bot, manager, blashId, msg.chat.id)
    }
  })

  // ════════════════════════════════════════════════════════════════════════
  // /blashstop & /blashstatus
  // ════════════════════════════════════════════════════════════════════════
  bot.onText(/^\/blashstop$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    const blashId = blashManager.getActive(msg.from.id)
    
    if (!blashId) {
      return bot.sendMessage(msg.chat.id, '❌ Tidak ada blash yang sedang berjalan\\.', { parse_mode: 'MarkdownV2' })
    }
    
    const blash = blashManager.getBlash(blashId)
    blash.isRunning = false
    blashManager.deleteBlash(blashId)
    
    bot.sendMessage(msg.chat.id, `🛑 *Blash Dihentikan\\!*\n\nLoop selesai: *${blash.loopCount}/${blash.config.totalLoops === Infinity ? 'unlimited' : blash.config.totalLoops}*`, { parse_mode: 'MarkdownV2' })
  })

  bot.onText(/^\/blashstatus$/, (msg) => {
    if (!isAdmin(msg.from.id)) return replyUnauth(bot, msg)
    const blashId = blashManager.getActive(msg.from.id)
    
    if (!blashId) {
      return bot.sendMessage(msg.chat.id, '❌ Tidak ada blash yang sedang berjalan\\.', { parse_mode: 'MarkdownV2' })
    }
    
    const blash = blashManager.getBlash(blashId)
    const loopText = blash.config.totalLoops === Infinity ? 'unlimited' : blash.config.totalLoops
    const stats = blash.currentLoopStats
    
    bot.sendMessage(msg.chat.id,
      `📊 *Status Blash Real\\-Time*\n\n🔄 Running: *${blash.isRunning ? 'Ya ⏳' : 'Berhenti ⏸️'}*\n🔁 Loop: *${blash.loopCount}/${loopText}*\n⏱️ Jeda: *${blash.config.loopDelay}s*\n👥 Akun: *${blash.config.accounts?.length || 0}*\n\n📊 *Loop Terakhir:*\n✅ Sukses: *${stats.success}*\n❌ Gagal: *${stats.fail}*\n⏳ Pending: *${stats.pending}*`,
      { parse_mode: 'MarkdownV2' }
    )
  })

  logger.info('✅ Command Telegram terdaftar (dengan blash parallel)')
}

// ────────────────────────────────────────────────────────────────────────
// BLASH LOOP FUNCTION (PARALLEL - SEMUA AKUN BERJALAN BERSAMAAN)
// ────────────────────────────────────────────────────────────────────────
async function startBlashLoopParallel(bot, manager, blashId, chatId) {
  const blash = blashManager.getBlash(blashId)
  
  while (blash.isRunning && blash.loopCount < blash.config.totalLoops) {
    // Check apakah jam tidur (01:00 - 06:00 WIB)
    if (isBlashSleepTime()) {
      logger.info(`⏸️ Blash sleep time (01:00-06:00 WIB). Menunggu...`)
      await sleep(300000) // Tunggu 5 menit, cek lagi
      continue
    }
    
    blash.loopCount++
    const { messages, accounts } = blash.config
    
    logger.info(`🔄 Blash Loop ${blash.loopCount} dimulai (${accounts.length} akun PARALLEL)...`)
    
    // Reset stats
    blash.currentLoopStats = { success: 0, fail: 0, pending: 0 }
    
    // Buat array promises untuk semua akun (PARALLEL)
    const promises = accounts.map(async (account) => {
      if (!blash.isRunning) return { phone: account.phone, success: false, reason: 'stopped' }
      
      const message = messages[account.phone]
      if (!message) return { phone: account.phone, success: false, reason: 'no message' }
      
      try {
        blash.currentLoopStats.pending++
        
        // Typing indicator selama 3 detik
        const targetJid = account.jid
        try {
          await manager.getAccount(account.phone)?.sock?.sendPresenceUpdate('typing', targetJid)
        } catch {}
        
        await sleep(3000)
        
        // Kirim pesan dengan AI badge
        await manager.sendFromAccount(account.phone, targetJid, { text: message })
        
        blash.currentLoopStats.pending--
        blash.currentLoopStats.success++
        logger.account(account.phone, `✅ Blash pesan terkirim (Loop ${blash.loopCount})`)
        
        return { phone: account.phone, success: true }
      } catch (err) {
        blash.currentLoopStats.pending--
        blash.currentLoopStats.fail++
        logger.error(`[${account.phone}] Blash gagal:`, err.message)
        return { phone: account.phone, success: false, reason: err.message }
      }
    })
    
    // Tunggu semua promises selesai (PARALLEL)
    const results = await Promise.all(promises)
    
    blash.results[blash.loopCount] = {
      success: blash.currentLoopStats.success,
      fail: blash.currentLoopStats.fail,
      details: results
    }
    
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    
    logger.info(`✅ Loop ${blash.loopCount} selesai: ${successCount}✅ ${failCount}❌`)
    
    // Update status di Telegram
    bot.sendMessage(chatId,
      `📊 *Loop ${blash.loopCount} Selesai*\n\n✅ Sukses: *${successCount}/${accounts.length}*\n❌ Gagal: *${failCount}/${accounts.length}*`,
      { parse_mode: 'MarkdownV2' }
    ).catch(() => {})
    
    // Jeda sebelum loop berikutnya
    if (blash.isRunning && blash.loopCount < blash.config.totalLoops) {
      logger.info(`⏳ Menunggu ${blash.config.loopDelay} detik sebelum loop berikutnya...`)
      await sleep(blash.config.loopDelay * 1000)
    }
  }
  
  if (blash.isRunning) {
    blash.isRunning = false
    const allResults = Object.values(blash.results)
    const totalSuccess = allResults.reduce((sum, r) => sum + r.success, 0)
    const totalFail = allResults.reduce((sum, r) => sum + r.fail, 0)
    const totalMessages = (totalSuccess + totalFail) * blash.config.accounts.length
    
    bot.sendMessage(chatId,
      `✅ *Blash Selesai\\!*\n\n🔁 Total Loop: *${blash.loopCount}*\n👥 Akun: *${blash.config.accounts.length}*\n\n📊 *Statistik Total:*\n✅ Berhasil: *${totalSuccess}*\n❌ Gagal: *${totalFail}*\n📨 Total Pesan: *${totalMessages}*\n⚡ Mode: *PARALLEL*`,
      { parse_mode: 'MarkdownV2' }
    ).catch(() => {})
    
    blashManager.deleteBlash(blashId)
  }
}

// ────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ────────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isBlashSleepTime() {
  const now = new Date()
  // Tambah 7 jam untuk WIB (UTC+7)
  const wibTime = new Date(now.getTime() + (7 * 3600000))
  const hour = wibTime.getHours()
  
  return hour >= 1 && hour < 6
}

export function isAdmin(userId) {
  return config.telegram.adminIds.includes(userId)
}

function replyUnauth(bot, msg) {
  bot.sendMessage(msg.chat.id, '⛔ Akses ditolak\\. Kamu bukan admin\\.', { parse_mode: 'MarkdownV2' })
}
