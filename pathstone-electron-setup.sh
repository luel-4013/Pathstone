#!/usr/bin/env bash
#
# pathstone-electron-setup.sh
#
# Prompt-based setup and packaging for the Pathstone Electron desktop app.
#
# The script asks before it changes files, installs dependencies, runs tests,
# builds installers, commits, or launches the app. Run it with no arguments
# from the Pathstone checkout and answer the prompts.
#
# It does not install system packages, push, or sign builds.

set -Eeuo pipefail

FORCE=0
SKIP_INSTALL=0
SKIP_TEST=0
COMMIT=0
NO_BRANCH=0
ASSUME_YES=0
PROJECT_DIR=""

usage() {
  cat <<'EOF'
Usage: pathstone-electron-setup.sh [options] [PATHSTONE_DIR]

Run without options for the interactive prompts.

Options:
  -y, --yes        Accept the default answer for every prompt
      --force      Overwrite existing desktop files without asking
      --skip-install  Do not install or update npm dependencies
      --skip-test     Do not run the test suite
      --commit     Commit the setup and packaging changes without asking
      --no-branch  Stay on the current branch
  -h, --help       Show this help

If PATHSTONE_DIR is omitted, the current directory is used.

Packaging uses Electron Forge through scripts/package-desktop.js and can build:
  Linux    AppImage, .deb, .rpm, .zip
  Windows  Squirrel Setup.exe, .zip
  macOS    .dmg, .zip

Targets that need tools missing from this host are skipped and explained.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1 ;;
    --force) FORCE=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-test) SKIP_TEST=1 ;;
    --commit) COMMIT=1 ;;
    --no-branch) NO_BRANCH=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    *) PROJECT_DIR="$1" ;;
  esac
  shift
done

if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR="$(pwd)"
fi

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Directory not found: $PROJECT_DIR" >&2
  exit 1
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

if [ "$(id -u)" -eq 0 ]; then
  echo "Do not run this as root. Use a normal user; sudo only for system packages." >&2
  exit 1
fi

if [ ! -f "$PROJECT_DIR/package.json" ] || [ ! -f "$PROJECT_DIR/server.py" ] || [ ! -d "$PROJECT_DIR/js" ]; then
  echo "Not a Pathstone checkout: $PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"

if ! node -e 'const p=require("./package.json"); if (p.name !== "pathstone") process.exit(1)' 2>/dev/null; then
  echo "package.json does not look like Pathstone (name must be \"pathstone\")." >&2
  exit 1
fi

missing=0
for cmd in node npm git python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  cat >&2 <<'EOF'

Install the missing tools first.

Manjaro/Arch:
  sudo pacman -S --needed nodejs npm git python base-devel squashfs-tools fuse2

Debian/Ubuntu:
  sudo apt update
  sudo apt install -y nodejs npm git python3 build-essential squashfs-tools libfuse2

Optional makers:
  Manjaro/Arch: sudo pacman -S --needed dpkg fakeroot rpm-tools zip imagemagick
  Debian/Ubuntu: sudo apt install -y dpkg fakeroot rpm zip imagemagick

Windows Squirrel installers on Linux also need mono and wine.
Node must be >= 22.13.0. On older Debian/Ubuntu:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
EOF
  exit 1
