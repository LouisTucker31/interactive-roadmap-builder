// The timeline: its time axis and views, and drawing the plan on it (rows, bars, phases, workload).
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Infinite horizontal timeline. The axis (group row, column row, divider lines) is
// generated for a date range that grows whenever you scroll near either end. Time maps
// linearly to x at dayPx pixels per day. Dates are UTC so daylight saving never shifts a day.
var DAY = 864e5;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var HOUR = DAY / 24;

var TODAY = (function () {
  var now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
})();

// The current local time on the same UTC-based scale, for the hour view.
var NOW = (function () {
  var now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
})();

// Calendar maths on UTC timestamps. add() expects `t` to already be a unit start.
function startOf(t, unit) {
  var d = new Date(t);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth();
  switch (unit) {
    case 'hour': return Math.floor(t / HOUR) * HOUR;
    case 'day': return Date.UTC(y, m, d.getUTCDate());
    case 'week': return startOf(t, 'day') - (d.getUTCDay() - WEEK_START + 7) % 7 * DAY; // the project's first day of the week
    case 'month': return Date.UTC(y, m, 1);
    case 'quarter': return Date.UTC(y, m - m % 3, 1);
    case 'year': return Date.UTC(y, 0, 1);
    case 'decade': return Date.UTC(y - y % 10, 0, 1);
  }
}

function add(t, unit, n) {
  var d = new Date(t);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth();
  switch (unit) {
    case 'hour': return t + n * HOUR;
    case 'day': return t + n * DAY;
    case 'week': return t + n * 7 * DAY;
    case 'month': return Date.UTC(y, m + n, 1);
    case 'quarter': return Date.UTC(y, m + 3 * n, 1);
    case 'year': return Date.UTC(y + n, 0, 1);
    case 'decade': return Date.UTC(y + 10 * n, 0, 1);
  }
}

// The first day of the current week: the plan starts here, so Today always lands on it.
var PLAN_START = startOf(TODAY, 'week');

// Views (H/D/W/M/Q/Y). Each has a column unit, a group unit for the row above, the column
// width at 100% zoom, how many days "Fit to screen" shows, the narrowest column fit will
// allow, and how many columns to add each time an edge is reached. Weekend shading only
// shows in day and week views; the hour view shades the hours outside 7am–6pm instead.
// Day view chunks are whole weeks, and hour view chunks whole days, so shading stays aligned.
var SCALES = {
  H: { unit: 'hour', days: 1 / 24, group: 'day', basePx: 64, fitDays: 0.5, minPx: 40, chunk: 48 },
  D: { unit: 'day', days: 1, group: 'month', basePx: 60, fitDays: 21, minPx: 28, chunk: 63, shade: true },
  W: { unit: 'week', days: 7, group: 'month', basePx: 100, fitDays: 112, minPx: 75, chunk: 26, shade: true },
  M: { unit: 'month', days: 30.44, group: 'year', basePx: 150, fitDays: 365, minPx: 60, chunk: 12 },
  Q: { unit: 'quarter', days: 91.31, group: 'year', basePx: 240, fitDays: 730, minPx: 80, chunk: 8 },
  Y: { unit: 'year', days: 365.25, group: 'decade', basePx: 360, fitDays: 1826, minPx: 80, chunk: 10 }
};

var scroller = document.querySelector('.scroll');
var chart = scroller.querySelector('.chart');
var groupsEl = chart.querySelector('[data-groups]');
var colsEl = chart.querySelector('[data-cols]');
var mlinesEl = chart.querySelector('[data-mlines]');
var plan = chart.querySelector('[data-plan]');
var todayBtn = chart.querySelector('[data-today]');

// Zoom scales the timeline horizontally: 100% = the view's basePx per column. 'fit'
// sizes the view's fitDays to the visible width and follows window resizes.
var ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 500];
var zoomMode = 'fit';
var scale = SCALES.W;

// The view and zoom are remembered in this browser; where you'd scrolled to is kept for
// the tab (sessionStorage), so a refresh lands in the same place but a new visit starts at today.
var savedView = localStore.getJSON(STORE.view);
if (savedView && SCALES[savedView.scale]) {
  scale = SCALES[savedView.scale];
  if (ZOOM_STEPS.indexOf(savedView.zoom) >= 0) zoomMode = savedView.zoom;
}
// The first time a project opens in this tab it can start on a chosen page and view
// (Settings → Defaults); after that, a refresh keeps you where you were.
var firstOpen = sessionStore.get(STORE.opened + ':' + currentId) == null;
if (firstOpen) sessionStore.set(STORE.opened + ':' + currentId, '1');
if (firstOpen && SCALES[defaults().openScale]) {
  scale = SCALES[defaults().openScale];
  zoomMode = 'fit';
}

