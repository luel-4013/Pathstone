'use strict';

function closeLayers() {
  $$('.modal-wrap, .drawer-wrap, .palette-wrap').forEach((layer) => { layer.hidden = true; });
  document.body.classList.remove('layer-open');
}

function openLayer(layer) {
  if (!layer) return;
  closeLayers();
  layer.hidden = false;
  document.body.classList.add('layer-open');
  const target = layer.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select, button');
  if (target) window.setTimeout(() => target.focus(), 30);
}

function isLayerOpen() {
  return document.body.classList.contains('layer-open');
}

function askConfirm(message) {
  if (typeof window.confirm !== 'function') return true;
  return window.confirm(message);
}

function populateProjectSelect(selected) {
  const select = $('#taskProject');
  if (!select) return;
  select.innerHTML = `<option value="">No project / Inbox</option>` + state.projects
    .map((project) => `<option value="${esc(project.id)}">${esc(project.short || project.name)}</option>`)
    .join('');
  select.value = selected || '';
}

function openTask(id, options = {}) {
  const task = id ? state.tasks.find((item) => item.id === id) : null;
  if (id && !task) return;
  ui.editingTaskId = task ? task.id : null;
  const isNew = !task;
  ui.draftSubtasks = task ? JSON.parse(JSON.stringify(task.subtasks)) : [];
  $('#taskForm').reset();
  populateProjectSelect(task ? task.projectId : (options.projectId !== undefined ? options.projectId : (activeProject() || {}).id));
  $('#taskModalTitle').textContent = isNew ? 'New task' : 'Edit task';
  $('#taskTitle').value = task ? task.title : '';
  $('#taskStatus').value = task ? task.status : (options.status || 'backlog');
  $('#taskPriority').value = task ? task.priority : 'medium';
  $('#taskEstimate').value = task ? task.estimate : 30;
  $('#taskDue').value = task ? (task.due || '') : (options.due !== undefined ? options.due : (options.status === 'inbox' ? '' : todayKey()));
  $('#taskTop').value = task ? String(task.top || 0) : '0';
  $('#taskRepeat').value = task && REPEAT_OPTIONS.includes(task.repeat) ? task.repeat : 'none';
  $('#taskTags').value = task ? task.tags.join(', ') : '';
  $('#taskNotes').value = task ? task.notes : '';
  $('#taskTop').disabled = ($('#taskStatus').value === 'done');
  $('#deleteTaskBtn').hidden = isNew;
  $('#taskError').hidden = true;
  $('#taskError').textContent = '';
  renderSubtasks();
  openLayer($('#taskModal'));
}

function saveTask() {
  const title = $('#taskTitle').value.trim();
  if (!title) {
    $('#taskError').textContent = 'A task needs a title before it can move.';
    $('#taskError').hidden = false;
    $('#taskTitle').focus();
    return;
  }
  const existing = ui.editingTaskId ? state.tasks.find((task) => task.id === ui.editingTaskId) : null;
  const task = existing || {
    id: uid('task'),
    createdAt: new Date().toISOString(),
    archived: false,
    completedAt: null,
    completedFrom: null,
    subtasks: []
  };
  const previousStatus = existing ? existing.status : null;
  const status = $('#taskStatus').value;
  task.title = title;
  task.projectId = $('#taskProject').value || null;
  task.status = status;
  task.priority = $('#taskPriority').value;
  task.estimate = Math.max(0, Number($('#taskEstimate').value) || 0);
  task.due = $('#taskDue').value || null;
  task.tags = $('#taskTags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
  task.notes = $('#taskNotes').value.trim();
  task.subtasks = ui.draftSubtasks.map((item) => ({ ...item, text: item.text.trim() })).filter((item) => item.text);
  task.top = status === 'done' ? 0 : Number($('#taskTop').value) || 0;
  task.repeat = REPEAT_OPTIONS.includes($('#taskRepeat').value) ? $('#taskRepeat').value : 'none';
  if (task.top > 0 && status === 'inbox') task.status = 'backlog';
  if (task.status === 'done') {
    if (previousStatus !== 'done') {
      task.completedAt = new Date().toISOString();
      task.completedFrom = previousStatus || 'backlog';
    }
  } else {
    task.completedAt = null;
    task.completedFrom = null;
  }
  if (task.top > 0) {
    state.tasks.forEach((item) => {
      if (item.id !== task.id && item.top === task.top) item.top = 0;
    });
  }
  if (!existing) state.tasks.push(task);
  ui.editingTaskId = null;
  closeLayers();
  commit(existing ? 'Task updated' : 'Task created');
}

function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  if (!askConfirm(`Delete “${task.title}”? This cannot be undone.`)) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  ui.editingTaskId = null;
  closeLayers();
  commit('Task deleted');
}

