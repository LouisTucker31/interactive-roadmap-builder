// The calendar view: the plan by month or week.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Calendar: the plan by month or week, weeks starting on Monday. Items over more than one
// day are bars across their days (a phase without an end runs until the next phase);
// items within a day are chips with their time; milestones show as diamonds. A month
// shows up to CAL_LANES per week and "+n more" on a fuller day, which opens that week.
// Click an item to edit it, empty space in a day to add a task on that day, or drag an
// item to another day (it keeps its time and length). Tick boxes pick what shows.
var calEl = document.querySelector('[data-cal]');
var calGrid = calEl.querySelector('[data-cal-grid]');
var CAL_LANES = 3;
var cal = { view: 'month', show: { task: true, milestone: true, phase: true } };
var savedCal = localStore.getJSON(STORE.cal);
if (savedCal && savedCal.view) cal.view = savedCal.view;
if (savedCal && savedCal.show) cal.show = savedCal.show;
var calAt = +sessionStore.get(STORE.calAt) || TODAY; // a day in the month or week shown; kept for the tab
var calDrag = null;

function saveCal() {
  localStore.set(STORE.cal, JSON.stringify(cal));
  sessionStore.set(STORE.calAt, String(calAt));
}

// The first and last day a row covers, as day timestamps.
function calSpan(r) {
  var s = startDay(r);
  var e = s;
  if (r.end != null) e = r.end % 1 || s % 1 ? r.end - 1e-6 : r.end - 1; // a whole-day end is exclusive
  else if (r.type === 'phase') {
    var next = data.rows[sectionEnd(r.id)];
    if (next && next.start > s) e = next.start - 1e-6;
  }
  return [PLAN_START + Math.floor(s) * DAY, PLAN_START + Math.floor(Math.max(e, s)) * DAY];
}

function calWeeks() {
  if (cal.view === 'week') return [startOf(calAt, 'week')];
  var month = startOf(calAt, 'month');
  var next = add(month, 'month', 1);
  var weeks = [];
  for (var w = startOf(month, 'week'); w < next; w += 7 * DAY) weeks.push(w);
  return weeks;
}

// A week's pieces of items, each in the first lane where its days are free. Longer items
// go first so bars stack neatly; then by start time.
function weekSegs(ws, rows) {
  var we = ws + 6 * DAY;
  var segs = rows.map(function (r, i) {
    var sp = calSpan(r);
    if (sp[1] < ws || sp[0] > we) return null;
    return {
      r: r, i: i, c0: (Math.max(sp[0], ws) - ws) / DAY, c1: (Math.min(sp[1], we) - ws) / DAY,
      head: sp[0] >= ws, tail: sp[1] <= we, multi: sp[1] > sp[0], len: sp[1] - sp[0]
    };
  }).filter(Boolean).sort(function (a, b) {
    return b.len - a.len || a.c0 - b.c0 || startDay(a.r) - startDay(b.r) || a.i - b.i;
  });
  var lanes = [];
  segs.forEach(function (sg) {
    var k = 0;
    while (lanes[k] && lanes[k].some(function (used, c) { return used && c >= sg.c0 && c <= sg.c1; })) k++;
    lanes[k] = lanes[k] || [];
    for (var c = sg.c0; c <= sg.c1; c++) lanes[k][c] = true;
    sg.lane = k;
  });
  return { segs: segs, lanes: lanes.length };
}