function scaleKey() {
  return Object.keys(SCALES).filter(function (k) { return SCALES[k] === scale; })[0];
}

function saveView() {
  localStore.set(STORE.view, JSON.stringify({ scale: scaleKey(), zoom: zoomMode }));
}

function saveSpot() {
  var spot = { scale: scaleKey(), time: timeAt(scroller.scrollLeft), top: scroller.scrollTop };
  sessionStore.set(STORE.spot, JSON.stringify(spot));
}

var rangeStart = add(home(), scale.unit, -scale.chunk);
var rangeEnd = add(home(), scale.unit, 2 * scale.chunk);
var dayPx = dayPxFor(zoomMode);

// Where Today scrolls to: one column before the current one, so the last hour / yesterday /
// last week / last month / last quarter shows first and the current period second. Year
// view starts on the current year.
function home() {
  var now = nowCol();
  return scale.unit === 'year' ? now : add(now, scale.unit, -1);
}

// The column containing now: the current hour in hour view, otherwise today's period.
function nowCol() {
  return startOf(scale.unit === 'hour' ? NOW : TODAY, scale.unit);
}

function dayPxFor(mode) {
  if (mode !== 'fit') return mode / 100 * scale.basePx / scale.days;
  return Math.max(scale.minPx / scale.days, scroller.clientWidth / scale.fitDays);
}

function xOf(time) {
  return (time - rangeStart) / DAY * dayPx;
}

function timeAt(x) {
  return rangeStart + x / dayPx * DAY;
}

function colLabel(t, width) {
  var d = new Date(t);
  switch (scale.unit) {
    case 'hour': return pad(d.getUTCHours()) + ':00';
    case 'day': return (width >= 52 ? WEEKDAYS[d.getUTCDay()] + ' ' : '') + d.getUTCDate();
    case 'week': return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    case 'month': return MONTHS[d.getUTCMonth()];
    case 'quarter': return 'Q' + (d.getUTCMonth() / 3 + 1);
    case 'year': return String(d.getUTCFullYear());
  }
}

function groupLabel(t) {
  var d = new Date(t);
  if (scale.group === 'day') return (WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]).toUpperCase();
  if (scale.group === 'month') return MONTHS[d.getUTCMonth()].toUpperCase() + ' ' + d.getUTCFullYear();
  if (scale.group === 'decade') return d.getUTCFullYear() + 's';
  return String(d.getUTCFullYear());
}

