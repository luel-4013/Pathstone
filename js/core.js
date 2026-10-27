'use strict';

const VAULT_KEY = 'pathstone-vault-v1';
const LEGACY_THEME_KEY = 'pathstone-theme';
const THEMES = ['dusk', 'warm', 'paper', 'ink'];
const VIEWS = ['today', 'board', 'project'];
const CAPACITY = 480;
const FOCUS_GOAL = 900;
const COLUMNS = [
  { status: 'backlog', label: 'Backlog', color: '#a79a87' },
  { status: 'designing', label: 'Designing', color: '#e08a6b' },
  { status: 'building', label: 'Building', color: '#7894c4' },
  { status: 'review', label: 'Review', color: '#c59a3d' },
  { status: 'done', label: 'Done', color: '#5f9b74' }
];
const REPEAT_OPTIONS = ['none', 'daily', 'weekdays', 'weekly'];
const REPEAT_LABEL = {
  daily: 'Repeats daily',
  weekdays: 'Repeats weekdays',
  weekly: 'Repeats weekly'
};
const STATUS_LABEL = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  designing: 'Designing',
  building: 'Building',
  review: 'Review',
  done: 'Done'
};
const TAG_CLASS = {
  Design: 'dev',
  Engineering: 'blue',
  Marketing: 'gold',
  Research: '',
  Discovery: '',
  Content: '',
  Later: 'gold'
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const icon = (name, className = 'ico') => `<svg class="${className}"><use href="#${name}"/></svg>`;

let state;
let toastTimer;
let dragTaskId = null;
let storageBlocked = false;
const ui = {
  view: 'today',
  editingTaskId: null,
  editingProjectId: null,
  editingDocId: null,
  docIsNew: false,
  draftSubtasks: [],
  paletteMode: 'search',
  paletteIndex: 0,
  suppressBoardClick: false
};

function uid(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `${prefix}-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseKey(key) {
  if (!key) return null;
  const parts = String(key).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey() {
  return dateKey(new Date());
}

function addDays(key, days) {
  const date = parseKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function daysBetween(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (!from || !to) return 0;
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);
}

function weekStart(date = new Date()) {
  const day = date.getDay();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  start.setDate(start.getDate() + ((day + 6) % 7) * -1);
  return start;
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function fmtMonthDay(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtLong(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtWeekRange(monday) {
  const sunday = parseKey(addDays(dateKey(monday), 6));
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${sunday.toLocaleDateString('en-GB', { month: 'short' })}`;
  }
  return `${fmtMonthDay(monday)} – ${fmtMonthDay(sunday)}`;
}

function fmtClock(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  if (safe < 60) return `${safe}m`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function minutesFromTime(time) {
  const parts = String(time || '00:00').split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function relativeDue(task) {
  if (!task.due) return 'No date';
  if (task.status === 'done' && task.completedAt) {
    return `Completed ${fmtMonthDay(new Date(task.completedAt))}`;
  }
  const diff = daysBetween(todayKey(), task.due);
  if (diff < 0) return `Overdue · ${fmtMonthDay(parseKey(task.due))}`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const date = parseKey(task.due);
  if (diff < 7) return date.toLocaleDateString('en-GB', { weekday: 'short' });
  return fmtMonthDay(date);
}

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'dusk';
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function updateSaveState() {
  if (storageBlocked) {
    const blockedStatus = $('#saveStatus');
    if (blockedStatus) blockedStatus.innerHTML = `${icon('i-lock')}Storage unavailable`;
    const blockedNote = $('#localNote');
    if (blockedNote) blockedNote.textContent = 'Storage unavailable here · the vault can not save in this browser context';
    return;
  }
  const date = state && state.meta && state.meta.lastSaved ? new Date(state.meta.lastSaved) : new Date();
  const time = fmtClock(date);
  const status = $('#saveStatus');
  if (status) status.innerHTML = `${icon('i-lock')}Saved ${time}`;
  const note = $('#localNote');
  if (note) note.textContent = `Saved locally · ${time}`;
}

function saveState() {
  state.meta.lastSaved = new Date().toISOString();
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(state));
    updateSaveState();
    return true;
  } catch (error) {
    showToast('Could not write to the local vault');
    return false;
  }
}

function commit(message) {
  saveState();
  renderAll();
  if (message) showToast(message);
}

function activeProject() {
  if (!state || !state.projects.length) return null;
  return state.projects.find((project) => project.id === state.ui.activeProjectId) || state.projects[0];
}

function projectStats(project) {
  if (!project) return { done: 0, open: 0, total: 0, overdue: 0, percent: 0 };
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const done = tasks.filter((task) => task.status === 'done').length;
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'inbox').length;
  const overdue = tasks.filter((task) => task.status !== 'done' && task.status !== 'inbox' && task.due && daysBetween(todayKey(), task.due) < 0).length;
  const total = done + open;
  return { done, open, total, overdue, percent: total ? Math.round((done / total) * 100) : 0 };
}

function projectForTask(task) {
  return state.projects.find((project) => project.id === task.projectId) || null;
}

function topTasks() {
  return state.tasks
    .filter((task) => task.top > 0 && task.status !== 'done' && !task.archived)
    .sort((a, b) => a.top - b.top)
    .slice(0, 3);
}

function tasksDueToday() {
  const today = todayKey();
  return state.tasks
    .filter((task) => task.due === today && task.status !== 'done' && task.status !== 'inbox' && !task.archived)
    .sort((a, b) => {
      if (a.top && !b.top) return -1;
      if (!a.top && b.top) return 1;
      if (a.top !== b.top) return a.top - b.top;
      return a.priority === 'high' ? -1 : 1;
    });
}

