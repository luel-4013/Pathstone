'use strict';

function renderAll() {
  if (!state) return;
  const project = activeProject();
  renderChrome(project);
  renderRail(project);
  renderToday(project);
  renderBoard(project);
  renderProjectPage(project);
  if (!$('#inboxWrap').hidden) renderInbox();
  if (!$('#paletteWrap').hidden) renderPalette();
}

function updateVaultNote() {
  const note = $('#vaultExport');
  if (!note) return;
  const last = state.meta && state.meta.lastExport ? new Date(state.meta.lastExport) : null;
  if (!last || Number.isNaN(last.getTime())) {
    note.textContent = 'No backup yet · keep a copy outside this browser';
    return;
  }
  const days = Math.max(0, Math.round((Date.now() - last.getTime()) / 86400000));
  note.textContent = days <= 13
    ? `Backup exported ${fmtMonthDay(last)} · recent copy exists`
    : `Last backup ${fmtMonthDay(last)} · ${days} days old, export again`;
}

function renderDemoAndVaultChrome() {
  const demo = state.meta && state.meta.demo;
  const badge = $('#demoBadge');
  if (badge) badge.hidden = !demo;
  const reset = $('#demoResetBtn');
  if (reset) reset.hidden = !demo;
  const remind = $('#remindBtn');
  if (remind) {
    const remindLabel = remind.querySelector('span');
    const label = state.settings.reminders ? 'Reminders on' : 'Remind daily';
    if (remindLabel) remindLabel.textContent = label;
    else remind.textContent = label;
    remind.setAttribute('aria-pressed', String(Boolean(state.settings.reminders)));
    remind.classList.toggle('on', Boolean(state.settings.reminders));
  }
  updateVaultNote();
}

function renderChrome(project) {
  $('#todayCount').textContent = tasksDueToday().length;
  $('#inboxCount').textContent = inboxTasks().length;
  if (!project) {
    $('#workspaceTitle').textContent = 'Pathstone';
    $('#workspaceDesc').textContent = 'An empty vault. Add a project, capture what is circling, then choose the three that matter.';
    $('#workspaceProgress').textContent = '0%';
    $('#workspaceOpen').textContent = '0';
    $('#workspaceTarget').textContent = '—';
    $('#workspaceStatus').textContent = 'Empty';
    $('#workspaceOwner').textContent = state.settings.owner;
    $('#projectEyebrow').textContent = 'No project yet';
    $('#boardEyebrow').textContent = 'Project board';
    updateSaveState();
    renderDemoAndVaultChrome();
    setView(ui.view || 'today', false);
    return;
  }
  const stats = projectStats(project);
  $('#workspaceTitle').textContent = project.name;
  $('#workspaceDesc').textContent = project.description || 'A local project with a clear next step.';
  $('#workspaceProgress').textContent = `${stats.percent}%`;
  $('#workspaceOpen').textContent = stats.open;
  $('#workspaceTarget').textContent = project.target ? fmtMonthDay(parseKey(project.target)) : '—';
  $('#workspaceStatus').textContent = project.status || 'In progress';
  $('#workspaceOwner').textContent = project.owner || state.settings.owner;
  $('#projectEyebrow').textContent = `Project page · ${project.short || project.name}`;
  $('#boardEyebrow').textContent = `${project.short || project.name} · Project board`;
  updateSaveState();
  renderDemoAndVaultChrome();
  setView(ui.view || 'today', false);
}

function renderRail(project) {
  const projects = state.projects.map((item) => {
    const stats = projectStats(item);
    return `<button class="rail-project${item.id === (project && project.id) ? ' active' : ''}" data-project="${esc(item.id)}" style="--dot:${esc(item.color)}"><i></i>${esc(item.short || item.name)}<span>${stats.percent}%</span></button>`;
  }).join('');
  $('#railProjects').innerHTML = projects;
  const areas = Array.from(new Set(state.projects.map((item) => item.area || 'Personal')));
  $('#railAreas').innerHTML = areas.map((area) => {
    const count = state.projects.filter((item) => (item.area || 'Personal') === area).length;
    return `<button class="rail-project" data-area="${esc(area)}" style="--dot:#a79a87"><i></i>${esc(area)}<span>${count}</span></button>`;
  }).join('');
}

