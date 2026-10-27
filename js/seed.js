'use strict';

function subItems(items, doneCount) {
  return items.map((text, index) => ({
    id: uid('sub'),
    text,
    done: index < doneCount
  }));
}

function seedState() {
  const today = todayKey();
  const monday = dateKey(weekStart(new Date()));
  const nowIso = new Date().toISOString();
  const projects = [
    {
      id: 'pathstone',
      name: 'Pathstone v1 — Launch',
      short: 'Pathstone v1',
      color: '#e08a6b',
      area: 'Work',
      owner: 'Prince',
      status: 'In progress',
      target: addDays(today, 22),
      description: 'Ship a calm, local-first workspace that turns a loud brain into one clear next step. Private by default, useful on the first day.',
      principles: 'Show the next step, not the whole mountain. Capacity is real. Completion is memory. The vault belongs to the user. Automation must ask before it moves anything.',
      docs: [
        { id: 'doc-design', title: 'Design principles', body: 'Quiet, tactile, a little editorial. Warm light and deep dusk. Show one clear next step before showing the whole system.\n\nInterfaces should feel like a well-kept notebook, not a cockpit.', updatedAt: nowIso },
        { id: 'doc-launch', title: 'Launch notes', body: 'Local vault first. No account wall. Capture must work before setup feels finished.\n\nLaunch gate: three people can use Today, Board, and Project without a walkthrough.', updatedAt: nowIso }
      ],
      dod: [
        { text: 'Happy path is clear', done: true },
        { text: 'Empty states written', done: true },
        { text: 'Keyboard accessible', done: false },
        { text: 'Tested with three people', done: false }
      ],
      requirements: [
        { id: 'FR-001', name: 'Capture a task in under three seconds', detail: 'Global shortcut, no modal', status: 'done' },
        { id: 'FR-002', name: 'Break any task into unlimited subtasks', detail: 'Nested, sortable, estimateable', status: 'build' },
        { id: 'FR-003', name: 'Plan a day against real capacity', detail: 'Estimates, buffers, overload warning', status: 'build' },
        { id: 'FR-004', name: 'Complete a weekly review', detail: 'Wins, blockers, next week', status: 'next' },
        { id: 'NFR-01', name: 'First paint under one second', detail: 'Local data, no blocking network', status: 'done' },
        { id: 'NFR-02', name: 'Works fully offline', detail: 'Every core action, not just viewing', status: 'build' }
      ]
    },
    {
      id: 'portfolio',
      name: 'Portfolio 2026',
      short: 'Portfolio 2026',
      color: '#8fc3a3',
      area: 'Work',
      owner: 'Prince',
      status: 'In progress',
      target: addDays(today, 45),
      description: 'A quieter portfolio that shows the thinking, not just the screens. Three case studies, one clear point of view.',
      principles: 'Evidence over decoration. Fewer projects, deeper stories. Every case study ends with what changed.',
      docs: [],
      dod: [{ text: 'Three case studies written', done: false }],
      requirements: [{ id: 'FR-01', name: 'Publish three case studies', detail: 'Problem, decisions, outcome', status: 'build' }]
    },
    {
      id: 'learn-rust',
      name: 'Learn Rust',
      short: 'Learn Rust',
      color: '#e7c76a',
      area: 'Personal',
      owner: 'Prince',
      status: 'Planning',
      target: addDays(today, 90),
      description: 'Learn enough Rust to build a small local-first command line tool without copying a tutorial for the tenth time.',
      principles: 'Build to learn. Small programs. Read errors slowly.',
      docs: [],
      dod: [{ text: 'Ship one working CLI', done: false }],
      requirements: [{ id: 'FR-01', name: 'Build a local search CLI', detail: 'Index, search, explain matches', status: 'next' }]
    },
    {
      id: 'home',
      name: 'Home and Life',
      short: 'Home and Life',
      color: '#8f97c5',
      area: 'Personal',
      owner: 'Prince',
      status: 'In progress',
      target: addDays(today, 60),
      description: 'The quiet maintenance work that makes the rest of life possible. Repairs, admin, and the occasional good meal plan.',
      principles: 'Maintain before it breaks. Keep the list short. Buy fewer things.',
      docs: [],
      dod: [{ text: 'No overdue home admin', done: false }],
      requirements: [{ id: 'FR-01', name: 'Clear the admin backlog', detail: 'Domain, appointments, repairs', status: 'build' }]
    }
  ];

  const tasks = [];
  const addTask = (id, title, projectId, status, priority, estimate, dueOffset, extra = {}) => {
    tasks.push({
      id,
      title,
      projectId,
      status,
      priority,
      estimate,
      due: dueOffset === null || dueOffset === undefined ? null : addDays(today, dueOffset),
      top: extra.top || 0,
      tags: extra.tags || [],
      notes: extra.notes || '',
      subtasks: extra.subtasks || [],
      repeat: extra.repeat || 'none',
      archived: Boolean(extra.archived),
      completedAt: extra.completedAt || null,
      completedFrom: extra.completedFrom || null,
      cover: extra.cover || null,
      createdAt: extra.createdAt || nowIso
    });
  };

  addTask('t-onboarding', 'Map the onboarding flow', 'pathstone', 'designing', 'high', 45, 0, {
    top: 1,
    tags: ['Design'],
    notes: 'From first capture to the first completed task in under two minutes.',
    cover: { label: 'Onboarding', c1: '#d97757', c2: '#e8ad8f' },
    subtasks: subItems(['Sketch the empty state', 'Map capture to Today', 'Write the first-run copy', 'Review with Sam', 'Final pass'], 3)
  });
  addTask('t-auth', 'Break auth spec into tickets', 'pathstone', 'building', 'high', 75, 0, {
    top: 2,
    tags: ['Engineering'],
    notes: 'Local unlock first. Account sync stays optional and boring.',
    cover: { label: 'Auth', c1: '#6f88bb', c2: '#a9b9dc' },
    subtasks: subItems(['Local unlock flow', 'Recovery path', 'Session boundaries', 'Ticket acceptance criteria', 'Link requirements', 'Handoff'], 2)
  });
  addTask('t-demo', 'Record 90-second demo', 'pathstone', 'backlog', 'medium', 30, 0, {
    top: 3,
    tags: ['Marketing'],
    notes: 'Capture, choose three, finish one, show the completed log.',
    subtasks: subItems(['Write the beats', 'Capture screen', 'Record voiceover'], 0)
  });
  addTask('t-analytics', 'Set up analytics events', 'pathstone', 'backlog', 'low', 45, 0, {
    tags: ['Discovery'],
    notes: 'Define the few numbers that tell us the daily loop works.',
    cover: { label: 'Research', c1: '#a98268', c2: '#d6b493' },
    subtasks: subItems(['Name the events', 'Instrument capture', 'Check the weekly view'], 0)
  });
  addTask('t-landing', 'Landing page hero', 'pathstone', 'review', 'medium', 30, 0, {
    tags: ['Marketing'],
    notes: 'Calm first impression. One promise, one demo, no feature wall.',
    cover: { label: 'Landing', c1: '#c59a3d', c2: '#e4c77b' }
  });
  addTask('t-persistence', 'Local persistence layer', 'pathstone', 'building', 'high', 25, 0, {
    tags: ['Engineering'],
    notes: 'Every mutation writes to the local vault before the UI settles.',
    subtasks: subItems(['Store schema', 'Save on mutation', 'Export path', 'Import validation', 'Recovery state', 'Offline check'], 3)
  });
  addTask('t-pricing', 'Write pricing page copy', 'pathstone', 'backlog', 'medium', 30, 7, {
    tags: ['Marketing'],
    subtasks: subItems(['First draft', 'Tighten'], 1)
  });
  addTask('t-keyboard', 'Audit keyboard shortcuts', 'pathstone', 'backlog', 'low', 30, 10, {
    tags: ['Design'],
    subtasks: subItems(['Inventory actions', 'Choose shortcuts', 'Test conflicts', 'Write hints'], 0)
  });
  addTask('t-empty', 'Empty state illustrations', 'pathstone', 'designing', 'low', 45, 5, {
    tags: ['Design'],
    subtasks: subItems(['Today', 'Board', 'Inbox', 'Search'], 1)
  });
  addTask('t-ritual', 'Name the daily ritual', 'pathstone', 'designing', 'medium', 20, 1, {
    tags: ['Content']
  });
  addTask('t-palette', 'Build command palette', 'pathstone', 'building', 'medium', 45, 6, {
    tags: ['Engineering'],
    subtasks: subItems(['Search tasks', 'Keyboard nav', 'Action results', 'Polish'], 1)
  });
  addTask('t-onboarding-copy', 'Onboarding copy', 'pathstone', 'review', 'low', 20, 1, {
    tags: ['Content'],
    subtasks: subItems(['First pass', 'Cut half'], 1)
  });

  addTask('t-brand', 'Brand direction', 'pathstone', 'done', 'high', 60, -3, {
    tags: ['Design'],
    notes: 'Quiet, tactile, a little editorial. Warm light and deep dusk.',
    cover: { label: 'Brand', c1: '#5f9b74', c2: '#a9cbb4' },
    completedAt: new Date(parseKey(addDays(today, -3))).toISOString(),
    completedFrom: 'review'
  });
  addTask('t-logo', 'Logo explorations', 'pathstone', 'done', 'medium', 90, -5, {
    tags: ['Design'],
    completedAt: new Date(parseKey(addDays(today, -5))).toISOString(),
    completedFrom: 'designing'
  });
  addTask('t-interviews', 'User interviews', 'pathstone', 'done', 'high', 120, -7, {
    tags: ['Research'],
    completedAt: new Date(parseKey(addDays(today, -7))).toISOString(),
    completedFrom: 'review'
  });
  addTask('t-stack', 'Tech stack decision', 'pathstone', 'done', 'high', 45, -9, {
    tags: ['Engineering'],
    completedAt: new Date(parseKey(addDays(today, -9))).toISOString(),
    completedFrom: 'review'
  });

  const archiveTitles = [
    'Name the product', 'Write the product brief', 'Map core objects', 'Choose type system',
    'Sketch today view', 'Sketch board view', 'Review with Sam', 'Set local-first rules',
    'Draft empty states', 'Define keyboard map', 'Test capture flow', 'Write onboarding draft',
    'Polish command palette', 'Review contrast', 'Fix mobile header', 'Ship dark theme',
    'Build icon set', 'Write release notes', 'Archive research', 'Clean seed data', 'Prepare launch checklist'
  ];
  archiveTitles.forEach((title, index) => {
    const completed = index < 3
      ? new Date().toISOString()
      : new Date(parseKey(addDays(today, -11 - index))).toISOString();
    addTask(`t-archive-${index}`, title, 'pathstone', 'done', 'medium', 30 + (index % 4) * 15, -11 - index, {
      tags: index % 3 === 0 ? ['Engineering'] : index % 3 === 1 ? ['Design'] : ['Research'],
      archived: true,
      completedAt: completed,
      completedFrom: 'review'
    });
  });

  addTask('t-portfolio-case', 'Send portfolio case study', 'portfolio', 'review', 'high', 45, -1, {
    tags: ['Research'],
    notes: 'The first case study is written. It needs a final read and a publish button.',
    subtasks: subItems(['Final read', 'Export images', 'Publish'], 1)
  });
  addTask('t-portfolio-copy', 'Portfolio site copy', 'portfolio', 'backlog', 'medium', 60, 14, {
    tags: ['Marketing']
  });
  addTask('t-rust-ch4', 'Finish chapter 4 notes', 'learn-rust', 'designing', 'medium', 45, 3, {
    tags: ['Research']
  });
  addTask('t-rust-cli', 'Build the CLI prototype', 'learn-rust', 'backlog', 'low', 120, 12, {
    tags: ['Engineering']
  });
  addTask('t-domain', 'Renew domain', 'home', 'backlog', 'high', 10, -2, {
    tags: ['Admin'],
    notes: 'The renewal notice is somewhere in the inbox.'
  });
  addTask('t-meals', 'Plan meals for the week', 'home', 'backlog', 'low', 25, 1, {
    tags: ['Personal']
  });
  addTask('t-shelf', 'Fix shelf bracket', 'home', 'backlog', 'low', 30, 9, {
    tags: ['Personal']
  });

  addTask('t-inbox-1', 'Idea: a calmer notification digest', null, 'inbox', 'low', 10, null, {
    tags: ['Idea'],
    notes: 'One daily summary. No red dots.'
  });
  addTask('t-inbox-2', 'Book dentist appointment', null, 'inbox', 'medium', 10, null, {
    tags: ['Personal']
  });
  addTask('t-inbox-3', 'Read notes on local-first sync', null, 'inbox', 'low', 20, null, {
    tags: ['Research']
  });

  const events = [
    { id: 'e-focus-1', date: today, title: 'Deep work · Onboarding', start: '09:00', end: '10:00', kind: 'focus' },
    { id: 'e-standup', date: today, title: 'Standup', start: '10:15', end: '10:30', kind: 'meeting' },
    { id: 'e-focus-2', date: today, title: 'Deep work · Auth spec', start: '11:00', end: '12:00', kind: 'focus' },
    { id: 'e-review', date: today, title: 'API review · Sam', start: '14:00', end: '15:00', kind: 'meeting-dark' },
    { id: 'e-buffer', date: today, title: 'Buffer · protect', start: '15:15', end: '16:00', kind: 'buffer' }
  ];

  const focusLog = {};
  const dayIntoWeek = Math.max(0, daysBetween(monday, today));
  [120, 145, 90, 155, 250, 0, 0].forEach((minutes, index) => {
    if (index <= dayIntoWeek) focusLog[addDays(monday, index)] = minutes;
  });
  [130, 110, 95, 120, 90, 60, 40].forEach((minutes, index) => {
    focusLog[addDays(monday, -7 + index)] = minutes;
  });

  const previousWeekStart = addDays(monday, -7);
  const reviews = [{
    id: 'review-seed',
    weekStart: previousWeekStart,
    wins: 'The daily loop found its shape. The board stopped being a second inbox.',
    blockers: 'The weekly review is still too easy to postpone.',
    next: 'Finish the onboarding flow and test the capture-to-done path with three people.',
    createdAt: new Date(parseKey(addDays(today, -3))).toISOString(),
    updatedAt: new Date(parseKey(addDays(today, -3))).toISOString()
  }];

  return {
    version: 1,
    settings: { theme: 'dusk', capacity: CAPACITY, owner: 'Prince' },
    meta: { createdAt: nowIso, lastSaved: nowIso, demo: true },
    projects,
    tasks,
    events,
    focusLog,
    reviews,
    shutdowns: [],
    ui: { activeProjectId: 'pathstone', boardFilter: 'all', showArchivedDone: false }
  };
}