function render() {
  chart.style.setProperty('--week', 7 * dayPx + 'px');
  chart.style.setProperty('--dock-x', (scale.unit === 'week' ? 7 * dayPx * 37 / 75 : 24) + 'px');
  chart.style.width = xOf(rangeEnd) + 'px';
  chart.toggleAttribute('data-noshade', !scale.shade);
  chart.toggleAttribute('data-sunday', WEEK_START === 0); // weekend shading starts a day later
  chart.toggleAttribute('data-hours', scale.unit === 'hour');
  chart.style.setProperty('--day', 24 * HOUR / DAY * dayPx + 'px');

  // Columns; the one containing today gets a highlighted label and a line at its start
  // (in hour view, the line sits at the current minute).
  var now = nowCol();
  var cols = '';
  var lines = '';
  // Zoomed well into the hour view, hours split into half hours (from 300%) or quarter
  // hours (from 500%), each with its own column and a fainter line.
  var pct = zoomPct();
  var split = scale.unit !== 'hour' ? 1 : pct >= 450 ? 4 : pct >= 280 ? 2 : 1;
  var step = HOUR / split;
  for (var t = rangeStart; t < rangeEnd; t = split > 1 ? t + step : add(t, scale.unit, 1)) {
    var next = split > 1 ? t + step : add(t, scale.unit, 1);
    var width = xOf(next) - xOf(t);
    var label = split > 1 ? clockOf(t) : colLabel(t, width);
    var isNow = split > 1 ? NOW >= t && NOW < next : t === now;
    var part = split > 1 && t % HOUR !== 0; // a half or quarter hour, not on the hour
    cols += isNow
      ? '<div class="col now' + (part ? ' part' : '') + '" style="width: ' + width + 'px" aria-current="date"><span>' + label + '</span></div>'
      : '<div class="col' + (part ? ' part' : '') + '" style="width: ' + width + 'px">' + label + '</div>';
    // Day/week views divide the chart at month boundaries; coarser views at every column,
    // with a stronger line between days in hour view and fainter ones between part hours.
    if (t > rangeStart && !scale.shade) {
      lines += '<div class="grid-line' + (part ? ' part' : scale.unit === 'hour' && t % DAY === 0 ? ' day' : '') + '" style="left: ' + xOf(t) + 'px"></div>';
    }
  }
  colsEl.innerHTML = cols;

  var groups = '';
  for (var g = startOf(rangeStart, scale.group); g < rangeEnd; g = add(g, scale.group, 1)) {
    var next = add(g, scale.group, 1);
    var gw = xOf(Math.min(next, rangeEnd)) - xOf(Math.max(g, rangeStart));
    groups += '<div class="group" style="width: ' + gw + 'px"><span>' + groupLabel(g) + '</span></div>';
    if (g > rangeStart && scale.shade) lines += '<div class="grid-line" style="left: ' + xOf(g) + 'px"></div>';
  }
  groupsEl.innerHTML = groups;
  // The now-line goes last so it sits on top of any divider at the same spot.
  mlinesEl.innerHTML = lines + '<div class="now-line" style="left: ' + xOf(scale.unit === 'hour' ? NOW : now) + 'px"></div>';
  renderPlan();
}

// Plan rows (tasks, milestones, phase headers), dependency arrows and footer stats,
// all drawn from js/data.js. Rows sit on a 34px grid (whole pixels keep the lines crisp) starting at ROW_Y (row centre).
var data = window.WORKSPACE;
loadPlan();
var ROW_Y = 51; // one empty row on top, where the Today button floats
var ROW_PX = 34;
var depsEl = chart.querySelector('[data-deps]');
var bandsEl = chart.querySelector('[data-bands]');
var freshId = null; // a just-created row, flashed briefly
var movingId = null; // the row being dragged to a new time
var rowIndex = {};
data.rows.forEach(function (row, i) { if (row.id) rowIndex[row.id] = i; });
data.rows.forEach(function (row, i) { // every row needs an id to be edited
  if (!row.id) rowIndex[row.id = uniqueId(row.name)] = i;
});

function dayX(day) {
  return xOf(PLAN_START + day * DAY);
}

function dayLabel(day) {
  var d = new Date(PLAN_START + Math.floor(day) * DAY);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// Days can be fractional when a time of day was given; show the time then too.
function whenLabel(day) {
  var mins = Math.round((day - Math.floor(day)) * 1440);
  return dayLabel(day) + (mins ? ' ' + pad(Math.floor(mins / 60)) + ':' + pad(mins % 60) : '');
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

// A whole-day `end` is exclusive, so the last day shown is the one before it.
// Within one day only the finish time is repeated: "28 Oct 09:30 – 11:30".
function rangeLabel(row) {
  if (row.end % 1 && Math.floor(row.end) === Math.floor(row.start)) return whenLabel(row.start) + ' – ' + timeOf(row.end);
  return whenLabel(row.start) + ' – ' + (row.end % 1 ? whenLabel(row.end) : dayLabel(row.end - 1));
}

// When a row happens. Tasks and milestones without an `end` happen at a moment ("at
// 10:00"); a phase without one runs until the next phase. A milestone starts at `day`.
function itemLabel(row) {
  if (row.type === 'milestone') return row.end != null ? rangeLabel({ start: row.day, end: row.end }) : whenLabel(row.day);
  if (row.type === 'phase') return row.end != null ? rangeLabel(row) : 'from ' + whenLabel(row.start);
  return row.end != null ? rangeLabel(row) : whenLabel(row.start);
}

// Task colours: picked in the task form and stored as `color`. Blue is the default and
// isn't stored. Subtask bars use a light tint of the colour (see .bar.lt in the CSS).
var COLORS = [
  ['Blue', '#418dab'], ['Teal', '#2f9585'], ['Green', '#4f9a3a'], ['Gold', '#b8860b'], ['Orange', '#dd6f2c'],
  ['Red', '#cf4646'], ['Pink', '#cf4d8a'], ['Purple', '#8458e0'], ['Slate', '#66727f']
];

// The inline style that gives a row its colour, or '' for the default.
function colorVar(row) {
  return safeColor(row.color, '') ? '; --c: ' + row.color : '';
}

// People: any row can have a `person` (an id from data.people). People are added from
// the task form and saved with the plan; each new one gets the next avatar colour.
var AVATAR_COLORS = ['#dfae2f', '#de4f87', '#e57f3a', '#8b5cf0', '#2f9585', '#418dab', '#cf4646', '#4f9a3a'];

function personById(id) {
  return id ? data.people.filter(function (p) { return p.id === id; })[0] || null : null;
}

function initials(name) {
  var words = name.trim().split(/\s+/);
  return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : '')).toUpperCase();
}