function completeTask(task, message) {
  if (!task || task.status === 'done') return null;
  task.completedFrom = task.status;
  task.status = 'done';
  task.completedAt = new Date().toISOString();
  task.top = 0;
  const minutes = Math.max(0, Number(task.estimate) || 0);
  if (minutes) {
    state.focusLog = state.focusLog || {};
    const key = dateKey(new Date(task.completedAt));
    state.focusLog[key] = (Number(state.focusLog[key]) || 0) + minutes;
  }
  let spawned = false;
  if (task.repeat && REPEAT_OPTIONS.includes(task.repeat) && task.repeat !== 'none') {
    const due = nextDateForRepeat(task.repeat, task.due);
    if (due) {
      state.tasks.push({
        ...task,
        id: uid('task'),
        status: 'backlog',
        due,
        top: 0,
        archived: false,
        completedAt: null,
        completedFrom: null,
        createdAt: new Date().toISOString(),
        subtasks: task.subtasks.map((item) => ({ id: uid('sub'), text: item.text, done: false }))
      });
      spawned = true;
    }
  }
  if (message) showToast(spawned ? `${message} · next one queued` : message);
  return spawned ? true : null;
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  if (task.status === 'done') {
    task.status = task.completedFrom || 'backlog';
    task.completedAt = null;
    task.completedFrom = null;
    task.archived = false;
    commit(`Reopened · ${task.title}`);
    return;
  }
  completeTask(task);
  commit(`Done · ${task.title}`);
}

function toggleDod(index) {
  const project = activeProject();
  if (!project || !project.dod[index]) return;
  project.dod[index].done = !project.dod[index].done;
  commit();
}

function pinTask(id, slot) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const moved = moveTaskToTop(id, slot);
  if (moved === null) {
    showToast('Top three is full. Unpin one first.');
    return;
  }
  commit(moved ? `Pinned to priority 0${moved}` : 'Removed from top three');
}

function openProjectModal(id) {
  const project = id ? state.projects.find((item) => item.id === id) : null;
  ui.editingProjectId = project ? project.id : null;
  $('#projectModalTitle').textContent = project ? 'Edit project' : 'New project';
  $('#projectName').value = project ? project.name : '';
  $('#projectDescription').value = project ? project.description : '';
  $('#projectArea').value = project ? project.area : 'Work';
  $('#projectOwner').value = project ? project.owner : state.settings.owner;
  $('#projectTargetInput').value = project ? (project.target || '') : addDays(todayKey(), 45);
  $('#projectColor').value = project ? project.color : '#e08a6b';
  $('#projectStatus').value = project ? project.status : 'Planning';
  $('#projectError').hidden = true;
  openLayer($('#projectModal'));
}

function saveProject() {
  const name = $('#projectName').value.trim();
  if (!name) {
    $('#projectError').textContent = 'Give the project a name.';
    $('#projectError').hidden = false;
    $('#projectName').focus();
    return;
  }
  const existing = ui.editingProjectId ? state.projects.find((project) => project.id === ui.editingProjectId) : null;
  const project = existing || {
    id: uid('project'),
    short: name,
    principles: 'One clear next step. Capacity is real. Completion is memory.',
    docs: [],
    dod: [{ text: 'Define the definition of done', done: false }],
    requirements: []
  };
  project.name = name;
  project.short = name;
  project.description = $('#projectDescription').value.trim();
  project.area = $('#projectArea').value.trim() || 'Personal';
  project.owner = $('#projectOwner').value.trim() || state.settings.owner;
  project.target = $('#projectTargetInput').value || null;
  project.color = $('#projectColor').value;
  project.status = $('#projectStatus').value;
  if (!existing) state.projects.push(project);
  state.ui.activeProjectId = project.id;
  ui.editingProjectId = null;
  closeLayers();
  saveState();
  renderAll();
  setView('project');
  showToast(existing ? 'Project updated' : 'Project created');
}

function openReview() {
  const review = currentReview();
  const monday = weekStart(new Date());
  $('#reviewIntro').textContent = `Week of ${fmtWeekRange(monday)}. Three honest lines. Then the week is closed.`;
  $('#reviewWins').value = review ? (review.wins || '') : '';
  $('#reviewBlockers').value = review ? (review.blockers || '') : '';
  $('#reviewNext').value = review ? (review.next || '') : '';
  const sorted = state.reviews.filter((item) => item && item.weekStart).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  $('#reviewHistory').innerHTML = sorted.length
    ? `Total reviews: ${sorted.length}. Last closed: ${sorted.slice(0, 3).map((item) => fmtMonthDay(parseKey(item.weekStart))).join(' · ')}`
    : 'No reviews yet. The first one is the hardest.';
  openLayer($('#reviewModal'));
}