function segHtml(sg) {
  var r = sg.r;
  var s = startDay(r);
  var timed = s % 1 && sg.head;
  var mark = r.type === 'milestone' ? '<i class="kind-mark ms"></i>' : r.type === 'phase' ? '<i class="kind-mark ph"></i>' : '<i class="kind-mark' + (r.parent ? ' sub' : '') + '"></i>';
  var done = r.type === 'task' && r.progress >= 1;
  var cls = 'cal-item ' + (sg.multi ? 'cal-bar' : 'cal-chip') + ' k-' + (r.type === 'task' && r.parent ? 'sub' : r.type) +
    (sg.head ? ' head' : '') + (sg.tail ? ' tail' : '') + (done ? ' done' : '') + (r.id === freshId ? ' fresh' : '');
  return '<div class="' + cls + '" data-id="' + esc(r.id) + '" draggable="true" tabindex="0" role="button" title="' +
    esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to another day') + '" style="left: calc(' + sg.c0 + ' * 100% / 7 + 2px); width: calc(' +
    (sg.c1 - sg.c0 + 1) + ' * 100% / 7 - 4px); top: ' + (28 + sg.lane * 22) + 'px' + colorVar(r) + '">' +
    (sg.multi && r.type === 'task' ? '' : mark) + (timed ? '<span class="cal-time">' + timeOf(s) + '</span>' : '') +
    '<span class="name-col">' + esc(r.name) + '</span></div>';
}

// One item in a day's list: its marker, time and name.
function itemLine(r, indent) {
  var s = startDay(r);
  var kind = r.type === 'task' && r.parent ? 'sub' : r.type;
  var mark = r.type === 'milestone' ? '<i class="kind-mark ms"></i>' : r.type === 'phase' ? '<i class="kind-mark ph"></i>' : '<i class="kind-mark' + (r.parent ? ' sub' : '') + '"></i>';
  var done = r.type === 'task' && r.progress >= 1;
  return '<div class="cal-entry k-' + kind + (indent ? ' in' : '') + (done ? ' done' : '') + (r.id === freshId ? ' fresh' : '') + '" data-id="' + esc(r.id) +
    '" draggable="true" tabindex="0" role="button" title="' + esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to another day') +
    '" style="' + colorVar(r).slice(2) + '">' + mark + (s % 1 ? '<span class="cal-time">' + timeOf(s) + '</span>' : '') +
    '<span class="name-col">' + esc(r.name) + '</span></div>';
}

// A day's own items (those within the day). The week view lists them all, grouped under
// their phases; a month lists a quiet day's few items, and sums up a busier one:
// milestones, then a line per phase with its tasks and how many are done, then any
// other tasks. A summary line opens that week.
function dayHtml(t, items, full) {
  if (!items.length) return '';
  items.sort(function (a, b) { return startDay(a) - startDay(b) || rowIndex[a.id] - rowIndex[b.id]; });
  var milestones = items.filter(function (r) { return r.type === 'milestone'; });
  var groups = [];
  var byId = {};
  function group(id) {
    if (!byId[id]) groups.push(byId[id] = { id: id, row: id ? data.rows[rowIndex[id]] : null, tasks: [], self: null });
    return byId[id];
  }
  items.forEach(function (r) {
    if (r.type === 'phase') group(r.id).self = r;
    else if (r.type === 'task') group(phaseIdOf(r)).tasks.push(r);
  });
  groups.sort(function (a, b) { return (a.id ? 0 : 1) - (b.id ? 0 : 1); }); // tasks without a phase last
  if (!full && items.length <= 3) return items.map(function (r) { return itemLine(r); }).join('');
  var out = milestones.map(function (r) { return itemLine(r); }).join('');
  var day = new Date(t);
  var dayName = day.getUTCDate() + ' ' + MONTHS[day.getUTCMonth()];
  groups.forEach(function (g) {
    var name = g.row ? g.row.name : 'Other tasks';
    var span = g.self ? timeOf(startDay(g.self)) + (g.self.end != null ? '–' + timeOf(g.self.end) : '') : '';
    if (full) {
      // Week view: the phase as a heading (editable when it's on this day), then its tasks.
      if (g.id || groups.length > 1) {
        out += '<div class="cal-group-head' + (g.id ? '' : ' other') + (g.self && g.self.id === freshId ? ' fresh' : '') + '"' + (g.row && g.row.color ? ' style="' + colorVar(g.row).slice(2) + '"' : '') +
          (g.self ? ' data-id="' + esc(g.self.id) + '" draggable="true" tabindex="0" role="button" title="' + esc(g.self.name + ' · ' + itemLabel(g.self) + ' · click to edit') + '"' : '') +
          '>' + (g.id ? '<i class="kind-mark ph"></i>' : '') + '<span class="name-col">' + esc(name) + '</span>' + (span ? '<span class="cal-time">' + span + '</span>' : '') + '</div>';
      }
      out += g.tasks.map(function (r) { return itemLine(r, !!g.id); }).join('');
      return;
    }
    var n = g.tasks.length;
    var doneN = g.tasks.filter(function (r) { return r.progress >= 1; }).length;
    if (!g.id) {
      out += '<div class="cal-summary other" role="button" tabindex="0" data-cal-open="' + t + '" title="See them in the week">+ ' + n + ' other ' + (n === 1 ? 'task' : 'tasks') + '</div>';
      return;
    }
    out += '<div class="cal-summary" role="button" tabindex="0" data-cal-open="' + t + '"' + (g.row.color ? ' style="' + colorVar(g.row).slice(2) + '"' : '') + ' title="' +
      esc(name + (span ? ' ' + span : '') + ' · ' + n + (n === 1 ? ' task' : ' tasks') + ' on ' + dayName + ', ' + doneN + ' done · click to see the week') + '">' +
      '<i class="kind-mark ph"></i><span class="name-col">' + esc(name) + '</span>' +
      (n ? '<span class="cal-count' + (doneN === n ? ' all' : '') + '">' + (doneN === n ? '✓ ' : '') + n + '</span>' : '<span class="cal-time">' + span + '</span>') +
      '</div>';
  });
  return out;
}

function renderCal() {
  var rows = data.rows.filter(function (r) { return cal.show[r.type] !== false; });
  var weeks = calWeeks();
  var month = startOf(calAt, 'month');
  var week = cal.view === 'week';
  calEl.classList.toggle('week', week);
  calEl.querySelector('[data-cal-days]').innerHTML = (WEEK_START === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]).map(function (d) {
    return '<span' + (d === 0 || d === 6 ? ' class="weekend"' : '') + '>' + WEEKDAYS[d] + '</span>';
  }).join('');
  // Items over several days are bars along the top of the week; the rest list in their day.
  var spans = rows.map(function (r) { return { r: r, sp: calSpan(r) }; });
  var multi = spans.filter(function (x) { return x.sp[1] > x.sp[0]; }).map(function (x) { return x.r; });
  calGrid.innerHTML = weeks.map(function (ws) {
    var w = weekSegs(ws, multi);
    var shownLanes = week ? w.lanes : Math.min(w.lanes, CAL_LANES);
    var hidden = [0, 0, 0, 0, 0, 0, 0];
    var segs = w.segs.filter(function (sg) {
      if (week || sg.lane < CAL_LANES) return true;
      for (var c = sg.c0; c <= sg.c1; c++) hidden[c]++;
      return false;
    });
    var days = '';
    for (var c = 0; c < 7; c++) {
      var t = ws + c * DAY;
      var d = new Date(t);
      var own = spans.filter(function (x) { return x.sp[0] === t && x.sp[1] === t; }).map(function (x) { return x.r; });
      var cls = 'cal-day' + (!week && startOf(t, 'month') !== month ? ' out' : '') + (t === TODAY ? ' is-today' : '') +
        (d.getUTCDay() % 6 === 0 ? ' weekend' : '');
      days += '<div class="' + cls + '" data-day="' + t + '" title="Click to add a task on ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + '">' +
        '<span class="cal-date">' + (d.getUTCDate() === 1 || week ? d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] : d.getUTCDate()) + '</span>' +
        '<div class="cal-list" style="margin-top: ' + (shownLanes * 22 + 3) + 'px">' + dayHtml(t, own, week) +
        (hidden[c] ? '<button type="button" class="cal-more" data-cal-more="' + ws + '" title="Show all of this week">+' + hidden[c] + ' more</button>' : '') +
        '</div></div>';
    }
    return '<div class="cal-week" style="--lanes: ' + shownLanes + '">' + days + segs.map(segHtml).join('') + '</div>';
  }).join('');
  calEl.querySelector('[data-cal-title]').textContent = week ? weekTitle(weeks[0]) : MONTHS_LONG[new Date(month).getUTCMonth()] + ' ' + new Date(month).getUTCFullYear();
  Array.prototype.forEach.call(calEl.querySelectorAll('[data-cal-view]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-cal-view') === cal.view));
  });
  Array.prototype.forEach.call(calEl.querySelectorAll('[data-cal-show]'), function (b) {
    b.checked = cal.show[b.getAttribute('data-cal-show')] !== false;
  });
}

