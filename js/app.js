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
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    syncToggle();
  });

  syncToggle();

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
      case 'week': return startOf(t, 'day') - (d.getUTCDay() + 6) % 7 * DAY; // Monday
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

  // Monday of the current week: the plan starts here, so Today always lands on it.
  var PLAN_START = startOf(TODAY, 'week');

  // Views (H/D/W/M/Q/Y). Each has a column unit, a group unit for the row above, the column
  // width at 100% zoom, how many days "Fit to screen" shows, the narrowest column fit will
  // allow, and how many columns to add each time an edge is reached. Weekend shading only
  // shows in day and week views; the hour view shades the hours outside 8am–6pm instead.
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
  var ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300];
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
    chart.toggleAttribute('data-hours', scale.unit === 'hour');
    chart.style.setProperty('--day', 24 * HOUR / DAY * dayPx + 'px');

    // Columns; the one containing today gets a highlighted label and a line at its start
    // (in hour view, the line sits at the current minute).
    var now = nowCol();
    var cols = '';
    var lines = '';
    for (var t = rangeStart; t < rangeEnd; t = add(t, scale.unit, 1)) {
      var width = xOf(add(t, scale.unit, 1)) - xOf(t);
      var label = colLabel(t, width);
      cols += t === now
        ? '<div class="col now" style="width: ' + width + 'px" aria-current="date"><span>' + label + '</span></div>'
        : '<div class="col" style="width: ' + width + 'px">' + label + '</div>';
      // Day/week views divide the chart at month boundaries; coarser views at every column,
      // with a stronger line between days in hour view.
      if (t > rangeStart && !scale.shade) {
        lines += '<div class="mline' + (scale.unit === 'hour' && t % DAY === 0 ? ' day' : '') + '" style="left: ' + xOf(t) + 'px"></div>';
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
  var ROW_Y = 85;
  var ROW_PX = 34;
  var depsEl = chart.querySelector('[data-deps]');
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

  // When a row happens. A milestone is a single moment, and so is a task with no `end`
  // ("at 10:00"); a phase can have an optional `end`, and without one it runs until the next phase.
  function itemLabel(row) {
    if (row.type === 'milestone') return when(row.day);
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

  // Milestones and tasks without a finish are drawn as a mark at one moment, not a bar.
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
    var cy = ROW_Y + i * ROW_PX;
    if (isPoint(row)) {
      var x = dayX(row.type === 'milestone' ? row.day : row.start);
      return { x1: x - 6, x2: x + 6, cx: x, cy: cy, top: cy - 6 };
    }
    var h = row.parent ? 18 : 20;
    return { x1: dayX(row.start), x2: dayX(row.end), cy: cy, top: cy - h / 2 };
  }

  function renderPlan() {
    var html = '';
    data.rows.forEach(function (row, i) {
      var b = box(row, i);
      var tip = ' data-id="' + esc(row.id) + '" title="' + esc(row.name + ' · ' + itemLabel(row)) + '"';
      var state = (row.id === freshId ? ' fresh' : '') + (row.id === movingId ? ' moving' : '');
      if (row.type === 'phase') {
        // An open-ended phase's line runs the whole width; one with an end stops there.
        var span = row.end != null ? 'left: ' + b.x1 + 'px; width: ' + (b.x2 - b.x1) + 'px; ' : '';
        html += '<div class="pline" style="' + span + 'top: ' + (b.cy + 6) + 'px"></div>' +
          (row.end != null ? '<div class="pcap" style="left: ' + b.x2 + 'px; top: ' + (b.cy + 2) + 'px"></div>' : '') +
          '<div class="phase' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + (b.cy - 11) + 'px"><i></i>' + esc(row.name) + '</div>';
      } else if (row.type === 'milestone') {
        html += '<div class="dia' + state + '"' + tip + ' style="left: ' + b.x1 + 'px; top: ' + b.top + 'px"></div>';
      } else if (row.end == null) {
        // A task at a moment: a ring (filled with a tick once done) with its name beside it.
        html += '<div class="pt' + (row.parent ? ' lt' : '') + (row.progress >= 1 ? ' done' : '') + state + '"' + tip +
          ' style="left: ' + b.x1 + 'px; top: ' + (b.cy - 10) + 'px' + colorVar(row) + '"><i></i>' +
          '<span class="t">' + esc(row.name) + '</span></div>';
      } else {
        // Progress darkens the done part of the bar, whatever its colour.
        var fill = row.progress && !row.parent
          ? '; background-image: linear-gradient(90deg,rgba(0,0,0,.16) 0 ' + row.progress * 100 + '%,transparent ' + row.progress * 100 + '%)'
          : '';
        html += '<div class="bar ' + (row.parent ? 'lt' : 'dk') + (b.x2 - b.x1 < 30 ? ' tiny' : '') + state + '" data-id="' + esc(row.id) +
          '" style="left: ' + b.x1 + 'px; top: ' + b.top + 'px; width: ' + (b.x2 - b.x1) + 'px' + fill + colorVar(row) + '" title="' +
          esc(row.name + ' · ' + rangeLabel(row)) + '">' +
          '<span class="t">' + esc(row.name) + '</span></div>';
      }
    });
    plan.innerHTML = html;

    // Leave a screen of blank space below the last row so the chart can always scroll down.
    var lastRow = ROW_Y + data.rows.length * ROW_PX;
    chartBody.style.minHeight = Math.max(620, lastRow + scroller.clientHeight - 41 - 2 * ROW_PX) + 'px';

    // Each arrow leaves the end of `from` and drops onto the start of `to`.
    depsEl.innerHTML = data.deps.filter(function (dep) {
      return rowIndex[dep[0]] != null && rowIndex[dep[1]] != null;
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
  }

  // Footer counts come straight from the data, so they stay right as the plan changes.
  function renderStats() {
    var counts = {
      tasks: data.rows.filter(function (r) { return r.type === 'task'; }).length,
      milestones: data.rows.filter(function (r) { return r.type === 'milestone'; }).length,
      deps: data.deps.length
    };
    var words = { tasks: ['task', 'tasks'], milestones: ['milestone', 'milestones'], deps: ['dep', 'deps'] };
    Object.keys(counts).forEach(function (key) {
      var n = counts[key];
      document.querySelector('[data-stat="' + key + '"]').innerHTML = '<b>' + n + '</b> ' + words[key][n === 1 ? 0 : 1];
    });
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
    if (!data.rows.length) {
      taskRowsEl.innerHTML = '<div class="trow empty">Nothing here yet.&nbsp;<button type="button" data-empty-add>Add a task</button></div>';
      return;
    }
    // Clicking a row scrolls the chart to it; the ⋯ button that shows on hover edits it
    // (see the task form below).
    var more = '<button type="button" class="more" data-row-edit tabindex="-1" aria-label="Edit" title="Edit">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg></button>';
    taskRowsEl.innerHTML = data.rows.map(function (row) {
      var attrs = ' data-id="' + esc(row.id) + '" role="button" tabindex="0"';
      function tip(text) { return ' title="' + esc(text + ' · click to go to it, drag to reorder, E to edit') + '"'; }
      if (row.type === 'phase') {
        return '<div class="trow ph"' + attrs + tip(row.name + ' · ' + itemLabel(row)) + '><i class="ic"></i><span class="tn">' + esc(row.name) + '</span>' + more + '</div>';
      }
      if (row.type === 'milestone') {
        return '<div class="trow ms"' + attrs + tip(row.name + ' · ' + itemLabel(row)) + '><i class="ic"></i>' +
          '<span class="tn">' + esc(row.name) + '</span><span class="meta">' + itemLabel(row) + '</span>' + more + '</div>';
      }
      return '<div class="trow ' + (row.parent ? 'sub' : 'top') + '"' + attrs + tip(row.name + ' · ' + itemLabel(row)) +
        '><i class="ic"' + (row.color ? ' style="' + colorVar(row).slice(2) + '"' : '') + '></i>' +
        '<span class="tn">' + esc(row.name) + '</span>' +
        (row.progress ? '<span class="meta">' + Math.round(row.progress * 100) + '%</span>'
          : row.end == null ? '<span class="meta">' + itemLabel(row) + '</span>' : '') +
        more + '</div>';
    }).join('') +
      // The empty row after the last one adds a new task; it only shows itself on hover.
      '<div class="trow add" role="button" tabindex="0" title="Add a task" data-add-row><i class="ic"></i><span class="tn">New task</span></div>';
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
    data.sig = sig;
    var saved;
    try { saved = JSON.parse(localStorage.getItem('roadmapPlan')); } catch (e) {}
    if (!saved || saved.sig !== sig) return;
    var shift = (saved.planStart - PLAN_START) / DAY;
    data.rows = saved.rows.map(function (r) {
      if (r.base != null) return base[r.base];
      if (r.type === 'milestone') delete r.end; // briefly allowed; milestones are single moments
      delete r.owner; // tasks used to have owners; they have colours now
      ['start', 'end', 'day'].forEach(function (k) { if (r[k] != null) r[k] += shift; });
      return r;
    }).filter(Boolean);
    data.deps = saved.deps;
  }

  function savePlan() {
    var plan = {
      sig: data.sig,
      planStart: PLAN_START,
      rows: data.rows.map(function (r) {
        var i = data.base.indexOf(r);
        return i >= 0 ? { base: i } : r;
      }),
      deps: data.deps
    };
    try { localStorage.setItem('roadmapPlan', JSON.stringify(plan)); } catch (e) {}
  }

  function reindex() {
    rowIndex = {};
    data.rows.forEach(function (row, i) {
      if (!row.id) row.id = uniqueId(row.name); // every row needs an id to be edited
      rowIndex[row.id] = i;
    });
  }

  function refresh() {
    reindex();
    renderPlan();
    renderTaskList();
    syncPanelScroll();
  }

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
  var defaultEnd = {}; // the finish a new task starts with
  var formTypeShown = 'task'; // the type the form last showed fields for

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
    // A task's or phase's finish is optional (a task without one happens at a moment) and
    // a milestone has none. A new row starts with no end when switched to a phase, and
    // gets its default back when switched to a task.
    if (!editing && type !== formTypeShown) {
      if (type !== 'task') form.elements.endDate.value = '';
      else if (!form.elements.endDate.value) {
        form.elements.endDate.value = defaultEnd.date;
        form.elements.endTime.value = defaultEnd.time;
      }
    }
    formTypeShown = type;
    form.querySelector('[data-start-label]').textContent = type === 'task' ? 'Start' : type === 'milestone' ? 'Date' : 'Starts';
    form.querySelector('[data-end-label]').innerHTML = (type === 'task' ? 'Finish' : 'Ends') + ' <em>optional</em>';
    form.querySelector('[data-end-clear]').hidden = !form.elements.endDate.value;
    form.querySelector('[data-nt-title]').textContent = (editing ? 'Edit ' : 'New ') + word;
    form.querySelector('[data-nt-submit]').textContent = editing ? 'Save changes' : 'Create ' + word;
    // A subtask sits under its parent, so its phase comes from there.
    form.elements.phase.disabled = type === 'task' && !!form.elements.parent.value;
    form.querySelector('[data-progress-out]').textContent = form.elements.progress.value + '%';
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
      data.deps.forEach(function (dep) {
        if (dep[1] !== row.id) return;
        var box = form.querySelector('[name="deps"][value="' + dep[0] + '"]');
        if (box) box.checked = true;
      });
    } else if (spot && scale.unit !== 'hour') {
      // A clicked day: just that day in day view, otherwise five days from it.
      f.startDate.value = isoDate(spot.time);
      f.endDate.value = isoDate(spot.time + (scale.unit === 'day' ? 0 : 4 * DAY));
    } else if (scale.unit === 'hour') {
      // Hour view: a one-hour slot from the clicked time, or starting on the next hour after
      // now, or a quarter of the way into the view when now is off screen.
      var left = timeAt(scroller.scrollLeft);
      var right = timeAt(scroller.scrollLeft + scroller.clientWidth);
      var t = spot ? spot.time : NOW >= left && NOW < right ? startOf(NOW, 'hour') + HOUR : startOf((3 * left + right) / 4, 'hour');
      f.allDay.checked = false;
      f.startDate.value = isoDate(t);
      f.startTime.value = clockOf(t);
      f.endDate.value = isoDate(t + HOUR);
      f.endTime.value = clockOf(t + HOUR);
    } else {
      // Start on the date at the left of the view if today is off screen, otherwise today.
      var leftDay = startOf(timeAt(scroller.scrollLeft), 'day');
      var rightDay = timeAt(scroller.scrollLeft + scroller.clientWidth);
      var day = TODAY >= leftDay && TODAY < rightDay ? TODAY : leftDay;
      f.startDate.value = isoDate(day);
      f.endDate.value = isoDate(day + 4 * DAY);
    }
    defaultEnd = { date: f.endDate.value, time: f.endTime.value };
    formTypeShown = 'task';
    errEl.hidden = true;
    syncForm();
    dialog.showModal();
    f.name.focus();
    if (editing) f.name.select();
  }

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
    if (type !== 'milestone' && f.endDate.value) {
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
    setTimeout(function () { if (freshId === row.id) freshId = null; }, 1600);
  }

  newBtn.addEventListener('click', function () { openForm(); });
  deleteBtn.addEventListener('click', deleteRow);

  // Click a row in the task list to scroll the chart to it (Enter or Space when it has
  // focus); its ⋯ button, shown on hover, opens it for editing (E from the keyboard).
  // The empty task list has its own "Add a task" link, and the blank row under the last
  // one adds a task too.
  function goToRow(id) {
    var i = rowIndex[id];
    if (i != null) reveal(data.rows[i], i, true);
  }

  taskRowsEl.addEventListener('click', function (e) {
    if (sorted) {
      sorted = false;
      return;
    }
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
    if (!hit || !chartBody.contains(hit) || hit.closest('button, .plan [data-id]')) return null;
    var r = chartBody.getBoundingClientRect();
    var t = timeAt(clientX - r.left);
    t = scale.unit === 'hour' ? Math.floor(t / (HOUR / 4)) * HOUR / 4 : startOf(t, 'day');
    var y = clientY - r.top;
    var row = data.rows[Math.floor((y - ROW_Y) / ROW_PX + 0.5)];
    var phase = !row ? null : row.type === 'phase' ? row.id : phaseOf(row.parent ? data.rows[rowIndex[row.parent]] : row);
    return { time: t, phase: phase, y: y };
  }

  scroller.addEventListener('pointermove', function (e) {
    if (move) return;
    var spot = e.pointerType === 'mouse' && !drag && spotAt(e.clientX, e.clientY);
    ghost.hidden = !spot;
    if (!spot) return;
    ghost.style.left = xOf(spot.time) + 'px';
    ghost.firstChild.style.top = spot.y + 'px';
    ghost.firstChild.textContent = '+ ' + (scale.unit === 'hour' ? clockOf(spot.time) : dayLabel((spot.time - PLAN_START) / DAY));
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

  // Item details popup: what a clicked bar, milestone or phase is, when it happens, who
  // owns it, what it depends on and what's waiting on it, with an Edit button to change
  // it. It sits just below the item (above it near the bottom of the screen) and closes
  // with Esc, the ×, a click elsewhere or scrolling the chart.
  var peek = document.querySelector('[data-peek]');
  var peekId = null;

  // "5 days" for all-day rows; "1d 2h 30m" style for timed ones.
  function duration(row) {
    var mins = Math.round((row.end - row.start) * 1440);
    if (!(row.start % 1) && !(row.end % 1)) return mins / 1440 + (mins === 1440 ? ' day' : ' days');
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
    if (row.type !== 'milestone' && row.end != null) items.push(['Length', duration(row)]);
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

  // After changing window.ROADMAP, call roadmap.refresh() to redraw the plan and stats.
  // roadmap.reset() removes everything created with the New task form.
  window.roadmap = {
    refresh: refresh,
    reset: function () {
      try { localStorage.removeItem('roadmapPlan'); } catch (e) {}
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
})();
