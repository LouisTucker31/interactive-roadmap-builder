// The task form: creating and editing tasks, milestones and phases, people, dependencies and deleting.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Task form: creates a task, milestone or phase row, or edits one. Everything js/data.js
// can describe can be entered here: name, dates (optionally with times), colour, phase,
// parent task, progress and dependencies. A new row goes at the end of its phase, or
// straight after its parent's other subtasks; an edited row moves only if its phase or
// parent changed.
var dialog = document.querySelector('[data-new-dialog]');
var form = dialog.querySelector('[data-new-form]');
var newBtn = document.querySelector('[data-new-task]');
var errEl = form.querySelector('[data-nt-error]');
var deleteBtn = form.querySelector('[data-nt-delete]');
var editing = null; // the row being edited, or null when creating

function formType() {
  return form.elements.type.value;
}

// A top-level task's subtasks sit directly below it.
function childCount(row) {
  var i = rowIndex[row.id] + 1;
  var n = 0;
  while (i + n < data.rows.length && data.rows[i + n].parent === row.id) n++;
  return n;
}

// The phase a row belongs to: the nearest phase above it, or '' for none.
function phaseOf(row) {
  for (var i = rowIndex[row.id] - 1; i >= 0; i--) if (data.rows[i].type === 'phase') return data.rows[i].id;
  return '';
}

// Show only the fields that apply to the chosen type.
function syncForm() {
  var type = formType();
  var word = type;
  var allDay = form.elements.allDay.checked;
  // data-for lists the types a field applies to; data-time fields also need All day off.
  Array.prototype.forEach.call(form.querySelectorAll('[data-for],[data-time]'), function (el) {
    var types = el.getAttribute('data-for');
    el.hidden = (types && types.split(' ').indexOf(type) < 0) || (el.hasAttribute('data-time') && allDay);
  });
  // Every type's finish is optional, and a new row starts without one: a task or
  // milestone without one happens at a moment, a phase runs until the next phase.
  form.querySelector('[data-start-label]').textContent = type === 'task' ? 'Start' : 'Starts';
  form.querySelector('[data-end-label]').innerHTML = (type === 'task' ? 'Finish' : 'Ends') + ' <em>optional</em>';
  form.querySelector('[data-end-clear]').hidden = !form.elements.endDate.value;
  form.querySelector('[data-nt-title]').textContent = (editing ? 'Edit ' : 'New ') + word;
  form.querySelector('[data-nt-submit]').textContent = editing ? 'Save changes' : 'Create ' + word;
  // A subtask sits under its parent, so its phase comes from there.
  form.elements.phase.disabled = type === 'task' && !!form.elements.parent.value;
  form.querySelector('[data-progress-out]').textContent = form.elements.progress.value + '%';
  var deps = form.querySelectorAll('[name="deps"]:checked').length;
  form.querySelector('[data-deps-count]').textContent = deps ? deps + ' selected' : '';
}

// Phases split the rows into sections: rows before the first phase have none.
function sectionEnd(phaseId) {
  var from = phaseId ? rowIndex[phaseId] : -1;
  for (var i = from + 1; i < data.rows.length; i++) if (data.rows[i].type === 'phase') return i;
  return data.rows.length;
}

