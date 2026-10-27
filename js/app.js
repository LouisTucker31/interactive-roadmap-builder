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

  var TODAY = (function () {
    var now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  })();

  // Calendar maths on UTC timestamps. add() expects `t` to already be a unit start.
  function startOf(t, unit) {
    var d = new Date(t);
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth();
    switch (unit) {
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

  // Views (D/W/M/Q/Y). Each has a column unit, a group unit for the row above, the column
  // width at 100% zoom, how many days "Fit to screen" shows, the narrowest column fit will
  // allow, and how many columns to add each time an edge is reached. Weekend shading only
  // shows in day and week views. Day view chunks are whole weeks so shading stays aligned.
  var SCALES = {
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

  var rangeStart = add(home(), scale.unit, -scale.chunk);
  var rangeEnd = add(home(), scale.unit, 2 * scale.chunk);
  var dayPx = dayPxFor(zoomMode);

  // Where Today scrolls to: one column before the current one, so yesterday / last week /
  // last month / last quarter shows first and the current period second. Year view starts
  // on the current year.
  function home() {
    var now = startOf(TODAY, scale.unit);
    return scale.unit === 'year' ? now : add(now, scale.unit, -1);
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
      case 'day': return (width >= 52 ? WEEKDAYS[d.getUTCDay()] + ' ' : '') + d.getUTCDate();
      case 'week': return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
      case 'month': return MONTHS[d.getUTCMonth()];
      case 'quarter': return 'Q' + (d.getUTCMonth() / 3 + 1);
      case 'year': return String(d.getUTCFullYear());
    }
  }

  function groupLabel(t) {
    var d = new Date(t);
    if (scale.group === 'month') return MONTHS[d.getUTCMonth()].toUpperCase() + ' ' + d.getUTCFullYear();
    if (scale.group === 'decade') return d.getUTCFullYear() + 's';
    return String(d.getUTCFullYear());
  }

  function render() {
    chart.style.setProperty('--week', 7 * dayPx + 'px');
    chart.style.setProperty('--dock-x', (scale.unit === 'week' ? 7 * dayPx * 37 / 75 : 24) + 'px');
    chart.style.width = xOf(rangeEnd) + 'px';
    chart.toggleAttribute('data-noshade', !scale.shade);

    // Columns; the one containing today gets a highlighted label and a line at its start.
    var now = startOf(TODAY, scale.unit);
    var cols = '';
    var lines = '';
    for (var t = rangeStart; t < rangeEnd; t = add(t, scale.unit, 1)) {
      var width = xOf(add(t, scale.unit, 1)) - xOf(t);
      var label = colLabel(t, width);
      cols += t === now
        ? '<div class="col now" style="width: ' + width + 'px" aria-current="date"><span>' + label + '</span></div>'
        : '<div class="col" style="width: ' + width + 'px">' + label + '</div>';
      // Day/week views divide the chart at month boundaries; coarser views at every column.
      if (t > rangeStart && !scale.shade) lines += '<div class="mline" style="left: ' + xOf(t) + 'px"></div>';
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
    mlinesEl.innerHTML = lines + '<div class="nowline" style="left: ' + xOf(now) + 'px"></div>';
    renderPlan();
  }

  // Plan rows (tasks, milestones, phase headers), dependency arrows and footer stats,
  // all drawn from js/data.js. Rows sit on a 33.6px grid starting at ROW_Y (row centre).
  var data = window.ROADMAP;
  var ROW_Y = 85;
  var ROW_PX = 33.6;
  var depsEl = chart.querySelector('[data-deps]');
  var rowIndex = {};
  data.rows.forEach(function (row, i) { if (row.id) rowIndex[row.id] = i; });

  function dayX(day) {
    return xOf(PLAN_START + day * DAY);
  }

  function dayLabel(day) {
    var d = new Date(PLAN_START + day * DAY);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Where a row's shape sits: horizontal extent, vertical centre and top edge.
  function box(row, i) {
    var cy = ROW_Y + i * ROW_PX;
    if (row.type === 'milestone') {
      var x = dayX(row.day);
      return { x1: x - 6, x2: x + 6, cx: x, cy: cy, top: cy - 6 };
    }
    var h = row.parent ? 18 : 20;
    return { x1: dayX(row.start), x2: dayX(row.end), cy: cy, top: cy - h / 2 };
  }

  function renderPlan() {
    var html = '';
    data.rows.forEach(function (row, i) {
      var b = box(row, i);
      if (row.type === 'phase') {
        html += '<div class="pline" style="top: ' + (b.cy + 6) + 'px"></div>' +
          '<div class="phase" style="left: ' + dayX(row.start) + 'px; top: ' + (b.cy - 11) + 'px"><i></i>' + esc(row.name) + '</div>';
      } else if (row.type === 'milestone') {
        html += '<div class="dia" style="left: ' + b.x1 + 'px; top: ' + b.top + 'px" title="' +
          esc(row.name + ' · ' + dayLabel(row.day)) + '"></div>';
      } else {
        var owner = data.people[row.owner];
        var fill = row.progress && !row.parent
          ? '; background: linear-gradient(90deg,#367f9c 0 ' + row.progress * 100 + '%,#4a95b2 ' + row.progress * 100 + '%)'
          : '';
        html += '<div class="bar ' + (row.parent ? 'lt' : 'dk') + (b.x2 - b.x1 < 30 ? ' tiny' : '') + '" style="left: ' + b.x1 + 'px; top: ' + b.top +
          'px; width: ' + (b.x2 - b.x1) + 'px' + fill + '" title="' +
          esc(row.name + ' · ' + dayLabel(row.start) + ' – ' + dayLabel(row.end - 1)) + '">' +
          '<span class="t">' + esc(row.name) + '</span>' +
          (owner ? '<span class="av" style="background: ' + owner.color + '">' + esc(row.owner) + '</span>' : '') +
          '</div>';
      }
    });
    plan.innerHTML = html;

    // Leave a screen of blank space below the last row so the chart can always scroll down.
    var lastRow = ROW_Y + data.rows.length * ROW_PX;
    chartBody.style.minHeight = Math.max(620, lastRow + scroller.clientHeight - 41 - 2 * ROW_PX) + 'px';

    // Each arrow leaves the end of `from` and drops onto the start of `to`.
    depsEl.innerHTML = data.deps.map(function (dep) {
      var fi = rowIndex[dep[0]];
      var ti = rowIndex[dep[1]];
      var from = box(data.rows[fi], fi);
      var to = box(data.rows[ti], ti);
      var fx = data.rows[fi].type === 'milestone' ? from.cx + 7 : from.x2;
      var tx = data.rows[ti].type === 'milestone' ? to.cx : to.x1 + 5;
      var ty = data.rows[ti].type === 'milestone' ? to.cy - 10 : to.top - 2;
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

  // Point the Today button's arrow towards the home view.
  function syncTodayArrow() {
    var label = scroller.scrollLeft < xOf(home()) - 1 ? 'Today →' : '← Today';
    if (todayBtn.textContent !== label) todayBtn.textContent = label;
  }

  // Drag to pan: hold the left mouse button and drag to move the chart freely in any
  // direction, diagonals included. Let go mid-drag and it keeps gliding, slowing to a stop
  // like a map. Touch screens already pan (and fling) natively. Buttons such as Today still
  // click, and grabbing the scrollbar still works normally.
  var FRICTION = 0.995;  // glide speed kept per millisecond
  var drag = null;
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
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
    var r = scroller.getBoundingClientRect();
    if (e.clientX - r.left >= scroller.clientWidth || e.clientY - r.top >= scroller.clientHeight) return;
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, trail: [] };
    try { scroller.setPointerCapture(e.pointerId); } catch (err) {}
    scroller.classList.add('dragging');
    e.preventDefault(); // don't start a text selection
  });

  scroller.addEventListener('pointermove', function (e) {
    if (!drag) return;
    scroller.scrollLeft = drag.left - (e.clientX - drag.x);
    scroller.scrollTop = drag.top - (e.clientY - drag.y);
    // Keep the last 100ms of movement to work out the release speed.
    var now = e.timeStamp || performance.now();
    drag.trail.push({ t: now, x: e.clientX, y: e.clientY });
    while (drag.trail.length > 2 && now - drag.trail[0].t > 100) drag.trail.shift();
  });

  function endDrag(e) {
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
  }, { passive: true });

  todayBtn.addEventListener('click', function () {
    stopGlide();
    scroller.scrollTo({ left: xOf(home()), behavior: 'smooth' });
  });

  // Keep the same date at the left edge when the window is resized.
  // Watches the chart area itself, so it also catches the task panel opening or closing.
  function onResize() {
    var leftTime = timeAt(scroller.scrollLeft);
    dayPx = dayPxFor(zoomMode);
    render();
    scroller.scrollLeft = xOf(leftTime);
    extend();
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
    taskRowsEl.innerHTML = data.rows.map(function (row) {
      if (row.type === 'phase') {
        return '<div class="trow ph"><i class="ic"></i><span class="tn">' + esc(row.name) + '</span></div>';
      }
      if (row.type === 'milestone') {
        return '<div class="trow ms" title="' + esc(row.name + ' · ' + dayLabel(row.day)) + '"><i class="ic"></i>' +
          '<span class="tn">' + esc(row.name) + '</span><span class="meta">' + dayLabel(row.day) + '</span></div>';
      }
      var owner = data.people[row.owner];
      return '<div class="trow ' + (row.parent ? 'sub' : 'top') + '" title="' +
        esc(row.name + ' · ' + dayLabel(row.start) + ' – ' + dayLabel(row.end - 1)) + '"><i class="ic"></i>' +
        '<span class="tn">' + esc(row.name) + '</span>' +
        (row.progress ? '<span class="meta">' + Math.round(row.progress * 100) + '%</span>' : '') +
        (owner ? '<span class="av" style="background: ' + owner.color + '">' + esc(row.owner) + '</span>' : '') +
        '</div>';
    }).join('');
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
  }

  // View switcher (D/W/M/Q/Y). Switching fits the new view to the screen. From a view's
  // home position you land on the new view's home; otherwise it starts at the column
  // containing the date at the left edge. The range is rebuilt around that column.
  var scaleBtns = Array.prototype.slice.call(document.querySelectorAll('[data-scale]'));

  function setScale(key) {
    var leftTime = timeAt(scroller.scrollLeft);
    var atHome = Math.abs(scroller.scrollLeft - xOf(home())) < 2;
    scale = SCALES[key];
    zoomMode = 'fit';
    dayPx = dayPxFor(zoomMode);
    var anchor = atHome ? home() : startOf(leftTime, scale.unit);
    rangeStart = add(startOf(anchor, scale.unit === 'day' ? 'week' : scale.unit), scale.unit, -scale.chunk);
    rangeEnd = add(anchor, scale.unit, scale.chunk);
    render();
    scroller.scrollLeft = xOf(anchor);
    extend();
    syncTodayArrow();
    syncZoom();
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

  // After changing window.ROADMAP, call roadmap.refresh() to redraw the plan and stats.
  window.roadmap = {
    refresh: function () {
      rowIndex = {};
      data.rows.forEach(function (row, i) { if (row.id) rowIndex[row.id] = i; });
      renderPlan();
      renderTaskList();
    }
  };

  render();
  scroller.scrollLeft = xOf(home());
  syncTodayArrow();
  syncZoom();
})();