var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "23 – 29 Nov 2026", or "30 Nov – 6 Dec 2026" across months.
function weekTitle(ws) {
  var a = new Date(ws);
  var b = new Date(ws + 6 * DAY);
  var sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return a.getUTCDate() + (sameMonth ? '' : ' ' + MONTHS[a.getUTCMonth()]) + (a.getUTCFullYear() !== b.getUTCFullYear() ? ' ' + a.getUTCFullYear() : '') +
    ' – ' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
}

// Move a row (and a parent's subtasks) by whole days, as changed copies.
function shiftDays(id, days) {
  var i = rowIndex[id];
  var row = data.rows[i];
  var n = row.type === 'task' && !row.parent ? childCount(row) : 0;
  for (var k = i; k <= i + n; k++) data.rows[k] = shifted(data.rows[k], days);
  freshId = id;
  refresh();
  savePlan();
  setTimeout(function () { if (freshId === id) freshId = null; }, 1600);
}

calEl.addEventListener('click', function (e) {
  var t = e.target;
  var step = t.closest('[data-cal-step]');
  var view = t.closest('[data-cal-view]');
  var more = t.closest('[data-cal-more]');
  var seg = t.closest('.cal-item[data-id], .cal-entry[data-id], .cal-group-head[data-id]');
  var open = t.closest('[data-cal-open]');
  var day = t.closest('.cal-day[data-day]');
  if (step) calAt = add(startOf(calAt, cal.view === 'week' ? 'week' : 'month'), cal.view === 'week' ? 'week' : 'month', +step.getAttribute('data-cal-step'));
  else if (t.closest('[data-cal-today]')) calAt = TODAY;
  else if (view) cal.view = view.getAttribute('data-cal-view');
  else if (more) {
    cal.view = 'week';
    calAt = +more.getAttribute('data-cal-more');
  } else if (open) {
    cal.view = 'week';
    calAt = +open.getAttribute('data-cal-open');
  } else if (seg) return openEdit(seg.getAttribute('data-id'));
  else if (day) {
    openForm();
    form.elements.startDate.value = isoDate(+day.getAttribute('data-day'));
    form.elements.allDay.checked = true;
    return syncForm();
  } else return;
  saveCal();
  renderCal();
});
calEl.addEventListener('change', function (e) {
  var box = e.target.closest('[data-cal-show]');
  if (!box) return;
  cal.show[box.getAttribute('data-cal-show')] = box.checked;
  saveCal();
  renderCal();
});
calEl.addEventListener('keydown', function (e) {
  var seg = e.target.closest('.cal-item[data-id], .cal-entry[data-id], .cal-group-head[data-id]');
  if (seg && e.target === seg && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEdit(seg.getAttribute('data-id'));
  } else if (e.target.matches('[data-cal-open]') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.target.click();
  }
});
calGrid.addEventListener('dragstart', function (e) {
  var seg = e.target.closest('.cal-item[data-id], .cal-entry[data-id], .cal-group-head[data-id]');
  if (!seg) return;
  // Where in the item it was picked up, so a long bar moves by the days the mouse moves.
  var r = calSpan(data.rows[rowIndex[seg.getAttribute('data-id')]]);
  var under = cellAt(e.clientX, e.clientY);
  calDrag = { id: seg.getAttribute('data-id'), from: under != null ? under : r[0] };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', calDrag.id); } catch (err) { /* only Firefox needs data to start a drag */ }
  hideTip();
  setTimeout(function () { seg.classList.add('dragging'); }, 0);
});

