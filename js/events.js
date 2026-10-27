'use strict';

function addDraftSubtask() {
  const input = $('#subtaskInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  ui.draftSubtasks.push({ id: uid('sub'), text, done: false });
  input.value = '';
  renderSubtasks();
  input.focus();
}

function activatePaletteResult(result) {
  if (!result) return;
  const kind = result.dataset.kind;
  const id = result.dataset.id;
  closeLayers();
  if (kind === 'task') openTask(id);
  else if (kind === 'project') selectProject(id);
  else if (kind === 'action') runPaletteAction(id);
}

function updateTaskStatus(task, status) {
  if (!task || !status || task.status === status) return false;
  if (status === 'done') {
    completeTask(task);
    return true;
  }
  task.status = status;
  task.completedAt = null;
  task.completedFrom = null;
  task.archived = false;
  return true;
}

function trapLayerFocus(event) {
  const wrap = $('.modal-wrap:not([hidden]), .drawer-wrap:not([hidden]), .palette-wrap:not([hidden])');
  if (!wrap) return;
  const focusables = $$('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]', wrap)
    .filter((element) => element.offsetParent !== null || wrap === $('#paletteWrap'));
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && (document.activeElement === first || !wrap.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !wrap.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function closeFromBackdrop(event) {
  const layer = event.target.closest('.modal-wrap, .drawer-wrap, .palette-wrap');
  if (layer && event.target === layer) {
    closeLayers();
    return true;
  }
  return false;
}

function handleClick(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  if (closeFromBackdrop(event)) return;

  const close = target.closest('[data-close]');
  if (close) {
    closeLayers();
    return;
  }

  const themeButton = target.closest('.theme-btn[data-theme]');
  if (themeButton) {
    setTheme(themeButton.dataset.theme);
    return;
  }

  const viewButton = target.closest('[data-view]');
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const projectButton = target.closest('[data-project]');
  if (projectButton) {
    selectProject(projectButton.dataset.project);
    return;
  }

  const areaButton = target.closest('[data-area]');
  if (areaButton) {
    openPalette('projects', areaButton.dataset.area || '');
    return;
  }

  const paletteResult = target.closest('[data-result]');
  if (paletteResult) {
    activatePaletteResult(paletteResult);
    return;
  }

  const checkButton = target.closest('[data-check-task]');
  if (checkButton) {
    toggleTask(checkButton.dataset.checkTask);
    return;
  }

  const pinButton = target.closest('[data-pin-task]');
  if (pinButton) {
    pinTask(pinButton.dataset.pinTask, pinButton.dataset.pinSlot);
    return;
  }

  const actionElement = target.closest('[data-action]');
  if (actionElement) {
    doAction(actionElement);
    return;
  }

  const openTaskElement = target.closest('[data-open-task]');
  if (openTaskElement) {
    if (ui.suppressBoardClick) return;
    openTask(openTaskElement.dataset.openTask);
    return;
  }

  const subtaskToggle = target.closest('[data-subtask-toggle]');
  if (subtaskToggle) {
    const index = Number(subtaskToggle.dataset.subtaskToggle);
    if (ui.draftSubtasks[index]) {
      ui.draftSubtasks[index].done = !ui.draftSubtasks[index].done;
      renderSubtasks();
    }
    return;
  }

  const subtaskRemove = target.closest('[data-subtask-remove]');
  if (subtaskRemove) {
    const index = Number(subtaskRemove.dataset.subtaskRemove);
    ui.draftSubtasks.splice(index, 1);
    renderSubtasks();
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (isLayerOpen()) {
      event.preventDefault();
      closeLayers();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette('search');
    return;
  }
  if (event.key === 'Tab' && isLayerOpen()) {
    trapLayerFocus(event);
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
  const openTaskElement = target.closest('[data-open-task]');
  if (openTaskElement) {
    event.preventDefault();
    openTask(openTaskElement.dataset.openTask);
  }
}

function handlePaletteKey(event) {
  const results = $$('.palette-result');
  if (!results.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    ui.paletteIndex = (ui.paletteIndex + 1) % results.length;
    markPaletteActive();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    ui.paletteIndex = (ui.paletteIndex - 1 + results.length) % results.length;
    markPaletteActive();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    activatePaletteResult(results[ui.paletteIndex] || results[0]);
  }
}

function handlePaletteInput() {
  ui.paletteIndex = 0;
  renderPalette();
}

function bindForms() {
  $('#captureForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#captureInput');
    if (addToInbox(input.value)) input.value = '';
    input.focus();
  });

  $('#inboxForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#inboxInput');
    if (addToInbox(input.value)) input.value = '';
    input.focus();
  });

  $('#taskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveTask();
  });

  $('#taskStatus').addEventListener('change', () => {
    const isDone = $('#taskStatus').value === 'done';
    $('#taskTop').disabled = isDone;
    if (isDone) $('#taskTop').value = '0';
  });

  $('#deleteTaskBtn').addEventListener('click', () => {
    if (ui.editingTaskId) deleteTask(ui.editingTaskId);
  });

  $('#addSubtaskBtn').addEventListener('click', addDraftSubtask);
  $('#subtaskInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDraftSubtask();
    }
  });

  $('#subtaskList').addEventListener('input', (event) => {
    const input = event.target.closest('[data-subtask-text]');
    if (!input) return;
    const index = Number(input.dataset.subtaskText);
    if (ui.draftSubtasks[index]) ui.draftSubtasks[index].text = input.value;
  });

  $('#projectForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProject();
  });

  $('#reviewForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveReview();
  });

  $('#shutdownForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveShutdown();
  });

  $('#docForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveDoc();
  });

  $('#importInput').addEventListener('change', (event) => {
    const input = event.currentTarget;
    if (input.files && input.files[0]) importData(input.files[0]);
    input.value = '';
  });
}