function fillOptions(row) {
  var phases = data.rows.filter(function (r) { return r.type === 'phase'; });
  form.elements.phase.innerHTML = '<option value="">No phase</option>' + phases.map(function (p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
  }).join('');
  form.elements.phase.value = phases.length ? phases[phases.length - 1].id : '';

  // Subtasks only go one level deep, so a task that has subtasks can't become one.
  var hasKids = row && row.type === 'task' && childCount(row) > 0;
  form.elements.parent.innerHTML = '<option value="">None (top level)</option>' + (hasKids ? '' : data.rows.filter(function (r) {
    return r.type === 'task' && !r.parent && r !== row;
  }).map(function (r) {
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join(''));
  form.elements.parent.disabled = hasKids;
  form.elements.parent.title = hasKids ? 'This task has subtasks of its own' : '';

  form.querySelector('[data-colors]').innerHTML = COLORS.map(function (c, i) {
    return '<label class="swatch"><input type="radio" name="color" value="' + (i ? c[1] : '') + '"' + (i ? '' : ' checked') +
      ' aria-label="' + c[0] + '"><span style="background: ' + c[1] + '" title="' + c[0] + '"></span></label>';
  }).join('');

  fillPeople('');
  hidePersonBox();

  form.querySelector('[data-dep-options]').innerHTML = data.rows.filter(function (r) {
    return (r.type === 'task' || r.type === 'milestone') && r !== row;
  }).map(function (r) {
    return '<label class="dep-option' + (r.parent ? ' sub' : '') + '"><input type="checkbox" name="deps" value="' + esc(r.id) + '">' +
      '<i class="' + (r.type === 'milestone' ? 'ms' : 'tk') + '" style="' + colorVar(r).slice(2) + '"></i><span>' + esc(r.name) + '</span>' +
      '<em>' + itemLabel(r) + '</em></label>';
  }).join('') || '<p class="deps-empty">Nothing to depend on yet. Tasks and milestones you add appear here.</p>';
}

// Opens the form empty to create a row, or filled in from `row` to edit it. `spot`
// (from clicking empty chart space) gives a new row's start time and phase.
function openForm(row, spot) {
  editing = row && row.type ? row : null;
  form.reset();
  fillOptions(editing);
  if (spot && spot.phase != null) form.elements.phase.value = spot.phase;
  if (spot && spot.person) pickPerson(spot.person); // clicked in someone's workload row
  var f = form.elements;
  Array.prototype.forEach.call(f.type, function (r) { r.disabled = !!editing; });
  deleteBtn.hidden = !editing;
  armDelete(false);

  if (editing) {
    f.type.value = row.type;
    f.name.value = row.name;
    var start = row.type === 'milestone' ? row.day : row.start;
    var timed = start % 1 !== 0 || (row.end != null && row.end % 1 !== 0);
    f.allDay.checked = !timed;
    f.startDate.value = dateOf(start);
    if (timed) f.startTime.value = timeOf(start);
    f.endDate.value = row.end == null ? '' : timed ? dateOf(row.end) : dateOf(row.end - 1);
    if (timed && row.end != null) f.endTime.value = timeOf(row.end);
    if (row.type === 'task') {
      f.parent.value = row.parent || '';
      f.progress.value = Math.round((row.progress || 0) * 100);
      var swatch = form.querySelector('[name="color"][value="' + (row.color || '') + '"]');
      if (swatch) swatch.checked = true;
    }
    if (row.type !== 'phase') f.phase.value = phaseOf(row.parent ? data.rows[rowIndex[row.parent]] : row);
    if (personById(row.person)) fillPeople(row.person);
    data.deps.forEach(function (dep) {
      if (dep[1] !== row.id) return;
      var box = form.querySelector('[name="deps"][value="' + dep[0] + '"]');
      if (box) box.checked = true;
    });
  } else if (spot && scale.unit !== 'hour') {
    f.startDate.value = isoDate(spot.time); // the clicked day
  } else if (scale.unit === 'hour') {
    // Hour view: at the clicked time, or the next hour after now, or a quarter of the
    // way into the view when now is off screen.
    var left = timeAt(scroller.scrollLeft);
    var right = timeAt(scroller.scrollLeft + scroller.clientWidth);
    var t = spot ? spot.time : NOW >= left && NOW < right ? startOf(NOW, 'hour') + HOUR : startOf((3 * left + right) / 4, 'hour');
    f.allDay.checked = false;
    f.startDate.value = isoDate(t);
    f.startTime.value = clockOf(t);
  } else {
    // Start on the date at the left of the view if today is off screen, otherwise today.
    var leftDay = startOf(timeAt(scroller.scrollLeft), 'day');
    var rightDay = timeAt(scroller.scrollLeft + scroller.clientWidth);
    var day = TODAY >= leftDay && TODAY < rightDay ? TODAY : leftDay;
    f.startDate.value = isoDate(day);
  }
  if (!editing) applyDefaults(!!spot);
  errEl.hidden = true;
  foldDeps(false);
  syncForm();
  dialog.showModal();
  f.name.focus();
  if (editing) f.name.select();
}

// Person picker: a circle for Unassigned, one per person (their initials) and + to add
// someone. The chosen person's name shows underneath with Edit and Delete. Adding and
// editing use the box that opens below (name and avatar colour); a new name matching
// someone already there just picks them. Edits and deletes apply straight away and can
// be undone; a deleted person comes off every item they were on.
var peopleEl = form.querySelector('[data-people]');
var personSelEl = form.querySelector('[data-person-sel]');
var newPersonEl = form.querySelector('[data-new-person]');
var personEditing = null; // the person open in the box, or null when adding someone

function chosenPerson() {
  var r = peopleEl.querySelector('[name="person"]:checked');
  return r ? personById(r.value) : null;
}

function pickPerson(id) {
  var r = peopleEl.querySelector('[name="person"][value="' + (personById(id) ? id : '') + '"]');
  if (r) r.checked = true;
  syncPersonSel();
}

function fillPeople(value) {
  peopleEl.innerHTML =
    '<label class="person-pick" title="Unassigned"><input type="radio" name="person" value="" aria-label="Unassigned"><span class="person-avatar none"></span></label>' +
    data.people.map(function (p) {
      return '<label class="person-pick" title="' + esc(p.name) + '"><input type="radio" name="person" value="' + esc(p.id) + '" aria-label="' + esc(p.name) + '">' + avatar(p) + '</label>';
    }).join('') +
    '<button type="button" class="person-add" aria-label="New person" title="New person" data-new-person-btn>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></button>';
  pickPerson(value);
}

function syncPersonSel() {
  var p = chosenPerson();
  personSelEl.innerHTML = p
    ? '<span class="person-name">' + esc(p.name) + '</span><button type="button" data-edit-person>Edit</button>' +
      '<button type="button" class="person-delete" data-remove-person>Delete</button>'
    : '<span class="empty-value">Unassigned</span>';
}

function showPersonBox(person) {
  personEditing = person;
  newPersonEl.hidden = false;
  form.elements.newPerson.value = person ? person.name : '';
  form.querySelector('[data-add-person]').textContent = person ? 'Save' : 'Add';
  var pick = person ? person.color : AVATAR_COLORS[data.people.length % AVATAR_COLORS.length];
  form.querySelector('[data-person-colors]').innerHTML = AVATAR_COLORS.map(function (c) {
    return '<label class="swatch small"><input type="radio" name="personColor" value="' + c + '"' + (c === pick ? ' checked' : '') +
      ' aria-label="Colour ' + c + '"><span style="background: ' + c + '"></span></label>';
  }).join('');
  form.elements.newPerson.focus();
  if (person) form.elements.newPerson.select();
}

function hidePersonBox() {
  newPersonEl.hidden = true;
  form.elements.newPerson.value = '';
  personEditing = null;
}

// Add the person in the box (or save the one being edited) and pick them. False if
// the name can't be used.
function commitPerson() {
  var input = form.elements.newPerson;
  var name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    input.focus();
    return false;
  }
  var colorIn = form.querySelector('[name="personColor"]:checked');
  var color = colorIn ? colorIn.value : AVATAR_COLORS[0];
  var same = data.people.filter(function (q) { return q !== personEditing && q.name.toLowerCase() === name.toLowerCase(); })[0];
  var p;
  if (personEditing) {
    if (same) {
      fail('Someone is already called ' + same.name + '.', input);
      return false;
    }
    p = { id: personEditing.id, name: name, color: color };
    data.people = data.people.map(function (q) { return q === personEditing ? p : q; });
    refresh();
    savePlan();
  } else if (same) {
    p = same;
  } else {
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
    var id = base;
    for (var n = 2; personById(id); n++) id = base + '-' + n;
    p = { id: id, name: name, color: color };
    data.people.push(p);
    renderStats();
  }
  errEl.hidden = true;
  hidePersonBox();
  fillPeople(p.id);
  var r = peopleEl.querySelector('[name="person"]:checked');
  if (r) r.focus();
  return true;
}

// Delete asks once: the first click turns the link into a confirm.
function deletePerson(btn) {
  var p = chosenPerson();
  if (!p) return;
  if (!btn.classList.contains('armed')) {
    var uses = data.rows.filter(function (r) { return r.person === p.id; }).length;
    btn.classList.add('armed');
    btn.textContent = uses ? 'Delete and unassign ' + uses + ' item' + (uses === 1 ? '' : 's') + '?' : 'Click again to delete';
    return;
  }
  data.people = data.people.filter(function (q) { return q !== p; });
  data.rows = data.rows.map(function (r) {
    if (r.person !== p.id) return r;
    var copy = {}; // a copy, so js/data.js rows stay untouched
    Object.keys(r).forEach(function (k) { if (k !== 'person') copy[k] = r[k]; });
    copy.added = true;
    return copy;
  });
  hidePersonBox();
  refresh();
  savePlan();
  fillPeople('');
}

peopleEl.addEventListener('change', function () {
  hidePersonBox();
  syncPersonSel();
});
peopleEl.addEventListener('click', function (e) {
  if (e.target.closest('[data-new-person-btn]')) showPersonBox(null);
});
personSelEl.addEventListener('click', function (e) {
  if (e.target.closest('[data-edit-person]')) showPersonBox(chosenPerson());
  var del = e.target.closest('[data-remove-person]');
  if (del) deletePerson(del);
});
form.querySelector('[data-add-person]').addEventListener('click', commitPerson);
form.querySelector('[data-cancel-person]').addEventListener('click', function () {
  hidePersonBox();
  errEl.hidden = true;
});
// Enter adds or saves (rather than submitting the form); Esc closes just this box.
form.elements.newPerson.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitPerson();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hidePersonBox();
  }
});

