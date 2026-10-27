'use strict';

function renderProjectPage(project) {
  if (!project) return;
  const stats = projectStats(project);
  $('#projectComplete').textContent = `${stats.percent}%`;
  $('#projectReqCount').textContent = project.requirements.length;
  $('#projectTarget').textContent = project.target ? fmtMonthDay(parseKey(project.target)) : '—';
  const dod = project.dod.length
    ? project.dod.map((item, index) => `<div class="dod-row checkable${item.done ? ' is-done' : ''}"><button class="check${item.done ? ' is-done' : ''}" type="button" data-action="toggle-dod" data-index="${index}" aria-label="${item.done ? 'Reopen' : 'Complete'} ${esc(item.text)}" aria-pressed="${item.done}">${icon('i-check')}</button>${esc(item.text)}</div>`).join('')
    : `<div class="empty-inline">No definition of done yet.</div>`;
  const docs = project.docs.length
    ? project.docs.map((doc) => {
      const body = String(doc.body || '').replace(/\s+/g, ' ');
      return `<button class="doc-link" type="button" data-action="open-doc" data-id="${esc(doc.id)}">${icon('i-doc')}<span><b>${esc(doc.title)}</b><span>${esc(body.slice(0, 48))}${body.length > 48 ? '…' : ''}</span></span></button>`;
    }).join('')
    : `<div class="empty-inline" style="padding:8px">No notes yet. Add the durable context before it evaporates.</div>`;
  const requirements = project.requirements.length
    ? project.requirements.map((req) => `<div class="req-row"><span class="req-id">${esc(req.id)}</span><div class="req-name">${esc(req.name)}<small>${esc(req.detail)}</small></div><span class="status ${req.status === 'done' ? 'done' : req.status === 'build' ? 'build' : 'next'}">${req.status === 'done' ? 'Done' : req.status === 'build' ? 'Building' : 'Next'}</span></div>`).join('')
    : `<div class="empty-inline">No requirements captured.</div>`;
  const projectTasks = state.tasks.filter((task) => task.projectId === project.id && task.status !== 'done' && task.status !== 'inbox' && !task.archived);
  const linked = (projectTasks.filter((task) => task.top).length ? projectTasks.filter((task) => task.top).sort((a, b) => a.top - b.top) : projectTasks.slice(0, 3)).slice(0, 3);
  const links = linked.length
    ? linked.map((task) => `<div class="link-row checkable" data-open-task="${esc(task.id)}"><button class="check" type="button" data-check-task="${esc(task.id)}" aria-label="Complete ${esc(task.title)}" aria-pressed="false">${icon('i-check')}</button><b>${esc(task.title)}</b><span>${esc(relativeDue(task))}</span></div>`).join('')
    : `<div class="empty-inline">No linked tasks yet.</div>`;
  const updated = state.meta.lastSaved ? fmtClock(new Date(state.meta.lastSaved)) : 'just now';
  $('#projectContent').innerHTML = `<div class="project-stack">
    <section class="panel doc-panel">
      <h2>Why this exists</h2>
      <p>${esc(project.description || 'A project with no brief yet. Write down the clear next step.')}</p>
      <h3>Product principles</h3>
      <p>${esc(project.principles || 'One clear next step. Capacity is real. Completion is memory.')}</p>
      <h3>Definition of done</h3>
      <div class="dod">${dod}</div>
      <div class="doc-foot">${icon('i-lock')}Saved locally · last edit ${updated}</div>
    </section>
    <section class="panel doc-panel">
      <div class="card-head"><h3 style="margin:0">Working docs</h3><button class="mini-action" type="button" data-action="add-doc">${icon('i-plus')}Add note</button></div>
      <div class="docs-grid">${docs}</div>
    </section>
  </div>
  <div class="project-stack">
    <section class="panel project-props">
      <div class="card-head"><h2>Project page</h2><span>Living document</span></div>
      <div class="progress-ring-row">
        <div class="ring" style="--p:${stats.percent}"><div class="ring-text"><b>${stats.percent}</b><span>done</span></div></div>
        <div class="progress-copy"><b>${esc(project.short || project.name)}</b><span>${stats.open} open · ${stats.overdue} overdue · ${stats.done} done</span></div>
      </div>
      <div class="prop-list">
        <div class="prop-row">Owner<b>${esc(project.owner || state.settings.owner)}</b></div>
        <div class="prop-row">Area<b>${esc(project.area || 'Personal')}</b></div>
        <div class="prop-row">Target<b>${project.target ? fmtMonthDay(parseKey(project.target)) : 'Not set'}</b></div>
        <div class="prop-row">Visibility<b>Local vault</b></div>
        <div class="prop-row">Sync<b>Off by default</b></div>
      </div>
    </section>
    <section class="panel req-card">
      <div class="card-head"><h2>Requirements</h2><span>${project.requirements.length} items</span></div>
      <div class="req-list">${requirements}</div>
    </section>
    <section class="panel req-card">
      <div class="card-head"><h2>Linked tasks</h2><span>${linked.length} shown</span></div>
      <div class="link-list">${links}</div>
    </section>
    <section class="panel project-local">
      <h2>Local-first promise</h2>
      <p>Tasks, notes, and reviews stay in this browser by default. Sync is a choice, not a requirement.</p>
      <button type="button" data-action="export">${icon('i-download')}Export my data</button>
    </section>
  </div>`;
}