function saveReview() {
  const week = dateKey(weekStart(new Date()));
  const existing = currentReview();
  const review = existing || { id: uid('review'), weekStart: week, createdAt: new Date().toISOString() };
  review.wins = $('#reviewWins').value.trim();
  review.blockers = $('#reviewBlockers').value.trim();
  review.next = $('#reviewNext').value.trim();
  review.updatedAt = new Date().toISOString();
  if (!existing) state.reviews.push(review);
  closeLayers();
  commit('Weekly review saved');
}

function openShutdown() {
  const inbox = inboxTasks().length;
  const due = tasksDueToday().length;
  const top = topTasks().length;
  const overdue = overdueTasks().length;
  $('#shutdownSummary').innerHTML = `
    <div class="shutdown-item"><b>${inbox}</b><span>Inbox</span></div>
    <div class="shutdown-item"><b>${due}</b><span>Due today</span></div>
    <div class="shutdown-item"><b>${top}</b><span>Priorities</span></div>
    <div class="shutdown-item"><b>${overdue}</b><span>Overdue</span></div>`;
  $('#shutdownInbox').checked = inbox === 0;
  $('#shutdownTomorrow').checked = false;
  $('#shutdownCalendar').checked = true;
  openLayer($('#shutdownModal'));
}

function saveShutdown() {
  state.shutdowns.push({
    id: uid('shutdown'),
    date: todayKey(),
    at: new Date().toISOString(),
    inboxCleared: $('#shutdownInbox').checked,
    tomorrowFirstTask: $('#shutdownTomorrow').checked,
    calendarChecked: $('#shutdownCalendar').checked
  });
  closeLayers();
  commit('Day closed · tomorrow can wait until tomorrow');
}

function openDoc(id) {
  const project = activeProject();
  if (!project) return;
  const doc = id ? project.docs.find((item) => item.id === id) : null;
  ui.editingDocId = doc ? doc.id : null;
  ui.docIsNew = !doc;
  $('#docModalTitle').textContent = doc ? 'Edit note' : 'New note';
  $('#docTitle').value = doc ? doc.title : '';
  $('#docBody').value = doc ? doc.body : '';
  openLayer($('#docModal'));
}

function saveDoc() {
  const project = activeProject();
  if (!project) return;
  const title = $('#docTitle').value.trim();
  if (!title) {
    $('#docTitle').focus();
    return;
  }
  const doc = ui.editingDocId ? project.docs.find((item) => item.id === ui.editingDocId) : null;
  const next = doc || { id: uid('doc'), title: '', body: '' };
  next.title = title;
  next.body = $('#docBody').value;
  next.updatedAt = new Date().toISOString();
  if (!doc) project.docs.push(next);
  ui.editingDocId = null;
  closeLayers();
  commit('Working note saved');
}

function openPalette(mode = 'search', query = '') {
  ui.paletteMode = mode;
  ui.paletteIndex = 0;
  $('#paletteInput').value = query;
  renderPalette();
  openLayer($('#paletteWrap'));
  const input = $('#paletteInput');
  window.setTimeout(() => {
    input.focus();
    if (input.select) input.select();
  }, 30);
}

function openInbox() {
  $('#inboxInput').value = '';
  renderInbox();
  openLayer($('#inboxWrap'));
  const input = $('#inboxInput');
  window.setTimeout(() => input.focus(), 30);
}

function runPaletteAction(name) {
  if (name === 'new-task') openTask(null);
  else if (name === 'open-inbox') openInbox();
  else if (name === 'open-review') openReview();
  else if (name === 'project-palette') openPalette('projects');
  else if (name === 'export') exportData();
  else if (name === 'add-project') openProjectModal(null);
}

function addToInbox(title) {
  const clean = String(title || '').trim();
  if (!clean) return false;
  state.tasks.push({
    id: uid('task'),
    title: clean,
    projectId: null,
    status: 'inbox',
    priority: 'medium',
    estimate: 10,
    due: null,
    top: 0,
    tags: [],
    notes: '',
    subtasks: [],
    archived: false,
    completedAt: null,
    completedFrom: null,
    repeat: 'none',
    cover: null,
    createdAt: new Date().toISOString()
  });
  saveState();
  renderAll();
  showToast('Captured · it can wait in the inbox');
  return true;
}

