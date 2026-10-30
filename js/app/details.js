// The item details popup, and moving items on the chart by pressing and holding.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Item details popup: what a clicked bar, milestone or phase is, when it happens, how
// it's going, what it depends on and what's waiting on it, with an Edit button to change
// it. It sits just below the item (above it near the bottom of the screen) and closes
// with Esc, the ×, a click elsewhere or scrolling the chart.
var peek = document.querySelector('[data-peek]');
var peekId = null;

function rowLinks(ids) {
  return ids.filter(function (id) { return rowIndex[id] != null; }).map(function (id) {
    var r = data.rows[rowIndex[id]];
    return '<span class="details-link"><i class="' + (r.type === 'milestone' ? 'ms' : 'tk') + '" style="' + colorVar(r).slice(2) + '"></i>' + esc(r.name) + '</span>';
  }).join('');
}

function openPeek(id, el, clientX) {
  var row = data.rows[rowIndex[id]];
  if (!row) return;
  peekId = id;
  var kind = row.type === 'task' ? (row.parent ? 'Subtask' : 'Task') : row.type === 'milestone' ? 'Milestone' : 'Phase';
  var icon = peek.querySelector('[data-peek-icon]');
  icon.className = 'details-icon ' + row.type;
  icon.setAttribute('style', colorVar(row).slice(2));
  peek.querySelector('[data-peek-kind]').textContent = kind;
  peek.querySelector('[data-peek-title]').textContent = row.name;

  var items = [['When', esc(itemLabel(row))]];
  var who = personById(row.person);
  if (who) items.push(['Person', avatar(who) + esc(who.name)]);
  if (row.end != null) items.push(['Length', duration(row)]);
  if (row.type === 'task') {
    var pct = Math.round((row.progress || 0) * 100);
    items.push(['Progress', '<span class="progress-bar"><b style="width: ' + pct + '%"></b></span>' + pct + '%']);
    if (row.parent && rowIndex[row.parent] != null) items.push(['Subtask of', esc(data.rows[rowIndex[row.parent]].name)]);
    var kids = row.parent ? 0 : childCount(row);
    if (kids) items.push(['Subtasks', kids]);
  }
  if (row.type !== 'phase') {
    var ph = phaseOf(row.parent ? data.rows[rowIndex[row.parent]] : row);
    if (ph) items.push(['Phase', esc(data.rows[rowIndex[ph]].name)]);
    var after = rowLinks(data.deps.filter(function (d) { return d[1] === id; }).map(function (d) { return d[0]; }));
    var before = rowLinks(data.deps.filter(function (d) { return d[0] === id; }).map(function (d) { return d[1]; }));
    if (after) items.push(['Depends on', after]);
    if (before) items.push(['Holds up', before]);
  }
  peek.querySelector('[data-peek-body]').innerHTML = items.map(function (it) {
    return '<dt>' + it[0] + '</dt><dd>' + it[1] + '</dd>';
  }).join('');

  // Place it under the item, starting near where it was clicked, kept on screen.
  peek.hidden = false;
  var r = el.getBoundingClientRect();
  var w = peek.offsetWidth;
  var h = peek.offsetHeight;
  var left = Math.max(8, Math.min(clientX - 24, window.innerWidth - w - 8));
  var top = r.bottom + 8 + h > window.innerHeight - 8 ? r.top - 8 - h : r.bottom + 8;
  peek.style.left = left + 'px';
  peek.style.top = Math.max(8, top) + 'px';
  syncPeekMoves();
  peek.querySelector('[data-peek-edit]').focus();
}

function closePeek() {
  var back = peekFrom && peek.contains(document.activeElement) ? taskRowsEl.querySelector('.task-row[data-id="' + CSS.escape(peekFrom) + '"]') : null;
  peek.hidden = true;
  peekId = null;
  peekFrom = null;
  if (back) back.focus();
}

// Open the details from the task list once the chart has finished scrolling to the item, and
// send the focus back to the row when they close (found again by id: moving redraws the list).
var peekFrom = null;
function peekWhenStill(id) {
  var last = -1;
  var tries = 0;
  (function wait() {
    var now = scroller.scrollLeft + ',' + scroller.scrollTop;
    if (now !== last && tries++ < 40) {
      last = now;
      return setTimeout(wait, 60);
    }
    var el = scroller.querySelector('.plan [data-id="' + CSS.escape(id) + '"]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    openPeek(id, el, r.left + Math.min(r.width / 2, 40));
    peekFrom = id;
  })();
}

// Move up / Move down: the same as dragging the row in the task list.
function syncPeekMoves() {
  Array.prototype.forEach.call(peek.querySelectorAll('[data-peek-move]'), function (b) {
    b.disabled = nudgeSlot(peekId, +b.getAttribute('data-peek-move')) == null;
  });
}

peek.querySelector('.details-foot').addEventListener('click', function (e) {
  var b = e.target.closest('[data-peek-move]');
  if (!b || !peekId) return;
  nudgeRow(peekId, +b.getAttribute('data-peek-move'));
  syncPeekMoves();
  if (b.disabled) peek.querySelector('[data-peek-edit]').focus();
});

peek.querySelector('[data-peek-close]').addEventListener('click', closePeek);
peek.querySelector('[data-peek-edit]').addEventListener('click', function () {
  var id = peekId;
  closePeek();
  openEdit(id);
});
document.addEventListener('pointerdown', function (e) {
  if (!peek.hidden && !peek.contains(e.target)) closePeek();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !peek.hidden && !move) closePeek();
});
scroller.addEventListener('wheel', function () { if (!peek.hidden) closePeek(); }, { passive: true });
window.addEventListener('resize', function () { if (!peek.hidden) closePeek(); });