fi

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node ${process.versions.node} is too old; need >= 22.13.0`);
  process.exit(1);
}
'

HOST_OS="$(node -p 'process.platform')"

# Older Pathstone test revisions assert on the plan-check UI, which changes
# after 17:00 local. Run the suite at a fixed 10:00 local time so the result
# does not depend on when this script happens to run.
TEST_TZ="XXX$(printf '%+d' "$(( $(date -u +%H) - 10 ))")"

ask_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local reply

  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    [ "$default" = "y" ]
    return
  fi

  while :; do
    if [ "$default" = "y" ]; then
      read -r -p "$prompt [Y/n] " reply || reply=""
    else
      read -r -p "$prompt [y/N] " reply || reply=""
    fi
    reply="${reply:-$default}"
    case "$reply" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) printf 'Please answer y or n.\n' ;;
    esac
  done
}

choose_platform() {
  local choice

  PACKAGE_PLATFORM=""
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    PACKAGE_PLATFORM="all"
    return 0
  fi

  cat <<'EOF'

Which packages should be built?
  1) Linux    AppImage, .deb, .rpm, .zip
  2) Windows  Squirrel Setup.exe, .zip
  3) macOS    .dmg, .zip
  4) All targets this host can build
  5) Do not build packages
EOF

  while :; do
    read -r -p "Selection [4]: " choice || choice=""
    choice="${choice:-4}"
    case "$choice" in
      1) PACKAGE_PLATFORM=linux; return 0 ;;
      2) PACKAGE_PLATFORM=win32; return 0 ;;
      3) PACKAGE_PLATFORM=darwin; return 0 ;;
      4) PACKAGE_PLATFORM=all; return 0 ;;
      5) return 1 ;;
      *) printf 'Enter 1-5.\n' ;;
    esac
  done
}

write_if_needed() {
  local file="$1"
  if [ -e "$file" ] && [ "$OVERWRITE" -ne 1 ]; then
    echo "==> Keeping existing $file"
    return 1
  fi
  echo "==> Writing $file"
  return 0
}

ensure_packaging_icons() {
  local missing=0
  local magick=""
  local tmp=""

  [ -f icons/icon-512.ico ] || missing=1
  [ -f icons/icon-512.icns ] || missing=1
  if [ "$missing" -eq 0 ]; then
    return 0
  fi

  if [ ! -f icons/icon-512.png ]; then
    echo "WARNING: icons/icon-512.png is missing; cannot generate Windows/macOS icons." >&2
    return 0
  fi

  if command -v magick >/dev/null 2>&1; then
    magick="magick"
  elif command -v convert >/dev/null 2>&1; then
    magick="convert"
  else
    echo "WARNING: icons/icon-512.ico or icons/icon-512.icns is missing." >&2
    echo "         Install imagemagick to generate them; Windows and macOS" >&2
    echo "         installers need them. Linux AppImage builds do not." >&2
    return 0
  fi

  if ! ask_yes_no "Windows/macOS icons are missing. Generate them with ImageMagick?" y; then
    echo "NOTE: Windows Squirrel and macOS DMG builds may fail without those icons."
    return 0
  fi

  echo "==> Generating Windows and macOS icons"
  if [ ! -f icons/icon-512.ico ]; then
    "$magick" icons/icon-512.png -define icon:auto-resize=256,128,64,48,32,16 icons/icon-512.ico
  fi
  if [ ! -f icons/icon-512.icns ]; then
    tmp="$(mktemp -d)"
    for size in 16 32 64 128 256 512; do
      "$magick" icons/icon-512.png -resize "${size}x${size}" "$tmp/${size}.png"
    done
    python3 - "$tmp" <<'PY'
import struct
import sys
from pathlib import Path

source = Path(sys.argv[1])
chunks = []
for kind, size in ((b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128), (b'ic08', 256), (b'ic09', 512)):
    data = (source / f'{size}.png').read_bytes()
    chunks.append(kind + struct.pack('>I', len(data) + 8) + data)
total = 8 + sum(len(chunk) for chunk in chunks)
Path('icons/icon-512.icns').write_bytes(b'icns' + struct.pack('>I', total) + b''.join(chunks))
PY
    rm -rf "$tmp"
  fi
  echo "    icons/icon-512.ico"
  echo "    icons/icon-512.icns"
}

cat <<EOF

Pathstone Electron setup and packaging
Project: $PROJECT_DIR

EOF

if ! ask_yes_no "Set up and package Pathstone in this checkout?" y; then
  echo "Cancelled."
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This is not a git repository. Clone Pathstone first." >&2
  exit 1
fi

DIRTY=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  DIRTY=1
  echo "Tracked files have uncommitted changes:"
  git status --short
  if ! ask_yes_no "Continue anyway? Branch switching will be skipped." n; then
    exit 1
  fi
fi

if [ "$NO_BRANCH" -eq 0 ] && [ "$DIRTY" -eq 0 ]; then
  CURRENT_BRANCH="$(git branch --show-current || true)"
  if [ "$CURRENT_BRANCH" != "desktop/electron" ]; then
    if git show-ref --verify --quiet refs/heads/desktop/electron; then
      if ask_yes_no "Switch to the existing desktop/electron branch?" y; then
        echo "==> Switching to branch desktop/electron"
        git switch desktop/electron
      fi
    else
      if ask_yes_no "Create and switch to branch desktop/electron?" y; then
        echo "==> Creating branch desktop/electron"
        git switch -c desktop/electron
      fi
    fi
  fi
fi

OVERWRITE=0
setup_files=(
  electron/main.js
  electron/sqlite-service.js
  forge.config.js
  scripts/packaging.js
  scripts/package-desktop.js
  tests/test_sqlite_service.js
)
existing=()
for file in "${setup_files[@]}"; do
  if [ -e "$file" ]; then existing+=("$file"); fi
done
if [ "${#existing[@]}" -gt 0 ]; then
  echo "Existing desktop files:"
  printf '  %s\n' "${existing[@]}"
  if [ "$FORCE" -eq 1 ] || ask_yes_no "Overwrite these files with the versions embedded in this script?" n; then
    OVERWRITE=1
  else
    echo "Keeping existing files. Missing files will still be created."
  fi
fi

INSTALL_DEPS=0
if [ "$SKIP_INSTALL" -eq 0 ]; then
  if ask_yes_no "Install/update npm dependencies (Electron Forge and makers)?" y; then
    INSTALL_DEPS=1
  fi
fi
if [ "$INSTALL_DEPS" -eq 1 ]; then
  echo "==> Installing baseline npm dependencies"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  echo "==> Adding Electron, Forge, and the packaging makers"
  npm install --save-dev \
    electron@45.3.2 \
    @electron-forge/cli@8.0.1 \
    @electron-forge/maker-deb@8.0.1 \
    @electron-forge/maker-dmg@8.0.1 \
    @electron-forge/maker-rpm@8.0.1 \
    @electron-forge/maker-squirrel@8.0.1 \
    @electron-forge/maker-zip@8.0.1 \
    @reforged/maker-appimage@6.0.0
fi

echo "==> Updating package.json"
node <<'NODE'
const fs = require('node:fs');
const file = 'package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.main = 'electron/main.js';
pkg.engines = { ...(pkg.engines || {}), node: '>=22.13.0' };
pkg.keywords = Array.from(new Set([...(pkg.keywords || []), 'electron', 'appimage', 'desktop']));
pkg.scripts = {
  ...pkg.scripts,
  'desktop:start': 'electron-forge start',
  'desktop:package': 'electron-forge package',
  'desktop:make': 'electron-forge make',
  'desktop:dist': 'node scripts/package-desktop.js',
  'desktop:dist:list': 'node scripts/package-desktop.js --list',
};

const sqliteTest = 'node tests/test_sqlite_service.js';
if (!String(pkg.scripts.test || '').includes(sqliteTest)) {
  pkg.scripts.test = `${pkg.scripts.test || 'node tests/test_pathstone.js'} && ${sqliteTest}`;
}

const ordered = {};
for (const key of ['name', 'version', 'description', 'license', 'author', 'repository', 'bugs', 'homepage', 'keywords', 'private', 'type', 'main', 'engines', 'scripts', 'devDependencies']) {
  if (pkg[key] !== undefined) ordered[key] = pkg[key];
}
for (const key of Object.keys(pkg)) if (!(key in ordered)) ordered[key] = pkg[key];
fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n');
NODE

echo "==> Updating .gitignore"
touch .gitignore
if [ -s .gitignore ] && [ "$(tail -c 1 .gitignore | wc -l)" -eq 0 ]; then
  printf '\n' >> .gitignore
fi
if ! grep -qxF '# Electron packaging and release outputs' .gitignore; then
  printf '\n# Electron packaging and release outputs\n' >> .gitignore
fi
for entry in '/out/' '/dist/' '/release/' '/artifacts/' '*.AppImage' '*.deb' '*.rpm' '*.dmg' '*.msi' '*.nupkg' '*.pkg' '*.snap' '*.flatpak' '.venv/'; do
  grep -qxF "$entry" .gitignore || printf '%s\n' "$entry" >> .gitignore
done

mkdir -p electron tests scripts

if write_if_needed electron/main.js; then
cat > electron/main.js <<'MAIN_JS'
'use strict';

/*
 * Pathstone desktop shell.
 *
 * The renderer is the same static app as the browser build. It is served
 * from app://pathstone (a secure, standard scheme) so IndexedDB, relative
 * URLs, and the /api/* contract all work exactly as they do over HTTP.
 *
 * The SQLite database lives in Electron's userData directory, not in the
 * app bundle. Unlike the browser/server build there is no Python process
 * and no listening socket: the main process answers /api/* directly from
 * `electron/sqlite-service.js`.
 */

const { app, BrowserWindow, dialog, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { VaultService, ApiError, MAX_BODY } = require('./sqlite-service');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'app://pathstone';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_FILE =
  /^(?:index\.html|styles\.css|manifest\.webmanifest|sw\.js|js\/[A-Za-z0-9._-]+\.js|icons\/[A-Za-z0-9._-]+\.(?:svg|png|ico))$/;

let mainWindow = null;
let vaultService = null;
let shuttingDown = false;

app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');
app.setAppUserModelId('org.pathstone.app');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function isAppUrl(target) {
  try {
    const url = new URL(target);
    return url.protocol === 'app:' && url.host === 'pathstone';
  } catch {
    return false;
  }
}

function resolveAsset(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return null;
  }

  if (!PUBLIC_FILE.test(rel)) return null;

  const candidate = path.resolve(ROOT, rel);
  const relative = path.relative(ROOT, candidate).split(path.sep).join('/');
  if (!relative || relative.startsWith('..')) return null;

  return candidate;
}

function baseHeaders() {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-cache',
  };
}

function jsonResponse(status, payload, headOnly = false) {
  const body = headOnly ? null : JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (body !== null) headers['content-length'] = String(Buffer.byteLength(body));
  return new Response(body, { status, headers });
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    throw new ApiError(413, 'payload too large');
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length > MAX_BODY) throw new ApiError(413, 'payload too large');
  if (buffer.length === 0) throw new ApiError(400, 'empty body');

  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApiError(400, 'body is not valid JSON');
  }
}

async function handleApi(request) {
  const url = new URL(request.url);
  const method = String(request.method || 'GET').toUpperCase();

  if (shuttingDown || !vaultService) {
    return jsonResponse(503, { error: 'database unavailable' });
  }

  try {
    let body;
    if (method === 'PUT' || method === 'POST') body = await readJsonBody(request);
    const result = vaultService.handle(method, url.pathname, body);
    return jsonResponse(result.status, result.payload, method === 'HEAD');
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error('[vault] API failure:', error);
    return jsonResponse(500, { error: 'internal error' });
  }
}

async function serveStatic(request) {
  const url = new URL(request.url);
  if (url.host !== 'pathstone') {
    return new Response('Not found', { status: 404, headers: baseHeaders() });
  }

  const file = resolveAsset(url.pathname);
  if (!file) {
    return new Response('Forbidden', { status: 403, headers: baseHeaders() });
  }

  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    return new Response('Not found', { status: 404, headers: baseHeaders() });
  }

  const headers = {
    ...baseHeaders(),
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': String(data.length),
  };

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(data, { status: 200, headers });
}

function hardenWebContents(contents) {
  if (contents.getType() !== 'window') return;

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  contents.on('will-redirect', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Pathstone',
    autoHideMenuBar: true,
    backgroundColor: '#14120f',
    icon: path.join(ROOT, 'icons/icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });

  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadURL(`${ORIGIN}/index.html`).catch((error) => {
    console.error('[pathstone] failed to load the app:', error);
  });

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

function configureDownloads() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const owner = BrowserWindow.fromWebContents(webContents);
    const suggested = item.getFilename() || 'pathstone-export.json';
    const filePath = dialog.showSaveDialogSync(owner, {
      title: 'Save Pathstone export',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!filePath) {
      event.preventDefault();
      return;
    }
    item.setSavePath(filePath);
  });
}

function configureSession() {
  const defaultSession = session.defaultSession;

  // Pathstone is offline-only. The renderer never needs a real HTTP origin.
  defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  );

  // The daily reminder is the only browser permission Pathstone requests.
  defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'notifications');
  });
  defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');

  configureDownloads();
}

async function bootstrap() {
  const dbPath = process.env.PATHSTONE_DB || path.join(app.getPath('userData'), 'pathstone.db');
  const legacyPath =
    process.env.PATHSTONE_LEGACY_DB || path.join(ROOT, 'data', 'pathstone.db');

  vaultService = new VaultService(dbPath, { legacyPath });
  console.log(`[vault] database ${dbPath}`);
  console.log(`[vault] legacy source ${legacyPath}`);

  app.once('will-quit', () => {
    shuttingDown = true;
    if (vaultService) {
      vaultService.close();
    }
  });

  configureSession();
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'pathstone') {
      return new Response('Not found', { status: 404, headers: baseHeaders() });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request);
    }
    return serveStatic(request);
  });

  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[pathstone] startup failed:', error);
    dialog.showErrorBox(
      'Pathstone could not start',
      `The local database could not be opened.\n\n${error.message || error}`
    );
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && vaultService) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
MAIN_JS
fi

if write_if_needed electron/sqlite-service.js; then
cat > electron/sqlite-service.js <<'SQLITE_JS'
'use strict';

/*
 * Embedded Pathstone vault storage for the Electron shell.
 *
 * This is the desktop equivalent of server.py's SQLite layer: the same
 * tables, the same JSON records, and the same /api/vault + /api/snapshots
 * contract. It uses Node's built-in `node:sqlite` module, so the packaged
 * app stays self-contained — no Python, no sidecar process, no network
 * listener, and no data outside the app's userData directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MAX_BODY = 32 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const SAFE_KINDS = new Set(['auto', 'manual', 'pre']);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vault (
    id TEXT PRIMARY KEY,
    saved_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_saved ON snapshots(saved_at);
`;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSavedAt(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 ? value : nowIso();
}

