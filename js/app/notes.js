// Notes: the account-wide checklist.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Notes: a personal checklist for the whole account, the same in every project and on
// Workspace, apart from any plan (not in its undo or templates). It opens in a popup from
// the Notes button in a project's top bar or on Workspace. Add with Enter, tick to
// complete, click the text to edit, drag to reorder; done notes collect in a folded
// "Done" list. The buttons show how many are still to do. Saved to your account.
var notesBtn = document.querySelector('[data-notes-btn]');
var notesPop = document.querySelector('[data-notes-pop]');
document.body.appendChild(notesPop); // fixed on the page, so either button can open it
var notesFrom = notesBtn; // the button it was opened from
var notes = localStore.getJSON(STORE.notes);
if (!Array.isArray(notes)) notes = [];
var showDone = false;
var editNote = null; // the note being edited
var dragNote = null;

function saveNotes() {
  saveData(STORE.notes, JSON.stringify(notes));
  syncNotesBadge();
  if (onHome()) renderHome(); // its Notes box too
}

function syncNotesBadge() {
  var open = notes.filter(function (n) { return !n.done; }).length;
  Array.prototype.forEach.call(document.querySelectorAll('[data-notes-count]'), function (badge) {
    badge.hidden = !open;
    badge.textContent = open;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-notes-btn], [data-home-notes]'), function (b) {
    b.title = open ? open + ' note' + (open === 1 ? '' : 's') + ' to do' : 'Notes';
  });
}

function noteHtml(n) {
  var text = editNote === n.id
    ? '<input type="text" class="note-input" maxlength="300" value="' + esc(n.text) + '" aria-label="Edit note" data-note-input>'
    : '<span class="note-text" tabindex="0" role="button" title="Click to edit" data-note-edit>' + esc(n.text) + '</span>';
  return '<li class="note' + (n.done ? ' done' : '') + '" data-note="' + esc(n.id) + '"' + (n.done || editNote === n.id ? '' : ' draggable="true"') + '>' +
    '<label class="note-check"><input type="checkbox"' + (n.done ? ' checked' : '') + ' aria-label="' + (n.done ? 'Mark as not done' : 'Mark as done') + '" data-note-done><span></span></label>' +
    text + '<button type="button" class="note-delete" aria-label="Delete note" title="Delete" data-note-del>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></li>';
}

function renderNotes() {
  var open = notes.filter(function (n) { return !n.done; });
  var done = notes.filter(function (n) { return n.done; });
  var keep = notesPop.querySelector('[data-note-new]');
  var draft = keep ? keep.value : '';
  notesPop.innerHTML = '<div class="popup-head notes-hd"><span>Notes</span><span class="notes-summary">' + (open.length ? open.length + ' to do' : notes.length ? 'All done' : '') + '</span></div>' +
    '<div class="note-add"><input type="text" maxlength="300" placeholder="Add a note and press Enter" aria-label="Add a note" data-note-new></div>' +
    '<ul class="note-list" data-note-list="open">' + (open.map(noteHtml).join('') || '<li class="notes-empty">' + (done.length ? 'Nothing left to do.' : 'Nothing here yet. Jot down things to do, chase or remember.') + '</li>') + '</ul>' +
    (done.length ? '<div class="notes-done-head"><button type="button" class="notes-fold" aria-expanded="' + showDone + '" data-note-fold>' +
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>Done (' + done.length + ')</button>' +
      '<button type="button" class="notes-clear" data-note-clear>Clear done</button></div>' +
      (showDone ? '<ul class="note-list">' + done.map(noteHtml).join('') + '</ul>' : '') : '');
  var add = notesPop.querySelector('[data-note-new]');
  add.value = draft;
  var editing = notesPop.querySelector('[data-note-input]');
  if (editing) {
    editing.focus();
    editing.setSelectionRange(editing.value.length, editing.value.length);
  }
}

// Open (or close) the popup under the button it was opened from.
function openNotes(open, from) {
  editNote = null;
  if (from) notesFrom = from;
  notesPop.hidden = !open;
  Array.prototype.forEach.call(document.querySelectorAll('[data-notes-btn], [data-home-notes]'), function (b) {
    b.setAttribute('aria-expanded', String(open && b === notesFrom));
  });
  if (open) {
    renderNotes();
    var r = notesFrom.getBoundingClientRect();
    notesPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - notesPop.offsetWidth - 8)) + 'px';
    notesPop.style.top = r.bottom + 6 + 'px';
    notesPop.querySelector('[data-note-new]').focus();
  }
}

function noteById(id) {
  return notes.filter(function (n) { return n.id === id; })[0];
}

