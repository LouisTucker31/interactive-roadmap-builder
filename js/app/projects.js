// Templates, the project switcher, the Actions menu and its dialog.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Copies of the plan as it is now, for a duplicate or a template: js/data.js rows become
// ordinary saved rows so the copy stands on its own.
function planCopy() {
  return JSON.parse(JSON.stringify({ rows: data.rows, deps: data.deps, people: data.people }));
}

function savedPlan(rows, deps, people) {
  return {
    sig: data.sig,
    planStart: PLAN_START,
    rows: rows.map(function (r) { r.added = true; return r; }),
    deps: deps,
    people: people
  };
}

// Templates: a project's items saved to start new projects from. Progress is cleared, and
// dates are kept relative to the first day so a new project starts from today.
var templates = localStore.getJSON(STORE.templates);
if (!Array.isArray(templates)) templates = [];

function saveTemplates() {
  saveData(STORE.templates, JSON.stringify(templates));
}

// Project switcher: click the project name to open another project, rename or delete
// one, or start a new project, blank or from a template.
var projBtn = document.querySelector('[data-project-btn]');
var projPop = document.querySelector('[data-project-pop]');
var projMode = null; // null for the list, or { kind: 'rename' | 'new', id, template }

function renderProjBtn() {
  projBtn.textContent = project().name;
}

function renderProjPop() {
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
  if (projMode) {
    var m = projMode;
    var p = m.kind === 'rename' ? projects.filter(function (x) { return x.id === m.id; })[0] : null;
    var t = m.template ? templates.filter(function (x) { return x.id === m.template; })[0] : null;
    var title = m.kind === 'rename' ? 'Rename project' : t ? 'New project from ' + t.name : 'New project';
    var value = p ? p.name : t ? t.name : '';
    projPop.innerHTML = '<div class="popup-head">' + esc(title) + '</div><div class="popup-body">' +
      '<input type="text" maxlength="60" placeholder="Project name" aria-label="Project name" value="' + esc(value) + '" data-proj-name>' +
      (t ? '<p class="popup-note">Its items start from today, with progress cleared.</p>' : '') +
      '<p class="popup-error" hidden data-proj-err></p></div>' +
      '<div class="popup-foot"><button class="btn" type="button" data-proj-back>Cancel</button><button class="primary" type="button" data-proj-save>' +
      (m.kind === 'rename' ? 'Save' : 'Create and open') + '</button></div>';
    projPop.querySelector('[data-proj-name]').select();
    return;
  }
  projPop.innerHTML = '<div class="popup-head">Projects</div><div class="popup-body"><div class="popup-list" role="listbox" aria-label="Projects">' +
    projects.map(function (p) {
      var on = p.id === currentId;
      return '<div class="popup-row' + (on ? ' on' : '') + '"><button type="button" class="popup-pick" role="option" aria-selected="' + on + '" data-proj-open="' + esc(p.id) + '">' +
        '<span>' + esc(p.name) + '</span></button>' +
        '<button type="button" class="popup-edit" aria-label="Rename ' + esc(p.name) + '" title="Rename" data-proj-rename="' + esc(p.id) + '">' + PENCIL + '</button>' +
        (on ? '' : '<button type="button" class="popup-edit popup-delete" aria-label="Delete ' + esc(p.name) + '" title="Delete project" data-proj-del="' + esc(p.id) + '">' + TRASH + '</button>') +
        '</div>';
    }).join('') + '</div>' +
    '<button type="button" class="popup-create" data-proj-new>+ New blank project</button>' +
    (templates.length ? '<div class="popup-subhead">From a template</div><div class="popup-list">' + templates.map(function (t) {
      return '<div class="popup-row"><button type="button" class="popup-pick" data-proj-template="' + esc(t.id) + '"><span>' + esc(t.name) + '</span>' +
        '<em>' + itemsWord(t.rows.length) + '</em></button>' +
        '<button type="button" class="popup-edit popup-delete" aria-label="Delete template ' + esc(t.name) + '" title="Delete template" data-template-del="' + esc(t.id) + '">' + TRASH + '</button></div>';
    }).join('') + '</div>' : '') +
    '</div>';
  var cur = projPop.querySelector('[aria-selected="true"]');
  if (cur) cur.focus();
}

function openProjPop(open) {
  projMode = null;
  projPop.hidden = !open;
  projBtn.setAttribute('aria-expanded', String(open));
  if (open) renderProjPop();
}