function taskMeta(task) {
  const project = projectForTask(task);
  const tag = task.tags && task.tags[0] ? task.tags[0] : STATUS_LABEL[task.status] || 'Task';
  return { project, tag, color: project ? project.color : '#a79a87', projectName: project ? project.short || project.name : 'No project' };
}

function taskRow(task, index, placement) {
  const meta = taskMeta(task);
  const pinned = task.top > 0;
  const pinSlot = placement === 'top' ? '0' : 'next';
  const pinLabel = placement === 'top' ? 'Remove from top three' : 'Pin to top three';
  return `<div class="task-row with-pin checkable${task.status === 'done' ? ' is-done' : ''}" data-open-task="${esc(task.id)}">
    <span class="task-num">${String(index + 1).padStart(2, '0')}</span>
    <button class="check${task.status === 'done' ? ' is-done' : ''}" type="button" data-check-task="${esc(task.id)}" aria-label="${task.status === 'done' ? 'Reopen' : 'Complete'} ${esc(task.title)}" aria-pressed="${task.status === 'done'}">${icon('i-check')}</button>
    <div class="task-main" tabindex="0" data-open-task="${esc(task.id)}">
      <span class="task-title">${esc(task.title)}</span>
      <span class="task-meta"><i style="--dot:${esc(meta.color)}"></i>${esc(meta.projectName)} · ${esc(meta.tag)}${task.repeat && task.repeat !== 'none' ? ` · ${esc(REPEAT_LABEL[task.repeat])}` : ''}</span>
    </div>
    <span class="task-est">${icon('i-clock')}${task.estimate ? fmtDuration(task.estimate) : '—'}</span>
    <span class="priority ${task.priority === 'low' ? 'low' : ''}">${task.priority || 'low'}</span>
    <button class="task-pin${pinned ? ' is-pinned' : ''}" type="button" data-pin-task="${esc(task.id)}" data-pin-slot="${pinSlot}" aria-label="${pinLabel}" title="${pinLabel}">${icon('i-star')}</button>
  </div>`;
}

function renderTopThree() {
  const top = topTasks();
  const rows = [];
  for (let index = 0; index < 3; index += 1) {
    const task = top[index];
    if (task) {
      rows.push(taskRow(task, index, 'top'));
    } else {
      rows.push(`<div class="task-row placeholder">
        <span class="task-num">${String(index + 1).padStart(2, '0')}</span>
        <button class="check" type="button" disabled aria-hidden="true">${icon('i-check')}</button>
        <div class="task-main"><span class="task-title">Choose a priority</span><span class="task-meta">Pin a task to this slot</span></div>
        <button class="mini-action" data-action="open-palette" data-mode="tasks">Pick</button>
      </div>`);
    }
  }
  $('#topThree').innerHTML = rows.join('');
}

function renderAlsoToday() {
  const also = tasksDueToday().filter((task) => !task.top).slice(0, 8);
  $('#alsoCount').textContent = `${also.length} task${also.length === 1 ? '' : 's'}`;
  if (!also.length) {
    $('#alsoToday').innerHTML = `<div class="empty-inline"><b>Nothing loose.</b>Today is down to the priorities. Let the rest wait.</div>`;
    return;
  }
  $('#alsoToday').innerHTML = also.map((task, index) => taskRow(task, index, 'also')).join('');
}