function overdueTasks() {
  const today = todayKey();
  return state.tasks
    .filter((task) => task.status !== 'done' && task.status !== 'inbox' && !task.archived && task.due && daysBetween(today, task.due) < 0)
    .sort((a, b) => a.due.localeCompare(b.due));
}

function inboxTasks() {
  return state.tasks.filter((task) => task.status === 'inbox').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function eventsFor(date) {
  return state.events.filter((event) => event.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

function meetingMinutes(date) {
  return eventsFor(date)
    .filter((event) => event.kind === 'meeting' || event.kind === 'meeting-dark')
    .reduce((total, event) => total + Math.max(0, minutesFromTime(event.end) - minutesFromTime(event.start)), 0);
}

function bufferMinutes(date) {
  return eventsFor(date)
    .filter((event) => event.kind === 'buffer')
    .reduce((total, event) => total + Math.max(0, minutesFromTime(event.end) - minutesFromTime(event.start)), 0);
}

function currentReview() {
  const start = dateKey(weekStart(new Date()));
  return state.reviews.find((review) => review.weekStart === start) || null;
}

function nextTopSlot() {
  const used = new Set(topTasks().map((task) => task.top));
  for (let slot = 1; slot <= 3; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return 0;
}

function moveTaskToTop(taskId, slot) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  if (slot === 'next') {
    slot = nextTopSlot();
    if (!slot) return null;
  }
  slot = Number(slot) || 0;
  if (!slot) {
    task.top = 0;
    return 0;
  }
  const occupied = topTasks().some((item) => item.top === slot && item.id !== task.id);
  if (occupied) {
    state.tasks.forEach((item) => {
      if (item.id !== task.id && item.top === slot) item.top = 0;
    });
  } else if (!topTasks().some((item) => item.id === task.id) && nextTopSlot() === 0) {
    return null;
  }
  task.top = slot;
  if (task.status === 'inbox') task.status = 'backlog';
  if (!task.due) task.due = todayKey();
  return slot;
}

function computePlan() {
  const today = todayKey();
  const dueToday = state.tasks.filter((task) => task.due === today && task.status !== 'done' && task.status !== 'inbox' && !task.archived);
  const planned = dueToday.reduce((total, task) => total + task.estimate, 0);
  const meetings = meetingMinutes(today);
  const buffer = bufferMinutes(today);
  const used = planned + meetings + buffer;
  const pct = Math.round((used / state.settings.capacity) * 100);
  const overdue = overdueTasks();
  const inbox = inboxTasks();
  const top = topTasks();
  const backlogUndated = state.tasks.filter((task) => task.status !== 'done' && task.status !== 'inbox' && !task.archived && !task.due && !task.top).length;
  const review = currentReview();
  let score = 100;
  score -= Math.min(24, overdue.length * 6);
  if (!buffer) score -= 6;
  if (top.length < 3) score -= 6;
  if (inbox.length > 0) score -= 4;
  if (!review) score -= 2;
  if (pct > 92) score -= 8;
  score = Math.max(35, Math.min(100, score));
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const closed = nowMinutes >= 1020;
  let moves = 0;
  if (overdue.length) moves += 1;
  if (pct >= 75) moves += 1;
  if (!buffer) moves += 1;
  if (closed) moves = 0;
  return { dueToday, planned, meetings, buffer, used, pct, overdue, inbox, top, backlogUndated, review, score, moves, closed };
}

function nextDateForRepeat(repeat, fromKey) {
  const base = fromKey && daysBetween(todayKey(), fromKey) >= 0 ? fromKey : todayKey();
  if (repeat === 'daily') return addDays(base, 1);
  if (repeat === 'weekdays') {
    let next = addDays(base, 1);
    while ([0, 6].includes(parseKey(next).getDay())) next = addDays(next, 1);
    return next;
  }
  if (repeat === 'weekly') return addDays(base, 7);
  return null;
}

function movableTask() {
  const today = todayKey();
  return state.tasks
    .filter((task) => task.due === today && task.status !== 'done' && task.status !== 'inbox' && !task.archived && !task.top)
    .sort((a, b) => {
      const rank = { low: 0, medium: 1, high: 2 };
      return rank[a.priority] - rank[b.priority] || a.estimate - b.estimate;
    })[0] || null;
}

function applyTheme(theme) {
  const next = normalizeTheme(theme);
  state.settings.theme = next;
  document.body.dataset.theme = next;
  $$('.theme-btn').forEach((button) => {
    const active = button.dataset.theme === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  try {
    localStorage.setItem(LEGACY_THEME_KEY, next);
  } catch (error) {
    return;
  }
}

function setTheme(theme) {
  applyTheme(theme);
  saveState();
}

function setView(view, updateHash = true) {
  if (!VIEWS.includes(view)) view = 'today';
  ui.view = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.view-tab').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.rail-link[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const project = activeProject();
  if (view === 'project' && project) {
    $$('.rail-project').forEach((button) => button.classList.toggle('active', button.dataset.project === project.id));
  } else {
    $$('.rail-project').forEach((button) => button.classList.toggle('active', false));
  }
  if (updateHash && window.location.hash !== `#${view}`) {
    window.history.replaceState(null, '', `#${view}`);
  }
  document.title = `${project ? project.short || project.name : 'Pathstone'} · ${view.charAt(0).toUpperCase()}${view.slice(1)}`;
}

function selectProject(projectId, view = 'project') {
  if (!state.projects.some((project) => project.id === projectId)) return;
  state.ui.activeProjectId = projectId;
  saveState();
  renderAll();
  setView(view);
  const project = activeProject();
  if (project) showToast(`${project.short || project.name} opened`);
}