function emptyState() {
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    settings: { theme: 'dusk', capacity: CAPACITY, owner: 'Prince', reminders: false, lastReminderDate: null },
    meta: { createdAt: nowIso, lastSaved: nowIso, demo: false },
    projects: [],
    tasks: [],
    events: [],
    focusLog: {},
    focusRun: null,
    reviews: [],
    shutdowns: [],
    ui: { activeProjectId: null, boardFilter: 'all', showArchivedDone: false }
  };
}

function normalizeState(candidate) {
  if (!candidate || !Array.isArray(candidate.projects) || !Array.isArray(candidate.tasks)) {
    return seedState();
  }
  const seed = seedState();
  const next = candidate;
  next.version = 1;
  next.settings = Object.assign({}, seed.settings, next.settings || {});
  next.settings.theme = normalizeTheme(next.settings.theme);
  next.settings.capacity = Number(next.settings.capacity) || CAPACITY;
  next.settings.reminders = Boolean(next.settings.reminders);
  next.settings.lastReminderDate = next.settings.lastReminderDate && typeof next.settings.lastReminderDate === 'string' ? next.settings.lastReminderDate : null;
  const storedDemo = next.meta && next.meta.demo === true;
  next.meta = Object.assign({}, seed.meta, next.meta || {});
  next.meta.demo = Boolean(storedDemo);
  next.meta.lastSaved = next.meta.lastSaved && !Number.isNaN(new Date(next.meta.lastSaved).getTime()) ? next.meta.lastSaved : new Date().toISOString();
  next.meta.lastExport = typeof next.meta.lastExport === 'string' && !Number.isNaN(new Date(next.meta.lastExport).getTime()) ? next.meta.lastExport : null;
  next.events = Array.isArray(next.events) ? next.events.filter((event) => event && event.date) : [];
  next.focusLog = next.focusLog && typeof next.focusLog === 'object' ? next.focusLog : {};
  next.focusRun = next.focusRun && next.focusRun.startedAt && !Number.isNaN(new Date(next.focusRun.startedAt).getTime())
    ? { startedAt: String(next.focusRun.startedAt) }
    : null;
  next.reviews = Array.isArray(next.reviews) ? next.reviews.filter((review) => review && review.weekStart) : [];
  next.shutdowns = Array.isArray(next.shutdowns) ? next.shutdowns : [];
  next.ui = Object.assign({ activeProjectId: next.projects[0] ? next.projects[0].id : null, boardFilter: 'all', showArchivedDone: false }, next.ui || {});
  if (!next.projects.some((project) => project.id === next.ui.activeProjectId)) {
    next.ui.activeProjectId = next.projects[0] ? next.projects[0].id : null;
  }
  next.tasks.forEach((task) => {
    task.title = String(task.title || 'Untitled task');
    task.status = STATUS_LABEL[task.status] ? task.status : 'backlog';
    task.priority = ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium';
    task.top = task.status === 'done' ? 0 : Math.max(0, Math.min(3, Number(task.top) || 0));
    task.estimate = Math.max(0, Number(task.estimate) || 0);
    task.due = task.due && parseKey(task.due) ? task.due : null;
    task.notes = String(task.notes || '');
    task.completedFrom = STATUS_LABEL[task.completedFrom] ? task.completedFrom : null;
    task.completedAt = task.completedAt && !Number.isNaN(new Date(task.completedAt).getTime()) ? String(task.completedAt) : null;
    task.repeat = REPEAT_OPTIONS.includes(task.repeat) ? task.repeat : 'none';
    task.createdAt = task.createdAt && !Number.isNaN(new Date(task.createdAt).getTime()) ? task.createdAt : new Date().toISOString();
    task.tags = Array.isArray(task.tags) ? task.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
    task.subtasks = Array.isArray(task.subtasks)
      ? task.subtasks.filter((item) => item && item.text).map((item) => ({
        id: item.id || uid('sub'),
        text: String(item.text),
        done: Boolean(item.done)
      }))
      : [];
    task.archived = Boolean(task.archived);
    task.cover = task.cover && typeof task.cover === 'object'
      ? {
        label: String(task.cover.label || '').slice(0, 24),
        c1: typeof task.cover.c1 === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(task.cover.c1) ? task.cover.c1 : '#d97757',
        c2: typeof task.cover.c2 === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(task.cover.c2) ? task.cover.c2 : '#e8ad8f'
      }
      : null;
    task.projectId = next.projects.some((project) => project.id === task.projectId) ? task.projectId : null;
  });
  next.projects.forEach((project) => {
    project.name = String(project.name || project.short || 'Untitled project');
    project.short = String(project.short || project.name);
    project.description = String(project.description || '');
    project.principles = String(project.principles || 'One clear next step. Capacity is real. Completion is memory.');
    project.target = project.target && parseKey(project.target) ? project.target : null;
    project.docs = Array.isArray(project.docs)
      ? project.docs.filter((doc) => doc && doc.title).map((doc) => ({
        id: doc.id || uid('doc'),
        title: String(doc.title),
        body: String(doc.body || ''),
        updatedAt: doc.updatedAt || new Date().toISOString()
      }))
      : [];
    project.dod = Array.isArray(project.dod)
      ? project.dod.filter((item) => item && item.text).map((item) => ({ text: String(item.text), done: Boolean(item.done) }))
      : [];
    project.requirements = Array.isArray(project.requirements)
      ? project.requirements.filter((req) => req && req.name).map((req) => ({
        id: String(req.id || uid('req')),
        name: String(req.name),
        detail: String(req.detail || ''),
        status: ['done', 'build', 'next'].includes(req.status) ? req.status : 'next'
      }))
      : [];
    project.color = typeof project.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(project.color) ? project.color : '#e08a6b';
    project.area = project.area || 'Personal';
    project.owner = project.owner || next.settings.owner;
    project.status = project.status || 'In progress';
  });
  next.reviews = next.reviews.map((review) => ({
    ...review,
    wins: String(review.wins || ''),
    blockers: String(review.blockers || ''),
    next: String(review.next || ''),
    updatedAt: review.updatedAt || review.createdAt || new Date().toISOString()
  }));
  return next;
}

function loadState() {
  let loaded = null;
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (raw) loaded = normalizeState(JSON.parse(raw));
  } catch (error) {
    loaded = null;
  }
  if (!loaded) {
    loaded = seedState();
    try {
      const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacyTheme) loaded.settings.theme = normalizeTheme(legacyTheme);
    } catch (error) {
      loaded.settings.theme = 'dusk';
    }
  }
  const queryTheme = new URLSearchParams(window.location.search).get('theme');
  if (queryTheme) loaded.settings.theme = normalizeTheme(queryTheme);
  return loaded;
}
