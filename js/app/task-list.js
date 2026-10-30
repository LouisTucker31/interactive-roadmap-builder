// Going to a row, adding at a point on the chart, and reordering rows in the task list.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Bring a row into view and flash it briefly: after it's created or edited, and when
// it's clicked in the task list. Its start lands a little in from the left edge unless
// it's already on screen (`always` scrolls there regardless).
function reveal(row, i, always) {
  var start = PLAN_START + (row.type === 'milestone' ? row.day : row.start) * DAY;
  var view = scroller.clientWidth;
  var x = xOf(start);
  var inset = Math.min(120, view / 4);
  var offscreen = start < rangeStart || start >= rangeEnd || x < scroller.scrollLeft || x > scroller.scrollLeft + view - 60;
  var top = scroller.scrollTop;
  var y = box(row, i).cy + 41; // 41px header above the chart body
  if (y < top + 80 || y > top + scroller.clientHeight - 40) top = y - scroller.clientHeight / 2;
  if (always || offscreen) scrollToTime(start, inset, top, true);
  else scrollToTime(timeAt(scroller.scrollLeft), 0, top);
  freshId = row.id;
  renderPlan();
  renderList();
  renderBoard();
  renderCal();
  setTimeout(function () { if (freshId === row.id) freshId = null; }, 1600);
}

newBtn.addEventListener('click', function () { openForm(); });
deleteBtn.addEventListener('click', deleteRow);

// Click a row in the task list to scroll the chart to it. Enter or Space does the same and
// opens its details, the keyboard's way to them, since the chart itself takes no focus.
// Its ⋯ button, shown on hover, opens it for editing (E from the keyboard).
// The empty task list has its own "Add a task" link, and the blank row under the last
// one adds a task too.
function goToRow(id) {
  var i = rowIndex[id]; // in a day group, this scrolls to the group and lights it up
  if (i != null) reveal(data.rows[i], i, true);
}

taskRowsEl.addEventListener('click', function (e) {
  if (sorted) {
    sorted = false;
    return;
  }
  var pr = e.target.closest('[data-person]');
  if (pr) return goToPerson(pr.getAttribute('data-person'));
  if (e.target.closest('[data-empty-add],[data-add-row]')) return openForm();
  var tr = e.target.closest('.task-row[data-id]');
  if (!tr) return;
  if (e.target.closest('[data-row-edit]')) openEdit(tr.getAttribute('data-id'));
  else goToRow(tr.getAttribute('data-id'));
});
taskRowsEl.addEventListener('keydown', function (e) {
  if (e.target.closest('[data-add-row]') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    return openForm();
  }
  var pr = e.target.closest('[data-person]');
  if (pr && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    return goToPerson(pr.getAttribute('data-person'));
  }
  var tr = e.target.closest('.task-row[data-id]');
  if (!tr || e.target.closest('[data-row-edit]')) return;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    nudgeRow(tr.getAttribute('data-id'), e.key === 'ArrowUp' ? -1 : 1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    var id = tr.getAttribute('data-id');
    goToRow(id);
    peekWhenStill(id);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    openEdit(tr.getAttribute('data-id'));
  }
});

// What a click at a screen point would add: the time under it (to the day, or to the
// quarter hour in hour view) and the phase of the row it's level with. Null over a
// plan item, a button or anywhere outside the chart body.
var ghost = chartBody.querySelector('[data-ghost]');

function spotAt(clientX, clientY) {
  var hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !chartBody.contains(hit) || hit.closest('button, .plan [data-id], [data-group]')) return null;
  var r = chartBody.getBoundingClientRect();
  var t = timeAt(clientX - r.left);
  t = scale.unit === 'hour' ? Math.floor(t / (HOUR / 4)) * HOUR / 4 : startOf(t, 'day');
  var y = clientY - r.top;
  if (workload) { // the person whose row it is
    var lane = Math.floor((y - ROW_Y) / ROW_PX + 0.5);
    var bk = wl.blocks.filter(function (b) { return lane >= b.first && lane < b.first + b.lanes; })[0];
    return { time: t, phase: null, person: bk ? bk.id : null, y: y };
  }
  var row = data.rows[Math.floor((y - ROW_Y) / ROW_PX + 0.5)];
  var phase = !row ? phaseAt(t) : row.type === 'phase' ? row.id : phaseOf(row.parent ? data.rows[rowIndex[row.parent]] : row);
  return { time: t, phase: phase, y: y };
}

// Below the rows, the phase whose band spans time `t` (the latest-starting one if they
// overlap): up to its end, or for an open-ended phase up to the next phase's start.
function phaseAt(t) {
  var d = (t - PLAN_START) / DAY;
  var found = '';
  data.rows.forEach(function (row) {
    if (row.type !== 'phase' || d < row.start) return;
    var next = data.rows[sectionEnd(row.id)];
    var end = row.end != null ? row.end : next && next.start > row.start ? next.start : Infinity;
    if (d < end) found = row.id;
  });
  return found;
}

scroller.addEventListener('pointermove', function (e) {
  if (move) return;
  var spot = e.pointerType === 'mouse' && !drag && spotAt(e.clientX, e.clientY);
  ghost.hidden = !spot;
  if (!spot) return;
  ghost.style.left = xOf(spot.time) + 'px';
  ghost.firstChild.style.top = spot.y + 'px';
  ghost.firstChild.textContent = '+ ' + (scale.unit === 'hour' ? clockOf(spot.time) : dayLabel((spot.time - PLAN_START) / DAY)) +
    (spot.phase ? ' · ' + data.rows[rowIndex[spot.phase]].name : personById(spot.person) ? ' · ' + personById(spot.person).name : '');
});
scroller.addEventListener('pointerleave', function () { ghost.hidden = true; });