function saveProjName() {
  var input = projPop.querySelector('[data-proj-name]');
  var name = input.value.trim().replace(/\s+/g, ' ');
  var err = projPop.querySelector('[data-proj-err]');
  if (!name) {
    err.textContent = 'Give the project a name.';
    err.hidden = false;
    return input.focus();
  }
  if (projMode.kind === 'rename') {
    projects.filter(function (p) { return p.id === projMode.id; })[0].name = name;
    saveProjects();
    renderProjBtn();
    document.title = project().name;
    projMode = null;
    return renderProjPop();
  }
  var id = projectId(name);
  var t = projMode.template ? templates.filter(function (x) { return x.id === projMode.template; })[0] : null;
  if (t) {
    var copy = JSON.parse(JSON.stringify(t));
    var shift = (TODAY - PLAN_START) / DAY - t.day0; // the template's first day lands on today
    copy.rows.forEach(function (r) {
      ['start', 'end', 'day'].forEach(function (k) { if (r[k] != null) r[k] += shift; });
    });
    saveData(planKey(id), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people)));
  }
  projects.push({ id: id, name: name, tags: t ? t.tags || (t.tag ? [t.tag] : []) : [] });
  saveProjects();
  openProject(id);
}

projBtn.addEventListener('click', function () { openProjPop(projPop.hidden); });
projPop.addEventListener('click', function (e) {
  var t = e.target;
  var open = t.closest('[data-proj-open]');
  var rename = t.closest('[data-proj-rename]');
  var del = t.closest('[data-proj-del]');
  var tpl = t.closest('[data-proj-template]');
  var tplDel = t.closest('[data-template-del]');
  if (open) {
    var id = open.getAttribute('data-proj-open');
    if (id === currentId) return openProjPop(false);
    return openProject(id);
  }
  if (rename) projMode = { kind: 'rename', id: rename.getAttribute('data-proj-rename') };
  else if (t.closest('[data-proj-new]')) projMode = { kind: 'new' };
  else if (tpl) projMode = { kind: 'new', template: tpl.getAttribute('data-proj-template') };
  else if (t.closest('[data-proj-back]')) projMode = null;
  else if (t.closest('[data-proj-save]')) return saveProjName();
  else if (del || tplDel) {
    // Deleting asks once: the first click turns the button into a confirm.
    var btn = del || tplDel;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.title = del ? 'Click again to delete this project and everything in it' : 'Click again to delete this template';
      return;
    }
    if (del) {
      var gone = del.getAttribute('data-proj-del');
      projects = projects.filter(function (p) { return p.id !== gone; });
      localStore.remove(planKey(gone));
      saveProjects();
    } else {
      var goneT = tplDel.getAttribute('data-template-del');
      templates = templates.filter(function (x) { return x.id !== goneT; });
      saveTemplates();
    }
  } else {
    return;
  }
  renderProjPop();
});
projPop.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (projMode) {
      projMode = null;
      return renderProjPop();
    }
    openProjPop(false);
    return projBtn.focus();
  }
  if (e.key === 'Enter' && e.target.matches('[data-proj-name]')) {
    e.preventDefault();
    saveProjName();
  }
});
document.addEventListener('pointerdown', function (e) {
  if (!projPop.hidden && !e.target.closest('.project-wrap')) openProjPop(false);
});
renderProjBtn();

// Actions: duplicate the project, save it as a template, or reset it. Reset takes several
// deliberate steps.
var actBtn = document.querySelector('[data-actions-btn]');
var actMenu = document.querySelector('[data-actions-menu]');
var actDialog = document.querySelector('[data-act-dialog]');
var actForm = actDialog.querySelector('[data-act-form]');
var actItems = Array.prototype.slice.call(actMenu.querySelectorAll('[data-act]'));

function showActMenu(open) {
  actMenu.hidden = !open;
  actBtn.setAttribute('aria-expanded', String(open));
  if (open) actItems[0].focus();
}

function duplicateProject() {
  var copy = planCopy();
  var name = project().name + ' (copy)';
  var id = projectId(name);
  saveData(planKey(id), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people)));
  projects.push({ id: id, name: name, tags: projectTags.slice() });
  saveProjects();
  openProject(id);
}

