// The list view: the plan as a table with sorting, filters and columns.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// List view: the same plan as a table, one row per plan row. Click a column heading to
// sort by it (again for descending, a third time back to plan order); filter by name,
// type, status or phase; hide columns from their heading or the Columns menu, which
// also brings them back. In plan order, phases head their sections and subtasks sit
// indented under their task. Clicking a row edits it with the same form as the timeline,
// so a change made on either page shows on both. Sort, filters and hidden columns are
// remembered in this browser.
var app = document.querySelector('.app');
var listEl = document.querySelector('[data-list]');
var listHead = listEl.querySelector('[data-list-head]');
var listBody = listEl.querySelector('[data-list-body]');
var listCount = listEl.querySelector('[data-list-count]');
var colsBtn = listEl.querySelector('[data-cols-btn]');
var colsMenu = listEl.querySelector('[data-cols-menu]');
var filterEls = Array.prototype.slice.call(listEl.querySelectorAll('[data-lf]'));
var clearBtn = listEl.querySelector('[data-lf-clear]');
var pageBtns = Array.prototype.slice.call(document.querySelectorAll('[data-page-btn]'));

var STATUS = { open: 'Not started', active: 'In progress', done: 'Done' };
var STATUS_RANK = { open: 0, active: 1, done: 2, ms: 3 };

var listState = { sort: null, dir: 1, hidden: [], order: [], filters: {} };
var savedList = localStore.getJSON(STORE.list);
if (savedList) Object.keys(listState).forEach(function (k) { if (savedList[k] != null) listState[k] = savedList[k]; });

function saveList() {
  localStore.set(STORE.list, JSON.stringify(listState));
}

// The phase a row is in; a phase row is its own phase.
function phaseName(row) {
  if (row.type === 'phase') return row.name;
  var ph = phaseOf(row.parent && rowIndex[row.parent] != null ? data.rows[rowIndex[row.parent]] : row);
  return ph ? data.rows[rowIndex[ph]].name : '';
}

// A task's own progress; a phase's is the average of the tasks in its section. Null
// when there's nothing to measure (milestones, empty phases).
function progressOf(row) {
  if (row.type === 'task') return row.progress || 0;
  if (row.type !== 'phase') return null;
  var tasks = data.rows.slice(rowIndex[row.id] + 1, sectionEnd(row.id)).filter(function (r) { return r.type === 'task'; });
  if (!tasks.length) return null;
  return tasks.reduce(function (sum, r) { return sum + (r.progress || 0); }, 0) / tasks.length;
}

function statusOf(row) {
  if (row.type === 'milestone') return 'ms';
  var p = progressOf(row);
  return p == null || p === 0 ? 'open' : p >= 1 ? 'done' : 'active';
}

function depsOf(row) {
  return data.deps.filter(function (d) { return d[1] === row.id && rowIndex[d[0]] != null; }).map(function (d) {
    return data.rows[rowIndex[d[0]]];
  });
}

