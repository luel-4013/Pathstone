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