function scheduleFromInbox(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.due = todayKey();
  task.status = 'backlog';
  if (topTasks().length < 3) {
    const slot = nextTopSlot();
    if (slot) moveTaskToTop(task.id, slot);
  }
  commit('Moved to today');
}

function editFromInbox(id) {
  openTask(id);
}

function deleteFromInbox(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  if (!askConfirm(`Delete “${task.title}”?`)) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  commit('Capture deleted');
}

function rescheduleOverdue() {
  const tasks = overdueTasks();
  if (!tasks.length) {
    showToast('No overdue tasks to move');
    return;
  }
  tasks.forEach((task) => {
    task.due = null;
    task.top = 0;
  });
  commit(`${tasks.length} overdue task${tasks.length === 1 ? '' : 's'} swept to backlog · dated again when chosen`);
}

function moveLowPriority(id) {
  const task = (id && state.tasks.find((item) => item.id === id)) || movableTask();
  if (!task) {
    showToast('Nothing left to move');
    return;
  }
  task.due = addDays(todayKey(), 1);
  task.top = 0;
  commit(`${task.title} moved to tomorrow`);
}

function addBuffer() {
  const today = todayKey();
  if (eventsFor(today).some((event) => event.kind === 'buffer')) {
    showToast('A buffer is already protected');
    return;
  }
  state.events.push({
    id: uid('event'),
    date: today,
    title: 'Buffer · protect',
    start: '15:15',
    end: '16:00',
    kind: 'buffer'
  });
  commit('45-minute buffer protected');
}

function applyPlan() {
  let moves = 0;
  if (overdueTasks().length) {
    const tasks = overdueTasks();
    tasks.forEach((task) => {
      task.due = null;
      task.top = 0;
    });
    moves += 1;
  }
  const plan = computePlan();
  if (plan.pct >= 75) {
    const move = movableTask();
    if (move) {
      move.due = addDays(todayKey(), 1);
      move.top = 0;
      moves += 1;
    }
  }
  if (!bufferMinutes(todayKey())) {
    if (!eventsFor(todayKey()).some((event) => event.kind === 'buffer')) {
      state.events.push({
        id: uid('event'),
        date: todayKey(),
        title: 'Buffer · protect',
        start: '15:15',
        end: '16:00',
        kind: 'buffer'
      });
      moves += 1;
    }
  }
  if (!moves) {
    showToast('Plan is already clear');
    return;
  }
  commit(`${moves} move${moves === 1 ? '' : 's'} applied · today rebalanced`);
}

function toggleArchive() {
  state.ui.showArchivedDone = !state.ui.showArchivedDone;
  saveState();
  renderAll();
  showToast(state.ui.showArchivedDone ? 'Archive shown' : 'Archive hidden');
}

function startFocus() {
  if (state.focusRun) {
    stopFocus();
    return;
  }
  state.focusRun = { startedAt: new Date().toISOString() };
  saveState();
  renderAll();
  showToast('Focus running · it logs when you stop');
}

function stopFocus() {
  const run = state.focusRun;
  if (!run) {
    showToast('No focus run is active');
    return;
  }
  const started = new Date(run.startedAt).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  state.focusRun = null;
  if (!minutes) {
    saveState();
    renderAll();
    showToast('Focused under a minute · nothing logged');
    return;
  }
  state.focusLog = state.focusLog || {};
  const key = todayKey();
  state.focusLog[key] = (Number(state.focusLog[key]) || 0) + minutes;
  commit(`Focus logged · ${fmtDuration(minutes)}`);
}

function tickFocusClock() {
  const clock = $('#focusClock');
  if (!clock || !state) return;
  const run = state.focusRun;
  if (!run) {
    clock.textContent = '—';
    return;
  }
  const started = new Date(run.startedAt).getTime();
  clock.textContent = fmtDuration(Math.max(0, Math.floor((Date.now() - started) / 60000)));
}

function toggleReminders() {
  if (typeof window.Notification !== 'function') {
    showToast('This browser has no notifications');
    return;
  }
  const service = window.Notification;
  if (!state.settings.reminders && service.permission === 'default' && typeof service.requestPermission === 'function') {
    service.requestPermission().then((permission) => {
      if (permission === 'granted') {
        state.settings.reminders = true;
        saveState();
        renderAll();
        runDailyReminder();
        showToast('Daily reminder on · it fires when the vault opens');
      } else {
        showToast('Reminders stay off — permission was not granted');
      }
    }).catch(() => showToast('Reminders stay off — permission was not granted'));
    return;
  }
  state.settings.reminders = !state.settings.reminders;
  saveState();
  renderAll();
  showToast(state.settings.reminders ? 'Daily reminder on · it fires when the vault opens' : 'Daily reminder off');
}

