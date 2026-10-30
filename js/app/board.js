// The board view: the plan as a kanban, grouped by status, phase, person or day.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Board: the plan as a kanban. Cards are tasks and milestones (subtasks too, unless
// switched off); phases group cards rather than being cards themselves. Columns are by
// status, phase, person or day. Drag a card to another column to change that about it
// (its progress, phase, person or day), click it to edit it, or add one from the foot
// of a column, already set for that column. Show picks what each card shows. Settings
// are remembered in this browser.
var boardEl = document.querySelector('[data-board]');
var boardCols = boardEl.querySelector('[data-board-cols]');
var showBtn = boardEl.querySelector('[data-show-btn]');
var showMenu = boardEl.querySelector('[data-show-menu]');
var CARD_FIELDS = [
  ['phase', 'Phase'], ['date', 'Date'], ['time', 'Time'], ['length', 'Length'], ['progress', 'Progress'],
  ['person', 'Person'], ['status', 'Status'], ['deps', 'Depends on'], ['color', 'Colour']
];
var board = { group: 'status', subtasks: true, width: 'comfortable', hide: ['length', 'deps'] };
var savedBoard = localStore.getJSON(STORE.board);
if (savedBoard) Object.keys(board).forEach(function (k) { if (savedBoard[k] != null) board[k] = savedBoard[k]; });
var dragId = null; // the card being dragged

function saveBoard() {
  localStore.set(STORE.board, JSON.stringify(board));
}

function showing(field) {
  return board.hide.indexOf(field) < 0;
}

function phaseIdOf(row) {
  return phaseOf(row.parent && rowIndex[row.parent] != null ? data.rows[rowIndex[row.parent]] : row);
}

// Which column a card is in, for the current grouping.
function columnOf(row) {
  if (board.group === 'status') return statusOf(row);
  if (board.group === 'phase') return phaseIdOf(row);
  if (board.group === 'person') return personById(row.person) ? row.person : '';
  return String(Math.floor(startDay(row)));
}

function boardColumns() {
  var cards = data.rows.filter(function (r) { return r.type !== 'phase' && (board.subtasks || !r.parent); });
  var cols;
  if (board.group === 'status') {
    cols = [['open', 'Not started'], ['active', 'In progress'], ['done', 'Done'], ['ms', 'Milestones']].map(function (c) {
      return { key: c[0], title: c[1], dot: '<i class="col-dot ' + c[0] + '"></i>' };
    });
  } else if (board.group === 'phase') {
    cols = [{ key: '', title: 'No phase', dot: '<i class="col-dot none"></i>' }].concat(data.rows.filter(function (r) {
      return r.type === 'phase';
    }).map(function (p) {
      return { key: p.id, title: p.name, dot: '<i class="col-dot ph" style="' + colorVar(p).slice(2) + '"></i>' };
    }));
  } else if (board.group === 'person') {
    cols = [{ key: '', title: 'Unassigned', dot: '<i class="col-dot none"></i>' }].concat(data.people.map(function (p) {
      return { key: p.id, title: p.name, dot: avatar(p) };
    }));
  } else {
    var days = [];
    cards.forEach(function (r) {
      var d = Math.floor(startDay(r));
      if (days.indexOf(d) < 0) days.push(d);
    });
    cols = days.sort(function (a, b) { return a - b; }).map(function (d) {
      return { key: String(d), title: WEEKDAYS[new Date(PLAN_START + d * DAY).getUTCDay()] + ' ' + listDate(d), dot: '<i class="col-dot day"></i>' };
    });
  }
  cols.forEach(function (c) {
    c.cards = cards.filter(function (r) { return columnOf(r) === c.key; });
  });
  // "No phase" only shows when something is in it, or there are no phases at all.
  if (board.group === 'phase' && !cols[0].cards.length && cols.length > 1) cols.shift();
  return cols;
}

var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path></svg>';
var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
var ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

