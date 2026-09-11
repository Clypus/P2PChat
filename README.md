# P2PChat: Real-Time Decentralized Communication 🚀

P2PChat is a modern, Discord-style peer-to-peer chat application built with **React 19**, **TypeScript**, and **Vite**. It uses **WebRTC** (via PeerJS) for direct client-to-client communication — no message server, no database, maximum privacy.

## ✨ Features

### Messaging
- **True peer-to-peer** — messages travel directly between users over WebRTC data channels
- **End-to-end encryption** — ECDH (P-256) key exchange + AES-GCM per-peer encryption
- **Render-time HTML sanitization** — markdown formatting without XSS risk
- Replies, reactions, pins, edit/delete, @mentions, markdown, YouTube embeds
- **Right-click context menu** on any message, plus spoiler tags with `||hidden||`
- **Paste a screenshot straight into the composer** with Ctrl+V
- **Per-chat drafts** that survive switching chats and restarting the app
- **New-message divider and jump-to-present button**
- **Inline GIFs and images** — paste a link or use the GIF picker (optional Tenor search)
- **Link preview cards** — Open Graph title, description and thumbnail (desktop build)
- **Chunked file sharing with progress bars** — both sides see name, size and percentage
- Image lightbox, video/audio players, voice messages
- Message search with jump-to-result, date separators, delivery ticks (✓ sent / ✓✓ delivered)
- Typing indicators with avatars, scoped to the chat you're typing in
- Offline message queue, automatic reconnect, heartbeat, periodic history sync
- **History in IndexedDB**, so attachments no longer fight a 5 MB quota; up to 5000
  messages per chat with a "load earlier" control
- **Virtualized message list** — only the rows near the viewport are mounted
- Unread badges for DMs, group DMs and servers, mirrored on the taskbar and tray
- Kill-switch keyword that wipes the active chat on both sides

### Servers & DMs
- Create/join servers (host-relayed mesh) with **custom text channels** (host-managed, synced to members)
- Roles: owner / admin / moderator / member
- Group DMs with ownership transfer and kick
- Friends list, user profiles (about me, status, member-since), per-user volume
- **Custom profile badges** — up to 5, shown in chat, the member list and profile cards

### Voice & Video
- Voice channels (Discord-style auto-join mesh) and 1:1 / group calls
- Screen sharing with **source picker** (Electron), **resolution up to 4K and 15/30/60 FPS**
- **Screen audio mixing** with its own mute and volume, adjustable mid-share
- Noise gate with input sensitivity, high-pass filter, mic boost, master volume
- Push-to-talk, mute/deafen, per-peer volume, live mic level meter
- Spotlight view — click a video tile to focus it
- Connection quality (ping) indicators
- **TURN relay support** for peers that cannot reach each other directly, with a
  one-click free public relay preset

### Quality of Life
- **Custom window chrome** — Discord-style title bar with its own minimize, maximize and close
- **Auto-away** — an Online status flips to Idle after a configurable delay and back on activity
- **7 built-in themes plus a full custom palette editor** (13 colours, live preview)
- **Three synthesised sound packs** — Chime, Bubble and Retro, each previewable per event
- **Configurable keybinds** for mute, deafen, camera, screen share, hang up and notifications,
  optionally registered with the OS so they work while the app is in the background
- Notification settings with a one-click **mute-everything** toggle, plus DND support
- **Desktop notifications for incoming calls**, not just messages
- **System tray** — closing keeps you connected; quit from the tray menu (can be turned off)
- **Auto-update** for the desktop build, with an in-app download and restart prompt
- Account backup & restore (identity, servers, friends, channels)
- Signaling-server reconnect banner — existing chats keep working while it reconnects

## 🛠️ Technology Stack
- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite 7
- **Network Layer:** WebRTC (PeerJS)
- **Desktop:** Electron + electron-updater
- **Mobile:** Capacitor (Android)

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm (v9+)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Clypus/P2PChat.git
   cd P2PChat
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

### Desktop (Electron)
```bash
# Development (Vite + Electron together)
npm run electron:dev

# Production build (NSIS installer / AppImage)
npm run electron:build

# Build and publish a release that auto-update clients will pick up
npm run electron:publish
```

Auto-update uses the GitHub provider configured in `package.json`. Publishing
needs a `GH_TOKEN` with repo access in your environment.

### Checks
```bash
npm run lint       # ESLint across all TS/TSX, JS and the Electron entry points
npm run typecheck  # tsc --noEmit
npm run build      # production web bundle
```

## 📱 Mobile Development (Capacitor)
```bash
# Build web assets first
npm run build

# Sync web assets to Android
npx cap sync android

# Open Android Studio to build and run the app
npx cap open android
```

## 🔐 Security Notes
- Messages are E2E encrypted per-peer (ECDH + AES-GCM); the PeerJS broker only relays signaling.
- **Long-term identity keys.** Each install generates one ECDH key pair, kept in IndexedDB with
  a non-extractable private key. Peers are pinned on first use, and a changed key raises a
  warning in the chat rather than passing silently.
- **Safety numbers.** Every conversation derives an eight-group number from both public keys.
  Read it to each other over a channel you already trust; matching numbers rule out anyone
  relaying between you. Open it from the chat header or the connection info panel.
- All rendered message HTML passes through an allowlist sanitizer (`src/utils/sanitize.ts`).
  Remote media is limited to `https:` so no request is downgraded.
- A message is only accepted if its claimed sender matches the peer that delivered it.
  History sync batches are shape-checked, size-capped, and restricted to senders the
  relaying peer can vouch for.
- Reactions are attributed to the connection they arrive on, not to a field in the payload.
- Pins, edits, deletes, role changes, group kicks and channel lists are all authorization-checked.
- Incoming messages are rate-limited, and file transfers are capped by size and concurrency.
- Electron runs with `contextIsolation`, no `nodeIntegration`, a strict CSP, a narrow preload
  bridge, and navigation/window-open handlers that push external links to the OS browser.

## 🤝 Contributing
Contributions, issues, and feature requests are welcome!

## 📄 License
This project is open-source and available under the MIT License.