function renderInbox() {
  const tasks = inboxTasks();
  $('#inboxFoot').textContent = tasks.length ? `${tasks.length} capture${tasks.length === 1 ? '' : 's'} · nothing leaves this device` : 'Inbox zero · nothing leaves this device';
  if (!tasks.length) {
    $('#inboxList').innerHTML = `<div class="empty-inline" style="padding-top:40px"><b>Inbox zero.</b>Nothing is circling. Keep it that way for a minute.</div>`;
    return;
  }
  $('#inboxList').innerHTML = tasks.map((task) => `<div class="inbox-item">
    <h3>${esc(task.title)}</h3>
    <p>${esc(task.notes || 'Captured with no context. That is allowed.')}</p>
    <p>${fmtMonthDay(new Date(task.createdAt))} · ${task.estimate ? fmtDuration(task.estimate) : 'No estimate'}</p>
    <div class="inbox-actions">
      <button type="button" data-action="inbox-today" data-id="${esc(task.id)}">Today</button>
      <button type="button" class="do" data-action="inbox-done" data-id="${esc(task.id)}">Done</button>
      <button type="button" data-action="inbox-edit" data-id="${esc(task.id)}">Edit</button>
      <button type="button" class="del" data-action="inbox-delete" data-id="${esc(task.id)}">Delete</button>
    </div>
  </div>`).join('');
}

function renderSubtasks() {
  const list = $('#subtaskList');
  if (!list) return;
  if (!ui.draftSubtasks.length) {
    list.innerHTML = `<div class="empty-inline" style="padding:7px 0;text-align:left">No checklist yet.</div>`;
    return;
  }
  list.innerHTML = ui.draftSubtasks.map((item, index) => `<div class="subtask-row">
    <button class="check${item.done ? ' is-done' : ''}" type="button" data-subtask-toggle="${index}" aria-pressed="${item.done}" aria-label="${item.done ? 'Reopen' : 'Complete'} ${esc(item.text)}">${icon('i-check')}</button>
    <input type="text" value="${esc(item.text)}" data-subtask-text="${index}" aria-label="Checklist item">
    <button class="remove" type="button" data-subtask-remove="${index}" aria-label="Remove checklist item">Remove</button>
  </div>`).join('');
}

function paletteAction(name, label, hint, iconName) {
  return { kind: 'action', id: name, title: label, hint, icon: iconName };
}

function paletteMatches(value, query) {
  return String(value || '').toLowerCase().includes(query);
}