// The small dialog: Save as template asks for a name; Reset asks you to tick that you
// understand and to type the project's name before the button will work.
function openTemplateDialog() {
  actForm.innerHTML = '<div class="dialog-head"><h2 id="act-title">Save as template</h2></div><div class="dialog-body">' +
    '<label class="field"><span class="field-label">Template name</span><input type="text" maxlength="60" value="' + esc(project().name) + '" data-tpl-name></label>' +
    '<p class="act-note">Saves all ' + itemsWord(data.rows.length) + ', their dependencies and people. Progress is cleared, and dates move so a new project starts from the day it’s made.</p>' +
    '<p class="act-note" hidden data-tpl-replace></p></div>' +
    '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="primary" type="submit" data-tpl-save>Save template</button></div>';
  actDialog.showModal();
  var input = actForm.querySelector('[data-tpl-name]');
  var sync = function () {
    var same = templates.filter(function (t) { return t.name.toLowerCase() === input.value.trim().toLowerCase(); })[0];
    var note = actForm.querySelector('[data-tpl-replace]');
    note.hidden = !same;
    note.textContent = same ? 'There’s already a template called ' + same.name + '; this replaces it.' : '';
    actForm.querySelector('[data-tpl-save]').textContent = same ? 'Replace template' : 'Save template';
    actForm.querySelector('[data-tpl-save]').disabled = !input.value.trim();
  };
  input.addEventListener('input', sync);
  sync();
  input.select();
  actForm.onsubmit = function (e) {
    e.preventDefault();
    var name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    var copy = planCopy();
    copy.rows.forEach(function (r) { delete r.progress; });
    var day0 = copy.rows.length ? Math.floor(Math.min.apply(null, copy.rows.map(startDay))) : 0;
    var same = templates.filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
    var tpl = { id: same ? same.id : 'tpl-' + Date.now().toString(36), name: name, tags: projectTags.slice(), day0: day0, rows: copy.rows, deps: copy.deps, people: copy.people };
    templates = templates.filter(function (t) { return t !== same; }).concat([tpl]);
    saveTemplates();
    actDialog.close();
  };
}

function openResetDialog() {
  var name = project().name;
  var nRows = data.rows.length;
  actForm.innerHTML = '<div class="dialog-head"><h2 id="act-title">Reset ' + esc(name) + '?</h2></div><div class="dialog-body">' +
    '<p class="act-warn">This removes all ' + itemsWord(nRows) + ' and ' + data.deps.length + (data.deps.length === 1 ? ' dependency' : ' dependencies') +
    ' from this project, leaving it empty. Its people, tag and your notes stay.</p>' +
    '<label class="checkbox"><input type="checkbox" data-reset-ok> I understand everything in this project will be removed</label>' +
    '<label class="field"><span class="field-label">Type <b>' + esc(name) + '</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-reset-name></label>' +
    '<p class="act-note">Changed your mind straight after? Undo (Ctrl+Z) brings it all back.</p></div>' +
    '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="btn del" type="submit" disabled data-reset-go>Reset project</button></div>';
  actDialog.showModal();
  var ok = actForm.querySelector('[data-reset-ok]');
  var typed = actForm.querySelector('[data-reset-name]');
  var go = actForm.querySelector('[data-reset-go]');
  var sync = function () {
    var ready = ok.checked && typed.value.trim() === name;
    go.disabled = !ready;
    go.classList.toggle('armed', ready);
  };
  ok.addEventListener('change', sync);
  typed.addEventListener('input', sync);
  actForm.querySelector('[data-act-close]').focus();
  actForm.onsubmit = function (e) {
    e.preventDefault();
    if (go.disabled) return;
    data.rows = [];
    data.deps = [];
    closePeek();
    refresh();
    savePlan();
    actDialog.close();
  };
}

actBtn.addEventListener('click', function () { showActMenu(actMenu.hidden); });
actMenu.addEventListener('click', function (e) {
  var item = e.target.closest('[data-act]');
  if (!item) return;
  showActMenu(false);
  var act = item.getAttribute('data-act');
  if (act === 'duplicate') duplicateProject();
  else if (act === 'template') openTemplateDialog();
  else if (act === 'reset') openResetDialog();
});
actMenu.addEventListener('keydown', function (e) {
  var i = actItems.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    showActMenu(false);
    actBtn.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    actItems[(i + (e.key === 'ArrowDown' ? 1 : actItems.length - 1)) % actItems.length].focus();
  }
});
document.addEventListener('click', function (e) {
  if (!actMenu.hidden && !e.target.closest('.actions-wrap')) showActMenu(false);
});
actDialog.addEventListener('click', function (e) {
  if (e.target === actDialog || e.target.closest('[data-act-close]')) actDialog.close();
});