function runDailyReminder() {
  try {
    const today = todayKey();
    if (!state.settings.reminders || state.settings.lastReminderDate === today) return;
    const service = typeof window.Notification === 'function' ? window.Notification : null;
    if (!service || service.permission !== 'granted') return;
    const top = topTasks().length;
    const due = tasksDueToday().length;
    const overdue = overdueTasks().length;
    const parts = [];
    if (overdue) parts.push(`${overdue} overdue`);
    if (due) parts.push(`${due} due today`);
    if (top) parts.push(`${top} priorit${top === 1 ? 'y' : 'ies'}`);
    if (!parts.length) return;
    state.settings.lastReminderDate = today;
    saveState();
    new service('Pathstone · today', { body: parts.join(' · '), icon: './icons/icon-192.png', tag: 'pathstone-daily' });
  } catch (error) {
    /* reminders are best-effort */
  }
}

function startEmptyWorkspace() {
  if (!askConfirm('Swap the current vault for an empty one? The present data stays on this device until the next save.')) return;
  startEmptyNow();
}

function startEmptyNow() {
  state = emptyState();
  applyTheme(state.settings.theme);
  saveState();
  closeLayers();
  renderAll();
  setView('today', false);
  showToast('Blank vault · capture the first thing circling');
}

function startDemoWorkspace() {
  state.meta.demo = true;
  saveState();
  closeLayers();
  renderAll();
  showToast('Demo workspace · swap to empty anytime from the vault card');
}

function setBoardFilter(filter) {
  state.ui.boardFilter = filter === 'high' ? 'high' : 'all';
  saveState();
  renderAll();
}

function exportData() {
  if (typeof URL.createObjectURL !== 'function') {
    showToast('Export is unavailable in this browser');
    return;
  }
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pathstone-vault-${todayKey()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.meta.lastExport = new Date().toISOString();
  saveState();
  updateVaultNote();
  showToast('Local vault exported');
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) throw new Error('Invalid vault');
      if (!askConfirm('Replace the local vault with this file?')) return;
      state = normalizeState(parsed);
      applyTheme(state.settings.theme);
      saveState();
      renderAll();
      showToast('Local vault imported');
    } catch (error) {
      showToast('That file is not a Pathstone vault');
    }
  };
  reader.readAsText(file);
}

function doAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;
  if (!action) return;
  if (action === 'noop') return;
  if (action === 'new-task') {
    const status = element.dataset.status || 'backlog';
    openTask(null, { status, projectId: (activeProject() || {}).id, due: status === 'inbox' ? '' : todayKey() });
  } else if (action === 'open-palette') {
    openPalette(element.dataset.mode || 'search');
  } else if (action === 'open-inbox') {
    openInbox();
  } else if (action === 'open-review') {
    openReview();
  } else if (action === 'open-shutdown') {
    openShutdown();
  } else if (action === 'inbox-today') {
    scheduleFromInbox(id);
  } else if (action === 'inbox-done') {
    const task = state.tasks.find((item) => item.id === id);
    if (task) { completeTask(task); commit('Done · capture cleared'); }
  } else if (action === 'inbox-edit') {
    editFromInbox(id);
  } else if (action === 'inbox-delete') {
    deleteFromInbox(id);
  } else if (action === 'toggle-dod') {
    toggleDod(Number(element.dataset.index));
  } else if (action === 'open-doc') {
    openDoc(id);
  } else if (action === 'add-doc') {
    openDoc(null);
  } else if (action === 'edit-project') {
    openProjectModal((activeProject() || {}).id);
  } else if (action === 'new-project') {
    openProjectModal(null);
  } else if (action === 'board-filter') {
    setBoardFilter(element.dataset.filter);
  } else if (action === 'toggle-archive') {
    toggleArchive();
  } else if (action === 'project-palette') {
    openPalette('projects');
  } else if (action === 'reschedule-overdue') {
    rescheduleOverdue();
  } else if (action === 'move-low') {
    moveLowPriority(id);
  } else if (action === 'add-buffer') {
    addBuffer();
  } else if (action === 'apply-plan') {
    applyPlan();
  } else if (action === 'export') {
    exportData();
  } else if (action === 'import') {
    $('#importInput').click();
  } else if (action === 'focus-run') {
    startFocus();
  } else if (action === 'toggle-reminders') {
    toggleReminders();
  } else if (action === 'first-run-empty') {
    startEmptyNow();
  } else if (action === 'first-run-demo') {
    startDemoWorkspace();
  } else if (action === 'reset-demo') {
    startEmptyWorkspace();
  }
}