function renderPalette() {
  if (!state) return;
  const input = $('#paletteInput');
  const query = (input.value || '').trim().toLowerCase();
  const mode = ui.paletteMode;
  const items = [];
  if (mode === 'projects') {
    state.projects
      .filter((project) => !query || paletteMatches(`${project.name} ${project.area} ${project.description}`, query))
      .forEach((project) => {
        const stats = projectStats(project);
        items.push({ kind: 'project', id: project.id, title: project.short || project.name, hint: `${project.area || 'Personal'} · ${stats.open} open · ${stats.percent}% done`, icon: 'i-board' });
      });
    $('#paletteTitle').textContent = 'Projects';
  } else if (mode === 'tasks') {
    state.tasks
      .filter((task) => task.status !== 'done' && !task.archived)
      .filter((task) => !query || paletteMatches(`${task.title} ${task.notes} ${task.tags.join(' ')} ${(projectForTask(task) || {}).short || ''}`, query))
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
      .slice(0, 30)
      .forEach((task) => {
        const meta = taskMeta(task);
        items.push({ kind: 'task', id: task.id, title: task.title, hint: `${meta.projectName} · ${relativeDue(task)} · ${STATUS_LABEL[task.status]}`, icon: 'i-doc' });
      });
    $('#paletteTitle').textContent = 'Choose a task';
  } else {
    if (!query) {
      items.push(paletteAction('new-task', 'New task', 'Capture, estimate, and place the next action', 'i-plus'));
      items.push(paletteAction('open-inbox', 'Open inbox', `${inboxTasks().length} captures waiting`, 'i-inbox'));
      items.push(paletteAction('open-review', 'Weekly review', 'Close the week with three honest lines', 'i-review'));
      items.push(paletteAction('project-palette', 'Switch project', 'Jump to another living workspace', 'i-board'));
      items.push(paletteAction('add-project', 'New project', 'Start another living workspace', 'i-plus'));
      items.push(paletteAction('export', 'Export local vault', 'Download a JSON copy of everything', 'i-download'));
    } else {
      state.projects
        .filter((project) => paletteMatches(`${project.name} ${project.area} ${project.description}`, query))
        .slice(0, 5)
        .forEach((project) => {
          const stats = projectStats(project);
          items.push({ kind: 'project', id: project.id, title: project.short || project.name, hint: `Project · ${stats.open} open · ${stats.percent}% done`, icon: 'i-board' });
        });
      state.tasks
        .filter((task) => paletteMatches(`${task.title} ${task.notes} ${task.tags.join(' ')} ${(projectForTask(task) || {}).short || ''}`, query))
        .sort((a, b) => (b.status === 'inbox') - (a.status === 'inbox') || (a.due || '9999').localeCompare(b.due || '9999'))
        .slice(0, 14)
        .forEach((task) => {
          const meta = taskMeta(task);
          items.push({ kind: 'task', id: task.id, title: task.title, hint: `${meta.projectName} · ${relativeDue(task)} · ${STATUS_LABEL[task.status]}`, icon: 'i-doc' });
        });
      const actions = [
        paletteAction('new-task', 'New task', 'Capture a new action', 'i-plus'),
        paletteAction('open-inbox', 'Open inbox', `${inboxTasks().length} captures waiting`, 'i-inbox'),
        paletteAction('open-review', 'Weekly review', 'Close the week', 'i-review'),
        paletteAction('add-project', 'New project', 'Start another living workspace', 'i-plus'),
        paletteAction('export', 'Export local vault', 'Download a JSON copy', 'i-download')
      ].filter((item) => paletteMatches(`${item.title} ${item.hint}`, query));
      if (actions.length) items.push(...actions.slice(0, 4));
    }
    $('#paletteTitle').textContent = query ? 'Search results' : 'Quick actions';
  }
  ui.paletteIndex = Math.max(0, Math.min(ui.paletteIndex, Math.max(0, items.length - 1)));
  if (!items.length) {
    $('#paletteResults').innerHTML = `<div class="palette-empty">No matches. Try a project, a tag, or a looser phrase.</div>`;
    return;
  }
  $('#paletteResults').innerHTML = items.map((item, index) => `<button class="palette-result${index === ui.paletteIndex ? ' active' : ''}" type="button" data-result data-kind="${item.kind}" data-id="${esc(item.id)}">
    ${icon(item.icon)}<span style="min-width:0"><b>${esc(item.title)}</b><span>${esc(item.hint)}</span></span><span class="kind">${item.kind === 'task' ? 'Task' : item.kind === 'project' ? 'Project' : 'Action'}</span>
  </button>`).join('');
}

function markPaletteActive() {
  const results = $$('.palette-result');
  if (!results.length) return;
  ui.paletteIndex = Math.max(0, Math.min(ui.paletteIndex, results.length - 1));
  results.forEach((result, index) => result.classList.toggle('active', index === ui.paletteIndex));
  const active = results[ui.paletteIndex];
  if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
}