// The day under a screen point, from the day cells' positions.
function cellAt(x, y) {
  var cells = calGrid.querySelectorAll('.cal-day');
  for (var k = 0; k < cells.length; k++) {
    var b = cells[k].getBoundingClientRect();
    if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) return +cells[k].getAttribute('data-day');
  }
  return null;
}

calGrid.addEventListener('dragover', function (e) {
  if (!calDrag) return;
  var t = cellAt(e.clientX, e.clientY);
  Array.prototype.forEach.call(calGrid.querySelectorAll('.cal-day.over'), function (c) { c.classList.remove('over'); });
  if (t == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var cell = calGrid.querySelector('.cal-day[data-day="' + t + '"]');
  if (cell) cell.classList.add('over');
});
calGrid.addEventListener('drop', function (e) {
  e.preventDefault();
  var d = calDrag;
  calDrag = null;
  var t = cellAt(e.clientX, e.clientY);
  if (d && t != null && t !== d.from) shiftDays(d.id, Math.round((t - d.from) / DAY));
  else renderCal();
});
calGrid.addEventListener('dragend', function () {
  calDrag = null;
  Array.prototype.forEach.call(calGrid.querySelectorAll('.over, .dragging'), function (x) {
    x.classList.remove('over');
    x.classList.remove('dragging');
  });
});

renderCal();