function parseState(text) {
  const state = JSON.parse(text);
  if (!isPlainObject(state)) throw new Error('state is not an object');
  return state;
}

class VaultService {
  constructor(dbPath, options = {}) {
    if (!dbPath) throw new Error('a database path is required');

    this.dbPath = path.resolve(dbPath);
    this.legacyPath = options.legacyPath ? path.resolve(options.legacyPath) : null;
    this.logger = options.logger || console;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=3000');
    this.db.exec(SCHEMA);

    this.migrateLegacy();
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  /* ---- first-run migration from the browser/server database ---- */

  migrateLegacy() {
    if (!this.legacyPath || this.legacyPath === this.dbPath) return;
    if (!fs.existsSync(this.legacyPath)) return;

    const vaultCount = this.db.prepare('SELECT COUNT(*) AS n FROM vault').get().n;
    const snapshotCount = this.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n;
    if (Number(vaultCount) > 0 || Number(snapshotCount) > 0) return;

    let legacy = null;
    try {
      legacy = new DatabaseSync(this.legacyPath, { timeout: 5000 });
      legacy.exec('PRAGMA query_only=ON');

      const tables = new Set(
        legacy
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name)
      );

      let vault = null;
      if (tables.has('vault')) {
        const row = legacy.prepare("SELECT saved_at, json FROM vault WHERE id = 'current'").get();
        if (row) {
          try {
            vault = { savedAt: row.saved_at, state: parseState(row.json) };
          } catch {
            this.logger.warn('[vault] skipping unreadable legacy vault row');
          }
        }
      }

      const snapshots = [];
      if (tables.has('snapshots')) {
        for (const row of legacy.prepare('SELECT id, kind, saved_at, json FROM snapshots').all()) {
          try {
            if (!SAFE_ID.test(String(row.id)) || !SAFE_KINDS.has(String(row.kind))) continue;
            snapshots.push({
              id: String(row.id),
              kind: String(row.kind),
              savedAt: String(row.saved_at),
              state: parseState(row.json),
            });
          } catch {
            this.logger.warn('[vault] skipping unreadable legacy snapshot row');
          }
        }
      }

      if (!vault && snapshots.length === 0) return;

      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (vault) {
          this.db
            .prepare(
              `INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)
               ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, json = excluded.json`
            )
            .run(vault.savedAt, JSON.stringify(vault.state));
        }
        const insertSnapshot = this.db.prepare(
          `INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, saved_at = excluded.saved_at, json = excluded.json`
        );
        for (const snapshot of snapshots) {
          insertSnapshot.run(
            snapshot.id,
            snapshot.kind,
            snapshot.savedAt,
            JSON.stringify(snapshot.state)
          );
        }
        this.db.exec('COMMIT');
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* transaction may already be gone */
        }
        throw error;
      }

