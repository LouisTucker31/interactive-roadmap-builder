// Project settings: general, phases, people, defaults, templates and the danger zone.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Project settings: a page of sections for this project. General (name, description,
// tag, dates at a glance), People (add, edit, merge, delete), Phases (rename, colour,
// reorder), Defaults (week start, where the project opens, what new items start with),
// Templates, and a danger zone to reset or delete the project. Name, description and
// defaults save as you type; people and phase changes go through the plan, so undo works.
var setEl = document.querySelector('[data-settings]');
var setNav = setEl.querySelector('[data-settings-nav]');
var setBody = setEl.querySelector('[data-settings-body]');
var SECTIONS = [['general', 'General'], ['people', 'People'], ['phases', 'Phases'], ['defaults', 'Defaults'], ['templates', 'Templates'], ['danger', 'Danger zone']];
var setEditing = null; // { kind: 'person' | 'phase' | 'template', id } being edited inline
var PAGES = [['', 'Where you left off'], ['timeline', 'Timeline'], ['list', 'List'], ['calendar', 'Calendar'], ['board', 'Board'], ['workload', 'Workload']];
var LENGTHS = [[0, 'No finish'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']];

function setDefault(key, value) {
  var p = project();
  p.defaults = p.defaults || {};
  if (value === '' || value == null) delete p.defaults[key];
  else p.defaults[key] = value;
  saveProjects();
}

function swatchesHtml(name, list, value, defaultColor, defaultName) {
  return '<div class="person-colors" role="radiogroup" aria-label="Colour">' +
    '<label class="swatch small"><input type="radio" name="' + name + '" value=""' + (!value ? ' checked' : '') + ' aria-label="' + defaultName + '"><span style="background: ' + defaultColor + '" title="' + defaultName + '"></span></label>' +
    list.map(function (c) {
      return '<label class="swatch small"><input type="radio" name="' + name + '" value="' + c[1] + '"' + (value === c[1] ? ' checked' : '') +
        ' aria-label="' + c[0] + '"><span style="background: ' + c[1] + '" title="' + c[0] + '"></span></label>';
    }).join('') + '</div>';
}

function phaseRows() {
  return data.rows.filter(function (r) { return r.type === 'phase'; });
}

function renderSettings() {
  var p = project();
  var d = defaults();
  var keep = setBody.scrollTop;
  setNav.innerHTML = '<div class="settings-nav-head">Project settings</div>' + SECTIONS.map(function (s) {
    return '<button type="button" class="' + (s[0] === 'danger' ? 'danger' : '') + '" data-sec="' + s[0] + '">' + s[1] + '</button>';
  }).join('');

  // General
  var starts = data.rows.map(startDay);
  var ends = data.rows.map(function (r) { return r.end != null ? r.end : startDay(r); });
  var first = starts.length ? Math.min.apply(null, starts) : null;
  var last = ends.length ? Math.max.apply(null, ends) : null;
  var on = projectTags.map(tagById).filter(Boolean);
  var count = function (type) { return data.rows.filter(function (r) { return r.type === type; }).length; };
  var html = '<section class="settings-section" id="set-general"><h2>General</h2>' +
    '<label class="settings-field"><span class="field-label">Project name</span><input type="text" maxlength="60" value="' + esc(p.name) + '" data-set-name></label>' +
    '<label class="settings-field"><span class="field-label">Description <em>optional</em></span><textarea rows="3" maxlength="600" placeholder="What this project is for, who it involves, anything worth knowing" data-set-desc>' +
    esc(p.description || '') + '</textarea></label>' +
    '<div class="settings-field"><span class="field-label">Tags</span><div class="settings-row wrap">' +
    (on.length ? on.map(function (t) { return '<span class="pill" style="--c: ' + esc(t.color) + '"># ' + esc(t.name) + '</span>'; }).join('') : '<span class="empty-value">No tags</span>') +
    '<button type="button" class="btn" data-set-tag>' + (on.length ? 'Change' : 'Add tags') + '</button></div></div>' +
    '<div class="settings-field"><span class="field-label">At a glance</span><div class="settings-glance">' +
    '<div><b>' + count('milestone') + '</b>' + (count('milestone') === 1 ? 'milestone' : 'milestones') + '</div>' +
    '<div><b>' + count('phase') + '</b>' + (count('phase') === 1 ? 'phase' : 'phases') + '</div>' +
    '<div><b>' + count('task') + '</b>' + (count('task') === 1 ? 'task' : 'tasks') + '</div>' +
    '<div><b>' + data.people.length + '</b>' + (data.people.length === 1 ? 'person' : 'people') + '</div>' +
    '<div class="wide"><b>' + (first == null ? 'None' : esc(listDate(first)) + ' – ' + esc(listDate(last))) + '</b>' +
    (first == null ? 'No dates yet' : 'First to last item, ' + esc(duration({ start: first, end: last }))) + '</div></div></div>' +
    '<p class="settings-saved" aria-live="polite" data-set-saved></p></section>';

  // People
  html += '<section class="settings-section" id="set-people"><h2>People</h2><p class="settings-desc">Everyone you can put on an item. Deleting someone unassigns their items; merging moves their items to someone else.</p><div class="settings-list">' +
    (data.people.length ? data.people.map(function (q) {
      var uses = data.rows.filter(function (r) { return r.person === q.id; }).length;
      if (setEditing && setEditing.kind === 'person' && setEditing.id === q.id) {
        return '<div class="settings-item editing" data-person-row="' + esc(q.id) + '">' + avatar(q) +
          '<input type="text" maxlength="60" value="' + esc(q.name) + '" aria-label="Name" data-edit-name>' +
          swatchesHtml('editColor', AVATAR_COLORS.map(function (c) { return ['Colour ' + c, c]; }), q.color, q.color, 'Keep colour') +
          '<div class="settings-actions"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-person-save>Save</button></div></div>';
      }
      if (setEditing && setEditing.kind === 'merge' && setEditing.id === q.id && personById(setEditing.to)) {
        var into = personById(setEditing.to);
        return '<div class="settings-item editing" data-person-row="' + esc(q.id) + '">' + avatar(q) +
          '<span class="settings-name">Move ' + (uses ? 'all ' + itemsWord(uses) : 'nothing') + ' from ' + esc(q.name) + ' to ' + esc(into.name) + ', and remove ' + esc(q.name) + '?</span>' +
          '<div class="settings-actions"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-person-merge-go>Merge</button></div></div>';
      }
      var others = data.people.filter(function (o) { return o !== q; });
      return '<div class="settings-item" data-person-row="' + esc(q.id) + '">' + avatar(q) +
        '<span class="settings-name">' + esc(q.name) + '</span><span class="settings-meta">' + itemsWord(uses) + '</span>' +
        '<div class="settings-actions">' +
        (others.length ? '<select aria-label="Merge ' + esc(q.name) + ' into" title="Merge into someone else" data-person-merge><option value="">Merge into…</option>' +
          others.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join('') + '</select>' : '') +
        '<button type="button" class="popup-edit" aria-label="Edit ' + esc(q.name) + '" title="Edit" data-person-edit>' + PENCIL + '</button>' +
        '<button type="button" class="popup-edit popup-delete" aria-label="Delete ' + esc(q.name) + '" title="Delete" data-person-del>' + TRASH_ICON + '</button>' +
        '</div></div>';
    }).join('') : '<p class="settings-empty">No people yet.</p>') +
    '</div><div class="settings-add"><input type="text" maxlength="60" placeholder="Add someone: their name" aria-label="New person\'s name" data-person-new><button type="button" class="btn" data-person-add>Add</button></div></section>';

  // Phases
  var phases = phaseRows();
  html += '<section class="settings-section" id="set-phases"><h2>Phases</h2><p class="settings-desc">The sections of the plan, in order. A colour here shows on the timeline, list, calendar and board.</p><div class="settings-list">' +
    (phases.length ? phases.map(function (ph, k) {
      var tasks = data.rows.slice(rowIndex[ph.id] + 1, sectionEnd(ph.id)).filter(function (r) { return r.type === 'task'; }).length;
      var ring = '<i class="phase-ring" style="' + colorVar(ph).slice(2) + '"></i>';
      if (setEditing && setEditing.kind === 'phase' && setEditing.id === ph.id) {
        return '<div class="settings-item editing" data-phase-row="' + esc(ph.id) + '">' + ring +
          '<input type="text" maxlength="80" value="' + esc(ph.name) + '" aria-label="Phase name" data-edit-name>' +
          swatchesHtml('editColor', COLORS, ph.color || '', '#a596ea', 'Lavender (default)') +
          '<div class="settings-actions"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-phase-save>Save</button></div></div>';
      }
      return '<div class="settings-item" data-phase-row="' + esc(ph.id) + '">' + ring +
        '<span class="settings-name">' + esc(ph.name) + '</span><span class="settings-meta">' + esc(itemLabel(ph)) + ' · ' + tasks + (tasks === 1 ? ' task' : ' tasks') + '</span>' +
        '<div class="settings-actions">' +
        '<button type="button" class="popup-edit" aria-label="Move ' + esc(ph.name) + ' up" title="Move up"' + (k ? '' : ' disabled') + ' data-phase-move="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg></button>' +
        '<button type="button" class="popup-edit" aria-label="Move ' + esc(ph.name) + ' down" title="Move down"' + (k < phases.length - 1 ? '' : ' disabled') + ' data-phase-move="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>' +
        '<button type="button" class="popup-edit" aria-label="Edit ' + esc(ph.name) + '" title="Rename or recolour" data-phase-edit>' + PENCIL + '</button>' +
        '</div></div>';
    }).join('') : '<p class="settings-empty">No phases yet. Add one with New task → Phase.</p>') + '</div></section>';

  // Defaults
  html += '<section class="settings-section" id="set-defaults"><h2>Defaults</h2>' +
    '<div class="settings-grid">' +
    '<label class="settings-field"><span class="field-label">Weeks start on</span><select data-def="weekStart"><option value="1"' + (WEEK_START === 1 ? ' selected' : '') + '>Monday</option><option value="0"' + (WEEK_START === 0 ? ' selected' : '') + '>Sunday</option></select></label>' +
    '<label class="settings-field"><span class="field-label">Open the project on</span><select data-def="openPage">' + PAGES.map(function (o) {
      return '<option value="' + o[0] + '"' + ((d.openPage || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label>' +
    '<label class="settings-field"><span class="field-label">In the view</span><select data-def="openScale"><option value="">Where you left off</option>' +
    [['H', 'Hour'], ['D', 'Day'], ['W', 'Week'], ['M', 'Month'], ['Q', 'Quarter'], ['Y', 'Year']].map(function (o) {
      return '<option value="' + o[0] + '"' + (d.openScale === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label></div>' +
    '<h3>New items start</h3><div class="settings-grid">' +
    '<label class="settings-field"><span class="field-label">At</span><select data-def="timed"><option value="">All day</option><option value="1"' + (d.timed ? ' selected' : '') + '>A set time</option></select></label>' +
    '<label class="settings-field"' + (d.timed ? '' : ' hidden') + '><span class="field-label">Time</span><input type="time" value="' + esc(d.startTime || '09:00') + '" data-def="startTime"></label>' +
    '<label class="settings-field"><span class="field-label">Finishing</span><select data-def="length">' + LENGTHS.map(function (o) {
      return '<option value="' + o[0] + '"' + ((d.length || 0) === o[0] ? ' selected' : '') + '>' + (o[0] ? o[1] + ' later' : o[1]) + '</option>';
    }).join('') + '</select></label></div>' +
    '<div class="settings-field"><span class="field-label">Task colour</span>' + swatchesHtml('defColor', COLORS.slice(1), d.color || '', COLORS[0][1], 'Blue (default)') + '</div>' +
    '<p class="settings-desc">Week start applies straight away and reloads the page. Opening defaults apply the first time the project is opened in a tab.</p></section>';

  // Templates
  html += '<section class="settings-section" id="set-templates"><h2>Templates</h2><p class="settings-desc">Start new projects from a saved copy of this one, from the project menu by the name at the top.</p>' +
    '<button type="button" class="btn" data-set-template>Save this project as a template…</button><div class="settings-list">' +
    (templates.length ? templates.map(function (tp) {
      if (setEditing && setEditing.kind === 'template' && setEditing.id === tp.id) {
        return '<div class="settings-item editing" data-template-row="' + esc(tp.id) + '"><input type="text" maxlength="60" value="' + esc(tp.name) + '" aria-label="Template name" data-edit-name>' +
          '<div class="settings-actions"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-template-save>Save</button></div></div>';
      }
      return '<div class="settings-item" data-template-row="' + esc(tp.id) + '"><span class="settings-name">' + esc(tp.name) + '</span><span class="settings-meta">' + itemsWord(tp.rows.length) + '</span>' +
        '<div class="settings-actions"><button type="button" class="popup-edit" aria-label="Rename ' + esc(tp.name) + '" title="Rename" data-template-edit>' + PENCIL + '</button>' +
        '<button type="button" class="popup-edit popup-delete" aria-label="Delete ' + esc(tp.name) + '" title="Delete template" data-template-del>' + TRASH_ICON + '</button></div></div>';
    }).join('') : '<p class="settings-empty">No templates yet.</p>') + '</div></section>';

  // Danger zone
  var only = projects.length < 2;
  html += '<section class="settings-section danger" id="set-danger"><h2>Danger zone</h2>' +
    '<div class="settings-danger"><div><b>Reset project</b><span>Remove every item and dependency, leaving it empty. People and the tag stay.</span></div><button type="button" class="btn del" data-set-reset>Reset project…</button></div>' +
    '<div class="settings-danger"><div><b>Delete project</b><span>' + (only ? 'This is your only project, so it can’t be deleted. Reset it instead.' : 'Remove the project and everything in it for good. This can’t be undone.') +
    '</span></div><button type="button" class="btn del" data-set-delete' + (only ? ' disabled' : '') + '>Delete project…</button></div></section>';

  setBody.innerHTML = html;
  setBody.scrollTop = keep;
  var editing = setBody.querySelector('[data-edit-name]');
  if (editing) {
    editing.focus();
    editing.select();
  }
}

var TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';

function flashSaved() {
  var el = setBody.querySelector('[data-set-saved]');
  if (!el) return;
  el.textContent = 'Saved';
  el.classList.add('on');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(function () { el.classList.remove('on'); }, 1200);
}

// A plan change made here: refresh every page and save, so it can be undone.
function settingsChange() {
  setEditing = null;
  refresh();
  savePlan();
}

// Rows are replaced with changed copies, so js/data.js rows stay untouched.
function changedRow(r, change) {
  var copy = {};
  Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
  change(copy);
  copy.added = true;
  return copy;
}

function addPersonHere() {
  var input = setBody.querySelector('[data-person-new]');
  var name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return input.focus();
  if (data.people.some(function (q) { return q.name.toLowerCase() === name.toLowerCase(); })) {
    input.select();
    return;
  }
  var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  var id = base;
  for (var n = 2; personById(id); n++) id = base + '-' + n;
  data.people = data.people.concat([{ id: id, name: name, color: AVATAR_COLORS[data.people.length % AVATAR_COLORS.length] }]);
  settingsChange();
  var again = setBody.querySelector('[data-person-new]');
  if (again) again.focus();
}

// Move a phase's whole section (the phase and everything up to the next phase) up or down.
function movePhase(id, dir) {
  var phases = phaseRows();
  var k = phases.map(function (x) { return x.id; }).indexOf(id);
  var other = phases[k + dir];
  if (!other) return;
  var a = dir < 0 ? other : phases[k];
  var b = dir < 0 ? phases[k] : other;
  var aFrom = rowIndex[a.id];
  var bFrom = rowIndex[b.id];
  var bTo = sectionEnd(b.id);
  data.rows = data.rows.slice(0, aFrom).concat(data.rows.slice(bFrom, bTo), data.rows.slice(aFrom, bFrom), data.rows.slice(bTo));
  settingsChange();
}

function openDeleteDialog() {
  var name = project().name;
  actForm.innerHTML = '<div class="dialog-head"><h2 id="act-title">Delete ' + esc(name) + '?</h2></div><div class="dialog-body">' +
    '<p class="act-warn">This deletes the project and all ' + itemsWord(data.rows.length) + ' in it, its people and its dependencies, for good. It can’t be undone. Your notes, tags and templates stay.</p>' +
    '<label class="checkbox"><input type="checkbox" data-del-ok> I understand this project will be gone for good</label>' +
    '<label class="field"><span class="field-label">Type <b>' + esc(name) + '</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-del-name></label></div>' +
    '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="btn del" type="submit" disabled data-del-go>Delete project</button></div>';
  actDialog.showModal();
  var ok = actForm.querySelector('[data-del-ok]');
  var typed = actForm.querySelector('[data-del-name]');
  var go = actForm.querySelector('[data-del-go]');
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
    if (go.disabled || projects.length < 2) return;
    var gone = currentId;
    projects = projects.filter(function (x) { return x.id !== gone; });
    saveProjects();
    localStore.remove(planKey(gone));
    sessionStore.remove(STORE.history);
    openProject(projects[0].id);
  };
}

setNav.addEventListener('click', function (e) {
  var b = e.target.closest('[data-sec]');
  var sec = b && setBody.querySelector('#set-' + b.getAttribute('data-sec'));
  if (sec) setBody.scrollTo({ top: sec.offsetTop - 16, behavior: 'smooth' });
});

setBody.addEventListener('input', function (e) {
  var t = e.target;
  if (t.matches('[data-set-name]')) {
    var name = t.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    project().name = name;
    saveProjects();
    renderProjBtn();
    document.title = name;
    flashSaved();
  } else if (t.matches('[data-set-desc]')) {
    project().description = t.value;
    saveProjects();
    flashSaved();
  }
});

setBody.addEventListener('change', function (e) {
  var t = e.target;
  var def = t.getAttribute('data-def');
  if (def === 'weekStart') {
    setDefault('weekStart', +t.value === 0 ? 0 : null);
    sessionStore.remove(STORE.spot);
    return location.reload(); // weeks are part of how every date is laid out
  }
  if (def === 'timed') {
    setDefault('timed', t.value ? true : null);
    return renderSettings();
  }
  if (def === 'length') return setDefault('length', +t.value || null);
  if (def) return setDefault(def, t.value || null);
  if (t.name === 'defColor') return setDefault('color', t.value || null);
  // Merging asks first, in the row: "Move 3 items to Kev and remove Kevin?"
  if (t.matches('[data-person-merge]') && t.value) {
    setEditing = { kind: 'merge', id: t.closest('[data-person-row]').getAttribute('data-person-row'), to: t.value };
    renderSettings();
  }
});

function mergePeople(from, to) {
  data.rows = data.rows.map(function (r) { return r.person === from ? changedRow(r, function (c) { c.person = to; }) : r; });
  data.people = data.people.filter(function (q) { return q.id !== from; });
  settingsChange();
}

setBody.addEventListener('click', function (e) {
  var t = e.target;
  var personRow = t.closest('[data-person-row]');
  var phaseRow = t.closest('[data-phase-row]');
  var tplRow = t.closest('[data-template-row]');
  if (t.closest('[data-set-tag]')) {
    openTagPop(true);
    return;
  }
  if (t.closest('[data-person-add]')) return addPersonHere();
  if (t.closest('[data-edit-cancel]')) {
    setEditing = null;
    return renderSettings();
  }
  if (personRow) {
    var pid = personRow.getAttribute('data-person-row');
    if (t.closest('[data-person-edit]')) {
      setEditing = { kind: 'person', id: pid };
      return renderSettings();
    }
    if (t.closest('[data-person-merge-go]')) return mergePeople(pid, setEditing.to);
    if (t.closest('[data-person-save]')) {
      var nm = personRow.querySelector('[data-edit-name]').value.trim().replace(/\s+/g, ' ');
      var col = personRow.querySelector('[name="editColor"]:checked');
      if (!nm || data.people.some(function (q) { return q.id !== pid && q.name.toLowerCase() === nm.toLowerCase(); })) {
        return personRow.querySelector('[data-edit-name]').select();
      }
      data.people = data.people.map(function (q) {
        return q.id === pid ? { id: q.id, name: nm, color: col && col.value ? col.value : q.color } : q;
      });
      return settingsChange();
    }
    var del = t.closest('[data-person-del]');
    if (del) {
      // Asks once: the first click turns the button into a confirm.
      if (!del.classList.contains('armed')) {
        var uses = data.rows.filter(function (r) { return r.person === pid; }).length;
        del.classList.add('armed');
        del.title = uses ? 'Click again to delete and unassign ' + itemsWord(uses) : 'Click again to delete';
        return;
      }
      data.people = data.people.filter(function (q) { return q.id !== pid; });
      data.rows = data.rows.map(function (r) { return r.person === pid ? changedRow(r, function (c) { delete c.person; }) : r; });
      return settingsChange();
    }
  }
  if (phaseRow) {
    var phid = phaseRow.getAttribute('data-phase-row');
    var mv = t.closest('[data-phase-move]');
    if (mv) return movePhase(phid, +mv.getAttribute('data-phase-move'));
    if (t.closest('[data-phase-edit]')) {
      setEditing = { kind: 'phase', id: phid };
      return renderSettings();
    }
    if (t.closest('[data-phase-save]')) {
      var pn = phaseRow.querySelector('[data-edit-name]').value.trim().replace(/\s+/g, ' ');
      var pc = phaseRow.querySelector('[name="editColor"]:checked');
      if (!pn) return phaseRow.querySelector('[data-edit-name]').focus();
      var i = rowIndex[phid];
      data.rows[i] = changedRow(data.rows[i], function (c) {
        c.name = pn;
        if (pc && pc.value) c.color = pc.value;
        else delete c.color;
      });
      return settingsChange();
    }
  }
  if (t.closest('[data-set-template]')) return openTemplateDialog();
  if (tplRow) {
    var tid = tplRow.getAttribute('data-template-row');
    if (t.closest('[data-template-edit]')) {
      setEditing = { kind: 'template', id: tid };
      return renderSettings();
    }
    if (t.closest('[data-template-save]')) {
      var tn = tplRow.querySelector('[data-edit-name]').value.trim().replace(/\s+/g, ' ');
      if (!tn) return;
      templates.forEach(function (x) { if (x.id === tid) x.name = tn; });
      saveTemplates();
      setEditing = null;
      return renderSettings();
    }
    var tdel = t.closest('[data-template-del]');
    if (tdel) {
      if (!tdel.classList.contains('armed')) {
        tdel.classList.add('armed');
        tdel.title = 'Click again to delete this template';
        return;
      }
      templates = templates.filter(function (x) { return x.id !== tid; });
      saveTemplates();
      return renderSettings();
    }
  }
  if (t.closest('[data-set-reset]')) return openResetDialog();
  if (t.closest('[data-set-delete]')) return openDeleteDialog();
});

setBody.addEventListener('keydown', function (e) {
  var t = e.target;
  if (e.key === 'Enter' && t.matches('[data-person-new]')) {
    e.preventDefault();
    addPersonHere();
  } else if (e.key === 'Enter' && t.matches('[data-edit-name]')) {
    e.preventDefault();
    var save = t.closest('.settings-item').querySelector('[data-person-save], [data-phase-save], [data-template-save]');
    if (save) save.click();
  } else if (e.key === 'Escape' && setEditing) {
    e.preventDefault();
    setEditing = null;
    renderSettings();
  }
});

// A template saved from here shows in the list once the dialog closes.
document.querySelector('[data-act-dialog]').addEventListener('close', function () {
  if (app.getAttribute('data-page') === 'settings') renderSettings();
});