function cardHtml(r) {
  var who = personById(r.person);
  var s = startDay(r);
  var ms = r.type === 'milestone';
  var parent = r.parent && rowIndex[r.parent] != null ? data.rows[rowIndex[r.parent]] : null;
  var meta = [];
  if (showing('status') && board.group !== 'status') {
    var st = statusOf(r);
    meta.push('<span class="status ' + st + '">' + (st === 'ms' ? 'Milestone' : STATUS[st]) + '</span>');
  }
  if (showing('date') && board.group !== 'day') meta.push('<span class="card-date">' + ICON_CAL + listDate(Math.floor(s)) + '</span>');
  if (showing('time') && (s % 1 || (r.end != null && r.end % 1))) {
    meta.push('<span class="card-date">' + ICON_CLOCK + timeOf(s) + (r.end != null && r.end - s < 1 ? '–' + timeOf(r.end) : '') + '</span>');
  }
  if (showing('length') && r.end != null) meta.push('<span class="card-date">' + duration(r) + '</span>');
  if (showing('deps')) {
    var ds = depsOf(r);
    if (ds.length) {
      meta.push('<span class="card-date" title="Depends on ' + esc(ds.map(function (d) { return d.name; }).join(', ')) + '">' + ICON_LINK + ds.length + '</span>');
    }
  }
  var face = showing('person') && who && board.group !== 'person'
    ? '<span class="card-person" title="' + esc(who.name) + '">' + avatar(who) + '</span>' : '';
  var p = r.type === 'task' ? r.progress || 0 : 0;
  return '<div class="card' + (ms ? ' ms' : '') + (r.parent ? ' sub' : '') + (showing('color') ? '' : ' plain') + (r.id === freshId ? ' fresh' : '') +
    '" draggable="true" tabindex="0" role="button" data-id="' + esc(r.id) + '" style="' + colorVar(r).slice(2) + '" title="' +
    esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to move') + '">' +
    (showing('phase') && board.group !== 'phase' && phaseName(r) ? '<span class="card-phase">' + esc(phaseName(r)) + '</span>' : '') +
    '<span class="card-name">' + (ms ? '<i class="card-diamond"></i>' : '') + esc(r.name) + '</span>' +
    (parent ? '<span class="card-parent">↳ ' + esc(parent.name) + '</span>' : '') +
    (meta.length || face ? '<div class="card-foot"><div class="card-meta">' + meta.join('') + '</div>' + face + '</div>' : '') +
    (showing('progress') && p > 0 ? '<span class="card-progress"><b style="width: ' + p * 100 + '%"></b></span>' : '') +
    '</div>';
}

function renderBoard() {
  var cols = boardColumns();
  var n = cols.reduce(function (sum, c) { return sum + c.cards.length; }, 0);
  boardCols.innerHTML = cols.length ? cols.map(function (c) {
    var addWord = board.group === 'status' && c.key === 'ms' ? 'milestone' : 'task';
    return '<section class="board-col" data-col="' + esc(c.key) + '"><header class="board-col-head">' + c.dot +
      '<span class="board-col-title">' + esc(c.title) + '</span><span class="board-col-count">' + c.cards.length + '</span></header>' +
      '<div class="board-col-body">' + (c.cards.map(cardHtml).join('') || '<p class="board-col-empty">Nothing here</p>') + '</div>' +
      '<button type="button" class="board-col-add" data-col-add="' + esc(c.key) + '">+ New ' + addWord + '</button></section>';
  }).join('') : '<p class="board-empty">Nothing here yet.&nbsp;<button type="button" data-board-new>Add a task</button></p>';
  boardEl.querySelector('[data-board-count]').textContent = n + (n === 1 ? ' card' : ' cards');
  boardEl.classList.toggle('compact', board.width === 'compact');

  Array.prototype.forEach.call(boardEl.querySelectorAll('[data-group-by]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-group-by') === board.group));
  });
  Array.prototype.forEach.call(boardEl.querySelectorAll('[data-width]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-width') === board.width));
  });
  boardEl.querySelector('[data-board-subtasks]').setAttribute('aria-pressed', String(board.subtasks));
  var hidden = board.hide.length;
  var badge = boardEl.querySelector('[data-show-count]');
  badge.hidden = !hidden;
  badge.textContent = hidden + ' hidden';
  showMenu.innerHTML = CARD_FIELDS.map(function (f) {
    return '<button type="button" role="menuitemcheckbox" aria-checked="' + showing(f[0]) + '" data-field="' + f[0] + '">' + f[1] + '</button>';
  }).join('') + '<div class="dropdown-sep" role="separator"></div><button type="button" data-show-all' + (hidden ? '' : ' disabled') + '>Show everything</button>';
}

// Whether a card can go into a column: milestones only to Milestones and tasks never
// there; a subtask's phase comes from its parent, so it can't change phase on its own.
function canDrop(row, key) {
  if (!row || columnOf(row) === key) return false;
  if (board.group === 'status') return (row.type === 'milestone') === (key === 'ms');
  if (board.group === 'phase') return !row.parent;
  return true;
}

// Dropping a card on a column changes that about it. Rows are replaced with changed
// copies, so js/data.js rows stay untouched.
function moveCard(id, key) {
  var i = rowIndex[id];
  var row = data.rows[i];
  var copy = {};
  Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
  copy.added = true;
  if (board.group === 'status') {
    if (key === 'open') delete copy.progress;
    else if (key === 'done') copy.progress = 1;
    else copy.progress = row.progress > 0 && row.progress < 1 ? row.progress : 0.5;
  } else if (board.group === 'person') {
    if (key) copy.person = key;
    else delete copy.person;
  } else if (board.group === 'day') {
    var shift = Number(key) - Math.floor(startDay(row)); // same time of day, new day
    ['start', 'end', 'day'].forEach(function (k) { if (copy[k] != null) copy[k] += shift; });
  }
  data.rows[i] = copy;
  if (board.group === 'phase') {
    var block = takeOut(copy);
    Array.prototype.splice.apply(data.rows, [placeFor(copy, key), 0].concat(block));
  }
  freshId = id;
  refresh();
  savePlan();
  setTimeout(function () { if (freshId === id) freshId = null; }, 1600);
}

