<h1 align="center">xlab-bash</h1>

<p align="center">
  <img src="public/icon.svg" width="128" alt="xlab-bash logo">
</p>

<p align="center"><b>A real SSH terminal for your phone, served from your own server.</b></p>

<p align="center"><a href="#install">Install</a> · <a href="#key-features">Features</a> · <a href="#login--security">Security</a> · <a href="#reverse-proxy-caddy">Caddy</a> · <a href="#mobile-controls--gestures">Gestures</a> · <a href="#uninstall">Uninstall</a></p>

Self-hosted, mobile-first web SSH terminal & PWA with a pure-black full-screen terminal, a built-in developer keyboard, an encrypted host vault and secure login. Built for driving Proxmox nodes, LXC containers and Linux servers from an Android phone.

[![Docker image](https://github.com/CJNG20u/xlab-bash/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/CJNG20u/xlab-bash/pkgs/container/xlab-bash)

🐳 **Docker image:** `ghcr.io/cjng20u/xlab-bash:latest` (amd64 + arm64)

```bash
docker pull ghcr.io/cjng20u/xlab-bash:latest
```

## Why xlab-bash?

SSH on a phone usually means a choice between two bad options. Terminal apps like Termux or JuiceSSH depend on the phone's own keyboard, which has no real `Ctrl`, `Esc`, `Tab` or arrow keys, so `vim`, `htop` and `tmux` become a fight. Browser consoles like noVNC or WebRTC-based remote desktops stream pixels, which is laggy, blurry and heavy on mobile data.

**xlab-bash** takes a text-first approach:
- **Real PTY, not pixels:** The server opens a genuine `ssh2` shell and streams plain text over one WebSocket. `xterm.js` renders it locally, so it's sharp at any zoom, fast on a weak signal, and copy/paste works like text.
- **A keyboard made for shells:** A built-in developer keyboard replaces the Android keyboard with sticky `Ctrl`/`Alt`/`Shift`, arrows, `Home`/`End`/`PgUp`/`PgDn`, a quick bar for `Ctrl+C` / `Ctrl+R` / `Tab`, and one-tap snippets like `qm list` and `pct list`.
- **Your hosts, your server:** Saved hosts and private keys stay encrypted (AES-256-GCM) in SQLite on your own box. Nothing is stored in the browser and nothing goes through a third-party relay.
- **One small container:** One Node.js process, one `./data` folder, no database server and no agents on the target machines; anything that runs `sshd` works.

---

## Key Features

- **Real Interactive SSH PTY**: `xterm.js` (`xterm-256color`, 10,000-line scrollback, fit, clickable links, search) piped into `ssh2` over WebSocket, with Fish-inspired color themes (`Fish Vivid`, `Fish Aurora`, `Fish Sunset`, `OLED Classic`). Works with `vim`, `htop`, `nano` and `tmux`.
- **Built-In Developer Keyboard**: Large on-screen PC-style keyboard with a `123` toggle, `Ctrl`, `Shift`, `Alt`, `Fn/Sym`, arrows and navigation keys. Uses `inputmode="none"` to keep the Android keyboard away, with sticky/double-tap-lock modifiers, hold-to-repeat, spacebar swipe cursor scrubbing, key-preview popups, haptics, and a JSON layout editor.
- **Quick Bar & Snippets**: One-tap shell combos (`Esc`, `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+L`, `Ctrl+R`, `Ctrl+A`, `Ctrl+E`, `Tab`, `|`, `~`, `/`, `$`) plus a swipeable row of your own snippets (`qm list`, `pct list`, `systemctl status`, `docker ps`, `journalctl -f`, `htop`…).
- **Encrypted Host Vault**: Saved hosts (password or PEM/OpenSSH private key with passphrase) stored in SQLite with AES-256-GCM encryption. Credentials never touch `localStorage`.
- **Host Key Verification**: Shows the SHA-256 host key fingerprint on first connect and warns loudly if a host key changes.
- **Multiple Tabs & Auto-Reconnect**: Several sessions side by side; dropped connections reconnect automatically (pair with `tmux` to pick up exactly where you left off).
- **Built-in Login**: A sign-in screen protects the app and every SSH stream. Passwords are hashed with scrypt, logins are rate limited, and terminal WebSockets need a short-lived single-use ticket.
- **Installable PWA**: Full-screen standalone mode on Android and iOS with zero browser chrome.

---

## Install

Every xlab app installs and updates the same way: one folder, one `docker-compose.yml`, one `.env`, your data in `./data`.

```bash
mkdir -p /opt/xlab-bash && cd /opt/xlab-bash
curl -fsSLO https://raw.githubusercontent.com/CJNG20u/xlab-bash/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/CJNG20u/xlab-bash/main/.env.example -o .env
docker compose up -d
```

Open `http://<host-ip>:8022`. On first visit you create the admin account (see [Login & Security](#login--security)).

No keys to generate: on first start xlab-bash creates its encryption key and session secret and keeps them in `./data/secrets.json`. Everything in `.env` is optional.

## Update

```bash
cd /opt/xlab-bash
docker compose pull && docker compose up -d
```

Images are built automatically for `linux/amd64` and `linux/arm64`. `:latest` follows `main`; every release also gets version tags (for example `:1.0.0`, `:1`), so you can pin one with `image: ghcr.io/cjng20u/xlab-bash:1.0.0`.

## Uninstall

```bash
cd /opt/xlab-bash
docker compose down
docker image rm ghcr.io/cjng20u/xlab-bash:latest
```

Your saved hosts, snippets and layouts stay in `/opt/xlab-bash/data`. To remove everything, including the encrypted vault, also run:

```bash
rm -rf /opt/xlab-bash
```

## Build from source

```bash
git clone https://github.com/CJNG20u/xlab-bash.git
cd xlab-bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

---

## Login & Security

xlab-bash is a remote shell, so treat it like one. The first time you open it, it asks you to create an admin account (password of at least 10 characters). After that, the app and every SSH stream need a sign-in. You stay signed in for 7 days on each device.

**Open it right after you start the container.** Until the account exists, whoever reaches the page first can create it. To skip that, set the account in `.env` instead:

```env
APP_USERNAME=admin
APP_PASSWORD=choose-a-long-password
```

| Variable | What it does |
| --- | --- |
| `APP_USERNAME` / `APP_PASSWORD` | Fixed admin login from the environment. When set, the first-run screen is skipped. |
| `ENCRYPTION_KEY` | Key for the host vault. Optional: generated and saved in `data/secrets.json` if empty. If you set it, never change it, or saved passwords/keys can't be decrypted. |
| `JWT_SECRET` | Signs login sessions. Optional: generated and saved in `data/secrets.json` if empty. Changing it signs everyone out. |
| `TRUST_PROXY` | Number of reverse proxies in front (Caddy, Cloudflare Tunnel). Lets rate limiting see real IPs and lets xlab-bash detect HTTPS. Set `0` for direct LAN access only. |
| `ALLOWED_ORIGINS` | Only needed if your proxy rewrites the `Host` header and the terminal fails to connect (403 on `/ws/ssh`). Comma-separated hostnames, e.g. `ssh.example.com`. |

What's protected:

- Saved SSH passwords, private keys and passphrases are encrypted at rest with AES-256-GCM.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` whenever you reach the app over HTTPS.
- Terminal WebSockets check the page's origin, so another website can't open a shell using your login.
- Login attempts are rate limited per IP (12 per 15 minutes).

**Forgot your password?** Set `APP_USERNAME` and `APP_PASSWORD` in `.env` and run `docker compose up -d`; the environment login takes over. Your saved hosts are not touched.

Login protects access, but it doesn't encrypt traffic. For use outside your home network, put xlab-bash behind HTTPS and ideally an extra access layer such as mTLS, a VPN (Tailscale/WireGuard) or Cloudflare Access.

---

## Reverse Proxy (Caddy)

Installing the PWA and using the clipboard need HTTPS. Caddy handles certificates and WebSocket upgrades automatically:

```caddyfile
ssh.example.com {
    reverse_proxy 127.0.0.1:8022
}
```

Keep `TRUST_PROXY=1` in `.env` (see [Login & Security](#login--security)).

---

## Installing as a Full-Screen App on Android (PWA)

1. Open your HTTPS xlab-bash URL (e.g. `https://ssh.example.com`) in Chrome on Android.
2. Tap **Install App** in the header or Settings panel (or Chrome menu → *Add to Home screen*).
3. Launch xlab-bash from your home screen for full-screen OLED-black terminal mode without browser bars.

---

## Mobile Controls & Gestures

- **Switch Keyboard Mode**: Tap the keyboard icon in the top bar to cycle between **Built-in Dev Keyboard**, **Native Phone Keyboard**, and **Hidden**.
- **Sticky Modifiers**: Tap `Ctrl`, `Alt`, or `Shift` once for one-shot; double-tap to lock; tap again to release.
- **Cursor Scrubbing**: Swipe left or right across the `Space` bar to move the terminal cursor precisely.
- **Zoom Font Size**: Pinch with two fingers on the terminal or use `-` / `+` in the toolbar or settings.
- **Copy & Paste**: Select text to copy automatically; long-press on the terminal to paste.

---

## Storage Layout

```text
/data/
├── termdock.db      # SQLite: hosts (encrypted secrets), known host keys, snippets, layouts, settings
└── secrets.json     # Auto-generated vault key + session secret (only if not set in .env)
```

Back up the whole `data` folder together: the database is useless without `secrets.json` (or your `ENCRYPTION_KEY`).

---

## Local Development

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3000` with Express API routes and Vite middleware mounted together.

## License

MIT