      this.logger.info(
        `[vault] imported legacy database ${this.legacyPath} (${vault ? 1 : 0} vault, ${snapshots.length} snapshots)`
      );
    } catch (error) {
      this.logger.warn(`[vault] legacy import skipped: ${error.message}`);
    } finally {
      if (legacy) {
        try {
          legacy.close();
        } catch {
          /* already closed */
        }
      }
    }
  }

  /* ---- vault ---- */

  readVault() {
    const row = this.db
      .prepare("SELECT saved_at, json FROM vault WHERE id = 'current'")
      .get();
    if (!row) return { record: null };
    return { record: { savedAt: row.saved_at, state: parseState(row.json) } };
  }

  writeVault(body) {
    if (!isPlainObject(body)) throw new ApiError(400, 'body is not a JSON object');
    if (!isPlainObject(body.state)) throw new ApiError(400, 'missing state');

    const savedAt = normalizeSavedAt(body.savedAt);
    this.db
      .prepare(
        `INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)
         ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, json = excluded.json`
      )
      .run(savedAt, JSON.stringify(body.state));
    return { savedAt };
  }

  /* ---- snapshots ---- */

  listSnapshots() {
    const rows = this.db
      .prepare('SELECT id, kind, saved_at FROM snapshots ORDER BY saved_at DESC')
      .all();
    return {
      records: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        savedAt: row.saved_at,
      })),
    };
  }

  writeSnapshot(body) {
    if (!isPlainObject(body)) throw new ApiError(400, 'body is not a JSON object');

    const id = body.id;
    const kind = body.kind;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new ApiError(400, 'bad id');
    if (typeof kind !== 'string' || !SAFE_KINDS.has(kind)) throw new ApiError(400, 'bad kind');
    if (!isPlainObject(body.state)) throw new ApiError(400, 'missing state');

    const savedAt = normalizeSavedAt(body.savedAt);
    this.db
      .prepare(
        `INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, saved_at = excluded.saved_at, json = excluded.json`
      )
      .run(id, kind, savedAt, JSON.stringify(body.state));
    return { id };
  }

  readSnapshot(id) {
    const row = this.db
      .prepare('SELECT id, kind, saved_at, json FROM snapshots WHERE id = ?')
      .get(id);
    if (!row) return { record: null };
    return {
      record: {
        id: row.id,
        kind: row.kind,
        savedAt: row.saved_at,
        state: parseState(row.json),
      },
    };
  }

  deleteSnapshot(id) {
    const result = this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
    return { deleted: Number(result.changes) > 0 };
  }

  /* ---- routing, mirroring server.py's /api surface ---- */

  handle(method, pathname, body) {
    const verb = String(method || 'GET').toUpperCase();

    if (pathname === '/api/vault') {
      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.readVault() };
      if (verb === 'PUT') return { status: 200, payload: this.writeVault(body) };
      throw new ApiError(405, 'method not allowed');
    }

    if (pathname === '/api/snapshots') {
      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.listSnapshots() };
      if (verb === 'POST') return { status: 200, payload: this.writeSnapshot(body) };
      throw new ApiError(405, 'method not allowed');
    }

    if (pathname.startsWith('/api/snapshots/')) {
      const parts = pathname.split('/');
      if (parts.length !== 4 || parts[1] !== 'api' || parts[2] !== 'snapshots') {
        throw new ApiError(400, 'bad snapshot path');
      }

      let id;
      try {
        id = decodeURIComponent(parts[3]);
      } catch {
        throw new ApiError(400, 'bad snapshot id');
      }
      if (!SAFE_ID.test(id)) throw new ApiError(400, 'bad snapshot id');

      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.readSnapshot(id) };
      if (verb === 'DELETE') return { status: 200, payload: this.deleteSnapshot(id) };
      throw new ApiError(405, 'method not allowed');
    }

    throw new ApiError(404, 'not found');
  }
}

module.exports = {
  VaultService,
  ApiError,
  MAX_BODY,
  SAFE_ID,
  SAFE_KINDS,
};
SQLITE_JS
fi

if write_if_needed forge.config.js; then
cat > forge.config.js <<'FORGE_CONFIG'
'use strict';

const { getMakers } = require('./scripts/packaging');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Pathstone',
    appBundleId: 'org.pathstone.app',
    appCategoryType: 'public.app-category.productivity',
    executableName: 'pathstone',
    icon: 'icons/icon-512.png',
    appCopyright: 'MIT licensed.',
    win32metadata: {
      CompanyName: 'Pathstone',
      FileDescription: 'Local-first task and project planner',
      ProductName: 'Pathstone',
      InternalName: 'pathstone',
      OriginalFilename: 'pathstone.exe',
      'requested-execution-level': 'asInvoker',
    },
    ignore: [
      /^\/data(\/|$)/,
      /^\/tests(\/|$)/,
      /^\/scripts(\/|$)/,
      /^\/server\.py$/,
      /^\/forge\.config\.js$/,
      /^\/\.git(\/|$)/,
      /^\/\.github(\/|$)/,
      /^\/\.venv(\/|$)/,
      /^\/out(\/|$)/,
      /^\/dist(\/|$)/,
      /^\/release(\/|$)/,
      /^\/artifacts(\/|$)/,
      /^\/node_modules\/\.cache(\/|$)/,
      /^\/_app\.js$/,
      /^\/_body\.html$/,
      /^\/mock\.html$/,
      /^\/DB_POSTMORTEM\.md$/,
      /^\/POSTMORTEM\.md$/,
      /^\/README\.md$/,
      /^\/package-lock\.json$/,
      /^\/\.editorconfig$/,
      /^\/\.gitattributes$/,
      /^\/\.gitignore$/,
    ],
  },
  makers: getMakers(),
};
FORGE_CONFIG
fi

if write_if_needed scripts/packaging.js; then
cat > scripts/packaging.js <<'PACKAGING_JS'
'use strict';