function bindPalette() {
  $('#paletteInput').addEventListener('input', handlePaletteInput);
  $('#paletteInput').addEventListener('keydown', handlePaletteKey);
}

function bindBoardDrag() {
  document.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.board-card');
    if (!card) return;
    dragTaskId = card.dataset.taskId;
    ui.suppressBoardClick = true;
    card.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragTaskId);
    }
  });

  document.addEventListener('dragover', (event) => {
    const column = event.target.closest('.board-col');
    if (!column) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    $$('.board-col.drag-over').forEach((item) => {
      if (item !== column) item.classList.remove('drag-over');
    });
    column.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.board-col');
    if (!column) return;
    if (event.relatedTarget && column.contains(event.relatedTarget)) return;
    column.classList.remove('drag-over');
  });

  document.addEventListener('drop', (event) => {
    const column = event.target.closest('.board-col');
    if (!column) return;
    event.preventDefault();
    const taskId = dragTaskId || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    const task = state.tasks.find((item) => item.id === taskId);
    const status = column.dataset.status;
    const changed = updateTaskStatus(task, status);
    dragTaskId = null;
    $$('.board-card.dragging').forEach((card) => card.classList.remove('dragging'));
    $$('.board-col.drag-over').forEach((item) => item.classList.remove('drag-over'));
    if (changed) {
      const label = STATUS_LABEL[status] || 'column';
      commit(`Moved to ${label}`);
    }
  });

  document.addEventListener('dragend', () => {
    dragTaskId = null;
    $$('.board-card.dragging').forEach((card) => card.classList.remove('dragging'));
    $$('.board-col.drag-over').forEach((item) => item.classList.remove('drag-over'));
    window.setTimeout(() => { ui.suppressBoardClick = false; }, 50);
  });
}

function bindButtons() {
  const actions = {
    searchBtn: () => openPalette('search'),
    newTaskBtn: () => openTask(null),
    inboxBtn: () => openInbox(),
    reviewBtn: () => openReview(),
    addProjectBtn: () => openProjectModal(null),
    exportBtn: () => exportData(),
    importBtn: () => $('#importInput').click(),
    editProjectBtn: () => openProjectModal((activeProject() || {}).id),
    closeLoopsBtn: () => openShutdown(),
    reviewRow: () => openReview(),
    applyPlanBtn: () => applyPlan(),
    allProjectsBtn: () => openPalette('projects')
  };
  Object.entries(actions).forEach(([id, handler]) => {
    const element = document.getElementById(id);
    if (element) element.addEventListener('click', handler);
  });
}