// Each column: its heading, the value it sorts by and the cell it draws. Name can't be hidden.
var LIST_COLS = [
  { key: 'name', label: 'Name', fixed: true,
    val: function (r) { return r.name.toLowerCase(); },
    cell: function (r) {
      var ic = r.type === 'phase' ? '<i class="list-icon ph" style="' + colorVar(r).slice(2) + '"></i>' : r.type === 'milestone' ? '<i class="list-icon ms"></i>'
        : '<i class="list-icon' + (r.parent ? ' sub' : '') + '" style="' + colorVar(r).slice(2) + '"></i>';
      return '<div class="name-cell">' + ic + '<span class="list-name">' + esc(r.name) + '</span></div>';
    } },
  { key: 'type', label: 'Type',
    val: function (r) { return r.type === 'task' && r.parent ? 'subtask' : r.type; },
    cell: function (r) { return r.type === 'task' ? (r.parent ? 'Subtask' : 'Task') : r.type === 'milestone' ? 'Milestone' : 'Phase'; } },
  { key: 'phase', label: 'Phase',
    val: function (r) { return phaseName(r).toLowerCase() || '~'; }, // no phase sorts last
    cell: function (r) { return esc(phaseName(r)) || '<span class="empty-value">No phase</span>'; } },
  { key: 'start', label: 'Start', mono: true,
    val: startDay,
    cell: function (r) { return listDate(startDay(r)); } },
  { key: 'end', label: 'Finish', mono: true,
    val: function (r) { var f = finishDay(r); return f == null ? Infinity : f; },
    cell: function (r) { var f = finishDay(r); return f == null ? '<span class="empty-value">None</span>' : listDate(f); } },
  { key: 'days', label: 'Length', mono: true, right: true,
    val: function (r) { return r.end == null ? -1 : r.end - startDay(r); },
    cell: function (r) { return r.end == null ? '<span class="empty-value">None</span>' : duration(r); } },
  { key: 'progress', label: 'Progress',
    val: function (r) { var p = progressOf(r); return p == null ? -1 : p; },
    cell: function (r) {
      var p = progressOf(r);
      if (p == null) return '<span class="empty-value">None</span>';
      var pct = Math.round(p * 100);
      return '<span class="list-progress"><span class="progress-bar"><b style="width: ' + pct + '%"></b></span><span class="list-pct">' + pct + '%</span></span>';
    } },
  { key: 'status', label: 'Status',
    val: function (r) { return STATUS_RANK[statusOf(r)]; },
    cell: function (r) {
      var s = statusOf(r);
      return '<span class="status ' + s + '">' + (s === 'ms' ? 'Milestone' : STATUS[s]) + '</span>';
    } },
  { key: 'person', label: 'Person',
    val: function (r) { var p = personById(r.person); return p ? p.name.toLowerCase() : '~'; }, // unassigned sorts last
    cell: function (r) {
      var p = personById(r.person);
      return p ? '<span class="list-person">' + avatar(p) + esc(p.name) + '</span>' : '<span class="empty-value">Unassigned</span>';
    } },
  { key: 'deps', label: 'Depends on',
    val: function (r) { return depsOf(r).length; },
    cell: function (r) {
      var ds = depsOf(r);
      return ds.length ? '<span class="list-deps" title="' + esc(ds.map(function (d) { return d.name; }).join(', ')) + '">' +
        esc(ds.map(function (d) { return d.name; }).join(', ')) + '</span>' : '<span class="empty-value">None</span>';
    } }
];

// Columns in the order chosen (dragged headings, or Move up / Move down in the Columns menu):
// Name first, then the saved order, then any column not in it yet.
function orderedCols() {
  var order = listState.order;
  return LIST_COLS.slice().sort(function (a, b) {
    if (a.fixed || b.fixed) return a.fixed ? -1 : 1;
    var i = order.indexOf(a.key), j = order.indexOf(b.key);
    return (i < 0 ? 1e3 + LIST_COLS.indexOf(a) : i) - (j < 0 ? 1e3 + LIST_COLS.indexOf(b) : j);
  });
}

function shownCols() {
  return orderedCols().filter(function (c) { return c.fixed || listState.hidden.indexOf(c.key) < 0; });
}

// Put column `key` before `before` (null: last), and keep the order for next time.
function moveCol(key, before) {
  var keys = orderedCols().filter(function (c) { return !c.fixed; }).map(function (c) { return c.key; });
  keys.splice(keys.indexOf(key), 1);
  keys.splice(before == null ? keys.length : keys.indexOf(before), 0, key);
  listState.order = keys;
  saveList();
  renderList();
}

function colByKey(key) {
  return LIST_COLS.filter(function (c) { return c.key === key; })[0];
}

