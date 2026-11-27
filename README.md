# xlab-bash — Self-Hosted Mobile-First Web SSH Terminal

A pure-black, full-viewport web SSH terminal built for Android and desktop browsers. Connects directly to your Proxmox VE nodes, Linux servers, or containers over real `ssh2` PTY sessions streamed via WebSocket — no VNC, no WebRTC.

## Key Features

- **Real Interactive SSH PTY**: `xterm.js` (`xterm-256color`, 10,000-line scrollback, fit, web-links, search) piped directly into `ssh2` over WebSocket with vibrant Fish-inspired terminal color themes (`Fish Vivid`, `Fish Aurora`, `Fish Sunset`, `OLED Classic`). Works seamlessly with `vim`, `htop`, `nano`, and `tmux`.
- **Built-In 5-Row Developer Keyboard**: Large, ergonomic on-screen PC keyboard (numbers, QWERTY, `Ctrl`, `Shift`, `Alt`, `Fn/Sym`, arrows, `Home`/`End`/`PgUp`/`PgDn`) with `inputmode="none"` to suppress the Android system keyboard, sticky/double-tap-lock modifiers, hold-to-repeat, spacebar swipe cursor scrubbing, key-preview popups, haptic feedback, and a JSON layout editor.
- **Quick Bar & Snippets**: One-tap shell combos (`Esc`, `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+L`, `Ctrl+R`, `Ctrl+A`, `Ctrl+E`, `Tab`, `|`, `~`, `/`, `$`) plus a swipeable row of user-defined snippets (`qm list`, `pct list`, `systemctl status`, `docker ps`, `journalctl -f`, `htop`, etc.).
- **Encrypted Host Vault**: Saved hosts (password or PEM/OpenSSH private key) stored in SQLite at `/data` with AES-256-GCM encryption via `ENCRYPTION_KEY`. Credentials never touch `localStorage`.
- **Host Key Verification & Auto-Reconnect**: Displays SHA-256 host key fingerprints on first connect (and warns if a host key changes), supports multiple session tabs, and automatically reconnects dropped sessions.
- **Installable PWA**: Full-screen standalone mode on Android and iOS with zero browser chrome.

---

## Quick Start (Docker Compose)

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials and keys:

```bash
cp .env.example .env
```

Generate strong random keys for `ENCRYPTION_KEY` and `JWT_SECRET`:

```bash
openssl rand -hex 32   # use for ENCRYPTION_KEY
openssl rand -hex 32   # use for JWT_SECRET
```

Edit `.env`:

```env
PORT=8022
DATA_DIR=/data
APP_USERNAME=admin
APP_PASSWORD=your-strong-app-password
ENCRYPTION_KEY=<64-char-hex-from-openssl>
JWT_SECRET=<64-char-hex-from-openssl>
TRUST_PROXY=1
```

### 2. Build and Run

```bash
mkdir -p data
docker compose up -d --build
```

xlab-bash will listen on port **8022** (`http://<server-ip>:8022`) and persist its SQLite database in `./data`.

---

## Reverse Proxy Setup (Caddy)

Caddy automatically handles HTTPS certificates and WebSocket upgrades:

```caddyfile
ssh.example.com {
    reverse_proxy 127.0.0.1:8022 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

Ensure `TRUST_PROXY=1` is set in `.env` so xlab-bash accurately applies login rate limiting per client IP using `X-Forwarded-For`.

---

## Installing as a Full-Screen App on Android (PWA)

1. Open your HTTPS xlab-bash URL (e.g. `https://ssh.example.com`) in Chrome on Android.
2. Tap **Install App** in the xlab-bash header or Settings panel (or Chrome Menu → *Add to Home screen*).
3. Launch xlab-bash from your home screen for true full-screen OLED black terminal mode without browser bars.

---

## Mobile Controls & Gestures

- **Switch Keyboard Mode**: Tap the keyboard icon in the top bar to cycle between **Built-in Dev Keyboard**, **Native Phone Keyboard**, and **Hidden**.
- **Sticky Modifiers**: Tap `Ctrl`, `Alt`, or `Shift` once for one-shot; double-tap to lock; tap again to release.
- **Cursor Scrubbing**: Swipe left or right across the `Space` bar to move the terminal cursor precisely.
- **Zoom Font Size**: Pinch in/out with two fingers on the terminal or use `-` / `+` in the toolbar/settings.
- **Copy & Paste**: Select text to copy automatically; long-press on the terminal viewport to paste.

---

## Local Development

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3000`.