function bindNavigation() {
  window.addEventListener('hashchange', () => {
    const view = window.location.hash.replace('#', '');
    if (VIEWS.includes(view)) setView(view, false);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* Offline cache is best-effort; the app still runs without it. */
  });
}

let dayBooted = null;

/* Push the current state into both database tiers plus the mirror. Used at
 * boot so every storage engine ends the boot holding the same generation. */
function reconcileTiers(savedAt) {
  const writes = [];
  if (typeof window.fetch === 'function') {
    writes.push(srvWriteVault(state, savedAt || new Date().toISOString()).catch(() => {}));
  }
  writes.push(idbWriteVault(state).catch(() => {}));
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(state));
  } catch (error) {
    /* best effort — the next saveState retries */
  }
  return Promise.allSettled(writes);
}

function checkDayRollover() {
  const nowDay = todayKey();
  if (!dayBooted || dayBooted === nowDay) return false;
  dayBooted = nowDay;
  renderAll();
  setView(ui.view || 'today', false);
  showToast('A new day · today is fresh again');
  return true;
}

function init() {
  boot();
}

async function boot() {
  registerServiceWorker();
  let storedVault = null;
  try {
    storedVault = localStorage.getItem(VAULT_KEY);
  } catch (error) {
    storedVault = null;
  }
  state = loadState();
  try {
    localStorage.setItem('__pathstone_probe__', '1');
    localStorage.removeItem('__pathstone_probe__');
    storageBlocked = false;
  } catch (error) {
    storageBlocked = true;
  }
  ui.view = VIEWS.includes(window.location.hash.replace('#', '')) ? window.location.hash.replace('#', '') : 'today';

  /* Pick the live database tier (SQLite server > IndexedDB), then
   * reconcile: the mirror is always instant; the upper tiers may hold a
   * different generation. Newest savedAt wins and the winner is pushed
   * into every other reachable tier, so the stores converge. */
  try {
    await decideActiveTier();
    dbFailed = false;
    const dbRecord = await readVaultFromDb();
    let bestRecord = dbRecord;
    if (isServerMode()) {
      /* server live? Its first adoption on a browser that already owns an
       * IndexedDB vault must not strand the older store — newest wins. */
      const idbRecord = await idbReadVault().catch(() => null);
      if (idbRecord) bestRecord = newestOf(bestRecord, idbRecord);
    }
    const verdict = newerVaultCopy(bestRecord, state);
    const mirrorAt = state.meta && state.meta.lastSaved ? state.meta.lastSaved : null;
    if (verdict === 'db') {
      state = normalizeState(dbClone(bestRecord.state));
      reconcileTiers(bestRecord.savedAt);
    } else if (bestRecord) {
      /* tie, or mirror ahead after a crash: rebuild the tiers from it */
      reconcileTiers(mirrorAt);
    } else if (storedVault && !storageBlocked) {
      reconcileTiers(mirrorAt);
      showToast(dbMode === 'server' ? 'Vault moved into the SQLite database' : 'Vault moved into the local database');
    }
  } catch (error) {
    dbFailed = true; /* honest fallback: mirror-only mode until next boot */
  }

  dayBooted = todayKey();
  applyTheme(state.settings.theme);
  if (!storedVault) saveState();
  bindForms();
  bindPalette();
  bindBoardDrag();
  bindButtons();
  bindNavigation();
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  renderAll();
  setView(ui.view, false);
  window.setInterval(() => {
    tickFocusClock();
    checkDayRollover();
  }, 15000);
  runDailyReminder();
  if (!storedVault) {
    openLayer($('#firstRunModal'));
  }
  window.addEventListener('beforeunload', () => {
    flushDbSave();
  });
  /* pagehide: the flush moment on mobile, where beforeunload is advisory */
  window.addEventListener('pagehide', () => {
    flushDbSave();
  });
}

if (document.readyState === 'loading' && !document.querySelector('#docModal')) {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