function finishEdit(save) {
  var input = notesPop.querySelector('[data-note-input]');
  var n = editNote && noteById(editNote);
  editNote = null;
  if (n && input && save) {
    var text = input.value.trim();
    if (text) n.text = text;
    else notes = notes.filter(function (x) { return x !== n; }); // emptied: removed
    saveNotes();
  }
  renderNotes();
}

notesBtn.addEventListener('click', function () { openNotes(notesPop.hidden || notesFrom !== notesBtn, notesBtn); });
notesPop.addEventListener('click', function (e) {
  var li = e.target.closest('[data-note]');
  var n = li && noteById(li.getAttribute('data-note'));
  if (e.target.closest('[data-note-fold]')) {
    showDone = !showDone;
    return renderNotes();
  }
  if (e.target.closest('[data-note-clear]')) {
    notes = notes.filter(function (x) { return !x.done; });
    saveNotes();
    return renderNotes();
  }
  if (!n) return;
  if (e.target.closest('[data-note-del]')) {
    notes = notes.filter(function (x) { return x !== n; });
    saveNotes();
    renderNotes();
  } else if (e.target.closest('[data-note-edit]')) {
    editNote = n.id;
    renderNotes();
  }
});
notesPop.addEventListener('change', function (e) {
  if (!e.target.matches('[data-note-done]')) return;
  var n = noteById(e.target.closest('[data-note]').getAttribute('data-note'));
  n.done = e.target.checked;
  saveNotes();
  renderNotes();
});
notesPop.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t.matches('[data-note-new]') && e.key === 'Enter') {
    e.preventDefault();
    var text = t.value.trim();
    if (!text) return;
    notes.push({ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text, done: false });
    t.value = '';
    saveNotes();
    renderNotes();
    notesPop.querySelector('[data-note-new]').focus();
  } else if (t.matches('[data-note-input]') && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    finishEdit(e.key === 'Enter');
  } else if (t.matches('[data-note-edit]') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    editNote = t.closest('[data-note]').getAttribute('data-note');
    renderNotes();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    openNotes(false);
    notesBtn.focus();
  }
});
notesPop.addEventListener('focusout', function (e) {
  if (e.target.matches('[data-note-input]')) setTimeout(function () { if (editNote) finishEdit(true); }, 0);
});
// Drag notes up and down the to-do list to reorder them.
notesPop.addEventListener('dragstart', function (e) {
  var li = e.target.closest('[data-note]');
  if (!li) return;
  dragNote = li.getAttribute('data-note');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragNote); } catch (err) { /* only Firefox needs data to start a drag */ }
  setTimeout(function () { li.classList.add('dragging'); }, 0);
});
notesPop.addEventListener('dragover', function (e) {
  var li = e.target.closest('[data-note-list="open"] [data-note]');
  if (!dragNote || !li) return;
  e.preventDefault();
  var r = li.getBoundingClientRect();
  var after = e.clientY > r.top + r.height / 2;
  Array.prototype.forEach.call(notesPop.querySelectorAll('.drop-before, .drop-after'), function (x) { x.classList.remove('drop-before', 'drop-after'); });
  li.classList.add(after ? 'drop-after' : 'drop-before');
});
notesPop.addEventListener('drop', function (e) {
  var li = e.target.closest('[data-note-list="open"] [data-note]');
  e.preventDefault();
  if (dragNote && li && li.getAttribute('data-note') !== dragNote) {
    var moving = noteById(dragNote);
    var target = noteById(li.getAttribute('data-note'));
    var after = li.classList.contains('drop-after');
    notes = notes.filter(function (x) { return x !== moving; });
    notes.splice(notes.indexOf(target) + (after ? 1 : 0), 0, moving);
    saveNotes();
  }
  dragNote = null;
  renderNotes();
});
notesPop.addEventListener('dragend', function () {
  dragNote = null;
  Array.prototype.forEach.call(notesPop.querySelectorAll('.dragging, .drop-before, .drop-after'), function (x) {
    x.classList.remove('dragging', 'drop-before', 'drop-after');
  });
});
document.addEventListener('pointerdown', function (e) {
  if (!notesPop.hidden && !notesPop.contains(e.target) && !e.target.closest('[data-notes-btn], [data-home-notes]')) openNotes(false);
});
window.addEventListener('storage', function (e) {
  if (e.key !== STORE.notes) return;
  try { notes = JSON.parse(e.newValue) || []; } catch (err) { notes = []; }
  syncNotesBadge();
  if (!notesPop.hidden && !editNote) renderNotes();
});
syncNotesBadge();