/*
 * Shared desktop packaging metadata.
 *
 * `forge.config.js` uses getMakers() to expose only the makers that can run
 * on this host, and scripts/package-desktop.js uses getBuildPlan() to explain
 * which artifacts a target platform will produce and which tools are missing.
 *
 * Makers are selected in three layers:
 *   1. the maker must support the target platform;
 *   2. the current host must be able to run that maker;
 *   3. the required external tools must be installed.
 *
 * This keeps `electron-forge make --platform ...` from failing merely because
 * an optional maker (deb, rpm, dmg, Squirrel) has no toolchain on this host.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const HOST_PLATFORM = process.platform;
const TARGET_PLATFORMS = ['linux', 'win32', 'darwin'];
const TARGET_ARCHES = ['x64', 'arm64'];

const COMMON = {
  name: 'pathstone',
  productName: 'Pathstone',
  genericName: 'Local-first task and project planner',
  description: pkg.description,
  homepage: pkg.homepage,
  license: pkg.license,
  bin: 'pathstone',
  categories: ['Office', 'Utility'],
};

function commandAvailable(command) {
  if (HOST_PLATFORM === 'win32') {
    return (
      spawnSync('where', [command], {
        stdio: 'ignore',
        windowsHide: true,
      }).status === 0
    );
  }

  return (
    spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], {
      stdio: 'ignore',
    }).status === 0
  );
}

function hostSupports(maker) {
  return !maker.hosts || maker.hosts.includes(HOST_PLATFORM);
}

function requiredTools(maker) {
  return typeof maker.tools === 'function' ? maker.tools() : maker.tools || [];
}

function missingTools(maker) {
  return requiredTools(maker).filter((command) => !commandAvailable(command));
}

const MAKER_DEFS = [
  {
    key: 'appimage',
    label: 'AppImage',
    name: '@reforged/maker-appimage',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['mksquashfs'],
    installHint: 'squashfs-tools',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        bin: COMMON.bin,
        genericName: COMMON.genericName,
        categories: COMMON.categories,
        icon: 'icons/icon-512.png',
        keywords: ['tasks', 'projects', 'planner', 'local-first', 'offline'],
      },
    },
  },
  {
    key: 'deb',
    label: 'Debian/Ubuntu .deb',
    name: '@electron-forge/maker-deb',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['dpkg-deb', 'fakeroot'],
    installHint: 'dpkg fakeroot',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        genericName: COMMON.genericName,
        description: COMMON.description,
        maintainer: 'luel-4013 <luelworkneh@gmail.com>',
        homepage: COMMON.homepage,
        bin: COMMON.bin,
        icon: 'icons/icon-512.png',
        categories: COMMON.categories,
      },
    },
  },
  {
    key: 'rpm',
    label: 'Fedora/RHEL .rpm',
    name: '@electron-forge/maker-rpm',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['rpmbuild'],
    installHint: 'rpm-build (rpm-tools on Arch)',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        genericName: COMMON.genericName,
        description: COMMON.description,
        license: COMMON.license,
        homepage: COMMON.homepage,
        bin: COMMON.bin,
        icon: 'icons/icon-512.png',
        categories: COMMON.categories,
        compressionLevel: 9,
      },
    },
  },
  {
    key: 'squirrel',
    label: 'Windows Squirrel installer',
    name: '@electron-forge/maker-squirrel',
    platforms: ['win32'],
    hosts: ['win32', 'linux'],
    tools: () => (HOST_PLATFORM === 'win32' ? [] : ['mono', 'wine']),
    installHint: 'mono wine',
    config: {
      name: COMMON.name,
      authors: 'luel-4013',
      description: COMMON.description,
      setupIcon: path.join(ROOT, 'icons/icon-512.ico'),
      setupExe: `Pathstone-${pkg.version}-Setup.exe`,
      noMsi: true,
    },
  },
  {
    key: 'dmg',
    label: 'macOS .dmg',
    name: '@electron-forge/maker-dmg',
    platforms: ['darwin'],
    hosts: ['darwin'],
    tools: ['hdiutil'],
    installHint: 'macOS',
    config: {
      title: 'Pathstone',
      icon: path.join(ROOT, 'icons/icon-512.icns'),
    },
  },
  {
    key: 'zip',
    label: 'Portable .zip',
    name: '@electron-forge/maker-zip',
    platforms: ['linux', 'win32', 'darwin'],
    hosts: null,
    tools: () => (HOST_PLATFORM === 'win32' ? [] : ['zip']),
    installHint: 'zip',
    config: {},
  },
];

function getMakers() {
  return MAKER_DEFS.filter((maker) => hostSupports(maker) && missingTools(maker).length === 0).map(
    (maker) => ({
      name: maker.name,
      platforms: maker.platforms.slice(),
      ...(maker.config ? { config: { ...maker.config } } : {}),
    })
  );
}

function getBuildPlan(platform) {
  const relevant = MAKER_DEFS.filter((maker) => maker.platforms.includes(platform));
  const available = [];
  const skipped = [];

  for (const maker of relevant) {
    if (!hostSupports(maker)) {
      skipped.push({
        key: maker.key,
        label: maker.label,
        name: maker.name,
        reason: `requires ${maker.hosts.join(' or ')} host`,
      });
      continue;
    }

    const missing = missingTools(maker);
    if (missing.length > 0) {
      skipped.push({
        key: maker.key,
        label: maker.label,
        name: maker.name,
        reason: `missing ${missing.join(', ')}${maker.installHint ? ` (install ${maker.installHint})` : ''}`,
      });
      continue;
    }

    available.push({
      key: maker.key,
      label: maker.label,
      name: maker.name,
    });
  }

  return { available, skipped };
}

function getPlatformLabel(platform) {
  return (
    {
      linux: 'Linux (AppImage / deb / rpm / zip)',
      win32: 'Windows (Squirrel / zip)',
      darwin: 'macOS (dmg / zip)',
    }[platform] || platform
  );
}

module.exports = {
  HOST_PLATFORM,
  TARGET_PLATFORMS,
  TARGET_ARCHES,
  getMakers,
  getBuildPlan,
  getPlatformLabel,
};
PACKAGING_JS
fi

if write_if_needed scripts/package-desktop.js; then
cat > scripts/package-desktop.js <<'PACKAGE_DESKTOP_JS'
#!/usr/bin/env node
'use strict';

/*
 * Build Pathstone desktop packages for the current OS or for another target.
 *
 *   npm run desktop:dist
 *   npm run desktop:dist -- --platform all --clean
 *   npm run desktop:dist -- --platform linux --targets @reforged/maker-appimage
 *
 * Electron Forge does the packaging; this wrapper adds target validation,
 * host/toolchain checks, artifact discovery, and a stable summary. Every
 * artifact lands under out/, which is ignored by git.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  HOST_PLATFORM,
  TARGET_PLATFORMS,
  TARGET_ARCHES,
  getBuildPlan,
  getPlatformLabel,
} = require('./packaging');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const MAKE_DIR = path.join(OUT_DIR, 'make');
const pkg = require(path.join(ROOT, 'package.json'));

let FORGE_CLI;
try {
  FORGE_CLI = require.resolve('@electron-forge/cli/dist/electron-forge.js');
} catch {
  console.error('Electron Forge is not installed. Run `npm ci` first.');
  process.exit(1);
}

const ARTIFACT_EXTENSIONS = new Set([
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.flatpak',
  '.msi',
  '.nupkg',
  '.pkg',
  '.rpm',
  '.snap',
  '.zip',
]);
const ARTIFACT_NAMES = new Set(['releases', 'releases.json']);

function usage() {
  console.log(`Usage: npm run desktop:dist -- [options]

Options:
  -p, --platform <name>   linux, win32, darwin, or all (default: host)
  -a, --arch <name>       x64 or arm64 (default: host architecture)
      --targets <names>   Comma-separated Forge maker names to run
      --clean             Remove out/ before building
      --from-package      Make artifacts from the existing packaged app
      --dry-run           Show the build commands without running them
      --list              Show available makers and missing tools
  -h, --help              Show this help

Artifacts are written under out/make and are ignored by git.

Examples:
  npm run desktop:dist
  npm run desktop:dist -- --clean
  npm run desktop:dist -- --platform all
  npm run desktop:dist -- --platform linux --targets @reforged/maker-appimage
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function normalizePlatform(value) {
  const key = String(value || '').toLowerCase();
  const aliases = {
    linux: 'linux',
    win: 'win32',
    windows: 'win32',
    win32: 'win32',
    mac: 'darwin',
    macos: 'darwin',
    osx: 'darwin',
    darwin: 'darwin',
    all: 'all',
  };
  const platform = aliases[key];
  if (!platform) {
    fail(`unknown platform "${value}" (use linux, win32, darwin, or all)`);
  }
  return platform;
}

function parseArch(value) {
  const arch = String(value || '').toLowerCase();
  if (!TARGET_ARCHES.includes(arch)) {
    fail(`unknown architecture "${value}" (use ${TARGET_ARCHES.join(' or ')})`);
  }
  return arch;
}

function parseArgs(argv) {
  const options = {
    platforms: null,
    explicitPlatform: false,
    arch: process.arch,
    targets: null,
    clean: false,
    fromPackage: false,
    dryRun: false,
    list: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    let argument = argv[index];
    let inlineValue;

    const equals = argument.indexOf('=');
    if (argument.startsWith('--') && equals !== -1) {
      inlineValue = argument.slice(equals + 1);
      argument = argument.slice(0, equals);
    }

    const value = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= argv.length || argv[index].startsWith('-')) {
        fail(`${argument} needs a value`);
      }
      return argv[index];
    };

    switch (argument) {
      case '-p':
      case '--platform': {
        const requested = normalizePlatform(value());
        options.platforms = requested === 'all' ? TARGET_PLATFORMS.slice() : [requested];
        options.explicitPlatform = requested !== 'all';
        break;
      }
      case '-a':
      case '--arch':
        options.arch = parseArch(value());
        break;
      case '--targets':
        options.targets = value()
          .split(',')
          .map((target) => target.trim())
          .filter(Boolean);
        if (options.targets.length === 0) fail('--targets needs at least one maker name');
        break;
      case '--clean':
        options.clean = true;
        break;
      case '--from-package':
        options.fromPackage = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        fail(`unknown option "${argument}"`);
    }
  }

  if (options.clean && options.fromPackage) {
    fail('--clean and --from-package cannot be used together');
  }

  return options;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function listArtifacts() {
  const found = [];
  if (!fs.existsSync(MAKE_DIR)) return found;

  const pending = [MAKE_DIR];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (ARTIFACT_EXTENSIONS.has(extension) || ARTIFACT_NAMES.has(entry.name.toLowerCase())) {
        found.push(fullPath);
      }
    }
  }

  return found.sort();
}

function describeArtifact(file) {
  try {
    return `${formatBytes(fs.statSync(file).size).padStart(10)}  ${path.relative(ROOT, file)}`;
  } catch {
    return `     unknown  ${path.relative(ROOT, file)}`;
  }
}

function outputIsIgnored() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return true;
  const result = spawnSync('git', ['check-ignore', '-q', 'out'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function printList(platforms) {
  console.log(`Host: ${HOST_PLATFORM} ${process.arch}`);
  console.log(`Pathstone: ${pkg.version}`);
  console.log('');

  for (const platform of platforms) {
    const plan = getBuildPlan(platform);
    console.log(`${getPlatformLabel(platform)}:`);
    for (const maker of plan.available) {
      console.log(`  [ready]    ${maker.label} (${maker.name})`);
    }
    for (const maker of plan.skipped) {
      console.log(`  [skipped]  ${maker.label} - ${maker.reason}`);
    }
    if (plan.available.length === 0 && plan.skipped.length === 0) {
      console.log('  [none]     no makers configured');
    }
    console.log('');
  }
}

function forgeArgs(platform, arch, options) {
  const args = [FORGE_CLI, 'make', '--platform', platform, '--arch', arch];
  if (options.targets && options.targets.length > 0) {
    args.push('--targets', options.targets.join(','));
  }
  if (options.fromPackage) args.push('--from-package');
  return args;
}

function buildPlatform(platform, arch, options) {
  const plan = getBuildPlan(platform);

  console.log('');
  console.log(`==> ${getPlatformLabel(platform)} | ${arch}`);
  for (const maker of plan.available) {
    console.log(`    ready: ${maker.label} (${maker.name})`);
  }
  for (const maker of plan.skipped) {
    console.log(`    skip:  ${maker.label} - ${maker.reason}`);
  }

  let targets = options.targets;
  if (targets) {
    const availableNames = new Set(plan.available.map((maker) => maker.name));
    const unavailable = targets.filter((target) => !availableNames.has(target));
    if (unavailable.length > 0) {
      console.error(`    error: target(s) unavailable on this host: ${unavailable.join(', ')}`);
      return { ok: false, artifacts: [] };
    }
  } else if (plan.available.length === 0) {
    const message = `no maker can build ${platform} on ${HOST_PLATFORM} ${process.arch}`;
    if (options.explicitPlatform) {
      console.error(`    error: ${message}`);
      return { ok: false, artifacts: [] };
    }
    console.log(`    skipped: ${message}`);
    return { ok: true, skipped: true, artifacts: [] };
  }

  const args = forgeArgs(platform, arch, options);
  console.log(`    command: ${process.execPath} ${args.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`);

  if (options.dryRun) {
    return { ok: true, dryRun: true, artifacts: [] };
  }

  const before = new Map(
    listArtifacts().map((file) => {
      try {
        return [file, fs.statSync(file).mtimeMs];
      } catch {
        return [file, 0];
      }
    })
  );
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATHSTONE_PACKAGE_PLATFORM: platform,
      PATHSTONE_PACKAGE_ARCH: arch,
    },
  });

  if (result.error) {
    console.error(`    error: ${result.error.message}`);
    return { ok: false, artifacts: [] };
  }
  if (result.status !== 0) {
    console.error(`    error: electron-forge exited with status ${result.status}`);
    return { ok: false, artifacts: [] };
  }

  const artifacts = listArtifacts().filter((file) => {
    if (!before.has(file)) return true;
    try {
      return fs.statSync(file).mtimeMs !== before.get(file);
    } catch {
      return false;
    }
  });
  if (artifacts.length === 0) {
    console.log('    warning: build succeeded but no new artifact was discovered under out/make');
  }

  return { ok: true, artifacts };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const platforms = options.platforms || (options.list ? TARGET_PLATFORMS.slice() : [HOST_PLATFORM]);
  if (!TARGET_PLATFORMS.includes(HOST_PLATFORM)) {
    fail(`unsupported host platform "${HOST_PLATFORM}" (supported: ${TARGET_PLATFORMS.join(', ')})`);
  }
  if (!TARGET_ARCHES.includes(options.arch)) {
    fail(`unsupported host architecture "${options.arch}" (supported: ${TARGET_ARCHES.join(', ')})`);
  }

  if (options.list) {
    printList(platforms);
    return;
  }

  console.log(`Pathstone ${pkg.version} desktop packages`);
  console.log(`Host: ${HOST_PLATFORM} ${process.arch}`);
  console.log(`Targets: ${platforms.map((platform) => `${platform}/${options.arch}`).join(', ')}`);

  if (!outputIsIgnored()) {
    console.warn('warning: out/ is not ignored by git; add it to .gitignore before committing');
  }

  if (options.clean) {
    if (options.dryRun) {
      console.log('Would remove out/');
    } else {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
      console.log('Removed out/');
    }
  }

  const built = [];
  let failures = 0;
  let skipped = 0;

  for (const platform of platforms) {
    const result = buildPlatform(platform, options.arch, options);
    if (!result.ok) {
      failures += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    built.push(...result.artifacts);
  }

  console.log('');
  if (built.length > 0) {
    console.log(`Artifacts (${built.length}):`);
    for (const artifact of built) {
      console.log(`  ${describeArtifact(artifact)}`);
    }
  } else if (options.dryRun) {
    console.log('Dry run: no artifacts were built.');
  } else {
    console.log('No artifacts were built.');
  }
  if (skipped > 0) console.log(`Skipped targets: ${skipped}`);
  if (failures > 0) {
    console.error(`Failed targets: ${failures}`);
    process.exitCode = 1;
  } else if (built.length === 0 && !options.dryRun) {
    process.exitCode = 1;
  }
}

main();
PACKAGE_DESKTOP_JS
fi

if write_if_needed tests/test_sqlite_service.js; then
cat > tests/test_sqlite_service.js <<'SQLITE_TEST'
'use strict';

/* Unit/integration test for the Electron main-process database service.
 *
 * This exercises the same handle() surface that electron/main.js uses for
 * /api/vault and /api/snapshots, including restart persistence and first-run
 * import from the browser/server database. It runs on the system Node because
 * `node:sqlite` ships with modern Node; if this Node is too old the suite
 * skips instead of failing the browser tests.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  console.log('  · node:sqlite unavailable on this Node — desktop database test skipped');
  process.exit(0);
}

const { VaultService, ApiError } = require('../electron/sqlite-service');

const passes = [];
const failures = [];
const t = (name, condition) => {
  if (condition) passes.push(name);
  else failures.push(name);
  console.log((condition ? '  ✓ ' : '  ✗ ') + name);
};

const quiet = { info() {}, warn() {}, error() {} };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathstone-sqlite-'));
const dbPath = path.join(root, 'pathstone.db');
const legacyPath = path.join(root, 'legacy.db');

function cleanup() {
  fs.rmSync(root, { recursive: true, force: true });
}

function makeLegacyDb() {
  const db = new DatabaseSync(legacyPath);
  db.exec(`
    CREATE TABLE vault (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE snapshots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, saved_at TEXT NOT NULL, json TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)").run(
    '2026-10-01T09:00:00.000Z',
    JSON.stringify({ tasks: [{ id: 'legacy-task', title: 'from the old database' }] })
  );
  db.prepare('INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)').run(
    'snap-legacy-1',
    'manual',
    '2026-10-01T09:05:00.000Z',
    JSON.stringify({ tasks: [{ id: 'legacy-task', title: 'snapshot copy' }] })
  );
  db.close();
}

try {
  if (!fs.existsSync(dbPath)) {
    const service = new VaultService(dbPath, { logger: quiet });

    let result = service.handle('GET', '/api/vault');
    t('empty database returns a null vault record', result.status === 200 && result.payload.record === null);

    const firstState = { tasks: [{ id: 't1', title: 'persist me' }], version: 1 };
    result = service.handle('PUT', '/api/vault', { state: firstState, savedAt: '2026-11-15T12:00:00.000Z' });
    t('vault write returns the savedAt', result.payload.savedAt === '2026-11-15T12:00:00.000Z');

    result = service.handle('GET', '/api/vault');
    t('vault read returns the exact state', JSON.stringify(result.payload.record.state) === JSON.stringify(firstState));
    t('vault read returns the timestamp', result.payload.record.savedAt === '2026-11-15T12:00:00.000Z');

    let threw = false;
    try {
      service.handle('PUT', '/api/vault', { savedAt: 'now' });
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('vault rejects a body without state', threw);

    result = service.handle('POST', '/api/snapshots', {
      id: 'snap-auto-1',
      kind: 'auto',
      savedAt: '2026-11-15T12:01:00.000Z',
      state: { tasks: [{ id: 't1', title: 'snapshot' }] },
    });
    t('snapshot write returns the id', result.payload.id === 'snap-auto-1');

    result = service.handle('GET', '/api/snapshots');
    t('snapshot list contains the snapshot', result.payload.records.some((snap) => snap.id === 'snap-auto-1'));

    result = service.handle('GET', '/api/snapshots/snap-auto-1');
    t('snapshot read returns the exact state', result.payload.record.state.tasks[0].title === 'snapshot');

    result = service.handle('GET', '/api/snapshots/missing');
    t('unknown snapshot returns a null record', result.status === 200 && result.payload.record === null);

    threw = false;
    try {
      service.handle('DELETE', '/api/snapshots/snap%2Fbad');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('hostile snapshot id is rejected', threw);

    threw = false;
    try {
      service.handle('POST', '/api/snapshots', { id: 'x', kind: 'bad', state: {} });
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('unknown snapshot kind is rejected', threw);

    threw = false;
    try {
      service.handle('PATCH', '/api/vault');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 405;
    }
    t('unsupported method is rejected with 405', threw);

    threw = false;
    try {
      service.handle('GET', '/api/wat');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 404;
    }
    t('unknown API route is rejected with 404', threw);

    result = service.handle('DELETE', '/api/snapshots/snap-auto-1');
    t('snapshot delete reports success', result.payload.deleted === true);
    result = service.handle('GET', '/api/snapshots/snap-auto-1');
    t('deleted snapshot is gone', result.payload.record === null);

    service.close();

    const reopened = new VaultService(dbPath, { logger: quiet });
    result = reopened.handle('GET', '/api/vault');
    t(
      'vault survives a full service restart',
      result.payload.record && result.payload.record.state.tasks[0].title === 'persist me'
    );
    reopened.close();
  }

  makeLegacyDb();
  const freshPath = path.join(root, 'fresh.db');
  const migrated = new VaultService(freshPath, { legacyPath, logger: quiet });
  let result = migrated.handle('GET', '/api/vault');
  t(
    'first run imports the legacy vault',
    result.payload.record && result.payload.record.state.tasks[0].id === 'legacy-task'
  );
  result = migrated.handle('GET', '/api/snapshots/snap-legacy-1');
  t(
    'first run imports legacy snapshots',
    result.payload.record && result.payload.record.state.tasks[0].title === 'snapshot copy'
  );
  migrated.close();

  const again = new VaultService(freshPath, { legacyPath, logger: quiet });
  result = again.handle('GET', '/api/vault');
  t(
    'later runs do not overwrite the desktop database',
    result.payload.record.state.tasks[0].id === 'legacy-task'
  );
  again.close();
} catch (error) {
  console.error('UNEXPECTED:', error);
  failures.push(`unexpected: ${error.message}`);
} finally {
  cleanup();
}

console.log(`\nPASSED: ${passes.length}\nFAILED: ${failures.length}`);
if (failures.length) console.log('  ✗ ' + failures.join('\n  ✗ '));
process.exit(failures.length ? 1 : 0);
SQLITE_TEST
fi

ensure_packaging_icons

echo "==> Checking desktop files"
node --check electron/main.js
node --check electron/sqlite-service.js
node --check forge.config.js
node --check scripts/packaging.js
node --check scripts/package-desktop.js
node --check tests/test_sqlite_service.js

if ! grep -q "getMakers" forge.config.js; then
  echo "WARNING: forge.config.js does not use scripts/packaging.js." >&2
  echo "         Cross-platform makers may be incomplete." >&2
fi

if [ "$SKIP_TEST" -eq 0 ]; then
  if ask_yes_no "Run the full test suite now?" y; then
    echo "==> npm test (fixed 10:00 local time)"
    TZ="$TEST_TZ" npm test
  fi
fi

if [ "$HOST_OS" = "linux" ] && ! command -v mksquashfs >/dev/null 2>&1; then
  echo "WARNING: mksquashfs is missing. Install squashfs-tools before building the AppImage." >&2
fi
if [ "$HOST_OS" != "win32" ] && ! command -v zip >/dev/null 2>&1; then
  echo "NOTE: zip is missing; portable .zip output will be skipped on this host."
fi
if [ "$HOST_OS" = "linux" ] && { ! command -v dpkg-deb >/dev/null 2>&1 || ! command -v fakeroot >/dev/null 2>&1; }; then
  echo "NOTE: dpkg-deb/fakeroot are missing; the .deb maker will be skipped."
fi
if [ "$HOST_OS" = "linux" ] && ! command -v rpmbuild >/dev/null 2>&1; then
  echo "NOTE: rpmbuild is missing; the .rpm maker will be skipped."
fi
if [ "$HOST_OS" != "darwin" ] && [ "$HOST_OS" != "win32" ] && { ! command -v mono >/dev/null 2>&1 || ! command -v wine >/dev/null 2>&1; }; then
  echo "NOTE: mono/wine are missing; the Squirrel Windows installer will be skipped."
fi

PACKAGE_PLATFORM=""
if ask_yes_no "Build desktop packages now?" y; then
  while :; do
    if ! choose_platform; then
      break
    fi

    PACKAGE_ARGS=(--platform "$PACKAGE_PLATFORM")
    if ask_yes_no "Remove previous build output (out/) first?" n; then
      PACKAGE_ARGS+=(--clean)
    fi

    echo "==> Building packages for $PACKAGE_PLATFORM"
    if npm run desktop:dist -- "${PACKAGE_ARGS[@]}"; then
      echo "==> Artifacts"
      find out/make -type f \( \
        -name '*.AppImage' -o \
        -name '*.deb' -o \
        -name '*.rpm' -o \
        -name '*.dmg' -o \
        -name '*.exe' -o \
        -name '*.nupkg' -o \
        -name '*.zip' -o \
        -name 'RELEASES' \
      \) -print | sort
      break
    fi

    echo "Packaging did not complete for $PACKAGE_PLATFORM." >&2
    if ! ask_yes_no "Try a different target?" y; then
      break
    fi
  done
fi

if [ "$COMMIT" -eq 1 ] || ask_yes_no "Commit the setup and packaging changes?" n; then
  echo "==> Committing"
  commit_files=(
    .gitignore
    package.json
    package-lock.json
    electron/main.js
    electron/sqlite-service.js
    forge.config.js
    scripts/packaging.js
    scripts/package-desktop.js
    tests/test_sqlite_service.js
    pathstone-electron-setup.sh
    icons/icon-512.ico
    icons/icon-512.icns
  )
  for file in "${commit_files[@]}"; do
    if [ -e "$file" ]; then git add "$file"; fi
  done
  if git diff --cached --quiet; then
    echo "Nothing to commit."
  else
    git commit -m "feat(desktop): add cross-platform packaging"
  fi
fi

if ask_yes_no "Launch Pathstone in development now?" n; then
  echo "==> Launching"
  npm run desktop:start
fi

cat <<'EOF'

Done.

Useful commands:
  npm run desktop:dist:list   show makers and missing host tools
  npm run desktop:dist        build for this OS
  npm run desktop:dist -- --platform all
  npm run desktop:package     unpacked app only
  npm run desktop:start       development window

Packaged output lives under out/ and is ignored by git.
The AppImage is written under out/make/AppImage/<arch>/Pathstone-*.AppImage.

The desktop database lives at:
  Linux:   ~/.config/pathstone/pathstone.db
  macOS:   ~/Library/Application Support/pathstone/pathstone.db
  Windows: %APPDATA%\pathstone\pathstone.db

On first run an existing data/pathstone.db is imported when the destination
database is empty. Use PATHSTONE_LEGACY_DB=/path/to/pathstone.db for a
different source, or PATHSTONE_DB=/path/to/pathstone.db to override the
desktop database path.

Build dependencies:
  Manjaro/Arch: sudo pacman -S --needed squashfs-tools fuse2
  Debian/Ubuntu: sudo apt install -y squashfs-tools libfuse2
  Optional: dpkg fakeroot rpm-tools zip imagemagick mono wine

Notes:
  - Do not run npm with sudo.
  - The app is unsigned. Do not describe it as signed.
  - App-level encryption is not included. Use full-disk encryption for a
    confidential vault.
  - If Electron reports a sandbox error:
      sudo chown root:root node_modules/electron/dist/chrome-sandbox
      sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
  - If the window is blank under Wayland, try an X11 session for diagnosis.

Push when ready:
  git push -u origin desktop/electron
EOF