function focusWeekData() {
  const monday = weekStart(new Date());
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const key = addDays(dateKey(monday), index);
    days.push({ key, date: parseKey(key), minutes: Number(state.focusLog[key]) || 0 });
  }
  const prevDays = [];
  for (let index = 0; index < 7; index += 1) {
    const key = addDays(dateKey(monday), -7 + index);
    prevDays.push(Number(state.focusLog[key]) || 0);
  }
  return { monday, days, total: days.reduce((sum, day) => sum + day.minutes, 0), previous: prevDays.reduce((sum, value) => sum + value, 0) };
}

function renderMomentum() {
  const data = focusWeekData();
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const max = Math.max(60, ...data.days.map((day) => day.minutes));
  $('#focusWeekRange').textContent = fmtWeekRange(data.monday);
  $('#focusTotal').textContent = fmtDuration(data.total);
  const delta = data.previous ? Math.round(((data.total - data.previous) / data.previous) * 100) : 0;
  $('#focusDelta').textContent = data.previous ? `${delta >= 0 ? '+' : ''}${delta}% vs last week` : 'First week';
  $('#focusBars').innerHTML = data.days.map((day, index) => {
    const height = day.minutes ? Math.max(4, Math.round((day.minutes / max) * 63)) : 2;
    const isToday = day.key === todayKey();
    return `<div class="bar-day${isToday ? ' today' : ''}"><i style="--h:${height}px"></i><label>${labels[index]}</label></div>`;
  }).join('');
  const todayMinutes = data.days.find((day) => day.key === todayKey());
  $('#focusToday').textContent = `${fmtDuration(todayMinutes ? todayMinutes.minutes : 0)} today`;
  const goal = $('#focusGoal');
  if (goal) goal.textContent = `Goal ${fmtDuration(FOCUS_GOAL)}`;
  const runButton = $('#focusRunLabel');
  if (runButton) runButton.textContent = state.focusRun ? 'Stop focus' : 'Start focus';
  const runButtonWrap = $('#focusRunBtn');
  if (runButtonWrap) runButtonWrap.classList.toggle('running', Boolean(state.focusRun));
  tickFocusClock();
  $('#momentumProjects').innerHTML = state.projects.slice(0, 4).map((project) => {
    const stats = projectStats(project);
    return `<div class="proj-line"><span class="proj-label"><i style="--dot:${esc(project.color)}"></i>${esc(project.short || project.name)}</span><span class="proj-pct">${stats.percent}%</span><span class="proj-track"><i style="width:${stats.percent}%;--dot:${esc(project.color)}"></i></span></div>`;
  }).join('');
  const active = state.projects.filter((item) => projectStats(item).open > 0).length;
  $('#activeProjectCount').textContent = `${active} active this week`;
}

function renderCalendar() {
  const events = eventsFor(todayKey());
  if (!events.length) {
    $('#miniCal').innerHTML = `<div class="empty-inline" style="position:absolute;inset:0;display:grid;place-items:center">A clear calendar.</div>`;
    return;
  }
  $('#miniCal').innerHTML = events.map((event) => {
    const start = minutesFromTime(event.start);
    const end = minutesFromTime(event.end);
    const top = Math.max(0, ((start - 540) / 180) * 52);
    const height = Math.max(9, (Math.max(10, end - start) / 180) * 52);
    const tone = event.kind === 'meeting' ? ' grey' : event.kind === 'meeting-dark' ? ' dark' : event.kind === 'buffer' ? ' yellow' : '';
    return `<div class="cal-event${tone}" style="--top:${top};--h:${height}" title="${esc(event.start)}–${esc(event.end)} · ${esc(event.title)}">${esc(event.title)}</div>`;
  }).join('');
}

function renderShape(plan) {
  const pct = Math.min(100, Math.round((plan.used / state.settings.capacity) * 100));
  $('#shapeRing').style.setProperty('--p', pct);
  $('#shapePct').textContent = `${pct}%`;
  $('#shapeCapacityLabel').textContent = `${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} · ${fmtDuration(state.settings.capacity)} capacity`;
  $('#shapeFocus').textContent = fmtDuration(plan.planned);
  $('#shapeMeetings').textContent = fmtDuration(plan.meetings);
  $('#shapeBuffer').textContent = fmtDuration(plan.buffer);
}