function avatar(p) {
  return '<span class="person-avatar" style="background: ' + safeColor(p.color, AVATAR_COLORS[0]) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>';
}

// Milestones and tasks without a finish are drawn as marks, not bars: a milestone with
// a finish is a diamond at each end joined by a line.
function isPoint(row) {
  return row.type === 'milestone' || (row.type === 'task' && row.end == null);
}

// Where a row's shape sits: horizontal extent, vertical centre and top edge.
function box(row, i) {
  var cy = workload ? (wl.cy[row.id] != null ? wl.cy[row.id] : ROW_Y) : ROW_Y + i * ROW_PX;
  if (isPoint(row)) {
    var x = dayX(row.type === 'milestone' ? row.day : row.start);
    var xe = row.end != null ? dayX(row.end) : x; // a milestone's finish diamond
    return { x1: x - 6, x2: xe + 6, cx: x, ex: xe, cy: cy, top: cy - 6 };
  }
  var h = row.parent ? 18 : 20;
  return { x1: dayX(row.start), x2: dayX(row.end), cy: cy, top: cy - h / 2 };
}

// Day view and coarser: items timed within a single day would pile up on top of each
// other at that day, so runs of them (one row after another, all on the same day) are
// drawn as day pills instead, one per row with its time. Clicking one opens the hour view
// at that day. All-day items, and anything longer than a day, draw as usual.
var grouped = {}; // row id → its group, while drawn grouped

function intraday(row) {
  var s = startDay(row);
  if (s % 1 === 0 && (row.end == null || row.end % 1 === 0)) return false; // all-day
  return row.end == null || row.end <= Math.floor(s) + 1;
}

function dayGroups() {
  var groups = [];
  var run = null;
  if (scale.unit !== 'hour') {
    data.rows.forEach(function (row, i) {
      var day = intraday(row) ? Math.floor(startDay(row)) : null;
      if (day != null && run && run.day === day) {
        run.to = i;
        return;
      }
      if (run) groups.push(run);
      run = day != null ? { day: day, from: i, to: i } : null;
    });
    if (run) groups.push(run);
  }
  grouped = {};
  groups.forEach(function (g) {
    for (var i = g.from; i <= g.to; i++) grouped[data.rows[i].id] = g;
  });
  return groups;
}

// A pill on each grouped row at its day, like the workload's: the item's marker and
// its time (a phase's span). Clicking it opens the hour view at that time.
function groupHtml(g) {
  var x1 = dayX(g.day);
  var w = Math.max(dayX(g.day + 1) - x1, 64);
  return data.rows.slice(g.from, g.to + 1).map(function (r, k) {
    var s = startDay(r);
    var span = timeOf(s) + (r.end != null ? '–' + timeOf(r.end) : '');
    var mark = r.type === 'phase' ? 'ph' : r.type === 'milestone' ? 'ms' : r.parent ? 'sub' : '';
    return '<div class="workload-group row-pill' + (r.id === freshId ? ' fresh' : '') + '" data-group="' + g.day + '" data-first="' + s +
      '" role="button" tabindex="0" title="' + esc(r.name + ' · ' + itemLabel(r) + ' · click to see it by the hour') +
      '" style="left: ' + x1 + 'px; top: ' + (ROW_Y + (g.from + k) * ROW_PX - 10) + 'px; min-width: ' + w + 'px">' +
      '<i class="' + mark + '" style="' + colorVar(r).slice(2) + '"></i>' + span + '</div>';
  }).join('');
}

