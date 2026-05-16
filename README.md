# 📱 WA Multi-Account Telegram Manager

Sistem manajemen multi-akun WhatsApp (hingga 50 akun) yang dikontrol sepenuhnya melalui Telegram Bot.

---

## ✨ Fitur

| Fitur | Detail |
|---|---|
| 🔑 Custom Pairing Code | Prefix `SENDERZA` (8 karakter) |
| 📱 Multi-Akun | Hingga 50 akun WhatsApp |
| 💻 Identitas MacOS Chrome | Browser fingerprint MacOS |
| 🤖 AI Badge | Badge AI di semua pesan keluar |
| 📖 Auto-Read Grup | Otomatis baca semua pesan grup |
| 🎮 Kontrol Telegram | Semua command via Telegram Bot |

---

## 🚀 Instalasi

### Prasyarat
- Node.js 20+
- Token Telegram Bot (dari [@BotFather](https://t.me/BotFather))
- Chat ID Telegram admin (dari [@userinfobot](https://t.me/userinfobot))

### Langkah

```bash
# 1. Clone / salin project
cd wa-telegram-manager

# 2. Install dependensi
npm install

# 3. Konfigurasi .env
cp .env.example .env
nano .env   # isi TOKEN dan ADMIN_IDS

# 4. Jalankan
npm start
```

### Isi .env

```env
TELEGRAM_BOT_TOKEN=123456:ABCdef...
TELEGRAM_ADMIN_IDS=123456789
MAX_ACCOUNTS=50
PAIRING_PREFIX=SENDERZA
DEBUG=false
```

---

## 📋 Command Telegram

### Manajemen Akun

| Command | Fungsi |
|---|---|
| `/addaccount 6281234567890` | Tambah akun WA baru |
| `/removeaccount 6281234567890` | Hapus akun WA |
| `/reconnect 6281234567890` | Reconnect akun |
| `/listaccounts` | Daftar semua akun |
| `/status` | Status ringkas semua akun |
| `/stats` | Statistik detail sistem |

### Grup

| Command | Fungsi |
|---|---|
| `/groups 6281234567890` | Daftar grup akun tertentu |

### Pengaturan

| Command | Fungsi |
|---|---|
| `/autoread on all` | Aktifkan auto-read semua akun |
| `/autoread off 6281234567890` | Matikan auto-read 1 akun |
| `/aibadge on all` | Aktifkan AI badge semua akun |
| `/aibadge off 6281234567890` | Matikan AI badge 1 akun |

### Kirim Pesan

| Command | Fungsi |
|---|---|
| `/kirim 628xxx 628yyy@s.whatsapp.net Halo!` | Kirim dari 1 akun |
| `/broadcast 628yyy@s.whatsapp.net Halo!` | Kirim dari semua akun |

---

## 🔑 Cara Pairing Akun

1. Kirim `/addaccount 6281234567890` ke Telegram Bot
2. Bot akan mengirimkan pairing code seperti: `SENDERZA`
3. Buka WhatsApp di HP nomor tersebut
4. Masuk ke **Pengaturan → Perangkat Tertaut → Tautkan Perangkat**
5. Pilih **Tautkan dengan Nomor Telepon**
6. Masukkan kode yang dikirim bot
7. Bot akan notifikasi `✅ Akun Terhubung!`

---

## 🏗 Struktur Project

```
wa-telegram-manager/
├── index.js              ← Entry point
├── config.js             ← Konfigurasi global
├── package.json
├── .env                  ← Konfigurasi (jangan di-commit!)
├── .env.example
├── .gitignore
├── whatsapp/
│   ├── account.js        ← Handler satu akun WA
│   └── manager.js        ← Manager multi-akun
├── telegram/
│   ├── bot.js            ← Setup Telegram bot
│   └── commands.js       ← Semua command handler
├── utils/
│   └── logger.js         ← Logger berwarna
└── sessions/             ← Session WA (auto-dibuat, jangan commit!)
```

---

## ⚙️ Keterangan Teknis

- **Identitas browser:** MacOS / Chrome 120 (mencegah deteksi bot)
- **Pairing prefix:** Tepat 8 karakter, dikonfigurasi via `.env`
- **AI Badge:** Ditambahkan via flag `aiContent: true` di semua pesan keluar
- **Auto-read:** Memanggil `sock.readMessages()` untuk setiap pesan grup masuk
- **Reconnect:** Exponential backoff, max 5 retry, max delay 30 detik
- **Session:** Tersimpan per-nomor di folder `sessions/<nomor>/`

---

## 🔒 Keamanan

- Hanya admin (Chat ID terdaftar) yang bisa menggunakan bot
- Session tidak pernah di-commit ke Git
- Graceful shutdown menjaga session tetap valid

---

## 📦 Dependensi

| Package | Fungsi |
|---|---|
| `@crysnovax/baileys` | WhatsApp Web client |
| `node-telegram-bot-api` | Telegram Bot API |
| `@hapi/boom` | Error handling reconnect |
| `pino` | Logger internal baileys |
| `node-cache` | Cache metadata grup |
| `dotenv` | Load konfigurasi .env |
| `fs-extra` | File system helpers |