// Click a bar, milestone or phase label in the chart to see its details, or empty space
// to add something at that time. A drag that moved the chart doesn't count as a click.
scroller.addEventListener('click', function (e) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  var hit = document.elementFromPoint(e.clientX, e.clientY);
  var day = hit && hit.closest('[data-group]');
  if (day) return openDay(+day.getAttribute('data-group'), parseFloat(day.getAttribute('data-first')));
  var el = hit && hit.closest('.plan [data-id]');
  if (el) return openPeek(el.getAttribute('data-id'), el, e.clientX);
  var spot = spotAt(e.clientX, e.clientY);
  if (spot) {
    ghost.hidden = true;
    openForm(null, spot);
  }
});

// Hold-to-move: press a bar, milestone or phase label and hold still for HOLD_MS to
// pick it up, then drag it sideways to a new time (to the quarter hour in hour view,
// otherwise to the day). A task's subtasks come with it. Moving the mouse before then
// pans the chart as usual; Esc while moving puts it back. Moved rows are copies saved
// like created ones, so js/data.js rows stay untouched.
var HOLD_MS = 400;
var hold = null; // a press on a plan item, waiting to see if it's held still
var move = null; // the item being moved: its rows before the move and the shift so far

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold.el.classList.remove('holding');
  hold = null;
}

function lift() {
  var i = rowIndex[hold.id];
  hold = null;
  if (i == null || !drag) return;
  var row = data.rows[i];
  var n = row.type === 'task' && !row.parent ? childCount(row) : 0;
  var x = drag.trail.length ? drag.trail[drag.trail.length - 1].x : drag.x;
  move = { from: i, before: data.rows.slice(i, i + 1 + n), t0: timeAt(x - chart.getBoundingClientRect().left), shift: 0 };
  drag = null;
  dragMoved = true; // the release isn't a click
  scroller.classList.remove('dragging');
  scroller.classList.add('moving');
  movingId = row.id;
  renderPlan();
  showMove();
}

function shifted(row, d) {
  var copy = {};
  Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
  ['start', 'end', 'day'].forEach(function (k) { if (copy[k] != null) copy[k] += d; });
  copy.added = true;
  return copy;
}

function moveItemTo(clientX) {
  move.lastX = clientX;
  var d = (timeAt(clientX - chart.getBoundingClientRect().left) - move.t0) / DAY;
  d = scale.unit === 'hour' ? Math.round(d * 96) / 96 : Math.round(d);
  if (d === move.shift) return;
  move.shift = d;
  move.before.forEach(function (r, k) { data.rows[move.from + k] = shifted(r, d); });
  renderPlan();
  showMove();
}

// The guide line marks the moving item's start, labelled with its new dates.
function showMove() {
  var row = data.rows[move.from];
  var b = box(row, move.from);
  ghost.hidden = false;
  ghost.style.left = dayX(row.type === 'milestone' ? row.day : row.start) + 'px';
  ghost.firstChild.style.top = b.cy - 22 + 'px';
  ghost.firstChild.textContent = itemLabel(row);
}

function drop(cancel) {
  var m = move;
  move = null;
  movingId = null;
  scroller.classList.remove('moving');
  ghost.hidden = true;
  if (cancel || !m.shift) m.before.forEach(function (r, k) { data.rows[m.from + k] = r; });
  refresh();
  if (!cancel && m.shift) savePlan();
}

document.addEventListener('keydown', function (e) {
  if (move && e.key === 'Escape') drop(true);
});

// A day group opens from the keyboard too.
plan.addEventListener('keydown', function (e) {
  var g = e.target.closest('[data-group]');
  if (g && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openDay(+g.getAttribute('data-group'), parseFloat(g.getAttribute('data-first')));
  }
});

form.addEventListener('change', syncForm);
form.elements.progress.addEventListener('input', syncForm);
// Keep the finish on or after the start when the start moves past it.
form.elements.startDate.addEventListener('change', function () {
  var f = form.elements;
  if (f.startDate.value && f.endDate.value && f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value;
});
// A finish time picked with no finish date means the same day.
form.elements.endTime.addEventListener('change', function () {
  var f = form.elements;
  if (!f.endDate.value && f.startDate.value) f.endDate.value = f.startDate.value;
  syncForm();
});
form.querySelector('[data-end-clear]').addEventListener('click', function () {
  form.elements.endDate.value = '';
  syncForm();
});

// Length buttons (timed tasks): set the finish that long after the start.
form.addEventListener('submit', function (e) {
  e.preventDefault();
  saveRow();
});
Array.prototype.forEach.call(form.querySelectorAll('[data-nt-close]'), function (btn) {
  btn.addEventListener('click', function () { dialog.close(); });
});
// Clicking the dimmed backdrop closes the form.
dialog.addEventListener('click', function (e) {
  if (e.target === dialog) dialog.close();
});

dialog.addEventListener('close', function () { if (staleTabs) reloadPlan(); });