function itemsWord(n) {
  return n + (n === 1 ? ' item' : ' items');
}

// Open the hour view at a day, starting just before `first` (by default the day's first
// grouped item).
function openDay(day, first) {
  var rows = data.rows.filter(function (r) { return grouped[r.id] && grouped[r.id].day === day; });
  if (first == null || isNaN(first)) first = rows.length ? Math.min.apply(null, rows.map(startDay)) : day + 9 / 24;
  var t = PLAN_START + first * DAY - HOUR;
  closePeek();
  setScale('H');
  recentre(t);
  scroller.scrollLeft = xOf(t);
  extend();
  syncTodayArrow();
}

// Workload: the same timeline, but a row per person (and Unassigned) instead of a row
// per item. Each person's tasks and milestones are packed into as few lanes as they fit
// without overlapping on screen, and times when they have two timed tasks at once are
// tinted red: that's their overload. In day view and coarser, a person's several timed
// items on one day become one "n items" pill that opens the hour view. Phases and
// dependency arrows aren't drawn here.
var workload = false;
var wl = null; // the layout: each row's lane centre, each person's block

// Where several timed tasks run at once: [start, end] day ranges, merged.
function overlaps(rows) {
  var ev = [];
  rows.forEach(function (r) {
    if (r.type !== 'task' || r.end == null) return;
    ev.push([r.start, 1], [r.end, -1]);
  });
  ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); // finishes before starts
  var out = [];
  var n = 0;
  var from = null;
  ev.forEach(function (e) {
    n += e[1];
    if (n >= 2 && from == null) from = e[0];
    if (n < 2 && from != null) {
      if (e[0] > from) out.push([from, e[0]]);
      from = null;
    }
  });
  return out;
}

function workloadLayout() {
  var items = data.rows.filter(function (r) { return r.type !== 'phase'; });
  var owners = data.people.map(function (p) { return { id: p.id, p: p }; });
  var unassigned = items.filter(function (r) { return !personById(r.person); });
  if (unassigned.length || !owners.length) owners.push({ id: '', p: null });
  var layout = { cy: {}, blocks: [], groups: [], grouped: {}, lanes: 0 };
  owners.forEach(function (o) {
    var mine = items.filter(function (r) { return (personById(r.person) ? r.person : '') === o.id; });
    // Things to place: single items, or in coarse views a day's several timed items.
    var units = [];
    var byDay = {};
    mine.forEach(function (r) {
      if (scale.unit !== 'hour' && intraday(r)) {
        var d = Math.floor(startDay(r));
        (byDay[d] = byDay[d] || []).push(r);
      } else {
        units.push({ rows: [r] });
      }
    });
    Object.keys(byDay).forEach(function (d) {
      units.push({ rows: byDay[d], day: +d }); // even a single item, so every day reads the same
    });
    units.forEach(function (u) {
      var r = u.rows[0];
      if (u.day != null) {
        u.x1 = dayX(u.day);
        u.x2 = u.x1 + Math.max(dayX(u.day + 1) - u.x1, 64);
      } else {
        var b = { x1: dayX(startDay(r)) };
        if (r.type === 'milestone') b = { x1: b.x1 - 6, x2: (r.end != null ? dayX(r.end) : b.x1 + 6) + 6 };
        else if (r.end == null) b.x2 = b.x1 + 26 + r.name.length * 6.6; // ring and name
        else b.x2 = Math.max(dayX(r.end), b.x1 + 4);
        u.x1 = b.x1 - (r.end == null && r.type === 'task' ? 6 : 0);
        u.x2 = b.x2;
      }
    });
    units.sort(function (a, b) { return a.x1 - b.x1; });
    var ends = []; // each lane's right edge so far
    units.forEach(function (u) {
      var k = 0;
      while (k < ends.length && ends[k] > u.x1 - 6) k++;
      ends[k] = u.x2;
      u.lane = k;
    });
    var lanes = Math.max(1, ends.length);
    units.forEach(function (u) {
      var cy = ROW_Y + (layout.lanes + u.lane) * ROW_PX;
      u.rows.forEach(function (r) { layout.cy[r.id] = cy; });
      if (u.day != null) {
        u.cy = cy;
        layout.groups.push(u);
        u.rows.forEach(function (r) { layout.grouped[r.id] = u; });
      }
    });
    var over = overlaps(mine);
    layout.blocks.push({
      id: o.id, p: o.p, rows: mine, first: layout.lanes, lanes: lanes, over: over,
      overDays: over.reduce(function (sum, s) { return sum + s[1] - s[0]; }, 0)
    });
    layout.lanes += lanes;
  });
  return layout;
}

