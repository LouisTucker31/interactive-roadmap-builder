// Changes to the plan: undo and redo, redrawing every page after a change, and picking up other tabs' changes.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Undo and redo (the top bar buttons, Ctrl+Z and Ctrl+Y / Ctrl+Shift+Z). Each saved
// change keeps a snapshot of the plan from before it. Snapshots are JSON, with
// js/data.js rows kept as references like the saved plan, so they're unaffected by
// later edits. History lasts until the page is reloaded.
var undoStack = [];
var redoStack = [];
var current = null; // the snapshot of the plan as it is now
var undoBtn = document.querySelector('[data-undo]');
var redoBtn = document.querySelector('[data-redo]');

function snapshot() {
  return JSON.stringify({
    rows: data.rows.map(function (r) {
      var i = data.base.indexOf(r);
      return i >= 0 ? { base: i } : r;
    }),
    deps: data.deps,
    people: data.people
  });
}

// Record the plan as it is now as a new step, after a change.
function record() {
  var now = snapshot();
  if (now === current) return;
  if (current != null) {
    undoStack.push(current);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  current = now;
  syncUndo();
}

function savePlan() {
  record();
  writePlan();
}

// Step back (undo) or forward (redo) through the history.
function stepHistory(back) {
  var from = back ? undoStack : redoStack;
  if (!from.length || move || sort || dialog.open) return;
  (back ? redoStack : undoStack).push(current);
  current = from.pop();
  var s = JSON.parse(current);
  data.rows = s.rows.map(function (r) { return r.base != null ? data.base[r.base] : r; }).filter(Boolean);
  data.deps = s.deps;
  data.people = s.people;
  closePeek();
  refresh();
  writePlan();
  syncUndo();
}

function syncUndo() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
  // Kept for the tab, so a refresh doesn't lose it.
  sessionStore.set(STORE.history, JSON.stringify({ undo: undoStack, redo: redoStack, current: current }));
}

// At start-up: carry on the tab's history if it ends at the plan as loaded.
function loadHistory() {
  current = snapshot();
  var saved = sessionStore.getJSON(STORE.history);
  if (saved && saved.current === current && Array.isArray(saved.undo) && Array.isArray(saved.redo)) {
    undoStack = saved.undo;
    redoStack = saved.redo;
  }
  syncUndo();
}

undoBtn.addEventListener('click', function () { stepHistory(true); });
redoBtn.addEventListener('click', function () { stepHistory(false); });
document.addEventListener('keydown', function (e) {
  if (dialog.open || e.altKey || !e.key) return;
  var typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (typing) return; // fields keep their own undo and typing
  var key = e.key.toLowerCase();
  // On Workspace, N starts a new project; the project's own shortcuts don't apply.
  if (onHome()) {
    if (key === 'n' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !actDialog.open) {
      e.preventDefault();
      newProjectDialog();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' || key === 'y') {
      e.preventDefault();
      stepHistory(key === 'z' && !e.shiftKey);
    }
    return;
  }
  // Single keys: N adds a task, T goes back to today.
  if (e.shiftKey || e.repeat) return;
  if (key === 'n') {
    e.preventDefault();
    openForm();
  } else if (key === 't') {
    // Back to today: on the timeline (and workload), or this month or week on the calendar.
    var pg = app.getAttribute('data-page');
    if (pg === 'timeline' || pg === 'workload') {
      e.preventDefault();
      scrollToTime(home(), 0);
    } else if (pg === 'calendar') {
      e.preventDefault();
      calAt = TODAY;
      saveCal();
      renderCal();
    }
  }
});

function reindex() {
  rowIndex = {};
  data.rows.forEach(function (row, i) {
    if (!row.id) row.id = uniqueId(row.name); // every row needs an id to be edited
    rowIndex[row.id] = i;
  });
}

// Every change goes through here, so the timeline, task list, list and board all stay in step.
function refresh() {
  reindex();
  renderPlan();
  renderTaskList();
  syncPanelScroll();
  renderList();
  renderBoard();
  renderCal();
  if (app.getAttribute('data-page') === 'settings') renderSettings();
}

// Another tab saved the plan: load its version so every open tab shows the same plan.
// Waits while something here is mid-change (a move, a reorder or the open form).
var staleTabs = false;

function reloadPlan() {
  if (move || sort || dialog.open) {
    staleTabs = true;
    return;
  }
  staleTabs = false;
  data.rows = data.base.slice();
  data.deps = data.baseDeps.slice();
  loadPlan();
  refresh();
  record(); // the other tab's change can be undone here too
}

window.addEventListener('storage', function (e) {
  if (e.key === planKey()) reloadPlan();
});