// Drag rows up and down the task list to reorder the plan (Alt+↑/↓ from the keyboard).
// A row moves as a block: a task with its subtasks, a phase with everything in its
// section. Drop spots keep the plan valid: subtasks stay under their own parent, tasks
// and milestones can't land between a parent and its subtasks, and phases go between
// sections. Moving a task or milestone past a phase header moves it into that phase.
var sort = null;    // a press on a task list row, becoming a drag once it moves
var sorted = false; // the last press reordered, so its click is ignored
var sortLine = null;

function blockEnd(i) {
  var row = data.rows[i];
  if (row.type === 'phase') return sectionEnd(row.id);
  return i + 1 + (row.type === 'task' && !row.parent ? childCount(row) : 0);
}

// Where a block led by `row` may go in `rest` (the plan without it): slot i is before rest[i].
function slotsFor(row, rest) {
  var slots = [];
  for (var i = 0; i <= rest.length; i++) {
    var above = rest[i - 1];
    var below = rest[i];
    var ok = row.type === 'phase' ? !below || below.type === 'phase'
      : row.parent ? !!above && (above.id === row.parent || above.parent === row.parent)
      : !below || !below.parent;
    if (ok) slots.push(i);
  }
  return slots;
}

function placeBlock(from, end, slot) {
  var block = data.rows.slice(from, end);
  var rest = data.rows.slice(0, from).concat(data.rows.slice(end));
  if (slot === from) return false;
  Array.prototype.splice.apply(rest, [slot, 0].concat(block));
  data.rows = rest;
  refresh();
  savePlan();
  return true;
}

// The slot a row (with its subtasks, or a phase with its section) moves to one step up or
// down, or null at the top or bottom of where it can go.
function nudgeSlot(id, dir) {
  var from = rowIndex[id];
  var rest = data.rows.slice(0, from).concat(data.rows.slice(blockEnd(from)));
  var slots = slotsFor(data.rows[from], rest);
  var next = slots[slots.indexOf(from) + dir];
  return next == null ? null : next;
}

function nudgeRow(id, dir) {
  var from = rowIndex[id];
  var next = nudgeSlot(id, dir);
  if (next == null || !placeBlock(from, blockEnd(from), next)) return false;
  if (!peek.hidden) return true; // moved from the details popup, which keeps the focus
  var tr = taskRowsEl.querySelector('.task-row[data-id="' + CSS.escape(id) + '"]');
  if (tr) tr.focus();
  reveal(data.rows[rowIndex[id]], rowIndex[id]);
  return true;
}

taskRowsEl.addEventListener('pointerdown', function (e) {
  sorted = false;
  var tr = e.target.closest('.task-row[data-id]');
  if (e.pointerType !== 'mouse' || e.button !== 0 || !tr || e.target.closest('button')) return;
  sort = { id: tr.getAttribute('data-id'), y: e.clientY, pointer: e.pointerId, on: false };
});

taskRowsEl.addEventListener('pointermove', function (e) {
  if (!sort) return;
  if (!sort.on) {
    if (!e.buttons) sort = null; // released somewhere else before it moved
    if (!sort || Math.abs(e.clientY - sort.y) < 5) return;
    // Pick it up: dim the block and work out where it can go. Capturing only now
    // leaves a plain click on the row itself.
    try { taskRowsEl.setPointerCapture(sort.pointer); } catch (err) { /* the pointer has already gone */ }
    var from = rowIndex[sort.id];
    var end = blockEnd(from);
    sort.on = true;
    sort.from = from;
    sort.end = end;
    sort.slots = slotsFor(data.rows[from], data.rows.slice(0, from).concat(data.rows.slice(end)));
    var trs = taskRowsEl.querySelectorAll('.task-row[data-id]');
    for (var k = from; k < end; k++) trs[k].classList.add('lifted');
    sortLine = document.createElement('div');
    sortLine.className = 'sort-line' + (data.rows[from].parent ? ' sub' : '');
    taskRowsEl.appendChild(sortLine);
    panel.classList.add('sorting');
  }
  // Scroll when near the top or bottom of the list.
  var body = panel.querySelector('.task-panel-body').getBoundingClientRect();
  if (e.clientY < body.top + 30) scroller.scrollTop -= 10;
  else if (e.clientY > body.bottom - 30) scroller.scrollTop += 10;
  // The drop spot nearest the pointer; spots after the block skip over its rows.
  var top = taskRowsEl.getBoundingClientRect().top + 68;
  var len = sort.end - sort.from;
  var best = null;
  sort.slots.forEach(function (s) {
    var y = top + (s <= sort.from ? s : s + len) * ROW_PX;
    if (best === null || Math.abs(e.clientY - y) < Math.abs(e.clientY - best.y)) best = { slot: s, y: y };
  });
  sort.slot = best.slot;
  sortLine.style.top = best.y - taskRowsEl.getBoundingClientRect().top + 'px';
});

function endSort(cancel) {
  var s = sort;
  sort = null;
  if (!s || !s.on) return;
  sorted = true;
  panel.classList.remove('sorting');
  if (sortLine) sortLine.remove();
  sortLine = null;
  if (cancel || !placeBlock(s.from, s.end, s.slot)) renderTaskList();
}

taskRowsEl.addEventListener('pointerup', function () { endSort(false); });
taskRowsEl.addEventListener('pointercancel', function () { endSort(true); });
taskRowsEl.addEventListener('lostpointercapture', function () { endSort(true); });
document.addEventListener('keydown', function (e) {
  if (sort && sort.on && e.key === 'Escape') endSort(true);
});