function workloadHtml() {
  var html = '';
  wl.blocks.forEach(function (bk) {
    var top = ROW_Y - ROW_PX / 2 + bk.first * ROW_PX;
    var h = bk.lanes * ROW_PX;
    bk.over.forEach(function (s) {
      html += '<div class="workload-overlap" title="' + esc((bk.p ? bk.p.name : 'Unassigned') + ' has more than one task at once here') +
        '" style="left: ' + dayX(s[0]) + 'px; width: ' + Math.max(dayX(s[1]) - dayX(s[0]), 2) + 'px; top: ' + top + 'px; height: ' + h + 'px"></div>';
    });
    var tint = bk.p ? ' style="--c: ' + safeColor(bk.p.color, AVATAR_COLORS[0]) + '; top: ' : ' style="top: ';
    html = '<div class="workload-band' + (bk.p ? '' : ' none') + '"' + tint + top + 'px; height: ' + h + 'px"></div>' + html; // behind everything
    html += '<div class="workload-sep" style="top: ' + (top + h - 2) + 'px"></div>';
  });
  wl.groups.forEach(function (u) {
    var first = Math.min.apply(null, u.rows.map(startDay));
    var last = Math.max.apply(null, u.rows.map(function (r) { return r.end != null ? r.end : startDay(r); }));
    var n = u.rows.length;
    var fresh = u.rows.some(function (r) { return r.id === freshId; }) ? ' fresh' : '';
    html += '<div class="workload-group' + fresh + '" data-group="' + u.day + '" data-first="' + first + '" role="button" tabindex="0" title="' +
      esc(itemsWord(n) + ' on ' + dayLabel(u.day) + ', ' + timeOf(first) + '–' + timeOf(last) + ' · click to see them by the hour') +
      '" style="left: ' + u.x1 + 'px; top: ' + (u.cy - 10) + 'px; min-width: ' + (u.x2 - u.x1) + 'px"><b>' + n + '</b> ' + (n === 1 ? 'item' : 'items') + '</div>';
  });
  return html;
}