function matches(row) {
  var f = listState.filters;
  if (f.q && row.name.toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
  if (f.type && row.type !== f.type) return false;
  if (f.status && statusOf(row) !== f.status) return false;
  if (f.phase) {
    var ph = row.type === 'phase' ? row.id : phaseOf(row.parent && rowIndex[row.parent] != null ? data.rows[rowIndex[row.parent]] : row);
    if ((f.phase === '-' ? '' : f.phase) !== ph) return false;
  }
  if (f.person && (f.person === '-' ? !!personById(row.person) : row.person !== f.person)) return false;
  return true;
}

function filtering() {
  var f = listState.filters;
  return !!(f.q || f.type || f.status || f.phase || f.person);
}

// The rows to show, in order. In plan order a phase stays as a heading while anything
// in its section is shown, even if the phase itself is filtered out.
function listRows() {
  var rows = data.rows.filter(matches);
  var col = listState.sort && colByKey(listState.sort);
  if (col) {
    return rows.map(function (r, i) { return { r: r, v: col.val(r), i: i }; }).sort(function (a, b) {
      return a.v < b.v ? -listState.dir : a.v > b.v ? listState.dir : a.i - b.i;
    }).map(function (x) { return x.r; });
  }
  if (!filtering()) return rows;
  return data.rows.filter(function (r, i) {
    if (matches(r)) return true;
    if (r.type !== 'phase') return false;
    return data.rows.slice(i + 1, sectionEnd(r.id)).some(matches);
  });
}

function renderList() {
  var cols = shownCols();
  var flat = !!(listState.sort && colByKey(listState.sort));

  listHead.innerHTML = '<tr>' + cols.map(function (c) {
    var on = listState.sort === c.key;
    var dir = on ? (listState.dir > 0 ? 'ascending' : 'descending') : 'none';
    return '<th class="' + (c.key === 'name' ? 'name-col' : '') + (c.right ? ' r' : '') + '" aria-sort="' + dir + '">' +
      '<button type="button" class="sort-btn' + (on ? ' on' : '') + '" data-sort="' + c.key + '" title="Sort by ' + c.label.toLowerCase() + '">' +
      c.label + '<i class="sort-arrow' + (on && listState.dir < 0 ? ' down' : '') + '" aria-hidden="true"></i></button>' +
      (c.fixed ? '' : '<button type="button" class="hide-col-btn" data-hide-col="' + c.key + '" aria-label="Hide ' + c.label + ' column" title="Hide column">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>') +
      '</th>';
  }).join('') + '</tr>';

  var rows = listRows();
  var span = ' colspan="' + cols.length + '"';
  var body = rows.map(function (r) {
    var cls = 'list-row ' + (r.type === 'phase' ? 'l-ph' : r.type === 'milestone' ? 'l-ms' : r.parent ? 'l-sub' : 'l-top') +
      (r.type === 'task' && r.progress >= 1 ? ' done' : '') + (r.id === freshId ? ' fresh' : '');
    return '<tr class="' + cls + '" data-id="' + esc(r.id) + '" tabindex="0" title="Click to edit"' + (r.type === 'phase' && r.color ? ' style="' + colorVar(r).slice(2) + '"' : '') + '>' + cols.map(function (c) {
      return '<td class="' + (c.key === 'name' ? 'name-col' : '') + (c.mono ? ' mono' : '') + (c.right ? ' r' : '') + '">' + c.cell(r) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  if (!data.rows.length) {
    body = '<tr class="list-empty"><td' + span + '>Nothing here yet.&nbsp;<button type="button" data-list-add>Add a task</button></td></tr>';
  } else if (!rows.length) {
    body = '<tr class="list-empty"><td' + span + '>Nothing matches these filters.&nbsp;<button type="button" data-list-clear>Clear filters</button></td></tr>';
  } else {
    body += '<tr class="list-add" data-list-add tabindex="0"><td' + span + '><i class="list-icon add"></i>New task</td></tr>';
  }
  listBody.innerHTML = body;
  listEl.classList.toggle('flat', flat);

  var shown = rows.length;
  var total = data.rows.length;
  listCount.textContent = filtering() ? shown + ' of ' + total + ' shown' : total + (total === 1 ? ' item' : ' items');
  clearBtn.hidden = !filtering();

  // Phase filter options follow the plan's phases; a deleted phase drops out of the filter.
  var phaseSel = listEl.querySelector('[data-lf="phase"]');
  var phases = data.rows.filter(function (r) { return r.type === 'phase'; });
  if (listState.filters.phase && listState.filters.phase !== '-' && rowIndex[listState.filters.phase] == null) {
    delete listState.filters.phase;
    saveList();
  }
  phaseSel.innerHTML = '<option value="">All phases</option><option value="-">No phase</option>' + phases.map(function (p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
  }).join('');
  if (listState.filters.person && listState.filters.person !== '-' && !personById(listState.filters.person)) {
    delete listState.filters.person;
    saveList();
  }
  listEl.querySelector('[data-lf="person"]').innerHTML = '<option value="">Anyone</option><option value="-">Unassigned</option>' +
    data.people.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
    }).join('');
  filterEls.forEach(function (el) { el.value = listState.filters[el.getAttribute('data-lf')] || ''; });

  var hiddenN = LIST_COLS.length - cols.length;
  var badge = colsBtn.querySelector('[data-hidden-count]');
  badge.hidden = !hiddenN;
  badge.textContent = hiddenN + ' hidden';
  renderColsMenu();
}

function renderColsMenu() {
  var cols = orderedCols().filter(function (c) { return !c.fixed; });
  colsMenu.innerHTML = cols.map(function (c, i) {
    return '<div class="check-row"><button type="button" role="menuitemcheckbox" aria-checked="' + (listState.hidden.indexOf(c.key) < 0) + '" data-col="' + c.key + '">' + c.label + '</button>' +
      '<button type="button" class="col-move" aria-label="Move ' + c.label + ' up" title="Move up" data-col-move="' + c.key + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg></button>' +
      '<button type="button" class="col-move" aria-label="Move ' + c.label + ' down" title="Move down" data-col-move="' + c.key + '" data-dir="1"' + (i === cols.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div>';
  }).join('') + '<div class="dropdown-sep" role="separator"></div><button type="button" data-show-all' + (listState.hidden.length ? '' : ' disabled') + '>Show all columns</button>';
}

function setHidden(key, hide) {
  var i = listState.hidden.indexOf(key);
  if (hide && i < 0) listState.hidden.push(key);
  if (!hide && i >= 0) listState.hidden.splice(i, 1);
  if (hide && listState.sort === key) listState.sort = null;
  saveList();
  renderList();
}

// Press and hold a heading (except Name), then drag it sideways to move the column. A quick
// click still sorts; the Columns menu's Move up / Move down does the same without dragging.
var colDrag = null;
var colDragged = false;

listHead.addEventListener('pointerdown', function (e) {
  colDragged = false;
  var th = e.target.closest('th');
  var btn = th && th.querySelector('[data-sort]');
  if (!btn || e.button !== 0 || e.target.closest('[data-hide-col]') || colByKey(btn.getAttribute('data-sort')).fixed) return;
  colDrag = { key: btn.getAttribute('data-sort'), th: th, x: e.clientX, y: e.clientY, pointer: e.pointerId, on: false };
  colDrag.timer = setTimeout(function () {
    if (!colDrag) return;
    colDrag.on = true;
    th.classList.add('lifted');
    listEl.classList.add('moving-col');
    try { th.setPointerCapture(colDrag.pointer); } catch (err) { /* the pointer has already gone */ }
  }, 350);
});

// Where the dragged heading would go: before the heading whose middle is to the right.
function colDropTarget(x) {
  var ths = Array.prototype.filter.call(listHead.querySelectorAll('th'), function (th) { return !th.classList.contains('name-col'); });
  for (var i = 0; i < ths.length; i++) {
    var r = ths[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return { th: ths[i], before: true };
  }
  return ths.length ? { th: ths[ths.length - 1], before: false } : null;
}

listHead.addEventListener('pointermove', function (e) {
  if (!colDrag) return;
  if (!colDrag.on) {
    // Moving before the hold ends is a scroll or a stray click, not a column move.
    if (Math.abs(e.clientX - colDrag.x) > 6 || Math.abs(e.clientY - colDrag.y) > 6) {
      clearTimeout(colDrag.timer);
      colDrag = null;
    }
    return;
  }
  Array.prototype.forEach.call(listHead.querySelectorAll('.drop-before, .drop-after'), function (th) { th.classList.remove('drop-before', 'drop-after'); });
  var t = colDropTarget(e.clientX);
  if (t && t.th !== colDrag.th) t.th.classList.add(t.before ? 'drop-before' : 'drop-after');
});

function endColDrag(e, cancel) {
  if (!colDrag) return;
  var d = colDrag;
  colDrag = null;
  clearTimeout(d.timer);
  listEl.classList.remove('moving-col');
  if (!d.on) return;
  colDragged = true; // the click that follows isn't a sort
  d.th.classList.remove('lifted');
  var t = !cancel && colDropTarget(e.clientX);
  if (!t || t.th === d.th) return renderList();
  var target = t.th.querySelector('[data-sort]').getAttribute('data-sort');
  if (t.before) return moveCol(d.key, target);
  var keys = orderedCols().filter(function (c) { return !c.fixed; }).map(function (c) { return c.key; });
  moveCol(d.key, keys[keys.indexOf(target) + 1] || null);
}

listHead.addEventListener('pointerup', function (e) { endColDrag(e, false); });
listHead.addEventListener('pointercancel', function (e) { endColDrag(e, true); });
listHead.addEventListener('contextmenu', function (e) { if (colDrag) e.preventDefault(); }); // long press on touch

listHead.addEventListener('click', function (e) {
  if (colDragged) {
    colDragged = false;
    return;
  }
  var hide = e.target.closest('[data-hide-col]');
  if (hide) return setHidden(hide.getAttribute('data-hide-col'), true);
  var btn = e.target.closest('[data-sort]');
  if (!btn) return;
  var key = btn.getAttribute('data-sort');
  if (listState.sort !== key) {
    listState.sort = key;
    listState.dir = 1;
  } else if (listState.dir > 0) {
    listState.dir = -1;
  } else {
    listState.sort = null;
  }
  saveList();
  renderList();
  var again = listHead.querySelector('[data-sort="' + key + '"]');
  if (again) again.focus();
});

function showColsMenu(open) {
  colsMenu.hidden = !open;
  colsBtn.setAttribute('aria-expanded', String(open));
  if (open) colsMenu.querySelector('button').focus();
}

colsBtn.addEventListener('click', function () { showColsMenu(colsMenu.hidden); });
colsMenu.addEventListener('click', function (e) {
  var move = e.target.closest('[data-col-move]');
  if (move) {
    var mk = move.getAttribute('data-col-move');
    var dir = +move.getAttribute('data-dir');
    var keys = orderedCols().filter(function (c) { return !c.fixed; }).map(function (c) { return c.key; });
    var at = keys.indexOf(mk);
    moveCol(mk, dir < 0 ? keys[at - 1] : keys[at + 2] || null);
    var again = colsMenu.querySelector('[data-col-move="' + mk + '"][data-dir="' + dir + '"]');
    (again && !again.disabled ? again : colsMenu.querySelector('[data-col="' + mk + '"]')).focus();
    return;
  }
  var item = e.target.closest('[data-col]');
  if (item) {
    var key = item.getAttribute('data-col');
    setHidden(key, listState.hidden.indexOf(key) < 0);
    var same = colsMenu.querySelector('[data-col="' + key + '"]');
    if (same) same.focus();
  } else if (e.target.closest('[data-show-all]')) {
    listState.hidden = [];
    saveList();
    renderList();
    colsMenu.querySelector('button').focus();
  }
});
colsMenu.addEventListener('keydown', function (e) {
  var items = Array.prototype.slice.call(colsMenu.querySelectorAll('button:not(:disabled)'));
  var i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    showColsMenu(false);
    colsBtn.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
});
document.addEventListener('click', function (e) {
  if (!colsMenu.hidden && e.target.isConnected && !e.target.closest('.menu-wrap')) showColsMenu(false);
});

filterEls.forEach(function (el) {
  el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
    var key = el.getAttribute('data-lf');
    if (el.value) listState.filters[key] = el.value;
    else delete listState.filters[key];
    saveList();
    renderList();
  });
});

function clearFilters() {
  listState.filters = {};
  saveList();
  renderList();
}

clearBtn.addEventListener('click', clearFilters);

// Drag to scroll with the mouse, in any direction, gliding on after a fling like the
// timeline: used by the list and the board. A press that doesn't move still clicks;
// presses on anything matching `skip` (buttons, fields, board cards) work as normal.
// `yTarget` picks what scrolls up and down for a press (by default the box itself).
// Returns a function telling whether the last press dragged, so its click is ignored.
function dragScroll(box, skip, yTarget) {
  var drag = null;
  var dragged = false;
  var glide = 0;

  function stop() {
    if (glide) cancelAnimationFrame(glide);
    glide = 0;
  }

  function end(e) {
    if (!drag) return;
    var d0 = drag;
    drag = null;
    box.classList.remove('dragging');
    var trail = d0.trail;
    if (trail.length < 2) return;
    var a = trail[0];
    var b = trail[trail.length - 1];
    var dt = b.t - a.t;
    var now = (e && e.timeStamp) || performance.now();
    if (!(dt > 0 && now - b.t < 80)) return; // only glide if still moving when let go
    var cap = function (v) { return Math.max(-6, Math.min(6, v)); };
    var vx = cap((b.x - a.x) / dt);
    var vy = cap((b.y - a.y) / dt);
    var last = performance.now();
    function step(t) {
      var d = Math.min(t - last, 32);
      last = t;
      box.scrollLeft -= vx * d;
      d0.ys.scrollTop -= vy * d;
      var keep = Math.pow(FRICTION, d);
      vx *= keep;
      vy *= keep;
      glide = Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02 ? requestAnimationFrame(step) : 0;
    }
    glide = requestAnimationFrame(step);
  }

  box.addEventListener('pointerdown', function (e) {
    stop();
    dragged = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest(skip)) return;
    var r = box.getBoundingClientRect();
    if (e.clientX - r.left >= box.clientWidth || e.clientY - r.top >= box.clientHeight) return; // the scrollbars
    var ys = (yTarget && yTarget(e.target)) || box;
    drag = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: ys.scrollTop, ys: ys, id: e.pointerId, trail: [] };
    e.preventDefault(); // no text selection
  });
  box.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!e.buttons) return end(e); // released outside the window
    if (!dragged && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) {
      dragged = true;
      try { box.setPointerCapture(drag.id); } catch (err) { /* the pointer has already gone */ }
      box.classList.add('dragging');
    }
    if (!dragged) return;
    box.scrollLeft = drag.left - (e.clientX - drag.x);
    drag.ys.scrollTop = drag.top - (e.clientY - drag.y);
    var now = e.timeStamp || performance.now();
    drag.trail.push({ t: now, x: e.clientX, y: e.clientY });
    while (drag.trail.length > 2 && now - drag.trail[0].t > 100) drag.trail.shift();
  });
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('wheel', stop, { passive: true });

  return function () {
    var was = dragged;
    dragged = false;
    return was;
  };
}

var listDragged = dragScroll(listEl.querySelector('.list-scroll'), 'button, input, select, a, th');

listBody.addEventListener('click', function (e) {
  if (listDragged()) return;
  if (e.target.closest('[data-list-clear]')) return clearFilters();
  if (e.target.closest('[data-list-add]')) return openForm();
  var tr = e.target.closest('.list-row[data-id]');
  if (tr) openEdit(tr.getAttribute('data-id'));
});
listBody.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var tr = e.target.closest('.list-row[data-id], .list-add');
  if (!tr || e.target !== tr) return;
  e.preventDefault();
  if (tr.hasAttribute('data-list-add')) openForm();
  else openEdit(tr.getAttribute('data-id'));
});
