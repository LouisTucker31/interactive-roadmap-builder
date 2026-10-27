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

  // Infinite horizontal timeline. The axis (months, weeks, month lines) is generated for a
  // window of weeks that grows whenever you scroll near either end; the plan block stays
  // pinned to PLAN_START. Dates are UTC so daylight-saving changes never shift a day.
  var DAY = 864e5;
  var WEEK = 7 * DAY;
  var PLAN_WEEKS = 16;                   // the plan spans 16 weeks

  // Monday of the current week: the plan starts here, so Today always lands on it.
  var PLAN_START = (function () {
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return today - (new Date(today).getUTCDay() + 6) % 7 * DAY;
  })();
  var MIN_WEEK_PX = 75;
  var CHUNK_WEEKS = 26;                  // weeks added each time an edge is reached
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var scroller = document.querySelector('.scroll');
  var chart = scroller.querySelector('.chart');
  var monthsEl = chart.querySelector('[data-months]');
  var weeksEl = chart.querySelector('[data-weeks]');
  var mlinesEl = chart.querySelector('[data-mlines]');
  var plan = chart.querySelector('[data-plan]');
  var todayBtn = chart.querySelector('[data-today]');

  // Zoom scales the timeline horizontally: 100% = 100px per week. 'fit' sizes the
  // plan's 16 weeks to the visible width and follows window resizes.
  var BASE_WEEK_PX = 100;
  var ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300];
  var zoomMode = 'fit';

  var rangeStart = PLAN_START - CHUNK_WEEKS * WEEK;
  var weekCount = PLAN_WEEKS + CHUNK_WEEKS * 2;
  var weekPx = weekPxFor(zoomMode);

  // The plan's 16 weeks fill the visible chart, but never narrower than 75px a week.
  function fitWeek() {
    return Math.max(MIN_WEEK_PX, scroller.clientWidth / PLAN_WEEKS);
  }

  function weekPxFor(mode) {
    return mode === 'fit' ? fitWeek() : mode / 100 * BASE_WEEK_PX;
  }

  function xOf(time) {
    return (time - rangeStart) / WEEK * weekPx;
  }

  function render() {
    var end = rangeStart + weekCount * WEEK;
    chart.style.setProperty('--week', weekPx + 'px');
    chart.style.width = weekCount * weekPx + 'px';

    // The current week (which starts at PLAN_START) gets a highlighted label.
    var weeks = '';
    for (var i = 0; i < weekCount; i++) {
      var t = rangeStart + i * WEEK;
      var w = new Date(t);
      var label = MONTHS[w.getUTCMonth()] + ' ' + w.getUTCDate();
      weeks += t === PLAN_START
        ? '<div class="week now" aria-current="date"><span>' + label + '</span></div>'
        : '<div class="week">' + label + '</div>';
    }
    weeksEl.innerHTML = weeks;

    var months = '';
    var lines = '<div class="nowline" style="left: ' + xOf(PLAN_START) + 'px"></div>';
    var first = new Date(rangeStart);
    var y = first.getUTCFullYear();
    var m = first.getUTCMonth();
    for (var start = Date.UTC(y, m, 1); start < end; start = Date.UTC(y, m, 1)) {
      var next = Date.UTC(y, m + 1, 1);
      var width = xOf(Math.min(next, end)) - xOf(Math.max(start, rangeStart));
      months += '<div class="month" style="width: ' + width + 'px">' + MONTHS[m].toUpperCase() + ' ' + y + '</div>';
      if (start > rangeStart) lines += '<div class="mline" style="left: ' + xOf(start) + 'px"></div>';
      if (++m === 12) { m = 0; y++; }
    }
    monthsEl.innerHTML = months;
    mlinesEl.innerHTML = lines;
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
        html += '<div class="bar ' + (row.parent ? 'lt' : 'dk') + '" style="left: ' + b.x1 + 'px; top: ' + b.top +
          'px; width: ' + (b.x2 - b.x1) + 'px' + fill + '" title="' +
          esc(row.name + ' · ' + dayLabel(row.start) + ' – ' + dayLabel(row.end - 1)) + '">' +
          '<span class="t">' + esc(row.name) + '</span>' +
          (owner ? '<span class="av" style="background: ' + owner.color + '">' + esc(row.owner) + '</span>' : '') +
          '</div>';
      }
    });
    plan.innerHTML = html;

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
      rangeStart -= CHUNK_WEEKS * WEEK;
      weekCount += CHUNK_WEEKS;
      render();
      scroller.scrollLeft += CHUNK_WEEKS * weekPx;
    }
    while (scroller.scrollLeft + view > scroller.scrollWidth - view) {
      weekCount += CHUNK_WEEKS;
      render();
    }
  }

  // Point the Today button's arrow towards the home view.
  function syncTodayArrow() {
    var label = scroller.scrollLeft < xOf(PLAN_START) - 1 ? 'Today →' : '← Today';
    if (todayBtn.textContent !== label) todayBtn.textContent = label;
  }

  // The wheel scrolls the timeline sideways; Shift + wheel scrolls up and down instead.
  scroller.addEventListener('wheel', function (e) {
    if (e.ctrlKey) return; // leave pinch / ctrl-zoom alone
    var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientWidth : 1;
    var delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    if (!delta) return;
    e.preventDefault();
    if (e.shiftKey) scroller.scrollTop += delta;
    else scroller.scrollLeft += delta;
  }, { passive: false });

  scroller.addEventListener('scroll', function () {
    extend();
    syncTodayArrow();
  }, { passive: true });

  todayBtn.addEventListener('click', function () {
    scroller.scrollTo({ left: xOf(PLAN_START), behavior: 'smooth' });
  });

  // Keep the same date at the left edge when the window is resized.
  window.addEventListener('resize', function () {
    var leftTime = rangeStart + scroller.scrollLeft / weekPx * WEEK;
    weekPx = weekPxFor(zoomMode);
    render();
    scroller.scrollLeft = xOf(leftTime);
    extend();
    syncZoom();
  });

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
    return weekPx / BASE_WEEK_PX * 100;
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

  // Fit jumps back to the plan; other zooms keep the date in the middle of the view fixed.
  function setZoom(mode) {
    var view = scroller.clientWidth;
    var centre = rangeStart + (scroller.scrollLeft + view / 2) / weekPx * WEEK;
    zoomMode = mode;
    weekPx = weekPxFor(mode);
    render();
    scroller.scrollLeft = mode === 'fit' ? xOf(PLAN_START) : xOf(centre) - view / 2;
    extend();
    syncTodayArrow();
    syncZoom();
  }

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
    }
  };

  render();
  scroller.scrollLeft = xOf(PLAN_START);
  syncTodayArrow();
  syncZoom();
})();
