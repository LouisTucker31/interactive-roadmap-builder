// Gantt planner entry point.
(function () {
  'use strict';

  // Light/dark theme toggle. The initial theme is set inline in <head> to avoid a flash.
  var root = document.documentElement;
  var toggle = document.querySelector('[data-theme-toggle]');

  function syncToggle() {
    var dark = root.getAttribute('data-theme') === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode');
    toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  toggle.addEventListener('click', function () {
    setThemeMode(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // 'light', 'dark' or 'system' (follow the computer's setting, as it changes). Set from
  // the rail's moon/sun or the profile popup.
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function themeMode() {
    var saved;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  }

  function setThemeMode(mode) {
    try {
      if (mode === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch (e) {}
    root.setAttribute('data-theme', mode === 'system' ? (systemDark.matches ? 'dark' : 'light') : mode);
    syncToggle();
  }

  if (systemDark.addEventListener) {
    systemDark.addEventListener('change', function () { if (themeMode() === 'system') setThemeMode('system'); });
  }

  syncToggle();

  // Projects: each has a name, a tag and its own saved plan. The first project's plan keeps
  // the original storage key, so plans saved before projects existed carry straight on.
  // The open project is remembered in this browser; switching reloads the page.
  var FIRST_PROJECT = 'ex-hailstorm';
  var projects;
  var currentId;
  try { projects = JSON.parse(localStorage.getItem('roadmapProjects')); } catch (e) {}
  if (!Array.isArray(projects) || !projects.length) projects = [{ id: FIRST_PROJECT, name: 'Ex HAILSTORM' }];
  try { currentId = localStorage.getItem('roadmapCurrent'); } catch (e) {}
  if (!projects.some(function (p) { return p.id === currentId; })) currentId = projects[0].id;

  function project() {
    return projects.filter(function (p) { return p.id === currentId; })[0];
  }

  function planKey(id) {
    id = id || currentId;
    return id === FIRST_PROJECT ? 'roadmapPlan' : 'roadmapPlan:' + id;
  }

  function saveProjects() {
    try { localStorage.setItem('roadmapProjects', JSON.stringify(projects)); } catch (e) {}
  }

  function projectId(name) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    var id = base;
    for (var n = 2; projects.some(function (p) { return p.id === id; }); n++) id = base + '-' + n;
    return id;
  }

  function openProject(id) {
    try {
      localStorage.setItem('roadmapCurrent', id);
      sessionStorage.removeItem('roadmapSpot');
    } catch (e) {}
    location.reload();
  }

  document.title = project().name;

  // Project defaults, set in Settings: the first day of the week (1 Monday, 0 Sunday), the
  // page and view to open on, and what new items start with.
  function defaults() {
    return project().defaults || {};
  }

  var WEEK_START = defaults().weekStart === 0 ? 0 : 1;

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
  var savedView;
  try { savedView = JSON.parse(localStorage.getItem('roadmapView')); } catch (e) {}
  if (savedView && SCALES[savedView.scale]) {
    scale = SCALES[savedView.scale];
    if (ZOOM_STEPS.indexOf(savedView.zoom) >= 0) zoomMode = savedView.zoom;
  }
  // The first time a project opens in this tab it can start on a chosen page and view
  // (Settings → Defaults); after that, a refresh keeps you where you were.
  var firstOpen = false;
  try {
    firstOpen = !sessionStorage.getItem('roadmapOpened:' + currentId);
    sessionStorage.setItem('roadmapOpened:' + currentId, '1');
  } catch (e) {}
  if (firstOpen && SCALES[defaults().openScale]) {
    scale = SCALES[defaults().openScale];
    zoomMode = 'fit';
  }

  function scaleKey() {
    return Object.keys(SCALES).filter(function (k) { return SCALES[k] === scale; })[0];
  }

  function saveView() {
    try { localStorage.setItem('roadmapView', JSON.stringify({ scale: scaleKey(), zoom: zoomMode })); } catch (e) {}
  }

  function saveSpot() {
    var spot = { scale: scaleKey(), time: timeAt(scroller.scrollLeft), top: scroller.scrollTop };
    try { sessionStorage.setItem('roadmapSpot', JSON.stringify(spot)); } catch (e) {}
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
        lines += '<div class="mline' + (part ? ' part' : scale.unit === 'hour' && t % DAY === 0 ? ' day' : '') + '" style="left: ' + xOf(t) + 'px"></div>';
      }
    }
    colsEl.innerHTML = cols;

    var groups = '';
    for (var g = startOf(rangeStart, scale.group); g < rangeEnd; g = add(g, scale.group, 1)) {
      var next = add(g, scale.group, 1);
      var gw = xOf(Math.min(next, rangeEnd)) - xOf(Math.max(g, rangeStart));
      groups += '<div class="group" style="width: ' + gw + 'px"><span>' + groupLabel(g) + '</span></div>';
      if (g > rangeStart && scale.shade) lines += '<div class="mline" style="left: ' + xOf(g) + 'px"></div>';
    }
    groupsEl.innerHTML = groups;
    // The now-line goes last so it sits on top of any divider at the same spot.
    mlinesEl.innerHTML = lines + '<div class="nowline" style="left: ' + xOf(scale.unit === 'hour' ? NOW : now) + 'px"></div>';
    renderPlan();
  }

  // Plan rows (tasks, milestones, phase headers), dependency arrows and footer stats,
  // all drawn from js/data.js. Rows sit on a 34px grid (whole pixels keep the lines crisp) starting at ROW_Y (row centre).
  var data = window.ROADMAP;
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
  function when(day) {
    var mins = Math.round((day - Math.floor(day)) * 1440);
    return dayLabel(day) + (mins ? ' ' + pad(Math.floor(mins / 60)) + ':' + pad(mins % 60) : '');
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // A whole-day `end` is exclusive, so the last day shown is the one before it.
  // Within one day only the finish time is repeated: "28 Oct 09:30 – 11:30".
  function rangeLabel(row) {
    if (row.end % 1 && Math.floor(row.end) === Math.floor(row.start)) return when(row.start) + ' – ' + timeOf(row.end);
    return when(row.start) + ' – ' + (row.end % 1 ? when(row.end) : dayLabel(row.end - 1));
  }

  // When a row happens. Tasks and milestones without an `end` happen at a moment ("at
  // 10:00"); a phase without one runs until the next phase. A milestone starts at `day`.
  function itemLabel(row) {
    if (row.type === 'milestone') return row.end != null ? rangeLabel({ start: row.day, end: row.end }) : when(row.day);
    if (row.type === 'phase') return row.end != null ? rangeLabel(row) : 'from ' + when(row.start);
    return row.end != null ? rangeLabel(row) : when(row.start);
  }

  // Task colours: picked in the task form and stored as `color`. Blue is the default and
  // isn't stored. Subtask bars use a light tint of the colour (see .bar.lt in the CSS).
  var COLORS = [
    ['Blue', '#418dab'], ['Teal', '#2f9585'], ['Green', '#4f9a3a'], ['Gold', '#b8860b'], ['Orange', '#dd6f2c'],
    ['Red', '#cf4646'], ['Pink', '#cf4d8a'], ['Purple', '#8458e0'], ['Slate', '#66727f']
  ];

  // The inline style that gives a row its colour, or '' for the default.
  function colorVar(row) {
    return /^#[0-9a-f]{6}$/i.test(row.color || '') ? '; --c: ' + row.color : '';
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
    return '<span class="pav" style="background: ' + esc(p.color || AVATAR_COLORS[0]) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>';
  }

  // Milestones and tasks without a finish are drawn as marks, not bars: a milestone with
  // a finish is a diamond at each end joined by a line.
  function isPoint(row) {
    return row.type === 'milestone' || (row.type === 'task' && row.end == null);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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
      var when = timeOf(s) + (r.end != null ? '–' + timeOf(r.end) : '');
      var mark = r.type === 'phase' ? 'ph' : r.type === 'milestone' ? 'ms' : r.parent ? 'sub' : '';
      return '<div class="wl-group row-pill' + (r.id === freshId ? ' fresh' : '') + '" data-group="' + g.day + '" data-first="' + s +
        '" role="button" tabindex="0" title="' + esc(r.name + ' · ' + itemLabel(r) + ' · click to see it by the hour') +
        '" style="left: ' + x1 + 'px; top: ' + (ROW_Y + (g.from + k) * ROW_PX - 10) + 'px; min-width: ' + w + 'px">' +
        '<i class="' + mark + '" style="' + colorVar(r).slice(2) + '"></i>' + when + '</div>';
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
        html += '<div class="wl-over" title="' + esc((bk.p ? bk.p.name : 'Unassigned') + ' has more than one task at once here') +
          '" style="left: ' + dayX(s[0]) + 'px; width: ' + Math.max(dayX(s[1]) - dayX(s[0]), 2) + 'px; top: ' + top + 'px; height: ' + h + 'px"></div>';
      });
      var tint = bk.p ? ' style="--c: ' + esc(bk.p.color || AVATAR_COLORS[0]) + '; top: ' : ' style="top: ';
      html = '<div class="wl-band' + (bk.p ? '' : ' none') + '"' + tint + top + 'px; height: ' + h + 'px"></div>' + html; // behind everything
      html += '<div class="wl-sep" style="top: ' + (top + h - 2) + 'px"></div>';
    });
    wl.groups.forEach(function (u) {
      var first = Math.min.apply(null, u.rows.map(startDay));
      var last = Math.max.apply(null, u.rows.map(function (r) { return r.end != null ? r.end : startDay(r); }));
      var n = u.rows.length;
      var fresh = u.rows.some(function (r) { return r.id === freshId; }) ? ' fresh' : '';
      html += '<div class="wl-group' + fresh + '" data-group="' + u.day + '" data-first="' + first + '" role="button" tabindex="0" title="' +
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
        html += '<div class="pline" style="' + span + 'top: ' + (b.cy + 6) + 'px' + colorVar(row) + '"></div>' +
          '<div class="pcap' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + (b.cy + 2) + 'px' + colorVar(row) + '"></div>' +
          (row.end != null ? '<div class="pcap' + state + '"' + tip + ' style="left: ' + b.x2 + 'px; top: ' + (b.cy + 2) + 'px' + colorVar(row) + '"></div>' : '') +
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
          html += '<div class="mlink' + state + '"' + tip + ' style="left: ' + b.cx + 'px; width: ' + (b.ex - b.cx) + 'px; top: ' + (b.cy - 1) + 'px"></div>' +
            '<div class="dia' + state + '"' + tip + ' style="left: ' + (b.ex - 6) + 'px; top: ' + b.top + 'px"></div>';
        }
        html += '<div class="dia' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + b.top + 'px"></div>';
      } else if (row.end == null) {
        // A task at a moment: a ring (filled with a tick once done) with its name beside it.
        html += '<div class="pt' + (row.parent ? ' lt' : '') + (row.progress >= 1 ? ' done' : '') + state + '"' + tip +
          ' style="left: ' + b.x1 + 'px; top: ' + (b.cy - 10) + 'px' + colorVar(row) + '"><i></i>' +
          '<span class="t">' + esc(row.name) + '</span>' + (face ? avatar(face) : '') + '</div>';
      } else {
        // Progress darkens the done part of the bar, whatever its colour.
        var fill = row.progress && !row.parent
          ? '; background-image: linear-gradient(90deg,rgba(0,0,0,.16) 0 ' + row.progress * 100 + '%,transparent ' + row.progress * 100 + '%)'
          : '';
        html += '<div class="bar ' + (row.parent ? 'lt' : 'dk') + (b.x2 - b.x1 < 30 ? ' tiny' : '') + state + '" data-id="' + esc(row.id) +
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

  // Footer counts come straight from the data, so they stay right as the plan changes.
  function renderStats() {
    var counts = {
      tasks: data.rows.filter(function (r) { return r.type === 'task'; }).length,
      milestones: data.rows.filter(function (r) { return r.type === 'milestone'; }).length,
      phases: data.rows.filter(function (r) { return r.type === 'phase'; }).length
    };
    var words = { tasks: ['task', 'tasks'], milestones: ['milestone', 'milestones'], phases: ['phase', 'phases'] };
    Object.keys(counts).forEach(function (key) {
      var n = counts[key];
      document.querySelector('[data-stat="' + key + '"]').innerHTML = '<b>' + n + '</b> ' + words[key][n === 1 ? 0 : 1];
    });

    // The people in the top bar: the first four as avatars, then "+n" for the rest.
    // Hidden until someone has been added.
    var stack = document.querySelector('[data-people-stack]');
    var people = data.people;
    stack.hidden = !people.length;
    stack.setAttribute('aria-label', people.length + (people.length === 1 ? ' person' : ' people'));
    stack.innerHTML = people.slice(0, 4).map(function (p) {
      return '<span class="av" style="background: ' + esc(p.color || AVATAR_COLORS[0]) + '" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
    }).join('') + (people.length > 4 ? '<span class="more" title="' + esc(people.slice(4).map(function (p) { return p.name; }).join(', ')) + '">+' + (people.length - 4) + '</span>' : '');
  }

  // Grow the timeline by chunks until the view is at least one screen from either end.
  // Prepending shifts everything right, so scrollLeft moves by the same amount to stay put.
  function extend() {
    var view = scroller.clientWidth;
    while (scroller.scrollLeft < view) {
      var oldStart = rangeStart;
      rangeStart = add(rangeStart, scale.unit, -scale.chunk);
      render();
      var shift = xOf(oldStart);
      scroller.scrollLeft += shift;
      if (drag) drag.left += shift; // keep an in-progress drag anchored
    }
    while (scroller.scrollLeft + view > scroller.scrollWidth - view) {
      rangeEnd = add(rangeEnd, scale.unit, scale.chunk);
      render();
    }
  }

  // At the home view the Today button goes quiet (outline, no arrow); away from it, it's
  // solid with an arrow pointing back towards today. In hour view it reads "Now".
  function syncTodayArrow() {
    var offset = scroller.scrollLeft - xOf(home());
    var here = Math.abs(offset) < 2;
    var word = scale.unit === 'hour' ? 'Now' : 'Today';
    var label = here ? word : offset < 0 ? word + ' →' : '← ' + word;
    if (todayBtn.textContent !== label) todayBtn.textContent = label;
    todayBtn.classList.toggle('here', here);
    todayBtn.title = here ? "You're viewing " + word.toLowerCase() : 'Back to ' + word.toLowerCase();
  }

  // Drag to pan: hold the left mouse button and drag to move the chart freely in any
  // direction, diagonals included. Let go mid-drag and it keeps gliding, slowing to a stop
  // like a map. Touch screens already pan (and fling) natively. Buttons such as Today still
  // click, and grabbing the scrollbar still works normally.
  var FRICTION = 0.995;  // glide speed kept per millisecond
  var drag = null;
  var dragMoved = false; // the last press dragged the chart, so its click is ignored
  var glide = 0;         // requestAnimationFrame id while gliding

  function stopGlide() {
    if (glide) cancelAnimationFrame(glide);
    glide = 0;
  }

  // vx/vy are in px per ms, in the direction the content was moving.
  function startGlide(vx, vy) {
    var last = performance.now();
    function step(now) {
      var dt = Math.min(now - last, 32);
      last = now;
      scroller.scrollLeft -= vx * dt;
      scroller.scrollTop -= vy * dt;
      var keep = Math.pow(FRICTION, dt);
      vx *= keep;
      vy *= keep;
      glide = Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02 ? requestAnimationFrame(step) : 0;
    }
    glide = requestAnimationFrame(step);
  }

  scroller.addEventListener('pointerdown', function (e) {
    stopGlide();
    dragMoved = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
    var r = scroller.getBoundingClientRect();
    if (e.clientX - r.left >= scroller.clientWidth || e.clientY - r.top >= scroller.clientHeight) return;
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, trail: [] };
    try { scroller.setPointerCapture(e.pointerId); } catch (err) {}
    scroller.classList.add('dragging');
    e.preventDefault(); // don't start a text selection
    // Pressing a plan item and holding still picks it up to move (see hold-to-move below).
    var item = e.target.closest('.plan [data-id]');
    if (item) {
      item.classList.add('holding');
      hold = { id: item.getAttribute('data-id'), el: item, timer: setTimeout(lift, HOLD_MS) };
    }
  });

  scroller.addEventListener('pointermove', function (e) {
    if (move) return moveTo(e.clientX);
    if (!drag) return;
    scroller.scrollLeft = drag.left - (e.clientX - drag.x);
    scroller.scrollTop = drag.top - (e.clientY - drag.y);
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) {
      dragMoved = true;
      cancelHold();
    }
    // Keep the last 100ms of movement to work out the release speed.
    var now = e.timeStamp || performance.now();
    drag.trail.push({ t: now, x: e.clientX, y: e.clientY });
    while (drag.trail.length > 2 && now - drag.trail[0].t > 100) drag.trail.shift();
  });

  function endDrag(e) {
    cancelHold();
    if (move) return drop(false);
    if (!drag) return;
    var trail = drag.trail;
    drag = null;
    scroller.classList.remove('dragging');
    if (trail.length < 2) return;
    var a = trail[0];
    var b = trail[trail.length - 1];
    var now = (e && e.timeStamp) || performance.now();
    var dt = b.t - a.t;
    // Only glide if the mouse was still moving when it was released.
    var cap = function (v) { return Math.max(-6, Math.min(6, v)); }; // px per ms
    if (dt > 0 && now - b.t < 80) startGlide(cap((b.x - a.x) / dt), cap((b.y - a.y) / dt));
  }

  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);
  scroller.addEventListener('lostpointercapture', function () { endDrag(); });

  // The wheel uses the browser's normal scrolling (up and down; Shift or a trackpad
  // for sideways) and stops any glide in progress.
  scroller.addEventListener('wheel', stopGlide, { passive: true });

  scroller.addEventListener('scroll', function () {
    extend();
    syncTodayArrow();
    syncPanelScroll();
    saveSpot();
    if (move && move.lastX != null) moveTo(move.lastX); // keep a moving item under the mouse
  }, { passive: true });

  todayBtn.addEventListener('click', function () {
    scrollToTime(home(), 0);
  });

  // Keep the same date at the left edge when the window is resized.
  // Watches the chart area itself, so it also catches the task panel opening or closing.
  function onResize() {
    var leftTime = timeAt(scroller.scrollLeft);
    dayPx = dayPxFor(zoomMode);
    render();
    scroller.scrollLeft = xOf(leftTime);
    extend();
    syncTodayArrow();
    syncZoom();
    syncPanelScroll();
  }

  if (window.ResizeObserver) new ResizeObserver(onResize).observe(scroller);
  else window.addEventListener('resize', onResize);

  // Task list panel: one row per plan row, lined up with the chart and following its
  // vertical scroll. The arrow opens and closes it; the choice is remembered per browser.
  var panel = document.querySelector('[data-panel]');
  var panelToggle = panel.querySelector('[data-panel-toggle]');
  var taskRowsEl = panel.querySelector('[data-task-rows]');
  var chartBody = chart.querySelector('.body');

  function renderTaskList() {
    if (workload) return renderPeopleList();
    if (!data.rows.length) {
      taskRowsEl.innerHTML = '<div class="trow empty">Nothing here yet.&nbsp;<button type="button" data-empty-add>Add a task</button></div>';
      return;
    }
    // Clicking a row scrolls the chart to it; the ⋯ button that shows on hover edits it
    // (see the task form below).
    var more = '<button type="button" class="more" data-row-edit tabindex="-1" aria-label="Edit" title="Edit">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button>';
    taskRowsEl.innerHTML = data.rows.map(function (row) {
      var attrs = ' data-id="' + esc(row.id) + '" role="button" tabindex="0"';
      function tip(text) { return ' title="' + esc(text + ' · click to go to it, drag to reorder, E to edit') + '"'; }
      if (row.type === 'phase') {
        return '<div class="trow ph"' + attrs + (row.color ? ' style="' + colorVar(row).slice(2) + '"' : '') + tip(row.name + ' · ' + itemLabel(row)) + '><i class="ic"></i><span class="tn">' + esc(row.name) + '</span>' + more + '</div>';
      }
      if (row.type === 'milestone') {
        return '<div class="trow ms"' + attrs + tip(row.name + ' · ' + itemLabel(row)) + '><i class="ic"></i>' +
          '<span class="tn">' + esc(row.name) + '</span>' + more + '</div>';
      }
      return '<div class="trow ' + (row.parent ? 'sub' : 'top') + '"' + attrs + tip(row.name + ' · ' + itemLabel(row)) +
        '><i class="ic"' + (row.color ? ' style="' + colorVar(row).slice(2) + '"' : '') + '></i>' +
        '<span class="tn">' + esc(row.name) + '</span>' +
        (row.progress ? '<span class="meta">' + Math.round(row.progress * 100) + '%</span>' : '') +
        more + '</div>';
    }).join('') +
      // The empty row after the last one adds a new task; it only shows itself on hover.
      '<div class="trow add" role="button" tabindex="0" title="Add a task" data-add-row><i class="ic"></i><span class="tn">New task</span></div>';
  }

  // Workload: the panel lists people, each as tall as their lanes, with how many items they
  // have and any overload. Clicking one goes to their first item.
  function renderPeopleList() {
    if (!wl) wl = workloadLayout();
    var overloaded = wl.blocks.filter(function (bk) { return bk.overDays > 0; }).length;
    panel.querySelector('.gut-title').textContent = 'People' + (overloaded ? ' · ' + overloaded + ' overloaded' : '');
    taskRowsEl.innerHTML = wl.blocks.map(function (bk) {
      var n = bk.rows.length;
      var state = bk.overDays > 0 ? 'over' : n ? 'ok' : 'idle';
      var sub = n ? n + (n === 1 ? ' item' : ' items') : 'Nothing assigned';
      if (bk.overDays > 0) sub += ' · ' + duration({ start: 0, end: bk.overDays }) + ' overlap';
      var face = bk.p ? avatar(bk.p) : '<span class="pav none" aria-hidden="true"></span>';
      var name = bk.p ? bk.p.name : 'Unassigned';
      var tip = state === 'over' ? 'More than one task at once for ' + duration({ start: 0, end: bk.overDays })
        : state === 'ok' ? 'No overlapping work' : 'No work assigned';
      return '<div class="trow wl-p' + (bk.p ? '' : ' none') + '" role="button" tabindex="0" data-person="' + esc(bk.id) + '" style="height: ' + bk.lanes * ROW_PX + 'px' +
        (bk.p ? '; --c: ' + esc(bk.p.color || AVATAR_COLORS[0]) : '') + '" title="' +
        esc(name + ' · ' + sub + ' · click to go to their first item') + '">' + face +
        '<span class="wl-who"><span class="tn">' + esc(name) + '</span><span class="wl-sub">' + esc(sub) + '</span></span>' +
        '<i class="wl-dot ' + state + '" title="' + tip + '"></i></div>';
    }).join('');
  }

  // Go to a person's earliest item on the workload timeline.
  function goToPerson(id) {
    var bk = wl && wl.blocks.filter(function (b) { return b.id === id; })[0];
    if (!bk || !bk.rows.length) return;
    var first = bk.rows.slice().sort(function (a, b) { return startDay(a) - startDay(b); })[0];
    goToRow(first.id);
  }

  function syncPanelScroll() {
    taskRowsEl.style.height = chartBody.offsetHeight + 'px';
    taskRowsEl.style.transform = 'translateY(' + -scroller.scrollTop + 'px)';
  }

  function setPanel(open) {
    panel.classList.toggle('open', open);
    panelToggle.setAttribute('aria-expanded', String(open));
    panelToggle.setAttribute('aria-label', open ? 'Hide task list' : 'Show task list');
    panelToggle.title = open ? 'Hide task list' : 'Show task list';
    try { localStorage.setItem('taskPanel', open ? 'open' : 'closed'); } catch (e) {}
  }

  panelToggle.addEventListener('click', function () {
    setPanel(!panel.classList.contains('open'));
  });

  // Scrolling over the list scrolls the chart with it (both share one scroll position).
  panel.querySelector('.gut-body').addEventListener('wheel', function (e) {
    e.preventDefault();
    var unit = e.deltaMode === 1 ? 16 : 1;
    stopGlide();
    scroller.scrollTop += e.deltaY * unit;
    scroller.scrollLeft += e.deltaX * unit;
  }, { passive: false });

  renderTaskList();
  try { if (localStorage.getItem('taskPanel') === 'open') setPanel(true); } catch (e) {}

  // Zoom controls: −/+ step through ZOOM_STEPS, the % label opens a menu of set zooms.
  var zoomOut = document.querySelector('[data-zoom-out]');
  var zoomIn = document.querySelector('[data-zoom-in]');
  var zoomLabel = document.querySelector('[data-zoom-label]');
  var zoomMenu = document.querySelector('[data-zoom-menu]');

  zoomMenu.innerHTML =
    '<button type="button" role="menuitemradio" data-zoom="fit">Fit to screen</button>' +
    '<div class="zsep" role="separator"></div>' +
    ZOOM_STEPS.map(function (s) {
      return '<button type="button" role="menuitemradio" data-zoom="' + s + '">' + s + '%</button>';
    }).join('');
  var zoomItems = Array.prototype.slice.call(zoomMenu.querySelectorAll('[data-zoom]'));

  function zoomPct() {
    return dayPx * scale.days / scale.basePx * 100;
  }

  function syncZoom() {
    var pct = zoomPct();
    zoomLabel.textContent = Math.round(pct) + '%';
    zoomOut.disabled = pct <= ZOOM_STEPS[0] + 0.5;
    zoomIn.disabled = pct >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.5;
    zoomItems.forEach(function (item) {
      item.setAttribute('aria-checked', String(item.getAttribute('data-zoom') === String(zoomMode)));
    });
  }

  // Fit jumps back to today; other zooms keep the date in the middle of the view fixed.
  function setZoom(mode) {
    var view = scroller.clientWidth;
    var centre = timeAt(scroller.scrollLeft + view / 2);
    zoomMode = mode;
    dayPx = dayPxFor(mode);
    render();
    scroller.scrollLeft = mode === 'fit' ? xOf(home()) : xOf(centre) - view / 2;
    extend();
    syncTodayArrow();
    syncZoom();
    saveView();
  }

  // View switcher (H/D/W/M/Q/Y). Switching fits the new view to the screen. From a view's
  // home position you land on the new view's home; otherwise it starts at the column
  // containing the date at the left edge. The range is rebuilt around that column.
  var scaleBtns = Array.prototype.slice.call(document.querySelectorAll('[data-scale]'));

  // Rebuild the timeline around one moment: a chunk either side of its column, with the
  // start lined up to a whole day (hour view), week (day view) or period.
  function recentre(time) {
    var anchor = startOf(time, scale.unit);
    var align = { hour: 'day', day: 'week' }[scale.unit] || scale.unit;
    rangeStart = add(startOf(anchor, align), scale.unit, -scale.chunk);
    rangeEnd = add(anchor, scale.unit, scale.chunk);
    render();
  }

  // Scroll so `time` sits `inset` px from the left edge (and optionally to `top`). Nearby
  // targets glide there; one off the built timeline, or more than a few screens away when
  // `jumpFar` is set, is jumped to directly so the chart doesn't fly past months of columns.
  function scrollToTime(time, inset, top, jumpFar) {
    var view = scroller.clientWidth;
    var left = xOf(time) - inset;
    stopGlide();
    if (time < rangeStart || time >= rangeEnd || (jumpFar && Math.abs(left - scroller.scrollLeft) > 4 * view)) {
      recentre(time);
      scroller.scrollLeft = left = xOf(time) - inset;
      extend();
      left = scroller.scrollLeft;
      syncTodayArrow();
    }
    scroller.scrollTo({ left: left, top: top == null ? scroller.scrollTop : Math.max(0, top), behavior: 'smooth' });
  }

  function setScale(key) {
    var leftTime = timeAt(scroller.scrollLeft);
    var atHome = Math.abs(scroller.scrollLeft - xOf(home())) < 2;
    scale = SCALES[key];
    zoomMode = 'fit';
    dayPx = dayPxFor(zoomMode);
    var anchor = atHome ? home() : startOf(leftTime, scale.unit);
    recentre(anchor);
    scroller.scrollLeft = xOf(anchor);
    extend();
    syncTodayArrow();
    syncZoom();
    syncScaleBtns();
    saveView();
  }

  function syncScaleBtns() {
    var key = scaleKey();
    scaleBtns.forEach(function (btn) {
      var on = btn.getAttribute('data-scale') === key;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  scaleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { setScale(btn.getAttribute('data-scale')); });
  });

  function stepZoom(dir) {
    var pct = zoomPct();
    var next = dir > 0
      ? ZOOM_STEPS.filter(function (s) { return s > pct + 0.5; })[0]
      : ZOOM_STEPS.filter(function (s) { return s < pct - 0.5; }).pop();
    if (next) setZoom(next);
  }

  zoomOut.addEventListener('click', function () { stepZoom(-1); });
  zoomIn.addEventListener('click', function () { stepZoom(1); });

  function showZoomMenu(open) {
    zoomMenu.hidden = !open;
    zoomLabel.setAttribute('aria-expanded', String(open));
    if (open) (zoomMenu.querySelector('[aria-checked="true"]') || zoomItems[0]).focus();
  }

  zoomLabel.addEventListener('click', function () { showZoomMenu(zoomMenu.hidden); });

  zoomMenu.addEventListener('click', function (e) {
    var item = e.target.closest('[data-zoom]');
    if (!item) return;
    var value = item.getAttribute('data-zoom');
    setZoom(value === 'fit' ? 'fit' : Number(value));
    showZoomMenu(false);
    zoomLabel.focus();
  });

  zoomMenu.addEventListener('keydown', function (e) {
    var i = zoomItems.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      showZoomMenu(false);
      zoomLabel.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var n = zoomItems.length;
      zoomItems[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (!zoomMenu.hidden && !e.target.closest('.zwrap')) showZoomMenu(false);
  });

  // Full screen: shows the whole planner on the entire display. Hidden where the
  // browser doesn't support it (e.g. iPhone Safari).
  var fullscreenBtn = document.querySelector('[data-fullscreen]');

  function syncFullscreen() {
    var on = !!document.fullscreenElement;
    fullscreenBtn.setAttribute('aria-pressed', String(on));
    fullscreenBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    fullscreenBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen';
  }

  if (document.fullscreenEnabled) {
    fullscreenBtn.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
  } else {
    fullscreenBtn.hidden = true;
  }

  // Rows you create are saved in this browser (localStorage) along with the order of the
  // whole plan. js/data.js rows are saved as references, so they keep floating with the
  // current week, while created rows stay on the dates you picked. If js/data.js changes,
  // the saved plan no longer matches it and is dropped.
  function loadPlan() {
    var base = data.rows.slice();
    var sig = JSON.stringify([base, data.deps]);
    data.base = base;
    data.baseDeps = data.deps.slice(); // a copy: edits add to data.deps in place
    if (!data.basePeople) data.basePeople = (data.people || []).slice();
    data.people = data.basePeople.slice();
    data.sig = sig;
    var saved;
    try { saved = JSON.parse(localStorage.getItem(planKey())); } catch (e) {}
    if (!saved || saved.sig !== sig) return;
    if (saved.people) data.people = saved.people;
    var shift = (saved.planStart - PLAN_START) / DAY;
    data.rows = saved.rows.map(function (r) {
      if (r.base != null) return base[r.base];
      delete r.owner; // tasks used to have owners; they have colours now
      ['start', 'end', 'day'].forEach(function (k) { if (r[k] != null) r[k] += shift; });
      return r;
    }).filter(Boolean);
    data.deps = saved.deps;
  }

  function writePlan() {
    var plan = {
      sig: data.sig,
      planStart: PLAN_START,
      rows: data.rows.map(function (r) {
        var i = data.base.indexOf(r);
        return i >= 0 ? { base: i } : r;
      }),
      deps: data.deps,
      people: data.people
    };
    try { localStorage.setItem(planKey(), JSON.stringify(plan)); } catch (e) {}
  }

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
    try { sessionStorage.setItem('roadmapHistory', JSON.stringify({ undo: undoStack, redo: redoStack, current: current })); } catch (e) {}
  }

  // At start-up: carry on the tab's history if it ends at the plan as loaded.
  function loadHistory() {
    current = snapshot();
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem('roadmapHistory')); } catch (e) {}
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

  function isoDate(t) {
    return new Date(t).toISOString().slice(0, 10);
  }

  // Day offset from PLAN_START for a yyyy-mm-dd date and optional hh:mm time.
  function dayOf(date, time) {
    var p = date.split('-');
    var day = (Date.UTC(+p[0], p[1] - 1, +p[2]) - PLAN_START) / DAY;
    if (time) {
      var hm = time.split(':');
      day += (hm[0] * 60 + +hm[1]) / 1440;
    }
    return day;
  }

  // The reverse: a day offset as the date and time inputs' values.
  function dateOf(day) {
    return isoDate(PLAN_START + Math.floor(day) * DAY);
  }

  function timeOf(day) {
    var mins = Math.round((day - Math.floor(day)) * 1440);
    return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
  }

  // hh:mm of a timestamp.
  function clockOf(t) {
    var d = new Date(t);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

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
      return '<label class="sw"><input type="radio" name="color" value="' + (i ? c[1] : '') + '"' + (i ? '' : ' checked') +
        ' aria-label="' + c[0] + '"><span style="background: ' + c[1] + '" title="' + c[0] + '"></span></label>';
    }).join('');

    fillPeople('');
    hidePersonBox();

    form.querySelector('[data-dep-options]').innerHTML = data.rows.filter(function (r) {
      return (r.type === 'task' || r.type === 'milestone') && r !== row;
    }).map(function (r) {
      return '<label class="dep' + (r.parent ? ' sub' : '') + '"><input type="checkbox" name="deps" value="' + esc(r.id) + '">' +
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
      '<label class="pp" title="Unassigned"><input type="radio" name="person" value="" aria-label="Unassigned"><span class="pav none"></span></label>' +
      data.people.map(function (p) {
        return '<label class="pp" title="' + esc(p.name) + '"><input type="radio" name="person" value="' + esc(p.id) + '" aria-label="' + esc(p.name) + '">' + avatar(p) + '</label>';
      }).join('') +
      '<button type="button" class="pp-add" aria-label="New person" title="New person" data-new-person-btn>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></button>';
    pickPerson(value);
  }

  function syncPersonSel() {
    var p = chosenPerson();
    personSelEl.innerHTML = p
      ? '<span class="pp-name">' + esc(p.name) + '</span><button type="button" data-edit-person>Edit</button>' +
        '<button type="button" class="pp-del" data-remove-person>Delete</button>'
      : '<span class="nil">Unassigned</span>';
  }

  function showPersonBox(person) {
    personEditing = person;
    newPersonEl.hidden = false;
    form.elements.newPerson.value = person ? person.name : '';
    form.querySelector('[data-add-person]').textContent = person ? 'Save' : 'Add';
    var pick = person ? person.color : AVATAR_COLORS[data.people.length % AVATAR_COLORS.length];
    form.querySelector('[data-person-colors]').innerHTML = AVATAR_COLORS.map(function (c) {
      return '<label class="sw sm"><input type="radio" name="personColor" value="' + c + '"' + (c === pick ? ' checked' : '') +
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

  function uniqueId(name) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
    var id = base;
    for (var n = 2; rowIndex[id] != null; n++) id = base + '-' + n;
    return id;
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

  // Click a row in the task list to scroll the chart to it (Enter or Space when it has
  // focus); its ⋯ button, shown on hover, opens it for editing (E from the keyboard).
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
    var tr = e.target.closest('.trow[data-id]');
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
    var tr = e.target.closest('.trow[data-id]');
    if (!tr || e.target.closest('[data-row-edit]')) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudgeRow(tr.getAttribute('data-id'), e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToRow(tr.getAttribute('data-id'));
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

  function nudgeRow(id, dir) {
    var from = rowIndex[id];
    var end = blockEnd(from);
    var rest = data.rows.slice(0, from).concat(data.rows.slice(end));
    var slots = slotsFor(data.rows[from], rest);
    var next = slots[slots.indexOf(from) + dir];
    if (next == null || !placeBlock(from, end, next)) return;
    var tr = taskRowsEl.querySelector('.trow[data-id="' + id + '"]');
    if (tr) tr.focus();
    reveal(data.rows[rowIndex[id]], rowIndex[id]);
  }

  taskRowsEl.addEventListener('pointerdown', function (e) {
    sorted = false;
    var tr = e.target.closest('.trow[data-id]');
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
      try { taskRowsEl.setPointerCapture(sort.pointer); } catch (err) {}
      var from = rowIndex[sort.id];
      var end = blockEnd(from);
      sort.on = true;
      sort.from = from;
      sort.end = end;
      sort.slots = slotsFor(data.rows[from], data.rows.slice(0, from).concat(data.rows.slice(end)));
      var trs = taskRowsEl.querySelectorAll('.trow[data-id]');
      for (var k = from; k < end; k++) trs[k].classList.add('lifted');
      sortLine = document.createElement('div');
      sortLine.className = 'sort-line' + (data.rows[from].parent ? ' sub' : '');
      taskRowsEl.appendChild(sortLine);
      panel.classList.add('sorting');
    }
    // Scroll when near the top or bottom of the list.
    var body = panel.querySelector('.gut-body').getBoundingClientRect();
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

  // Item details popup: what a clicked bar, milestone or phase is, when it happens, how
  // it's going, what it depends on and what's waiting on it, with an Edit button to change
  // it. It sits just below the item (above it near the bottom of the screen) and closes
  // with Esc, the ×, a click elsewhere or scrolling the chart.
  var peek = document.querySelector('[data-peek]');
  var peekId = null;

  // "5 days" for all-day rows; "1d 2h 30m" style for timed ones.
  function duration(row) {
    var start = row.type === 'milestone' ? row.day : row.start;
    var mins = Math.round((row.end - start) * 1440);
    if (!(start % 1) && !(row.end % 1)) return mins / 1440 + (mins === 1440 ? ' day' : ' days');
    return [[Math.floor(mins / 1440), 'd'], [Math.floor(mins / 60) % 24, 'h'], [mins % 60, 'm']].filter(function (p) {
      return p[0];
    }).map(function (p) { return p[0] + p[1]; }).join(' ');
  }

  function rowLinks(ids) {
    return ids.filter(function (id) { return rowIndex[id] != null; }).map(function (id) {
      var r = data.rows[rowIndex[id]];
      return '<span class="peek-ln"><i class="' + (r.type === 'milestone' ? 'ms' : 'tk') + '" style="' + colorVar(r).slice(2) + '"></i>' + esc(r.name) + '</span>';
    }).join('');
  }

  function openPeek(id, el, clientX) {
    var row = data.rows[rowIndex[id]];
    if (!row) return;
    peekId = id;
    var kind = row.type === 'task' ? (row.parent ? 'Subtask' : 'Task') : row.type === 'milestone' ? 'Milestone' : 'Phase';
    var icon = peek.querySelector('[data-peek-icon]');
    icon.className = 'peek-ic ' + row.type;
    icon.setAttribute('style', colorVar(row).slice(2));
    peek.querySelector('[data-peek-kind]').textContent = kind;
    peek.querySelector('[data-peek-title]').textContent = row.name;

    var items = [['When', esc(itemLabel(row))]];
    var who = personById(row.person);
    if (who) items.push(['Person', avatar(who) + esc(who.name)]);
    if (row.end != null) items.push(['Length', duration(row)]);
    if (row.type === 'task') {
      var pct = Math.round((row.progress || 0) * 100);
      items.push(['Progress', '<span class="peek-pg"><b style="width: ' + pct + '%"></b></span>' + pct + '%']);
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
      if (before) items.push(['Blocks', before]);
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
    peek.querySelector('[data-peek-edit]').focus();
  }

  function closePeek() {
    peek.hidden = true;
    peekId = null;
  }

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

  function moveTo(clientX) {
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

  var listState = { sort: null, dir: 1, hidden: [], filters: {} };
  try {
    var savedList = JSON.parse(localStorage.getItem('roadmapList'));
    if (savedList) Object.keys(listState).forEach(function (k) { if (savedList[k] != null) listState[k] = savedList[k]; });
  } catch (e) {}

  function saveList() {
    try { localStorage.setItem('roadmapList', JSON.stringify(listState)); } catch (e) {}
  }

  function startDay(row) {
    return row.type === 'milestone' ? row.day : row.start;
  }

  // The last day shown: a whole-day finish is exclusive, so it's the day before.
  function finishDay(row) {
    return row.end == null ? null : row.end % 1 ? row.end : row.end - 1;
  }

  // "11 Jul", with the year when it isn't this year and the time when one was given.
  function listDate(day) {
    var d = new Date(PLAN_START + Math.floor(day) * DAY);
    var year = d.getUTCFullYear() !== new Date(TODAY).getUTCFullYear() ? ' ' + d.getUTCFullYear() : '';
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + year + (day % 1 ? ' ' + timeOf(day) : '');
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
        var ic = r.type === 'phase' ? '<i class="lic ph" style="' + colorVar(r).slice(2) + '"></i>' : r.type === 'milestone' ? '<i class="lic ms"></i>'
          : '<i class="lic' + (r.parent ? ' sub' : '') + '" style="' + colorVar(r).slice(2) + '"></i>';
        return '<div class="cname-in">' + ic + '<span class="ln">' + esc(r.name) + '</span></div>';
      } },
    { key: 'type', label: 'Type',
      val: function (r) { return r.type === 'task' && r.parent ? 'subtask' : r.type; },
      cell: function (r) { return r.type === 'task' ? (r.parent ? 'Subtask' : 'Task') : r.type === 'milestone' ? 'Milestone' : 'Phase'; } },
    { key: 'phase', label: 'Phase',
      val: function (r) { return phaseName(r).toLowerCase() || '~'; }, // no phase sorts last
      cell: function (r) { return esc(phaseName(r)) || '<span class="nil">—</span>'; } },
    { key: 'start', label: 'Start', mono: true,
      val: startDay,
      cell: function (r) { return listDate(startDay(r)); } },
    { key: 'end', label: 'Finish', mono: true,
      val: function (r) { var f = finishDay(r); return f == null ? Infinity : f; },
      cell: function (r) { var f = finishDay(r); return f == null ? '<span class="nil">—</span>' : listDate(f); } },
    { key: 'days', label: 'Length', mono: true, right: true,
      val: function (r) { return r.end == null ? -1 : r.end - startDay(r); },
      cell: function (r) { return r.end == null ? '<span class="nil">—</span>' : duration(r); } },
    { key: 'progress', label: 'Progress',
      val: function (r) { var p = progressOf(r); return p == null ? -1 : p; },
      cell: function (r) {
        var p = progressOf(r);
        if (p == null) return '<span class="nil">—</span>';
        var pct = Math.round(p * 100);
        return '<span class="lpg"><span class="peek-pg"><b style="width: ' + pct + '%"></b></span><span class="lpct">' + pct + '%</span></span>';
      } },
    { key: 'status', label: 'Status',
      val: function (r) { return STATUS_RANK[statusOf(r)]; },
      cell: function (r) {
        var s = statusOf(r);
        return '<span class="st ' + s + '">' + (s === 'ms' ? 'Milestone' : STATUS[s]) + '</span>';
      } },
    { key: 'person', label: 'Person',
      val: function (r) { var p = personById(r.person); return p ? p.name.toLowerCase() : '~'; }, // unassigned sorts last
      cell: function (r) {
        var p = personById(r.person);
        return p ? '<span class="lperson">' + avatar(p) + esc(p.name) + '</span>' : '<span class="nil">Unassigned</span>';
      } },
    { key: 'deps', label: 'Depends on',
      val: function (r) { return depsOf(r).length; },
      cell: function (r) {
        var ds = depsOf(r);
        return ds.length ? '<span class="ldeps" title="' + esc(ds.map(function (d) { return d.name; }).join(', ')) + '">' +
          esc(ds.map(function (d) { return d.name; }).join(', ')) + '</span>' : '<span class="nil">—</span>';
      } }
  ];

  function shownCols() {
    return LIST_COLS.filter(function (c) { return c.fixed || listState.hidden.indexOf(c.key) < 0; });
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
      return '<th class="' + (c.key === 'name' ? 'cname' : '') + (c.right ? ' r' : '') + '" aria-sort="' + dir + '">' +
        '<button type="button" class="sortb' + (on ? ' on' : '') + '" data-sort="' + c.key + '" title="Sort by ' + c.label.toLowerCase() + '">' +
        c.label + '<i class="arr' + (on && listState.dir < 0 ? ' down' : '') + '" aria-hidden="true"></i></button>' +
        (c.fixed ? '' : '<button type="button" class="hidec" data-hide-col="' + c.key + '" aria-label="Hide ' + c.label + ' column" title="Hide column">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>') +
        '</th>';
    }).join('') + '</tr>';

    var rows = listRows();
    var span = ' colspan="' + cols.length + '"';
    var body = rows.map(function (r) {
      var cls = 'lrow ' + (r.type === 'phase' ? 'l-ph' : r.type === 'milestone' ? 'l-ms' : r.parent ? 'l-sub' : 'l-top') + (r.id === freshId ? ' fresh' : '');
      return '<tr class="' + cls + '" data-id="' + esc(r.id) + '" tabindex="0" title="Click to edit"' + (r.type === 'phase' && r.color ? ' style="' + colorVar(r).slice(2) + '"' : '') + '>' + cols.map(function (c) {
        return '<td class="' + (c.key === 'name' ? 'cname' : '') + (c.mono ? ' mono' : '') + (c.right ? ' r' : '') + '">' + c.cell(r) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    if (!data.rows.length) {
      body = '<tr class="lnone"><td' + span + '>Nothing here yet.&nbsp;<button type="button" data-list-add>Add a task</button></td></tr>';
    } else if (!rows.length) {
      body = '<tr class="lnone"><td' + span + '>Nothing matches these filters.&nbsp;<button type="button" data-list-clear>Clear filters</button></td></tr>';
    } else {
      body += '<tr class="ladd" data-list-add tabindex="0"><td' + span + '><i class="lic add"></i>New task</td></tr>';
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
    colsMenu.innerHTML = LIST_COLS.filter(function (c) { return !c.fixed; }).map(function (c) {
      return '<button type="button" role="menuitemcheckbox" aria-checked="' + (listState.hidden.indexOf(c.key) < 0) + '" data-col="' + c.key + '">' + c.label + '</button>';
    }).join('') + '<div class="zsep" role="separator"></div><button type="button" data-show-all' + (listState.hidden.length ? '' : ' disabled') + '>Show all columns</button>';
  }

  function setHidden(key, hide) {
    var i = listState.hidden.indexOf(key);
    if (hide && i < 0) listState.hidden.push(key);
    if (!hide && i >= 0) listState.hidden.splice(i, 1);
    if (hide && listState.sort === key) listState.sort = null;
    saveList();
    renderList();
  }

  listHead.addEventListener('click', function (e) {
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
    if (!colsMenu.hidden && e.target.isConnected && !e.target.closest('.cwrap')) showColsMenu(false);
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
        try { box.setPointerCapture(drag.id); } catch (err) {}
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

  var listDragged = dragScroll(listEl.querySelector('.lscroll'), 'button, input, select, a');

  listBody.addEventListener('click', function (e) {
    if (listDragged()) return;
    if (e.target.closest('[data-list-clear]')) return clearFilters();
    if (e.target.closest('[data-list-add]')) return openForm();
    var tr = e.target.closest('.lrow[data-id]');
    if (tr) openEdit(tr.getAttribute('data-id'));
  });
  listBody.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('.lrow[data-id], .ladd');
    if (!tr || e.target !== tr) return;
    e.preventDefault();
    if (tr.hasAttribute('data-list-add')) openForm();
    else openEdit(tr.getAttribute('data-id'));
  });

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
  try {
    var savedBoard = JSON.parse(localStorage.getItem('roadmapBoard'));
    if (savedBoard) Object.keys(board).forEach(function (k) { if (savedBoard[k] != null) board[k] = savedBoard[k]; });
  } catch (e) {}
  var dragId = null; // the card being dragged

  function saveBoard() {
    try { localStorage.setItem('roadmapBoard', JSON.stringify(board)); } catch (e) {}
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
        return { key: c[0], title: c[1], dot: '<i class="bdot ' + c[0] + '"></i>' };
      });
    } else if (board.group === 'phase') {
      cols = [{ key: '', title: 'No phase', dot: '<i class="bdot none"></i>' }].concat(data.rows.filter(function (r) {
        return r.type === 'phase';
      }).map(function (p) {
        return { key: p.id, title: p.name, dot: '<i class="bdot ph" style="' + colorVar(p).slice(2) + '"></i>' };
      }));
    } else if (board.group === 'person') {
      cols = [{ key: '', title: 'Unassigned', dot: '<i class="bdot none"></i>' }].concat(data.people.map(function (p) {
        return { key: p.id, title: p.name, dot: avatar(p) };
      }));
    } else {
      var days = [];
      cards.forEach(function (r) {
        var d = Math.floor(startDay(r));
        if (days.indexOf(d) < 0) days.push(d);
      });
      cols = days.sort(function (a, b) { return a - b; }).map(function (d) {
        return { key: String(d), title: WEEKDAYS[new Date(PLAN_START + d * DAY).getUTCDay()] + ' ' + listDate(d), dot: '<i class="bdot day"></i>' };
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
      meta.push('<span class="st ' + st + '">' + (st === 'ms' ? 'Milestone' : STATUS[st]) + '</span>');
    }
    if (showing('date') && board.group !== 'day') meta.push('<span class="kc-d">' + ICON_CAL + listDate(Math.floor(s)) + '</span>');
    if (showing('time') && (s % 1 || (r.end != null && r.end % 1))) {
      meta.push('<span class="kc-d">' + ICON_CLOCK + timeOf(s) + (r.end != null && r.end - s < 1 ? '–' + timeOf(r.end) : '') + '</span>');
    }
    if (showing('length') && r.end != null) meta.push('<span class="kc-d">' + duration(r) + '</span>');
    if (showing('deps')) {
      var ds = depsOf(r);
      if (ds.length) {
        meta.push('<span class="kc-d" title="Depends on ' + esc(ds.map(function (d) { return d.name; }).join(', ')) + '">' + ICON_LINK + ds.length + '</span>');
      }
    }
    var face = showing('person') && who && board.group !== 'person'
      ? '<span class="kc-who" title="' + esc(who.name) + '">' + avatar(who) + '</span>' : '';
    var p = r.type === 'task' ? r.progress || 0 : 0;
    return '<div class="kcard' + (ms ? ' ms' : '') + (r.parent ? ' sub' : '') + (showing('color') ? '' : ' plain') + (r.id === freshId ? ' fresh' : '') +
      '" draggable="true" tabindex="0" role="button" data-id="' + esc(r.id) + '" style="' + colorVar(r).slice(2) + '" title="' +
      esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to move') + '">' +
      (showing('phase') && board.group !== 'phase' && phaseName(r) ? '<span class="kc-ph">' + esc(phaseName(r)) + '</span>' : '') +
      '<span class="kc-n">' + (ms ? '<i class="kc-ms"></i>' : '') + esc(r.name) + '</span>' +
      (parent ? '<span class="kc-sub">↳ ' + esc(parent.name) + '</span>' : '') +
      (meta.length || face ? '<div class="kc-f"><div class="kc-m">' + meta.join('') + '</div>' + face + '</div>' : '') +
      (showing('progress') && p > 0 ? '<span class="kc-pg"><b style="width: ' + p * 100 + '%"></b></span>' : '') +
      '</div>';
  }

  function renderBoard() {
    var cols = boardColumns();
    var n = cols.reduce(function (sum, c) { return sum + c.cards.length; }, 0);
    boardCols.innerHTML = cols.length ? cols.map(function (c) {
      var addWord = board.group === 'status' && c.key === 'ms' ? 'milestone' : 'task';
      return '<section class="bcol" data-col="' + esc(c.key) + '"><header class="bcol-hd">' + c.dot +
        '<span class="bcol-t">' + esc(c.title) + '</span><span class="bcol-n">' + c.cards.length + '</span></header>' +
        '<div class="bcol-body">' + (c.cards.map(cardHtml).join('') || '<p class="bcol-empty">Nothing here</p>') + '</div>' +
        '<button type="button" class="bcol-add" data-col-add="' + esc(c.key) + '">+ New ' + addWord + '</button></section>';
    }).join('') : '<p class="bnone">Nothing here yet.&nbsp;<button type="button" data-board-new>Add a task</button></p>';
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
    }).join('') + '<div class="zsep" role="separator"></div><button type="button" data-show-all' + (hidden ? '' : ' disabled') + '>Show everything</button>';
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
    var card = t.closest('.kcard[data-id]');
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
    var card = e.target.closest('.kcard[data-id]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openEdit(card.getAttribute('data-id'));
    }
  });

  // Drag the board itself to scroll: sideways moves the board; up and down scrolls the
  // column under the press when it's taller than the screen, otherwise the board. Cards
  // drag to other columns instead.
  dragScroll(boardEl.querySelector('.bscroll'), 'button, input, select, a, .kcard', function (t) {
    var body = t.closest('.bcol') && t.closest('.bcol').querySelector('.bcol-body');
    return body && body.scrollHeight > body.clientHeight ? body : null;
  });

  // Dragging cards between columns.
  boardCols.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.kcard[data-id]');
    if (!card) return;
    dragId = card.getAttribute('data-id');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    hideTip();
    setTimeout(function () { card.classList.add('dragging'); }, 0);
  });
  boardCols.addEventListener('dragover', function (e) {
    var col = e.target.closest('.bcol');
    var ok = col && dragId && canDrop(data.rows[rowIndex[dragId]], col.getAttribute('data-col'));
    Array.prototype.forEach.call(boardCols.querySelectorAll('.bcol.over'), function (c) { if (c !== col || !ok) c.classList.remove('over'); });
    if (!ok) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('over');
  });
  boardCols.addEventListener('drop', function (e) {
    var col = e.target.closest('.bcol');
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
    var col = e.target.closest('.bcol');
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
    if (!showMenu.hidden && e.target.isConnected && !e.target.closest('.cwrap')) showShowMenu(false);
  });

  renderBoard();

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
  try {
    var savedCal = JSON.parse(localStorage.getItem('roadmapCal'));
    if (savedCal && savedCal.view) cal.view = savedCal.view;
    if (savedCal && savedCal.show) cal.show = savedCal.show;
  } catch (e) {}
  var calAt = TODAY; // a day in the month or week shown; kept for the tab
  try { calAt = +sessionStorage.getItem('roadmapCalAt') || TODAY; } catch (e) {}
  var calDrag = null;

  function saveCal() {
    try {
      localStorage.setItem('roadmapCal', JSON.stringify(cal));
      sessionStorage.setItem('roadmapCalAt', String(calAt));
    } catch (e) {}
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
    var mark = r.type === 'milestone' ? '<i class="cmk ms"></i>' : r.type === 'phase' ? '<i class="cmk ph"></i>' : '<i class="cmk' + (r.parent ? ' sub' : '') + '"></i>';
    var done = r.type === 'task' && r.progress >= 1;
    var cls = 'cseg ' + (sg.multi ? 'cbar' : 'cchip') + ' k-' + (r.type === 'task' && r.parent ? 'sub' : r.type) +
      (sg.head ? ' head' : '') + (sg.tail ? ' tail' : '') + (done ? ' done' : '') + (r.id === freshId ? ' fresh' : '');
    return '<div class="' + cls + '" data-id="' + esc(r.id) + '" draggable="true" tabindex="0" role="button" title="' +
      esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to another day') + '" style="left: calc(' + sg.c0 + ' * 100% / 7 + 2px); width: calc(' +
      (sg.c1 - sg.c0 + 1) + ' * 100% / 7 - 4px); top: ' + (28 + sg.lane * 22) + 'px' + colorVar(r) + '">' +
      (sg.multi && r.type === 'task' ? '' : mark) + (timed ? '<span class="ctime">' + timeOf(s) + '</span>' : '') +
      '<span class="cname">' + esc(r.name) + '</span></div>';
  }

  // One item in a day's list: its marker, time and name.
  function itemLine(r, indent) {
    var s = startDay(r);
    var kind = r.type === 'task' && r.parent ? 'sub' : r.type;
    var mark = r.type === 'milestone' ? '<i class="cmk ms"></i>' : r.type === 'phase' ? '<i class="cmk ph"></i>' : '<i class="cmk' + (r.parent ? ' sub' : '') + '"></i>';
    var done = r.type === 'task' && r.progress >= 1;
    return '<div class="citem k-' + kind + (indent ? ' in' : '') + (done ? ' done' : '') + (r.id === freshId ? ' fresh' : '') + '" data-id="' + esc(r.id) +
      '" draggable="true" tabindex="0" role="button" title="' + esc(r.name + ' · ' + itemLabel(r) + ' · click to edit, drag to another day') +
      '" style="' + colorVar(r).slice(2) + '">' + mark + (s % 1 ? '<span class="ctime">' + timeOf(s) + '</span>' : '') +
      '<span class="cname">' + esc(r.name) + '</span></div>';
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
          out += '<div class="chead' + (g.id ? '' : ' other') + (g.self && g.self.id === freshId ? ' fresh' : '') + '"' + (g.row && g.row.color ? ' style="' + colorVar(g.row).slice(2) + '"' : '') +
            (g.self ? ' data-id="' + esc(g.self.id) + '" draggable="true" tabindex="0" role="button" title="' + esc(g.self.name + ' · ' + itemLabel(g.self) + ' · click to edit') + '"' : '') +
            '>' + (g.id ? '<i class="cmk ph"></i>' : '') + '<span class="cname">' + esc(name) + '</span>' + (span ? '<span class="ctime">' + span + '</span>' : '') + '</div>';
        }
        out += g.tasks.map(function (r) { return itemLine(r, !!g.id); }).join('');
        return;
      }
      var n = g.tasks.length;
      var doneN = g.tasks.filter(function (r) { return r.progress >= 1; }).length;
      if (!g.id) {
        out += '<div class="csum other" role="button" tabindex="0" data-cal-open="' + t + '" title="See them in the week">+ ' + n + ' other ' + (n === 1 ? 'task' : 'tasks') + '</div>';
        return;
      }
      out += '<div class="csum" role="button" tabindex="0" data-cal-open="' + t + '"' + (g.row.color ? ' style="' + colorVar(g.row).slice(2) + '"' : '') + ' title="' +
        esc(name + (span ? ' ' + span : '') + ' · ' + n + (n === 1 ? ' task' : ' tasks') + ' on ' + dayName + ', ' + doneN + ' done · click to see the week') + '">' +
        '<i class="cmk ph"></i><span class="cname">' + esc(name) + '</span>' +
        (n ? '<span class="ccount' + (doneN === n ? ' all' : '') + '">' + (doneN === n ? '✓ ' : '') + n + '</span>' : '<span class="ctime">' + span + '</span>') +
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
      return '<span' + (d === 0 || d === 6 ? ' class="wkend"' : '') + '>' + WEEKDAYS[d] + '</span>';
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
        var cls = 'cday' + (!week && startOf(t, 'month') !== month ? ' out' : '') + (t === TODAY ? ' is-today' : '') +
          (d.getUTCDay() % 6 === 0 ? ' wkend' : '');
        days += '<div class="' + cls + '" data-day="' + t + '" title="Click to add a task on ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + '">' +
          '<span class="cdate">' + (d.getUTCDate() === 1 || week ? d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] : d.getUTCDate()) + '</span>' +
          '<div class="clist" style="margin-top: ' + (shownLanes * 22 + 3) + 'px">' + dayHtml(t, own, week) +
          (hidden[c] ? '<button type="button" class="cmore" data-cal-more="' + ws + '" title="Show all of this week">+' + hidden[c] + ' more</button>' : '') +
          '</div></div>';
      }
      return '<div class="cweek" style="--lanes: ' + shownLanes + '">' + days + segs.map(segHtml).join('') + '</div>';
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
    var seg = t.closest('.cseg[data-id], .citem[data-id], .chead[data-id]');
    var open = t.closest('[data-cal-open]');
    var day = t.closest('.cday[data-day]');
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
    var seg = e.target.closest('.cseg[data-id], .citem[data-id], .chead[data-id]');
    if (seg && e.target === seg && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openEdit(seg.getAttribute('data-id'));
    } else if (e.target.matches('[data-cal-open]') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.target.click();
    }
  });
  calGrid.addEventListener('dragstart', function (e) {
    var seg = e.target.closest('.cseg[data-id], .citem[data-id], .chead[data-id]');
    if (!seg) return;
    // Where in the item it was picked up, so a long bar moves by the days the mouse moves.
    var r = calSpan(data.rows[rowIndex[seg.getAttribute('data-id')]]);
    var under = cellAt(e.clientX, e.clientY);
    calDrag = { id: seg.getAttribute('data-id'), from: under != null ? under : r[0] };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', calDrag.id); } catch (err) {}
    hideTip();
    setTimeout(function () { seg.classList.add('dragging'); }, 0);
  });

  // The day under a screen point, from the day cells' positions.
  function cellAt(x, y) {
    var cells = calGrid.querySelectorAll('.cday');
    for (var k = 0; k < cells.length; k++) {
      var b = cells[k].getBoundingClientRect();
      if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) return +cells[k].getAttribute('data-day');
    }
    return null;
  }

  calGrid.addEventListener('dragover', function (e) {
    if (!calDrag) return;
    var t = cellAt(e.clientX, e.clientY);
    Array.prototype.forEach.call(calGrid.querySelectorAll('.cday.over'), function (c) { c.classList.remove('over'); });
    if (t == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var cell = calGrid.querySelector('.cday[data-day="' + t + '"]');
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
    return '<div class="pcolors" role="radiogroup" aria-label="Colour">' +
      '<label class="sw sm"><input type="radio" name="' + name + '" value=""' + (!value ? ' checked' : '') + ' aria-label="' + defaultName + '"><span style="background: ' + defaultColor + '" title="' + defaultName + '"></span></label>' +
      list.map(function (c) {
        return '<label class="sw sm"><input type="radio" name="' + name + '" value="' + c[1] + '"' + (value === c[1] ? ' checked' : '') +
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
    setNav.innerHTML = '<div class="snav-hd">Project settings</div>' + SECTIONS.map(function (s) {
      return '<button type="button" class="' + (s[0] === 'danger' ? 'danger' : '') + '" data-sec="' + s[0] + '">' + s[1] + '</button>';
    }).join('');

    // General
    var starts = data.rows.map(startDay);
    var ends = data.rows.map(function (r) { return r.end != null ? r.end : startDay(r); });
    var first = starts.length ? Math.min.apply(null, starts) : null;
    var last = ends.length ? Math.max.apply(null, ends) : null;
    var on = projectTags.map(tagById).filter(Boolean);
    var count = function (type) { return data.rows.filter(function (r) { return r.type === type; }).length; };
    var html = '<section class="ssec" id="set-general"><h2>General</h2>' +
      '<label class="sfld"><span class="fl">Project name</span><input type="text" maxlength="60" value="' + esc(p.name) + '" data-set-name></label>' +
      '<label class="sfld"><span class="fl">Description <em>optional</em></span><textarea rows="3" maxlength="600" placeholder="What this project is for, who it involves, anything worth knowing" data-set-desc>' +
      esc(p.description || '') + '</textarea></label>' +
      '<div class="sfld"><span class="fl">Tags</span><div class="srowline wrap">' +
      (on.length ? on.map(function (t) { return '<span class="pill" style="--c: ' + esc(t.color) + '"># ' + esc(t.name) + '</span>'; }).join('') : '<span class="nil">No tags</span>') +
      '<button type="button" class="btn" data-set-tag>' + (on.length ? 'Change' : 'Add tags') + '</button></div></div>' +
      '<div class="sfld"><span class="fl">At a glance</span><div class="sglance">' +
      '<div><b>' + count('milestone') + '</b>' + (count('milestone') === 1 ? 'milestone' : 'milestones') + '</div>' +
      '<div><b>' + count('phase') + '</b>' + (count('phase') === 1 ? 'phase' : 'phases') + '</div>' +
      '<div><b>' + count('task') + '</b>' + (count('task') === 1 ? 'task' : 'tasks') + '</div>' +
      '<div><b>' + data.people.length + '</b>' + (data.people.length === 1 ? 'person' : 'people') + '</div>' +
      '<div class="wide"><b>' + (first == null ? '—' : esc(listDate(first)) + ' – ' + esc(listDate(last))) + '</b>' +
      (first == null ? 'No dates yet' : 'First to last item, ' + esc(duration({ start: first, end: last }))) + '</div></div></div>' +
      '<p class="ssaved" aria-live="polite" data-set-saved></p></section>';

    // People
    html += '<section class="ssec" id="set-people"><h2>People</h2><p class="sdesc">Everyone you can put on an item. Deleting someone unassigns their items; merging moves their items to someone else.</p><div class="slist">' +
      (data.people.length ? data.people.map(function (q) {
        var uses = data.rows.filter(function (r) { return r.person === q.id; }).length;
        if (setEditing && setEditing.kind === 'person' && setEditing.id === q.id) {
          return '<div class="sitem editing" data-person-row="' + esc(q.id) + '">' + avatar(q) +
            '<input type="text" maxlength="60" value="' + esc(q.name) + '" aria-label="Name" data-edit-name>' +
            swatchesHtml('editColor', AVATAR_COLORS.map(function (c) { return ['Colour ' + c, c]; }), q.color, q.color, 'Keep colour') +
            '<div class="sacts"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-person-save>Save</button></div></div>';
        }
        if (setEditing && setEditing.kind === 'merge' && setEditing.id === q.id && personById(setEditing.to)) {
          var into = personById(setEditing.to);
          return '<div class="sitem editing" data-person-row="' + esc(q.id) + '">' + avatar(q) +
            '<span class="sname">Move ' + (uses ? 'all ' + itemsWord(uses) : 'nothing') + ' from ' + esc(q.name) + ' to ' + esc(into.name) + ', and remove ' + esc(q.name) + '?</span>' +
            '<div class="sacts"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-person-merge-go>Merge</button></div></div>';
        }
        var others = data.people.filter(function (o) { return o !== q; });
        return '<div class="sitem" data-person-row="' + esc(q.id) + '">' + avatar(q) +
          '<span class="sname">' + esc(q.name) + '</span><span class="smeta">' + itemsWord(uses) + '</span>' +
          '<div class="sacts">' +
          (others.length ? '<select aria-label="Merge ' + esc(q.name) + ' into" title="Merge into someone else" data-person-merge><option value="">Merge into…</option>' +
            others.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join('') + '</select>' : '') +
          '<button type="button" class="tp-edit" aria-label="Edit ' + esc(q.name) + '" title="Edit" data-person-edit>' + PENCIL + '</button>' +
          '<button type="button" class="tp-edit tp-del" aria-label="Delete ' + esc(q.name) + '" title="Delete" data-person-del>' + TRASH_ICON + '</button>' +
          '</div></div>';
      }).join('') : '<p class="sempty">No people yet.</p>') +
      '</div><div class="sadd"><input type="text" maxlength="60" placeholder="Add someone: their name" aria-label="New person\'s name" data-person-new><button type="button" class="btn" data-person-add>Add</button></div></section>';

    // Phases
    var phases = phaseRows();
    html += '<section class="ssec" id="set-phases"><h2>Phases</h2><p class="sdesc">The sections of the plan, in order. A colour here shows on the timeline, list, calendar and board.</p><div class="slist">' +
      (phases.length ? phases.map(function (ph, k) {
        var tasks = data.rows.slice(rowIndex[ph.id] + 1, sectionEnd(ph.id)).filter(function (r) { return r.type === 'task'; }).length;
        var ring = '<i class="sring" style="' + colorVar(ph).slice(2) + '"></i>';
        if (setEditing && setEditing.kind === 'phase' && setEditing.id === ph.id) {
          return '<div class="sitem editing" data-phase-row="' + esc(ph.id) + '">' + ring +
            '<input type="text" maxlength="80" value="' + esc(ph.name) + '" aria-label="Phase name" data-edit-name>' +
            swatchesHtml('editColor', COLORS, ph.color || '', '#a596ea', 'Lavender (default)') +
            '<div class="sacts"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-phase-save>Save</button></div></div>';
        }
        return '<div class="sitem" data-phase-row="' + esc(ph.id) + '">' + ring +
          '<span class="sname">' + esc(ph.name) + '</span><span class="smeta">' + esc(itemLabel(ph)) + ' · ' + tasks + (tasks === 1 ? ' task' : ' tasks') + '</span>' +
          '<div class="sacts">' +
          '<button type="button" class="tp-edit" aria-label="Move ' + esc(ph.name) + ' up" title="Move up"' + (k ? '' : ' disabled') + ' data-phase-move="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg></button>' +
          '<button type="button" class="tp-edit" aria-label="Move ' + esc(ph.name) + ' down" title="Move down"' + (k < phases.length - 1 ? '' : ' disabled') + ' data-phase-move="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>' +
          '<button type="button" class="tp-edit" aria-label="Edit ' + esc(ph.name) + '" title="Rename or recolour" data-phase-edit>' + PENCIL + '</button>' +
          '</div></div>';
      }).join('') : '<p class="sempty">No phases yet. Add one with New task → Phase.</p>') + '</div></section>';

    // Defaults
    html += '<section class="ssec" id="set-defaults"><h2>Defaults</h2>' +
      '<div class="sgrid">' +
      '<label class="sfld"><span class="fl">Weeks start on</span><select data-def="weekStart"><option value="1"' + (WEEK_START === 1 ? ' selected' : '') + '>Monday</option><option value="0"' + (WEEK_START === 0 ? ' selected' : '') + '>Sunday</option></select></label>' +
      '<label class="sfld"><span class="fl">Open the project on</span><select data-def="openPage">' + PAGES.map(function (o) {
        return '<option value="' + o[0] + '"' + ((d.openPage || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="sfld"><span class="fl">In the view</span><select data-def="openScale"><option value="">Where you left off</option>' +
      [['H', 'Hour'], ['D', 'Day'], ['W', 'Week'], ['M', 'Month'], ['Q', 'Quarter'], ['Y', 'Year']].map(function (o) {
        return '<option value="' + o[0] + '"' + (d.openScale === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label></div>' +
      '<h3>New items start</h3><div class="sgrid">' +
      '<label class="sfld"><span class="fl">At</span><select data-def="timed"><option value="">All day</option><option value="1"' + (d.timed ? ' selected' : '') + '>A set time</option></select></label>' +
      '<label class="sfld"' + (d.timed ? '' : ' hidden') + '><span class="fl">Time</span><input type="time" value="' + esc(d.startTime || '09:00') + '" data-def="startTime"></label>' +
      '<label class="sfld"><span class="fl">Finishing</span><select data-def="length">' + LENGTHS.map(function (o) {
        return '<option value="' + o[0] + '"' + ((d.length || 0) === o[0] ? ' selected' : '') + '>' + (o[0] ? o[1] + ' later' : o[1]) + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="sfld"><span class="fl">Task colour</span>' + swatchesHtml('defColor', COLORS.slice(1), d.color || '', COLORS[0][1], 'Blue (default)') + '</div>' +
      '<p class="sdesc">Week start applies straight away and reloads the page. Opening defaults apply the first time the project is opened in a tab.</p></section>';

    // Templates
    html += '<section class="ssec" id="set-templates"><h2>Templates</h2><p class="sdesc">Start new projects from a saved copy of this one, from the project menu by the name at the top.</p>' +
      '<button type="button" class="btn" data-set-template>Save this project as a template…</button><div class="slist">' +
      (templates.length ? templates.map(function (tp) {
        if (setEditing && setEditing.kind === 'template' && setEditing.id === tp.id) {
          return '<div class="sitem editing" data-template-row="' + esc(tp.id) + '"><input type="text" maxlength="60" value="' + esc(tp.name) + '" aria-label="Template name" data-edit-name>' +
            '<div class="sacts"><button type="button" class="btn" data-edit-cancel>Cancel</button><button type="button" class="primary" data-template-save>Save</button></div></div>';
        }
        return '<div class="sitem" data-template-row="' + esc(tp.id) + '"><span class="sname">' + esc(tp.name) + '</span><span class="smeta">' + itemsWord(tp.rows.length) + '</span>' +
          '<div class="sacts"><button type="button" class="tp-edit" aria-label="Rename ' + esc(tp.name) + '" title="Rename" data-template-edit>' + PENCIL + '</button>' +
          '<button type="button" class="tp-edit tp-del" aria-label="Delete ' + esc(tp.name) + '" title="Delete template" data-template-del>' + TRASH_ICON + '</button></div></div>';
      }).join('') : '<p class="sempty">No templates yet.</p>') + '</div></section>';

    // Danger zone
    var only = projects.length < 2;
    html += '<section class="ssec danger" id="set-danger"><h2>Danger zone</h2>' +
      '<div class="sdanger"><div><b>Reset project</b><span>Remove every item and dependency, leaving it empty. People and the tag stay.</span></div><button type="button" class="btn del" data-set-reset>Reset project…</button></div>' +
      '<div class="sdanger"><div><b>Delete project</b><span>' + (only ? 'This is your only project, so it can’t be deleted. Reset it instead.' : 'Remove the project and everything in it for good. This can’t be undone.') +
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
    actForm.innerHTML = '<div class="dlg-hd"><h2 id="act-title">Delete ' + esc(name) + '?</h2></div><div class="dlg-body">' +
      '<p class="act-warn">This deletes the project and all ' + itemsWord(data.rows.length) + ' in it, its people and its dependencies, for good. It can’t be undone. Your notes, tags and templates stay.</p>' +
      '<label class="chk"><input type="checkbox" data-del-ok> I understand this project will be gone for good</label>' +
      '<label class="fld"><span class="fl">Type <b>' + esc(name) + '</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-del-name></label></div>' +
      '<div class="dlg-ft"><button class="btn" type="button" data-act-close>Cancel</button><button class="btn del" type="submit" disabled data-del-go>Delete project</button></div>';
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
      try {
        localStorage.removeItem(planKey(gone));
        sessionStorage.removeItem('roadmapHistory');
      } catch (err) {}
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
      try { sessionStorage.removeItem('roadmapSpot'); } catch (err) {}
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
      var save = t.closest('.sitem').querySelector('[data-person-save], [data-phase-save], [data-template-save]');
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

  // Pages: the rail switches between the timeline, the list and the board. The list and
  // board sit over the timeline rather than replacing it, so the chart keeps its scroll
  // position underneath.
  function setPage(page) {
    app.setAttribute('data-page', page);
    pageBtns.forEach(function (btn) {
      var on = btn.getAttribute('data-page-btn') === page;
      btn.classList.toggle('on', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    closePeek();
    try { localStorage.setItem('roadmapPage', page); } catch (e) {}
    if (page === 'settings') setTimeout(renderSettings, 0); // after start-up has loaded tags and templates
    // Workload redraws the timeline by person, with the people panel always open.
    if ((page === 'workload') !== workload) {
      workload = page === 'workload';
      if (!workload) panel.querySelector('.gut-title').textContent = 'Task';
      var open = false;
      try { open = localStorage.getItem('taskPanel') === 'open'; } catch (e) {}
      panel.classList.toggle('open', workload || open);
      renderPlan();
      renderTaskList();
      syncPanelScroll();
    }
  }

  pageBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { setPage(btn.getAttribute('data-page-btn')); });
  });

  renderList();
  var savedPage;
  try { savedPage = localStorage.getItem('roadmapPage'); } catch (e) {}
  if (firstOpen && defaults().openPage) savedPage = defaults().openPage;
  setPage(['list', 'board', 'workload', 'calendar', 'settings'].indexOf(savedPage) >= 0 ? savedPage : 'timeline');

  // Project tags: the tags beside the project name. Tags are a shared list (kept in this
  // browser apart from the plan), so projects can share them; a project can have any
  // number. The top bar shows the first with "+n" for the rest. Clicking it opens a popup
  // listing every tag to tick on or off, find or create one, edit a tag's name and
  // colour, or delete it.
  var tagBtn = document.querySelector('[data-tag-btn]');
  var tagPop = document.querySelector('[data-tag-pop]');
  var TAG_DEFAULT = { id: 'national-gas-transmission', name: 'National Gas Transmission', color: '#418dab' };
  var tags = null;
  var projectTags = [TAG_DEFAULT.id];
  var tagEditing = null; // the tag open in the editor, or null for the list

  // A project's tags as a list; projects used to have a single `tag` (and before that the
  // first project's tag was stored on its own).
  function tagsOf(p) {
    if (Array.isArray(p.tags)) return p.tags.slice();
    if ('tag' in p) return p.tag ? [p.tag] : [];
    var old;
    try { old = JSON.parse(localStorage.getItem('roadmapProject')); } catch (e) {}
    if (old && 'tag' in old) return old.tag ? [old.tag] : [];
    return p.id === FIRST_PROJECT ? [TAG_DEFAULT.id] : [];
  }

  function loadTags() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem('roadmapTags')); } catch (e) {}
    tags = Array.isArray(saved) ? saved : [TAG_DEFAULT];
    var fresh;
    try { fresh = JSON.parse(localStorage.getItem('roadmapProjects')); } catch (e) {}
    // Take another tab's changes, unless it deleted this project; this tab keeps what it had then.
    if (Array.isArray(fresh) && fresh.some(function (x) { return x.id === currentId; })) projects = fresh;
    projectTags = tagsOf(project()).filter(tagById);
  }

  function saveTags() {
    var p = project();
    p.tags = projectTags.slice();
    delete p.tag;
    saveProjects();
    try { localStorage.setItem('roadmapTags', JSON.stringify(tags)); } catch (e) {}
  }

  function tagById(id) {
    return tags.filter(function (t) { return t.id === id; })[0] || null;
  }

  function renderTagBtn() {
    var on = projectTags.map(tagById).filter(Boolean);
    var t = on[0];
    tagBtn.innerHTML = t ? '# ' + esc(t.name) + (on.length > 1 ? '<span class="pmore">+' + (on.length - 1) + '</span>' : '') : '+ Add tag';
    tagBtn.classList.toggle('empty', !t);
    tagBtn.style.setProperty('--c', t ? t.color : '');
    tagBtn.title = t ? on.map(function (x) { return '# ' + x.name; }).join(', ') + ' · click to change' : 'Tag this project';
    if (app.getAttribute('data-page') === 'settings') setTimeout(renderSettings, 0); // its tag list too
  }

  var PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path></svg>';

  function renderTagPop() {
    if (tagEditing) {
      var t = tagEditing;
      tagPop.innerHTML = '<div class="tp-hd">Edit tag</div>' +
        '<div class="tp-body"><input type="text" maxlength="40" value="' + esc(t.name) + '" aria-label="Tag name" data-tag-name>' +
        '<div class="pcolors" role="radiogroup" aria-label="Tag colour">' + COLORS.map(function (c) {
          return '<label class="sw sm"><input type="radio" name="tagColor" value="' + c[1] + '"' + (c[1] === t.color ? ' checked' : '') +
            ' aria-label="' + c[0] + '"><span style="background: ' + c[1] + '" title="' + c[0] + '"></span></label>';
        }).join('') + '</div>' +
        '<p class="tp-note">Changes show on every project with this tag.</p><p class="tp-err" hidden data-tag-err></p></div>' +
        '<div class="tp-ft"><button class="btn del" type="button" data-tag-delete>Delete tag</button>' +
        '<button class="btn" type="button" data-tag-back>Cancel</button><button class="primary" type="button" data-tag-save>Save</button></div>';
      tagPop.querySelector('[data-tag-name]').select();
      return;
    }
    tagPop.innerHTML = '<div class="tp-hd">Project tags</div>' +
      '<div class="tp-body"><input type="text" maxlength="40" placeholder="Find or create a tag" aria-label="Find or create a tag" data-tag-q>' +
      '<div class="tp-list" role="listbox" aria-multiselectable="true" aria-label="Tags" data-tag-list></div></div>' +
      '<div class="tp-ft" data-tag-foot></div>';
    renderTagList();
    tagPop.querySelector('[data-tag-q]').focus();
  }

  // This project's tags first, in their order, then the rest.
  function renderTagList() {
    var input = tagPop.querySelector('[data-tag-q]');
    var q = input.value.trim().replace(/\s+/g, ' ');
    var shown = tags.filter(function (t) { return t.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).sort(function (a, b) {
      var ia = projectTags.indexOf(a.id);
      var ib = projectTags.indexOf(b.id);
      return (ia < 0 ? 1e3 : ia) - (ib < 0 ? 1e3 : ib);
    });
    var exact = tags.some(function (t) { return t.name.toLowerCase() === q.toLowerCase(); });
    tagPop.querySelector('[data-tag-list]').innerHTML = shown.map(function (t) {
      var on = projectTags.indexOf(t.id) >= 0;
      return '<div class="tp-row' + (on ? ' on' : '') + '"><button type="button" class="tp-pick tp-check" role="option" aria-selected="' + on + '" data-tag-pick="' + esc(t.id) + '">' +
        '<b class="tp-box" aria-hidden="true"></b><i style="background: ' + esc(t.color) + '"></i><span>' + esc(t.name) + '</span>' +
        (on && projectTags[0] === t.id && projectTags.length > 1 ? '<em>Shown first</em>' : '') + '</button>' +
        '<button type="button" class="tp-edit" aria-label="Edit ' + esc(t.name) + '" title="Edit tag" data-tag-edit="' + esc(t.id) + '">' + PENCIL + '</button></div>';
    }).join('') +
      (q && !exact ? '<button type="button" class="tp-create" data-tag-create>+ Create tag “' + esc(q) + '”</button>' : '') +
      (!shown.length && !q ? '<p class="tp-empty">No tags yet. Type a name to create one.</p>' : '');
    var n = projectTags.length;
    var foot = tagPop.querySelector('[data-tag-foot]');
    foot.hidden = !n;
    foot.innerHTML = '<span class="tp-count">' + (n === 1 ? '1 tag on this project' : n + ' tags on this project') + '</span>' +
      '<button class="tp-remove" type="button" data-tag-remove>Remove ' + (n === 1 ? 'it' : 'all') + '</button>';
  }

  function openTagPop(open) {
    tagEditing = null;
    tagPop.hidden = !open;
    tagBtn.setAttribute('aria-expanded', String(open));
    if (open) renderTagPop();
  }

  // Tick a tag on or off for this project; the popup stays open for the next.
  function toggleTag(id, on) {
    var has = projectTags.indexOf(id) >= 0;
    if (on == null) on = !has;
    if (on && !has) projectTags.push(id);
    if (!on && has) projectTags.splice(projectTags.indexOf(id), 1);
    saveTags();
    renderTagBtn();
    renderTagList();
  }

  function createTag(name) {
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tag';
    var id = base;
    for (var n = 2; tagById(id); n++) id = base + '-' + n;
    tags.push({ id: id, name: name, color: COLORS[tags.length % COLORS.length][1] });
    tagPop.querySelector('[data-tag-q]').value = '';
    toggleTag(id, true);
    tagPop.querySelector('[data-tag-q]').focus();
  }

  function saveTagEdit() {
    var name = tagPop.querySelector('[data-tag-name]').value.trim().replace(/\s+/g, ' ');
    var err = tagPop.querySelector('[data-tag-err]');
    var clash = tags.filter(function (t) { return t !== tagEditing && t.name.toLowerCase() === name.toLowerCase(); })[0];
    if (!name || clash) {
      err.textContent = name ? 'There is already a tag called ' + clash.name + '.' : 'Give the tag a name.';
      err.hidden = false;
      return tagPop.querySelector('[data-tag-name]').focus();
    }
    var colorIn = tagPop.querySelector('[name="tagColor"]:checked');
    var edited = { id: tagEditing.id, name: name, color: colorIn ? colorIn.value : tagEditing.color };
    tags = tags.map(function (t) { return t === tagEditing ? edited : t; });
    saveTags();
    renderTagBtn();
    tagEditing = null;
    renderTagPop();
  }

  tagBtn.addEventListener('click', function () { openTagPop(tagPop.hidden); });
  tagPop.addEventListener('input', function (e) { if (e.target.matches('[data-tag-q]')) renderTagList(); });
  tagPop.addEventListener('click', function (e) {
    var t = e.target;
    var pick = t.closest('[data-tag-pick]');
    var edit = t.closest('[data-tag-edit]');
    if (pick) return toggleTag(pick.getAttribute('data-tag-pick'));
    if (edit) {
      tagEditing = tagById(edit.getAttribute('data-tag-edit'));
      return renderTagPop();
    }
    if (t.closest('[data-tag-create]')) return createTag(tagPop.querySelector('[data-tag-q]').value.trim().replace(/\s+/g, ' '));
    if (t.closest('[data-tag-remove]')) {
      projectTags = [];
      saveTags();
      renderTagBtn();
      return renderTagList();
    }
    if (t.closest('[data-tag-back]')) {
      tagEditing = null;
      return renderTagPop();
    }
    if (t.closest('[data-tag-save]')) return saveTagEdit();
    var del = t.closest('[data-tag-delete]');
    if (del) {
      // Asks once: the first click turns the button into a confirm.
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'Delete for every project?';
        return;
      }
      var gone = tagEditing.id;
      tags = tags.filter(function (x) { return x.id !== gone; });
      projectTags = projectTags.filter(function (x) { return x !== gone; });
      saveTags();
      renderTagBtn();
      tagEditing = null;
      renderTagPop();
    }
  });
  tagPop.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (tagEditing) {
        tagEditing = null;
        return renderTagPop();
      }
      openTagPop(false);
      return tagBtn.focus();
    }
    if (e.key !== 'Enter') return;
    if (e.target.matches('[data-tag-name]')) {
      e.preventDefault();
      return saveTagEdit();
    }
    if (e.target.matches('[data-tag-q]')) {
      // Enter picks the tag with that name, or the only match, or creates it.
      e.preventDefault();
      var q = e.target.value.trim().replace(/\s+/g, ' ');
      if (!q) return;
      var matches = tags.filter(function (t) { return t.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
      var exact = tags.filter(function (t) { return t.name.toLowerCase() === q.toLowerCase(); })[0];
      if (exact || matches.length === 1) {
        e.target.value = '';
        toggleTag((exact || matches[0]).id, true);
      } else {
        createTag(q);
      }
    }
  });
  document.addEventListener('pointerdown', function (e) {
    if (!tagPop.hidden && !e.target.closest('.tagwrap')) openTagPop(false);
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== 'roadmapTags' && e.key !== 'roadmapProjects') return;
    loadTags();
    renderTagBtn();
    renderProjBtn(); // a rename in another tab
    document.title = project().name;
    if (!tagPop.hidden && !tagEditing) renderTagList();
  });

  loadTags();
  renderTagBtn();

  // Search: type in the top bar to find anything in the plan by its name, phase, person
  // or type. Results update as you type; click one (or pick it with ↑/↓ and Enter) to go
  // to it on the page you're on, where it lights up for a moment. Ctrl+F (⌘F) jumps here.
  var searchIn = document.querySelector('[data-search-input]');
  var searchRes = document.querySelector('[data-search-results]');
  var searchHits = [];
  var searchSel = 0;
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  document.querySelector('[data-search-kbd]').textContent = MAC ? '⌘F' : 'Ctrl F';

  // The name with every searched-for word marked.
  function markWords(name, words) {
    var hit = [];
    var low = name.toLowerCase();
    words.forEach(function (w) {
      for (var i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) {
        for (var k = i; k < i + w.length; k++) hit[k] = true;
      }
    });
    var out = '';
    for (var j = 0; j < name.length; j++) {
      if (hit[j] && !hit[j - 1]) out += '<mark>';
      out += esc(name.charAt(j));
      if (hit[j] && !hit[j + 1]) out += '</mark>';
    }
    return out;
  }

  function runSearch() {
    var q = searchIn.value.trim().toLowerCase();
    if (!q) return showResults(false);
    var words = q.split(/\s+/);
    searchHits = data.rows.map(function (r, i) {
      var who = personById(r.person);
      var kind = r.type === 'task' ? (r.parent ? 'subtask' : 'task') : r.type;
      var hay = [r.name, phaseName(r), who ? who.name : '', kind].join(' ').toLowerCase();
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return null;
      var name = r.name.toLowerCase();
      // Names starting with the search come first, then names containing it, then the rest.
      return { r: r, rank: name.indexOf(q) === 0 ? 0 : name.indexOf(q) > 0 ? 1 : 2, i: i };
    }).filter(Boolean).sort(function (a, b) { return a.rank - b.rank || a.i - b.i; }).slice(0, 8).map(function (h) { return h.r; });
    searchSel = 0;
    searchRes.innerHTML = searchHits.length ? searchHits.map(function (r, i) {
      var who = personById(r.person);
      var ic = r.type === 'phase' ? '<i class="lic ph" style="' + colorVar(r).slice(2) + '"></i>' : r.type === 'milestone' ? '<i class="lic ms"></i>'
        : '<i class="lic' + (r.parent ? ' sub' : '') + '" style="' + colorVar(r).slice(2) + '"></i>';
      var meta = [r.type === 'task' ? (r.parent ? 'Subtask' : 'Task') : r.type === 'milestone' ? 'Milestone' : 'Phase', r.type === 'phase' ? '' : phaseName(r), who ? who.name : '']
        .filter(Boolean).map(esc).join(' · ');
      return '<div class="sr" role="option" id="sr-' + i + '" data-id="' + esc(r.id) + '">' + ic +
        '<span class="sr-t"><span class="sr-n">' + markWords(r.name, words) + '</span><span class="sr-m">' + meta + '</span></span>' +
        '<span class="sr-d">' + esc(itemLabel(r)) + '</span></div>';
    }).join('') : '<div class="sr-none">Nothing matches “' + esc(searchIn.value.trim()) + '”</div>';
    showResults(true);
    syncSearchSel();
  }

  function showResults(open) {
    searchRes.hidden = !open;
    searchIn.setAttribute('aria-expanded', String(open));
    if (!open) searchIn.removeAttribute('aria-activedescendant');
  }

  function syncSearchSel() {
    Array.prototype.forEach.call(searchRes.querySelectorAll('.sr'), function (el, i) {
      el.setAttribute('aria-selected', String(i === searchSel));
      if (i === searchSel) {
        searchIn.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  // Go to a row on whichever page is open and light it up for a moment.
  function goToItem(id) {
    showResults(false);
    searchIn.value = '';
    searchIn.blur();
    if (rowIndex[id] == null) return;
    var page = app.getAttribute('data-page');
    if (page === 'settings') { // items aren't shown here: go to it on the timeline
      setPage('timeline');
      page = 'timeline';
    }
    var q = window.CSS && CSS.escape ? CSS.escape(id) : id;
    if (page === 'calendar') {
      var item = data.rows[rowIndex[id]];
      cal.show[item.type] = true;
      calAt = calSpan(item)[0];
      freshId = id;
      renderCal();
      if (!calGrid.querySelector('[data-id="' + q + '"]')) { // summed up or under "+n more": show its week
        cal.view = 'week';
        renderCal();
      }
      saveCal();
      var seg = calGrid.querySelector('[data-id="' + q + '"]');
      if (seg) seg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(function () { if (freshId === id) freshId = null; }, 2200);
      return;
    }
    if (page === 'board') {
      var row = data.rows[rowIndex[id]];
      if (row.type === 'phase') board.group = 'phase'; // phases are columns, not cards
      else if (row.parent) board.subtasks = true;
      saveBoard();
      freshId = id;
      renderBoard();
      var target = boardCols.querySelector(row.type === 'phase' ? '.bcol[data-col="' + q + '"]' : '.kcard[data-id="' + q + '"]');
      if (target) {
        if (row.type === 'phase') target.classList.add('fresh');
        target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
      setTimeout(function () { if (freshId === id) freshId = null; }, 2200);
      return;
    }
    if (page !== 'list') return goToRow(id);
    var sel = '.lrow[data-id="' + q + '"]';
    if (!listBody.querySelector(sel)) clearFilters(); // it was filtered out
    freshId = id;
    renderList();
    var tr = listBody.querySelector(sel);
    if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(function () { if (freshId === id) freshId = null; }, 2200);
  }

  searchIn.addEventListener('input', runSearch);
  searchIn.addEventListener('focus', function () { if (searchIn.value.trim()) runSearch(); });
  searchIn.addEventListener('blur', function () { showResults(false); });
  searchIn.addEventListener('keydown', function (e) {
    var n = searchHits.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!searchRes.hidden) return showResults(false);
      searchIn.value = '';
      return searchIn.blur();
    }
    if (searchRes.hidden || !n) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      syncSearchSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goToItem(searchHits[searchSel].id);
    }
  });
  // mousedown, so the click lands before the box loses focus and the results close.
  searchRes.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var el = e.target.closest('.sr[data-id]');
    if (el) goToItem(el.getAttribute('data-id'));
  });
  searchRes.addEventListener('mousemove', function (e) {
    var el = e.target.closest('.sr');
    var i = Array.prototype.indexOf.call(searchRes.querySelectorAll('.sr'), el);
    if (el && i !== searchSel) {
      searchSel = i;
      syncSearchSel();
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && !dialog.open) {
      e.preventDefault();
      searchIn.focus();
      searchIn.select();
    }
  });

  // Copies of the plan as it is now, for a duplicate or a template: js/data.js rows become
  // ordinary saved rows so the copy stands on its own.
  function planCopy() {
    return JSON.parse(JSON.stringify({ rows: data.rows, deps: data.deps, people: data.people }));
  }

  function savedPlan(rows, deps, people) {
    return {
      sig: data.sig,
      planStart: PLAN_START,
      rows: rows.map(function (r) { r.added = true; return r; }),
      deps: deps,
      people: people
    };
  }

  function download(filename, type, text) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function fileBase() {
    return (project().name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project') + '-' + isoDate(TODAY);
  }

  // "2026-11-23 09:00", or just the date for an all-day value.
  function stamp(day) {
    return dateOf(day) + (day % 1 ? ' ' + timeOf(day) : '');
  }

  // Templates: a project's items saved to start new projects from. Progress is cleared, and
  // dates are kept relative to the first day so a new project starts from today.
  var templates;
  try { templates = JSON.parse(localStorage.getItem('roadmapTemplates')); } catch (e) {}
  if (!Array.isArray(templates)) templates = [];

  function saveTemplates() {
    try { localStorage.setItem('roadmapTemplates', JSON.stringify(templates)); } catch (e) {}
  }

  // Project switcher: click the project name to open another project, rename or delete
  // one, or start a new project, blank or from a template.
  var projBtn = document.querySelector('[data-project-btn]');
  var projPop = document.querySelector('[data-project-pop]');
  var projMode = null; // null for the list, or { kind: 'rename' | 'new', id, template }

  function renderProjBtn() {
    projBtn.textContent = project().name;
  }

  function renderProjPop() {
    var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
    if (projMode) {
      var m = projMode;
      var p = m.kind === 'rename' ? projects.filter(function (x) { return x.id === m.id; })[0] : null;
      var t = m.template ? templates.filter(function (x) { return x.id === m.template; })[0] : null;
      var title = m.kind === 'rename' ? 'Rename project' : t ? 'New project from ' + t.name : 'New project';
      var value = p ? p.name : t ? t.name : '';
      projPop.innerHTML = '<div class="tp-hd">' + esc(title) + '</div><div class="tp-body">' +
        '<input type="text" maxlength="60" placeholder="Project name" aria-label="Project name" value="' + esc(value) + '" data-proj-name>' +
        (t ? '<p class="tp-note">Its items start from today, with progress cleared.</p>' : '') +
        '<p class="tp-err" hidden data-proj-err></p></div>' +
        '<div class="tp-ft"><button class="btn" type="button" data-proj-back>Cancel</button><button class="primary" type="button" data-proj-save>' +
        (m.kind === 'rename' ? 'Save' : 'Create and open') + '</button></div>';
      projPop.querySelector('[data-proj-name]').select();
      return;
    }
    projPop.innerHTML = '<div class="tp-hd">Projects</div><div class="tp-body"><div class="tp-list" role="listbox" aria-label="Projects">' +
      projects.map(function (p) {
        var on = p.id === currentId;
        return '<div class="tp-row' + (on ? ' on' : '') + '"><button type="button" class="tp-pick" role="option" aria-selected="' + on + '" data-proj-open="' + esc(p.id) + '">' +
          '<span>' + esc(p.name) + '</span></button>' +
          '<button type="button" class="tp-edit" aria-label="Rename ' + esc(p.name) + '" title="Rename" data-proj-rename="' + esc(p.id) + '">' + PENCIL + '</button>' +
          (on ? '' : '<button type="button" class="tp-edit tp-del" aria-label="Delete ' + esc(p.name) + '" title="Delete project" data-proj-del="' + esc(p.id) + '">' + TRASH + '</button>') +
          '</div>';
      }).join('') + '</div>' +
      '<button type="button" class="tp-create" data-proj-new>+ New blank project</button>' +
      (templates.length ? '<div class="tp-sub">From a template</div><div class="tp-list">' + templates.map(function (t) {
        return '<div class="tp-row"><button type="button" class="tp-pick" data-proj-template="' + esc(t.id) + '"><span>' + esc(t.name) + '</span>' +
          '<em>' + itemsWord(t.rows.length) + '</em></button>' +
          '<button type="button" class="tp-edit tp-del" aria-label="Delete template ' + esc(t.name) + '" title="Delete template" data-template-del="' + esc(t.id) + '">' + TRASH + '</button></div>';
      }).join('') + '</div>' : '') +
      '</div>';
    var cur = projPop.querySelector('[aria-selected="true"]');
    if (cur) cur.focus();
  }

  function openProjPop(open) {
    projMode = null;
    projPop.hidden = !open;
    projBtn.setAttribute('aria-expanded', String(open));
    if (open) renderProjPop();
  }

  function saveProjName() {
    var input = projPop.querySelector('[data-proj-name]');
    var name = input.value.trim().replace(/\s+/g, ' ');
    var err = projPop.querySelector('[data-proj-err]');
    if (!name) {
      err.textContent = 'Give the project a name.';
      err.hidden = false;
      return input.focus();
    }
    if (projMode.kind === 'rename') {
      projects.filter(function (p) { return p.id === projMode.id; })[0].name = name;
      saveProjects();
      renderProjBtn();
      document.title = project().name;
      projMode = null;
      return renderProjPop();
    }
    var id = projectId(name);
    var t = projMode.template ? templates.filter(function (x) { return x.id === projMode.template; })[0] : null;
    if (t) {
      var copy = JSON.parse(JSON.stringify(t));
      var shift = (TODAY - PLAN_START) / DAY - t.day0; // the template's first day lands on today
      copy.rows.forEach(function (r) {
        ['start', 'end', 'day'].forEach(function (k) { if (r[k] != null) r[k] += shift; });
      });
      try { localStorage.setItem(planKey(id), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people))); } catch (e) {}
    }
    projects.push({ id: id, name: name, tags: t ? t.tags || (t.tag ? [t.tag] : []) : [] });
    saveProjects();
    openProject(id);
  }

  projBtn.addEventListener('click', function () { openProjPop(projPop.hidden); });
  projPop.addEventListener('click', function (e) {
    var t = e.target;
    var open = t.closest('[data-proj-open]');
    var rename = t.closest('[data-proj-rename]');
    var del = t.closest('[data-proj-del]');
    var tpl = t.closest('[data-proj-template]');
    var tplDel = t.closest('[data-template-del]');
    if (open) {
      var id = open.getAttribute('data-proj-open');
      if (id === currentId) return openProjPop(false);
      return openProject(id);
    }
    if (rename) projMode = { kind: 'rename', id: rename.getAttribute('data-proj-rename') };
    else if (t.closest('[data-proj-new]')) projMode = { kind: 'new' };
    else if (tpl) projMode = { kind: 'new', template: tpl.getAttribute('data-proj-template') };
    else if (t.closest('[data-proj-back]')) projMode = null;
    else if (t.closest('[data-proj-save]')) return saveProjName();
    else if (del || tplDel) {
      // Deleting asks once: the first click turns the button into a confirm.
      var btn = del || tplDel;
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.title = del ? 'Click again to delete this project and everything in it' : 'Click again to delete this template';
        return;
      }
      if (del) {
        var gone = del.getAttribute('data-proj-del');
        projects = projects.filter(function (p) { return p.id !== gone; });
        try { localStorage.removeItem(planKey(gone)); } catch (e) {}
        saveProjects();
      } else {
        var goneT = tplDel.getAttribute('data-template-del');
        templates = templates.filter(function (x) { return x.id !== goneT; });
        saveTemplates();
      }
    } else {
      return;
    }
    renderProjPop();
  });
  projPop.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (projMode) {
        projMode = null;
        return renderProjPop();
      }
      openProjPop(false);
      return projBtn.focus();
    }
    if (e.key === 'Enter' && e.target.matches('[data-proj-name]')) {
      e.preventDefault();
      saveProjName();
    }
  });
  document.addEventListener('pointerdown', function (e) {
    if (!projPop.hidden && !e.target.closest('.projwrap')) openProjPop(false);
  });
  renderProjBtn();

  // Actions: export the project (a spreadsheet, a full JSON copy, or print the page),
  // duplicate it, save it as a template, or reset it. Reset takes several deliberate steps.
  var actBtn = document.querySelector('[data-actions-btn]');
  var actMenu = document.querySelector('[data-actions-menu]');
  var actDialog = document.querySelector('[data-act-dialog]');
  var actForm = actDialog.querySelector('[data-act-form]');
  var actItems = Array.prototype.slice.call(actMenu.querySelectorAll('[data-act]'));

  function showActMenu(open) {
    actMenu.hidden = !open;
    actBtn.setAttribute('aria-expanded', String(open));
    if (open) actItems[0].focus();
  }

  function exportCsv() {
    var head = ['Name', 'Type', 'Phase', 'Subtask of', 'Start', 'Finish', 'Length', 'Progress', 'Status', 'Person', 'Depends on', 'Colour'];
    var lines = [head].concat(data.rows.map(function (r) {
      var parent = r.parent && rowIndex[r.parent] != null ? data.rows[rowIndex[r.parent]].name : '';
      var who = personById(r.person);
      var st = statusOf(r);
      var p = progressOf(r);
      var color = COLORS.filter(function (c) { return c[1] === r.color; })[0];
      return [
        r.name, r.type === 'task' ? (r.parent ? 'Subtask' : 'Task') : r.type === 'milestone' ? 'Milestone' : 'Phase',
        r.type === 'phase' ? '' : phaseName(r), parent, stamp(startDay(r)), r.end != null ? stamp(finishDay(r)) : '',
        r.end != null ? duration(r) : '', p == null ? '' : Math.round(p * 100) + '%', st === 'ms' ? 'Milestone' : STATUS[st],
        who ? who.name : '', depsOf(r).map(function (d) { return d.name; }).join('; '),
        r.type === 'task' ? (color ? color[0] : 'Blue') : ''
      ];
    })).map(function (cells) {
      return cells.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    });
    download(fileBase() + '.csv', 'text/csv;charset=utf-8', '﻿' + lines.join('\r\n')); // the BOM tells Excel it's UTF-8
  }

  function exportJson() {
    var copy = planCopy();
    var names = projectTags.map(tagById).filter(Boolean).map(function (t) { return t.name; });
    download(fileBase() + '.json', 'application/json', JSON.stringify({
      project: project().name,
      tags: names,
      exported: new Date().toISOString(),
      planStart: isoDate(PLAN_START),
      note: 'Days are counted from planStart; a fraction of a day is a time of day.',
      rows: copy.rows,
      deps: copy.deps,
      people: copy.people
    }, null, 2));
  }

  function duplicateProject() {
    var copy = planCopy();
    var name = project().name + ' (copy)';
    var id = projectId(name);
    try { localStorage.setItem(planKey(id), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people))); } catch (e) {}
    projects.push({ id: id, name: name, tags: projectTags.slice() });
    saveProjects();
    openProject(id);
  }

  // The small dialog: Save as template asks for a name; Reset asks you to tick that you
  // understand and to type the project's name before the button will work.
  function openTemplateDialog() {
    actForm.innerHTML = '<div class="dlg-hd"><h2 id="act-title">Save as template</h2></div><div class="dlg-body">' +
      '<label class="fld"><span class="fl">Template name</span><input type="text" maxlength="60" value="' + esc(project().name) + '" data-tpl-name></label>' +
      '<p class="act-note">Saves all ' + itemsWord(data.rows.length) + ', their dependencies and people. Progress is cleared, and dates move so a new project starts from the day it’s made.</p>' +
      '<p class="act-note" hidden data-tpl-replace></p></div>' +
      '<div class="dlg-ft"><button class="btn" type="button" data-act-close>Cancel</button><button class="primary" type="submit" data-tpl-save>Save template</button></div>';
    actDialog.showModal();
    var input = actForm.querySelector('[data-tpl-name]');
    var sync = function () {
      var same = templates.filter(function (t) { return t.name.toLowerCase() === input.value.trim().toLowerCase(); })[0];
      var note = actForm.querySelector('[data-tpl-replace]');
      note.hidden = !same;
      note.textContent = same ? 'There’s already a template called ' + same.name + '; this replaces it.' : '';
      actForm.querySelector('[data-tpl-save]').textContent = same ? 'Replace template' : 'Save template';
      actForm.querySelector('[data-tpl-save]').disabled = !input.value.trim();
    };
    input.addEventListener('input', sync);
    sync();
    input.select();
    actForm.onsubmit = function (e) {
      e.preventDefault();
      var name = input.value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      var copy = planCopy();
      copy.rows.forEach(function (r) { delete r.progress; });
      var day0 = copy.rows.length ? Math.floor(Math.min.apply(null, copy.rows.map(startDay))) : 0;
      var same = templates.filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
      var tpl = { id: same ? same.id : 'tpl-' + Date.now().toString(36), name: name, tags: projectTags.slice(), day0: day0, rows: copy.rows, deps: copy.deps, people: copy.people };
      templates = templates.filter(function (t) { return t !== same; }).concat([tpl]);
      saveTemplates();
      actDialog.close();
    };
  }

  function openResetDialog() {
    var name = project().name;
    var nRows = data.rows.length;
    actForm.innerHTML = '<div class="dlg-hd"><h2 id="act-title">Reset ' + esc(name) + '?</h2></div><div class="dlg-body">' +
      '<p class="act-warn">This removes all ' + itemsWord(nRows) + ' and ' + data.deps.length + (data.deps.length === 1 ? ' dependency' : ' dependencies') +
      ' from this project, leaving it empty. Its people, tag and your notes stay.</p>' +
      '<label class="chk"><input type="checkbox" data-reset-ok> I understand everything in this project will be removed</label>' +
      '<label class="fld"><span class="fl">Type <b>' + esc(name) + '</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-reset-name></label>' +
      '<p class="act-note">Changed your mind straight after? Undo (Ctrl+Z) brings it all back.</p></div>' +
      '<div class="dlg-ft"><button class="btn" type="button" data-act-close>Cancel</button><button class="btn del" type="submit" disabled data-reset-go>Reset project</button></div>';
    actDialog.showModal();
    var ok = actForm.querySelector('[data-reset-ok]');
    var typed = actForm.querySelector('[data-reset-name]');
    var go = actForm.querySelector('[data-reset-go]');
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
      if (go.disabled) return;
      data.rows = [];
      data.deps = [];
      closePeek();
      refresh();
      savePlan();
      actDialog.close();
    };
  }

  actBtn.addEventListener('click', function () { showActMenu(actMenu.hidden); });
  actMenu.addEventListener('click', function (e) {
    var item = e.target.closest('[data-act]');
    if (!item) return;
    showActMenu(false);
    var act = item.getAttribute('data-act');
    if (act === 'csv') exportCsv();
    else if (act === 'json') exportJson();
    else if (act === 'print') setTimeout(function () { window.print(); }, 50);
    else if (act === 'duplicate') duplicateProject();
    else if (act === 'template') openTemplateDialog();
    else if (act === 'reset') openResetDialog();
  });
  actMenu.addEventListener('keydown', function (e) {
    var i = actItems.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      showActMenu(false);
      actBtn.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      actItems[(i + (e.key === 'ArrowDown' ? 1 : actItems.length - 1)) % actItems.length].focus();
    }
  });
  document.addEventListener('click', function (e) {
    if (!actMenu.hidden && !e.target.closest('.actwrap')) showActMenu(false);
  });
  actDialog.addEventListener('click', function (e) {
    if (e.target === actDialog || e.target.closest('[data-act-close]')) actDialog.close();
  });

  // Notes: a personal checklist in a popup from the top bar, apart from the plan (not in
  // its undo, exports or templates). Add with Enter, tick to complete, click the text to
  // edit, drag to reorder; done notes collect in a folded "Done" list. The button shows
  // how many are still to do. Kept in this browser.
  var notesBtn = document.querySelector('[data-notes-btn]');
  var notesPop = document.querySelector('[data-notes-pop]');
  var notes;
  try { notes = JSON.parse(localStorage.getItem('roadmapNotes')); } catch (e) {}
  if (!Array.isArray(notes)) notes = [];
  var showDone = false;
  var editNote = null; // the note being edited
  var dragNote = null;

  function saveNotes() {
    try { localStorage.setItem('roadmapNotes', JSON.stringify(notes)); } catch (e) {}
    syncNotesBadge();
  }

  function syncNotesBadge() {
    var open = notes.filter(function (n) { return !n.done; }).length;
    var badge = notesBtn.querySelector('[data-notes-count]');
    badge.hidden = !open;
    badge.textContent = open;
    notesBtn.title = open ? open + ' note' + (open === 1 ? '' : 's') + ' to do' : 'Notes';
  }

  function noteHtml(n) {
    var text = editNote === n.id
      ? '<input type="text" class="ninput" maxlength="300" value="' + esc(n.text) + '" aria-label="Edit note" data-note-input>'
      : '<span class="ntext" tabindex="0" role="button" title="Click to edit" data-note-edit>' + esc(n.text) + '</span>';
    return '<li class="note' + (n.done ? ' done' : '') + '" data-note="' + esc(n.id) + '"' + (n.done || editNote === n.id ? '' : ' draggable="true"') + '>' +
      '<label class="nchk"><input type="checkbox"' + (n.done ? ' checked' : '') + ' aria-label="' + (n.done ? 'Mark as not done' : 'Mark as done') + '" data-note-done><span></span></label>' +
      text + '<button type="button" class="ndel" aria-label="Delete note" title="Delete" data-note-del>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></li>';
  }

  function renderNotes() {
    var open = notes.filter(function (n) { return !n.done; });
    var done = notes.filter(function (n) { return n.done; });
    var keep = notesPop.querySelector('[data-note-new]');
    var draft = keep ? keep.value : '';
    notesPop.innerHTML = '<div class="tp-hd notes-hd"><span>Notes</span><span class="nsum">' + (open.length ? open.length + ' to do' : notes.length ? 'All done' : '') + '</span></div>' +
      '<div class="nadd"><input type="text" maxlength="300" placeholder="Add a note and press Enter" aria-label="Add a note" data-note-new></div>' +
      '<ul class="nlist" data-note-list="open">' + (open.map(noteHtml).join('') || '<li class="nempty">' + (done.length ? 'Nothing left to do.' : 'Nothing here yet. Jot down things to do, chase or remember.') + '</li>') + '</ul>' +
      (done.length ? '<div class="ndone-hd"><button type="button" class="nfold" aria-expanded="' + showDone + '" data-note-fold>' +
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>Done (' + done.length + ')</button>' +
        '<button type="button" class="nclear" data-note-clear>Clear done</button></div>' +
        (showDone ? '<ul class="nlist">' + done.map(noteHtml).join('') + '</ul>' : '') : '');
    var add = notesPop.querySelector('[data-note-new]');
    add.value = draft;
    var editing = notesPop.querySelector('[data-note-input]');
    if (editing) {
      editing.focus();
      editing.setSelectionRange(editing.value.length, editing.value.length);
    }
  }

  function openNotes(open) {
    editNote = null;
    notesPop.hidden = !open;
    notesBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderNotes();
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

  notesBtn.addEventListener('click', function () { openNotes(notesPop.hidden); });
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
    try { e.dataTransfer.setData('text/plain', dragNote); } catch (err) {}
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
    if (!notesPop.hidden && !e.target.closest('.notewrap')) openNotes(false);
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== 'roadmapNotes') return;
    try { notes = JSON.parse(e.newValue) || []; } catch (err) { notes = []; }
    syncNotesBadge();
    if (!notesPop.hidden && !editNote) renderNotes();
  });
  syncNotesBadge();

  // Profile: the avatar at the bottom of the rail opens a popup about you (not the
  // project): your name, email and avatar colour (kept in this browser until there are
  // accounts), the theme, the keyboard shortcuts, and account actions that arrive with
  // accounts. Views: the main one, 'edit' for the profile form, 'keys' for shortcuts.
  var profBtn = document.querySelector('[data-profile-btn]');
  var profPop = document.querySelector('[data-profile-pop]');
  var profView = 'main';
  var me = { name: 'Louis Tucker', email: '', color: '#dfae2f' };
  try {
    var savedMe = JSON.parse(localStorage.getItem('roadmapProfile'));
    if (savedMe) Object.keys(me).forEach(function (k) { if (savedMe[k] != null) me[k] = savedMe[k]; });
  } catch (e) {}

  function saveMe() {
    try { localStorage.setItem('roadmapProfile', JSON.stringify(me)); } catch (e) {}
  }

  function renderProfBtn() {
    profBtn.textContent = initials(me.name || '?');
    profBtn.style.background = me.color;
    profBtn.title = (me.name || 'Your profile') + ' · your profile';
  }

  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
  var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

  function renderProfile() {
    var mod = MAC ? '⌘' : 'Ctrl';
    if (profView === 'edit') {
      profPop.innerHTML = '<div class="pf-hd"><button type="button" class="pf-back" aria-label="Back" data-pf-view="main">' + BACK + '</button>Edit profile</div>' +
        '<div class="pf-body">' +
        '<label class="sfld"><span class="fl">Display name</span><input type="text" maxlength="60" value="' + esc(me.name) + '" autocomplete="name" data-pf-name></label>' +
        // The email is the account's sign-in, so it's shown here but not edited.
        '<div class="sfld"><span class="fl">Email</span><div class="pf-email">' + (me.email ? esc(me.email) : 'Arrives with sign-in') + '</div>' +
        '<span class="pf-hint">Your sign-in email. It can’t be changed here.</span></div>' +
        '<div class="sfld"><span class="fl">Avatar colour</span><div class="pcolors" role="radiogroup" aria-label="Avatar colour">' + AVATAR_COLORS.map(function (c) {
          return '<label class="sw sm"><input type="radio" name="pfColor" value="' + c + '"' + (c === me.color ? ' checked' : '') + ' aria-label="Colour ' + c + '"><span style="background: ' + c + '"></span></label>';
        }).join('') + '</div></div>' +
        '<p class="tp-err" hidden data-pf-err></p></div>' +
        '<div class="tp-ft"><button class="btn" type="button" data-pf-view="main">Cancel</button><button class="primary" type="button" data-pf-save>Save</button></div>';
      profPop.querySelector('[data-pf-name]').focus();
      return;
    }
    if (profView === 'keys') {
      var keys = [
        [mod + ' Z', 'Undo'], [mod + ' Y', 'Redo (also ' + mod + ' Shift Z)'], [mod + ' F', 'Search'],
        ['N', 'New task'], ['T', 'Back to today (timeline, workload, calendar)'], ['Esc', 'Close a popup, or put back an item being moved'],
        ['↑ ↓ Enter', 'Pick a search result'], ['Enter', 'Open the selected row or card'],
        ['E', 'Edit the selected task list row'], ['Alt ↑ ↓', 'Move the selected task list row'],
        ['Hold, then drag', 'Move an item on the timeline']
      ];
      profPop.innerHTML = '<div class="pf-hd"><button type="button" class="pf-back" aria-label="Back" data-pf-view="main">' + BACK + '</button>Keyboard shortcuts</div>' +
        '<dl class="pf-keys">' + keys.map(function (k) {
          // Each key in its own cap; "Hold, then drag" is one step, so one cap.
          var caps = k[0].indexOf(',') >= 0 ? [k[0]] : k[0].split(' ');
          return '<dt>' + caps.map(function (x) { return '<kbd>' + esc(x) + '</kbd>'; }).join('') + '</dt><dd>' + esc(k[1]) + '</dd>';
        }).join('') + '</dl>';
      profPop.querySelector('.pf-back').focus();
      return;
    }
    var mode = themeMode();
    profPop.innerHTML = '<div class="pf-me">' +
      '<span class="pav pf-av" style="background: ' + esc(me.color) + '" aria-hidden="true">' + esc(initials(me.name || '?')) + '</span>' +
      '<div class="pf-who"><b>' + esc(me.name || 'Your name') + '</b><span>' + (me.email ? esc(me.email) : 'Not signed in') + '</span></div>' +
      '<button type="button" class="btn" data-pf-view="edit">Edit</button></div>' +
      '<div class="pf-sec"><span class="pf-lbl">Appearance</span><div class="bseg" role="group" aria-label="Theme">' +
      [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(function (o) {
        return '<button type="button" aria-pressed="' + (mode === o[0]) + '" data-pf-theme="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="pf-sec pf-links"><button type="button" class="pf-link" data-pf-view="keys">Keyboard shortcuts' + CHEV + '</button></div>' +
      '<div class="pf-sec pf-links"><span class="pf-lbl">Account <em>coming with sign-in</em></span>' +
      '<button type="button" class="pf-link" disabled title="Arrives with accounts">Change password</button>' +
      '<button type="button" class="pf-link" disabled title="Arrives with accounts">Sign out</button></div>' +
      '<div class="pf-ft">Workspace · everything is saved in this browser</div>';
    var first = profPop.querySelector('[data-pf-view="edit"]');
    if (first) first.focus();
  }

  // The popup sits in the middle of the screen (see .profpop), over a dimmed backdrop.
  var profBack = document.createElement('div');
  profBack.className = 'profback';
  profBack.hidden = true;
  profPop.parentNode.insertBefore(profBack, profPop);

  function openProfile(open) {
    profView = 'main';
    profPop.hidden = !open;
    profBack.hidden = !open;
    profBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderProfile();
    }
  }

  function saveProfileForm() {
    var name = profPop.querySelector('[data-pf-name]').value.trim().replace(/\s+/g, ' ');
    var err = profPop.querySelector('[data-pf-err]');
    if (!name) {
      err.textContent = 'Add your display name.';
      err.hidden = false;
      return;
    }
    var col = profPop.querySelector('[name="pfColor"]:checked');
    me = { name: name, email: me.email, color: col ? col.value : me.color };
    saveMe();
    renderProfBtn();
    profView = 'main';
    renderProfile();
  }

  profBtn.addEventListener('click', function () { openProfile(profPop.hidden); });
  profPop.addEventListener('click', function (e) {
    var view = e.target.closest('[data-pf-view]');
    var theme = e.target.closest('[data-pf-theme]');
    if (view) {
      profView = view.getAttribute('data-pf-view');
      renderProfile();
    } else if (theme) {
      setThemeMode(theme.getAttribute('data-pf-theme'));
      renderProfile();
    } else if (e.target.closest('[data-pf-save]')) {
      saveProfileForm();
    }
  });
  profPop.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (profView !== 'main') {
        profView = 'main';
        renderProfile();
        return;
      }
      openProfile(false);
      profBtn.focus();
    } else if (e.key === 'Enter' && profView === 'edit' && e.target.matches('input[type=text]')) {
      e.preventDefault();
      saveProfileForm();
    }
  });
  document.addEventListener('pointerdown', function (e) {
    if (!profPop.hidden && !profPop.contains(e.target) && !profBtn.contains(e.target)) openProfile(false);
  });

  // The rail's moon/sun changes the theme too; keep the popup's switch in step.
  toggle.addEventListener('click', function () { if (!profPop.hidden && profView === 'main') renderProfile(); });
  window.addEventListener('storage', function (e) {
    if (e.key !== 'roadmapProfile') return;
    try { me = JSON.parse(e.newValue) || me; } catch (err) {}
    renderProfBtn();
  });
  renderProfBtn();

  // Esc closes whatever popups and menus are open, wherever the focus is. A popup that
  // uses Esc itself first (stepping back a level, cancelling an edit) has already handled
  // it; the task form is a dialog the browser closes; Esc while moving an item puts it back.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented || move || document.querySelector('dialog[open]')) return;
    var closed = false;
    function shut(el, close) {
      if (el && !el.hidden) {
        close();
        closed = true;
      }
    }
    shut(profPop, function () { openProfile(false); });
    shut(notesPop, function () { openNotes(false); });
    shut(tagPop, function () { openTagPop(false); });
    shut(projPop, function () { openProjPop(false); });
    shut(actMenu, function () { showActMenu(false); });
    shut(colsMenu, function () { showColsMenu(false); });
    shut(showMenu, function () { showShowMenu(false); });
    shut(zoomMenu, function () { showZoomMenu(false); });
    shut(searchRes, function () { showResults(false); });
    shut(peek, closePeek);
    if (closed) {
      e.preventDefault();
      hideTip();
    }
  });

  // Tooltips: hovering (or tabbing to) anything with a title shows it in the app's own
  // small popup, and an icon-only button shows its aria-label. The title is set aside
  // while hovered so the browser's own tooltip never appears. After the first tip, moving
  // to the next thing shows its tip straight away. Nothing shows while a mouse button is
  // held (panning, moving or reordering).
  var TIP_SEL = '[title], [data-tip-title], button, .pp';
  var tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  var tipFor = null;   // the element the tip belongs to
  var tipX = null;     // where the mouse came in, for tips on wide things like bars
  var tipTimer = 0;
  var tipWarm = 0;     // until when the next tip shows without a delay

  function tipText(el) {
    var title = el.getAttribute('title') || el.getAttribute('data-tip-title');
    if (title) return title;
    var label = el.getAttribute('aria-label');
    // Only when the button shows no words of its own: an icon, or a symbol like − or 80%.
    return label && !/[a-z]{3}/i.test(el.textContent) ? label : '';
  }

  function placeTip() {
    if (!tipFor || !document.contains(tipFor)) return hideTip();
    var text = tipText(tipFor);
    if (!text) return hideTip();
    stashTitle(tipFor);
    // Inside the open form the tip has to live in the dialog to show above it.
    var host = tipFor.closest('dialog') || document.body;
    if (tipEl.parentNode !== host) host.appendChild(tipEl);
    tipEl.textContent = text;
    tipEl.hidden = false;
    var r = tipFor.getBoundingClientRect();
    var w = tipEl.offsetWidth;
    var h = tipEl.offsetHeight;
    if (tipFor.closest('.rail')) { // beside the rail's icons rather than over the next one
      tipEl.style.left = r.right + 6 + 'px';
      tipEl.style.top = r.top + r.height / 2 - h / 2 + 'px';
      return;
    }
    var below = r.bottom + 6 + h < window.innerHeight - 4;
    var cx = r.width > 160 && tipX != null ? tipX : r.left + r.width / 2;
    tipEl.style.left = Math.max(4, Math.min(cx - w / 2, window.innerWidth - w - 4)) + 'px';
    tipEl.style.top = (below ? r.bottom + 6 : r.top - 6 - h) + 'px';
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipEl.hidden) tipWarm = Date.now() + 500;
    tipEl.hidden = true;
    if (tipFor && tipFor.hasAttribute('data-tip-title')) {
      // Put the title back, unless the app gave the button a new one meanwhile.
      if (!tipFor.hasAttribute('title')) tipFor.setAttribute('title', tipFor.getAttribute('data-tip-title'));
      tipFor.removeAttribute('data-tip-title');
    }
    tipFor = null;
  }

  function stashTitle(el) {
    if (!el.hasAttribute('title')) return;
    el.setAttribute('data-tip-title', el.getAttribute('title'));
    el.removeAttribute('title');
  }

  // The nearest element from `el` up that has something to show.
  function tipTarget(el) {
    el = el && el.closest ? el.closest(TIP_SEL) : null;
    while (el && !tipText(el)) el = el.parentElement && el.parentElement.closest(TIP_SEL);
    return el;
  }

  function showTipFor(el) {
    if (el === tipFor) return;
    hideTip();
    tipFor = el;
    stashTitle(el); // straight away, before the browser's own tooltip can appear
    if (Date.now() < tipWarm) placeTip();
    else tipTimer = setTimeout(placeTip, 350);
  }

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;
    var el = e.buttons ? null : tipTarget(e.target);
    if (el && el !== tipFor) tipX = e.clientX;
    if (el) showTipFor(el);
    else if (tipFor) hideTip();
  });
  document.addEventListener('focusin', function (e) {
    var el = tipTarget(e.target);
    if (el && e.target.matches(':focus-visible')) {
      tipX = null;
      showTipFor(el);
    }
  });
  document.addEventListener('focusout', function (e) { if (tipFor && tipFor.contains(e.target)) hideTip(); });
  // A click can change a button's name (e.g. Dark mode → Light mode), so redraw the tip after it.
  document.addEventListener('click', function () {
    if (!tipFor) return;
    var el = tipFor;
    setTimeout(function () {
      if (el !== tipFor) return;
      if (el.hasAttribute('title')) el.removeAttribute('data-tip-title');
      if (!tipEl.hidden) placeTip();
    }, 0);
  });
  document.addEventListener('pointerdown', function (e) { if (tipFor && !tipFor.contains(e.target)) hideTip(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);

  // After changing window.ROADMAP, call roadmap.refresh() to redraw the plan and stats.
  // roadmap.reset() removes everything created with the New task form.
  window.roadmap = {
    refresh: refresh,
    reset: function () {
      try { localStorage.removeItem(planKey()); } catch (e) {}
      location.reload();
    }
  };

  // Start at today, or where this tab was before a refresh if it's still on the same view.
  var spot;
  try { spot = JSON.parse(sessionStorage.getItem('roadmapSpot')); } catch (e) {}
  if (spot && spot.scale === scaleKey() && isFinite(spot.time)) {
    recentre(spot.time);
    scroller.scrollLeft = xOf(spot.time);
    scroller.scrollTop = spot.top || 0;
    extend();
  } else {
    render();
    scroller.scrollLeft = xOf(home());
  }
  syncTodayArrow();
  syncZoom();
  syncScaleBtns();
  loadHistory();
})();