// A new item starts with the project's defaults (Settings → Defaults): its colour, all-day
// or timed from a set time (unless the time came from a click in the hour view), and a
// finish that far after the start.
function applyDefaults(clicked) {
  var d = defaults();
  var f = form.elements;
  if (d.color) {
    var swatch = form.querySelector('[name="color"][value="' + d.color + '"]');
    if (swatch) swatch.checked = true;
  }
  var hourClick = clicked && scale.unit === 'hour';
  if (d.timed && !hourClick) {
    f.allDay.checked = false;
    f.startTime.value = d.startTime || '09:00';
  }
  if (d.length && f.startDate.value) {
    if (f.allDay.checked) {
      // All day: only a length of a day or more applies, counting the start day.
      if (d.length >= 1440) f.endDate.value = dateOf(dayOf(f.startDate.value) + Math.round(d.length / 1440) - 1);
    } else {
      var end = dayOf(f.startDate.value, f.startTime.value) + d.length / 1440;
      f.endDate.value = dateOf(end);
      f.endTime.value = timeOf(end);
    }
  }
}

// Depends on folds away, closed each time the form opens; its heading counts what's ticked.
var depsToggle = form.querySelector('[data-deps-toggle]');
var depsList = form.querySelector('[data-dep-options]');

function foldDeps(open) {
  depsToggle.setAttribute('aria-expanded', String(open));
  depsList.hidden = !open;
}