function renderFlow(project) {
  if (!project) {
    $('#flowCols').innerHTML = '';
    return;
  }
  const tasks = state.tasks.filter((task) => task.projectId === project.id && task.status !== 'done' && task.status !== 'inbox' && !task.archived);
  const groups = [
    { label: 'Next up', color: '#a79a87', items: tasks.filter((task) => task.status === 'backlog') },
    { label: 'In progress', color: '#e08a6b', items: tasks.filter((task) => task.status === 'designing' || task.status === 'building') },
    { label: 'Review', color: '#8fc3a3', items: tasks.filter((task) => task.status === 'review') }
  ];
  $('#flowCols').innerHTML = groups.map((group) => {
    const cards = group.items.slice(0, 2).map((task) => `<div class="flow-card" data-open-task="${esc(task.id)}" tabindex="0"><b>${esc(task.title)}</b><small>${task.subtasks.length ? `${task.subtasks.filter((item) => item.done).length}/${task.subtasks.length} · ` : ''}${esc(relativeDue(task))}</small></div>`).join('');
    return `<div class="flow-col" style="--col:${group.color}"><div class="flow-col-head"><i></i>${group.label}<span>${group.items.length}</span></div>${cards || `<div class="flow-card"><b>Nothing here</b><small>Clean air</small></div>`}</div>`;
  }).join('');
}

function planSuggestion(text, buttonLabel, action, accent, id, dataMode) {
  return `<div class="plan-suggestion"><i class="plan-dot${accent ? ' good' : ''}"></i><p>${text}</p><button class="mini-action${accent ? ' accent' : ''}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}${dataMode ? ` data-mode="${esc(dataMode)}"` : ''}>${buttonLabel}</button></div>`;
}

function renderPlan() {
  const plan = computePlan();
  const move = movableTask();
  $('#planRing').style.setProperty('--p', plan.score);
  $('#planScore').textContent = plan.score;
  const title = plan.closed
    ? 'The day is closed'
    : plan.overdue.length ? `${plan.overdue.length} loop${plan.overdue.length === 1 ? '' : 's'} still open` : plan.pct >= 85 ? 'Today looks heavy' : plan.score >= 90 ? 'The day is ready' : 'One calm pass';
  $('#planTitle').textContent = title;
  $('#planSubtitle').textContent = plan.closed ? 'Nothing has to move tonight' : `${plan.moves} move${plan.moves === 1 ? '' : 's'} suggested · ${plan.pct}% planned`;
  $('#planReady').textContent = plan.closed ? 'See you tomorrow' : plan.moves ? 'Ready to apply' : 'No changes needed';
  const suggestions = [];
  if (plan.closed) {
    suggestions.push(planSuggestion('<b>The workday is closed.</b> Tomorrow gets chosen tomorrow.', 'Done', 'noop', true));
  } else {
    if (plan.overdue.length) {
      suggestions.push(planSuggestion(`<b>${plan.overdue.length} overdue task${plan.overdue.length === 1 ? '' : 's'}</b> belong in the backlog until they matter again.`, 'Sweep out', 'reschedule-overdue', false));
    }
    if (plan.pct >= 75 && move) {
      suggestions.push(planSuggestion(`Today is <b>${plan.pct}% full</b>. Move <b>${esc(move.title)}</b> to tomorrow.`, 'Move', 'move-low', false, move.id));
    }
    if (!plan.buffer) {
      suggestions.push(planSuggestion('No buffer on the calendar. Protect <b>45 minutes</b> this afternoon.', 'Protect', 'add-buffer', true));
    }
    if (plan.inbox.length) {
      suggestions.push(planSuggestion(`<b>${plan.inbox.length} capture${plan.inbox.length === 1 ? '' : 's'}</b> waiting. A five-minute pass would close the loop.`, 'Open inbox', 'open-inbox', true));
    }
    if (plan.backlogUndated) {
      suggestions.push(planSuggestion(`<b>${plan.backlogUndated} undated task${plan.backlogUndated === 1 ? '' : 's'}</b> rest in the backlog. Date the few that matter this week — the others can wait.`, 'Decide', 'open-palette', true, null, 'tasks'));
    }
    if (!plan.review) {
      suggestions.push(planSuggestion('The weekly review is still open.', 'Review', 'open-review', true));
    }
  }
  if (!suggestions.length) suggestions.push(planSuggestion('<b>No conflicts.</b> Keep the day quiet.', 'Done', 'noop', true));
  $('#planSuggestions').innerHTML = suggestions.join('');
  const beforeNoon = eventsFor(todayKey()).filter((event) => (event.kind === 'meeting' || event.kind === 'meeting-dark') && minutesFromTime(event.start) < 720).length;
  $('#planInsight').querySelector('span').innerHTML = `<b>Calendar insight</b> · ${beforeNoon} meeting${beforeNoon === 1 ? '' : 's'} before noon. Best focus window is 09:00–12:00.`;
  $('#planFoot').textContent = `${plan.overdue.length} overdue · ${fmtDuration(plan.planned)} focus planned`;
  const apply = $('#applyPlanBtn');
  apply.disabled = plan.moves === 0;
  apply.querySelector('span').textContent = plan.moves ? `Apply ${plan.moves} move${plan.moves === 1 ? '' : 's'}` : 'Plan is clear';
}