// A new item from the foot of a column starts out set for that column.
function addInColumn(key) {
  openForm();
  var f = form.elements;
  if (board.group === 'status') {
    if (key === 'ms') f.type.value = 'milestone';
    if (key === 'active') f.progress.value = 50;
    if (key === 'done') f.progress.value = 100;
  } else if (board.group === 'phase') {
    f.phase.value = key;
  } else if (board.group === 'person') {
    pickPerson(key);
  } else {
    f.startDate.value = dateOf(Number(key));
  }
  syncForm();
}

boardEl.addEventListener('click', function (e) {
  var t = e.target;
  var by = t.closest('[data-group-by]');
  var width = t.closest('[data-width]');
  var add = t.closest('[data-col-add]');
  var card = t.closest('.card[data-id]');
  if (by) board.group = by.getAttribute('data-group-by');
  else if (width) board.width = width.getAttribute('data-width');
  else if (t.closest('[data-board-subtasks]')) board.subtasks = !board.subtasks;
  else if (add) return addInColumn(add.getAttribute('data-col-add'));
  else if (t.closest('[data-board-new]')) return openForm();
  else if (card) return openEdit(card.getAttribute('data-id'));
  else return;
  saveBoard();
  renderBoard();
});
boardEl.addEventListener('keydown', function (e) {
  var card = e.target.closest('.card[data-id]');
  if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEdit(card.getAttribute('data-id'));
  }
});

// Drag the board itself to scroll: sideways moves the board; up and down scrolls the
// column under the press when it's taller than the screen, otherwise the board. Cards
// drag to other columns instead.
dragScroll(boardEl.querySelector('.board-scroll'), 'button, input, select, a, .card', function (t) {
  var body = t.closest('.board-col') && t.closest('.board-col').querySelector('.board-col-body');
  return body && body.scrollHeight > body.clientHeight ? body : null;
});

// Dragging cards between columns.
boardCols.addEventListener('dragstart', function (e) {
  var card = e.target.closest('.card[data-id]');
  if (!card) return;
  dragId = card.getAttribute('data-id');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch (err) { /* only Firefox needs data to start a drag */ }
  hideTip();
  setTimeout(function () { card.classList.add('dragging'); }, 0);
});
boardCols.addEventListener('dragover', function (e) {
  var col = e.target.closest('.board-col');
  var ok = col && dragId && canDrop(data.rows[rowIndex[dragId]], col.getAttribute('data-col'));
  Array.prototype.forEach.call(boardCols.querySelectorAll('.board-col.over'), function (c) { if (c !== col || !ok) c.classList.remove('over'); });
  if (!ok) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  col.classList.add('over');
});
boardCols.addEventListener('drop', function (e) {
  var col = e.target.closest('.board-col');
  e.preventDefault();
  var id = dragId;
  dragId = null;
  if (col && id && canDrop(data.rows[rowIndex[id]], col.getAttribute('data-col'))) moveCard(id, col.getAttribute('data-col'));
  else renderBoard();
});
boardCols.addEventListener('dragend', function () {
  dragId = null;
  Array.prototype.forEach.call(boardCols.querySelectorAll('.over, .dragging'), function (el) {
    el.classList.remove('over');
    el.classList.remove('dragging');
  });
});
boardCols.addEventListener('dragleave', function (e) {
  var col = e.target.closest('.board-col');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
});

// The Show menu: which details the cards show.
function showShowMenu(open) {
  showMenu.hidden = !open;
  showBtn.setAttribute('aria-expanded', String(open));
  if (open) showMenu.querySelector('button').focus();
}

showBtn.addEventListener('click', function () { showShowMenu(showMenu.hidden); });
showMenu.addEventListener('click', function (e) {
  var item = e.target.closest('[data-field]');
  if (item) {
    var key = item.getAttribute('data-field');
    var i = board.hide.indexOf(key);
    if (i >= 0) board.hide.splice(i, 1);
    else board.hide.push(key);
  } else if (e.target.closest('[data-show-all]')) {
    board.hide = [];
  } else {
    return;
  }
  saveBoard();
  renderBoard();
  var same = item ? showMenu.querySelector('[data-field="' + item.getAttribute('data-field') + '"]') : showMenu.querySelector('button');
  if (same) same.focus();
});
showMenu.addEventListener('keydown', function (e) {
  var items = Array.prototype.slice.call(showMenu.querySelectorAll('button:not(:disabled)'));
  var i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    showShowMenu(false);
    showBtn.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
});
document.addEventListener('click', function (e) {
  if (!showMenu.hidden && e.target.isConnected && !e.target.closest('.menu-wrap')) showShowMenu(false);
});

renderBoard();