function renderPlan() {
  var html = '';
  var bands = '';
  if (workload) {
    wl = workloadLayout();
    grouped = wl.grouped;
    html += workloadHtml();
  } else {
    dayGroups().forEach(function (g) { html += groupHtml(g); });
  }
  data.rows.forEach(function (row, i) {
    if (grouped[row.id]) return; // drawn as part of a day group
    if (workload && row.type === 'phase') return;
    var b = box(row, i);
    var who = personById(row.person);
    var face = workload ? null : who; // the workload row already says whose it is
    var tip = ' data-id="' + esc(row.id) + '" title="' + esc(row.name + ' · ' + itemLabel(row) + (who ? ' · ' + who.name : '')) + '"';
    var state = (row.id === freshId ? ' fresh' : '') + (row.id === movingId ? ' moving' : '');
    if (row.type === 'phase') {
      // An open-ended phase's line runs the whole width; one with an end stops there.
      var span = row.end != null ? 'left: ' + b.x1 + 'px; width: ' + (b.x2 - b.x1) + 'px; ' : '';
      // A circle on the line marks the start, and another the end when there is one.
      html += '<div class="phase-line" style="' + span + 'top: ' + (b.cy + 6) + 'px' + colorVar(row) + '"></div>' +
        '<div class="phase-cap' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + (b.cy + 2) + 'px' + colorVar(row) + '"></div>' +
        (row.end != null ? '<div class="phase-cap' + state + '"' + tip + ' style="left: ' + b.x2 + 'px; top: ' + (b.cy + 2) + 'px' + colorVar(row) + '"></div>' : '') +
        '<div class="phase' + state + '"' + tip + ' style="left: ' + (b.x1 - 6) + 'px; top: ' + (b.cy - 13) + 'px' + colorVar(row) + '">' + esc(row.name) + '</div>';
      // A tinted band behind the whole section, over the phase's time: up to its end, or
      // for an open-ended phase up to the next phase's start (or the end of the timeline).
      var next = data.rows[sectionEnd(row.id)];
      var bx2 = row.end != null ? b.x2 : next && dayX(next.start) > b.x1 ? dayX(next.start) : xOf(rangeEnd);
      bands += '<div class="band" style="left: ' + b.x1 + 'px; width: ' + (bx2 - b.x1) + 'px; top: ' + (b.cy - ROW_PX / 2) +
        'px; height: ' + (sectionEnd(row.id) - i) * ROW_PX + 'px' + colorVar(row) + '"></div>';
    } else if (row.type === 'milestone') {
      // A diamond, or with a finish, a diamond at each end joined by a line.
      if (row.end != null) {
        html += '<div class="milestone-link' + state + '"' + tip + ' style="left: ' + b.cx + 'px; width: ' + (b.ex - b.cx) + 'px; top: ' + (b.cy - 1) + 'px"></div>' +
          '<div class="diamond' + state + '"' + tip + ' style="left: ' + (b.ex - 6) + 'px; top: ' + b.top + 'px"></div>';
      }
      html += '<div class="diamond' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + b.top + 'px"></div>';
    } else if (row.end == null) {
      // A task at a moment: a ring (filled with a tick once done) with its name beside it.
      html += '<div class="point' + (row.parent ? ' tint' : '') + (row.progress >= 1 ? ' done' : '') + state + '"' + tip +
        ' style="left: ' + b.x1 + 'px; top: ' + (b.cy - 10) + 'px' + colorVar(row) + '"><i></i>' +
        '<span class="t">' + esc(row.name) + '</span>' + (face ? avatar(face) : '') + '</div>';
    } else {
      // Progress darkens the done part of the bar, whatever its colour.
      var fill = row.progress && !row.parent
        ? '; background-image: linear-gradient(90deg,rgba(0,0,0,.16) 0 ' + row.progress * 100 + '%,transparent ' + row.progress * 100 + '%)'
        : '';
      html += '<div class="bar ' + (row.parent ? 'tint' : 'solid') + (b.x2 - b.x1 < 30 ? ' tiny' : '') + state + '" data-id="' + esc(row.id) +
        '" style="left: ' + b.x1 + 'px; top: ' + b.top + 'px; width: ' + (b.x2 - b.x1) + 'px' + fill + colorVar(row) + '" title="' +
        esc(row.name + ' · ' + rangeLabel(row) + (who ? ' · ' + who.name : '')) + '">' +
        '<span class="t">' + esc(row.name) + '</span>' + (face && b.x2 - b.x1 >= 70 ? avatar(face) : '') + '</div>';
    }
  });
  plan.innerHTML = html;
  bandsEl.innerHTML = bands;

  // Leave a screen of blank space below the last row so the chart can always scroll down.
  var lastRow = ROW_Y + (workload ? wl.lanes : data.rows.length) * ROW_PX;
  chartBody.style.minHeight = Math.max(620, lastRow + scroller.clientHeight - 41 - ROW_PX) + 'px';

  // Each arrow leaves the end of `from` and drops onto the start of `to`.
  depsEl.innerHTML = data.deps.filter(function (dep) {
    return !workload && rowIndex[dep[0]] != null && rowIndex[dep[1]] != null && !grouped[dep[0]] && !grouped[dep[1]];
  }).map(function (dep) {
    var fi = rowIndex[dep[0]];
    var ti = rowIndex[dep[1]];
    var from = box(data.rows[fi], fi);
    var to = box(data.rows[ti], ti);
    var fx = isPoint(data.rows[fi]) ? from.x2 + 1 : from.x2;
    var tx = isPoint(data.rows[ti]) ? to.cx : to.x1 + 5;
    var ty = isPoint(data.rows[ti]) ? to.cy - 10 : to.top - 2;
    var d = tx >= fx
      ? 'M' + fx + ' ' + from.cy + 'H' + tx + 'V' + ty
      : 'M' + fx + ' ' + from.cy + 'H' + (fx + 4) + 'V' + (ty - 8) + 'H' + tx + 'V' + ty;
    return '<path d="' + d + '" marker-end="url(#ah)"></path>';
  }).join('');

  renderStats();
  if (workload) renderPeopleList(); // lanes change with zoom, so the people rows do too
}