depsToggle.addEventListener('click', function () { foldDeps(depsList.hidden); });

function openEdit(id) {
  if (rowIndex[id] != null) openForm(data.rows[rowIndex[id]]);
}

function fail(msg, field) {
  errEl.textContent = msg;
  errEl.hidden = false;
  if (field) field.focus();
}

// Takes a row out of the plan along with its subtasks, returning them all in order.
function takeOut(row) {
  var i = rowIndex[row.id];
  var n = row.type === 'task' && !row.parent ? childCount(row) : 0;
  var block = data.rows.splice(i, 1 + n);
  reindex();
  return block;
}

function saveRow() {
  var f = form.elements;
  var type = formType();
  var name = f.name.value.trim();
  if (!name) return fail('Give it a name.', f.name);
  if (!f.startDate.value) return fail('Pick a date.', f.startDate);
  var timed = !f.allDay.checked;
  var row = { type: type, name: name };

  var start = dayOf(f.startDate.value, timed && f.startTime.value);
  if (f.endDate.value) {
    // All-day rows finish at the end of the finish date.
    row.end = timed ? dayOf(f.endDate.value, f.endTime.value) : dayOf(f.endDate.value) + 1;
    if (row.end <= start) return fail('The finish needs to be after the start.', f.endDate);
  }
  if (type === 'milestone') row.day = start;
  else row.start = start;

  if (type === 'task') {
    if (f.parent.value) row.parent = f.parent.value;
    if (f.color.value) row.color = f.color.value;
    if (+f.progress.value) row.progress = f.progress.value / 100;
  }
  if (type === 'phase' && editing && editing.color) row.color = editing.color; // set in Settings → Phases
  // A name typed into New person but not yet added is added now.
  if (!newPersonEl.hidden && f.newPerson.value.trim() && !commitPerson()) return;
  var who = chosenPerson();
  if (who) row.person = who.id;
  row.id = editing ? editing.id : uniqueId(name);
  row.added = true;

  var at;
  if (editing) {
    var i = rowIndex[editing.id];
    var phase = type === 'phase' ? null : f.phase.value;
    var moved = type !== 'phase' &&
      ((row.parent || '') !== (editing.parent || '') || (!row.parent && phase !== phaseOf(editing)));
    if (!moved) {
      data.rows[i] = row;
      at = i;
    } else {
      var block = takeOut(editing);
      block[0] = row;
      at = placeFor(row, phase);
      Array.prototype.splice.apply(data.rows, [at, 0].concat(block));
    }
    // Its dependencies are replaced by whatever is ticked now.
    data.deps = data.deps.filter(function (dep) { return dep[1] !== row.id; });
  } else {
    at = placeFor(row, f.phase.value);
    data.rows.splice(at, 0, row);
  }

  if (type !== 'phase') {
    Array.prototype.forEach.call(form.querySelectorAll('[name="deps"]:checked'), function (box) {
      data.deps.push([box.value, row.id]);
    });
  }

  refresh();
  savePlan();
  dialog.close();
  reveal(row, rowIndex[row.id]);
}

// Where a row goes: after its parent's last subtask, at the end of the chosen phase, or
// (for a phase) at the bottom as a new section.
function placeFor(row, phase) {
  if (row.parent) {
    var at = rowIndex[row.parent] + 1;
    while (at < data.rows.length && data.rows[at].parent === row.parent) at++;
    return at;
  }
  return row.type === 'phase' ? data.rows.length : sectionEnd(phase);
}

// Delete asks once: the first click turns the button into a confirm.
function armDelete(on) {
  deleteBtn.classList.toggle('armed', on);
  if (!on) {
    deleteBtn.textContent = 'Delete';
    return;
  }
  var n = editing.type === 'task' && !editing.parent ? childCount(editing) : 0;
  deleteBtn.textContent = n ? 'Delete with ' + n + ' subtask' + (n === 1 ? '' : 's') + '?' : 'Click again to delete';
}

function deleteRow() {
  if (!deleteBtn.classList.contains('armed')) return armDelete(true);
  var gone = takeOut(editing).map(function (r) { return r.id; });
  data.deps = data.deps.filter(function (dep) {
    return gone.indexOf(dep[0]) < 0 && gone.indexOf(dep[1]) < 0;
  });
  refresh();
  savePlan();
  dialog.close();
}