function renderToday(project) {
  const todayDate = new Date();
  const nowKey = todayKey();
  const completedToday = state.tasks.filter((task) => task.status === 'done' && task.completedAt && dateKey(new Date(task.completedAt)) === nowKey).length;
  const focus = Number(state.focusLog[nowKey]) || 0;
  $('#todayEyebrow').textContent = `${fmtLong(todayDate)} · Week ${isoWeek(todayDate)}`;
  $('#todayDone').textContent = completedToday;
  $('#todayFocus').textContent = fmtDuration(focus);
  $('#todayOverdue').textContent = overdueTasks().length;
  renderTopThree();
  renderAlsoToday();
  renderMomentum();
  renderFlow(project);
  const plan = computePlan();
  renderShape(plan);
  renderCalendar();
  renderPlan();
  const review = currentReview();
  $('#reviewTime').textContent = review ? `Saved ${fmtClock(new Date(review.updatedAt || review.createdAt))}` : 'Not started';
}

function boardCard(task) {
  const meta = taskMeta(task);
  const subtotal = task.subtasks.length;
  const subdone = task.subtasks.filter((item) => item.done).length;
  const progress = subtotal ? Math.round((subdone / subtotal) * 100) : 0;
  const cover = task.cover
    ? `<div class="card-cover" style="--c1:${esc(task.cover.c1)};--c2:${esc(task.cover.c2)}"><span class="cover-label">${esc(task.cover.label)}</span></div>`
    : '';
  const tagClass = task.status === 'done' ? 'done' : TAG_CLASS[meta.tag] || '';
  const tags = task.tags.slice(0, 2).map((tag, index) => `<span class="tag ${index === 0 ? esc(TAG_CLASS[tag] || tagClass) : ''}">${esc(tag)}</span>`).join(' ');
  const metaParts = [];
  metaParts.push(subtotal ? `<span>${subdone}/${subtotal}</span>` : `<span>${STATUS_LABEL[task.status]}</span>`);
  metaParts.push(`<span>${esc(relativeDue(task))}</span>`);
  if (task.archived) metaParts.push('<span>Archived</span>');
  const project = projectForTask(task);
  const person = (project && project.owner ? project.owner : state.settings.owner).charAt(0).toUpperCase();
  return `<article class="board-card" draggable="true" data-open-task="${esc(task.id)}" data-task-id="${esc(task.id)}" tabindex="0" aria-label="Open ${esc(task.title)}">
    ${cover}
    ${tags || `<span class="tag">${esc(STATUS_LABEL[task.status])}</span>`}
    <h3>${esc(task.title)}</h3>
    ${task.notes ? `<p>${esc(task.notes)}</p>` : ''}
    ${subtotal ? `<div class="card-progress${task.status === 'done' ? ' green' : ''}"><i style="width:${progress}%"></i></div>` : ''}
    <div class="board-card-meta">${metaParts.join('')}<span class="spacer"></span><span class="avatars"><i>${esc(person)}</i></span></div>
  </article>`;
}

function renderBoard(project) {
  if (!project) return;
  const stats = projectStats(project);
  $('#boardOpen').textContent = stats.open;
  $('#boardOverdue').textContent = stats.overdue;
  $('#boardComplete').textContent = `${stats.percent}%`;
  $('#boardProjectChip').textContent = project.short || project.name;
  $('#boardProjectDot').style.setProperty('--dot', project.color);
  $$('.board-toolbar [data-action="board-filter"]').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.ui.boardFilter));
  const archivedDone = state.tasks.filter((task) => task.projectId === project.id && task.status === 'done' && task.archived);
  const archiveChip = $('#archiveChip');
  archiveChip.hidden = archivedDone.length === 0;
  archiveChip.classList.toggle('active', Boolean(state.ui.showArchivedDone));
  archiveChip.textContent = state.ui.showArchivedDone ? 'Hide archive' : `Archive ${archivedDone.length}`;
  const source = state.tasks.filter((task) => {
    if (task.projectId !== project.id || task.status === 'inbox') return false;
    if (task.archived && !(task.status === 'done' && state.ui.showArchivedDone)) return false;
    if (state.ui.boardFilter === 'high' && task.priority !== 'high') return false;
    return true;
  });
  const cardsByStatus = {};
  COLUMNS.forEach((column) => { cardsByStatus[column.status] = []; });
  source.forEach((task) => {
    if (cardsByStatus[task.status]) cardsByStatus[task.status].push(task);
  });
  COLUMNS.forEach((column) => {
    cardsByStatus[column.status].sort((a, b) => {
      if (a.status === 'done' && b.status === 'done') return (b.completedAt || '').localeCompare(a.completedAt || '');
      if (a.top && b.top) return a.top - b.top;
      if (a.top) return -1;
      if (b.top) return 1;
      return (a.due || '9999').localeCompare(b.due || '9999');
    });
  });
  const archivedInDone = state.ui.showArchivedDone ? archivedDone.length : 0;
  $('#board').innerHTML = COLUMNS.map((column) => {
    const cards = cardsByStatus[column.status].map(boardCard).join('');
    const hiddenArchive = column.status === 'done' && !state.ui.showArchivedDone && archivedDone.length > 0;
    return `<div class="board-col" data-status="${column.status}" style="--col:${column.color}">
      <div class="col-head"><i></i><b>${column.label}</b><span>${cardsByStatus[column.status].length}</span><div class="right"><button type="button" data-action="new-task" data-status="${column.status}" aria-label="Add card to ${column.label}">${icon('i-plus')}</button><button type="button" data-action="noop" aria-label="Column options">${icon('i-more')}</button></div></div>
      ${cards}
      ${hiddenArchive ? `<button class="archive-link" data-action="toggle-archive">Show ${archivedDone.length} archived</button>` : ''}
      ${column.status === 'done' && archivedInDone ? `<div class="empty-inline" style="padding:6px 2px 0">${archivedInDone} archived shown</div>` : ''}
      <button class="add-card" type="button" data-action="new-task" data-status="${column.status}">${icon('i-plus')}Add a card</button>
    </div>`;
  }).join('');
  const totalCards = source.length;
  $('#boardCount').textContent = `${COLUMNS.length} columns · ${totalCards} card${totalCards === 1 ? '' : 's'}`;
}
