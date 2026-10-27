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

  var rangeStart = PLAN_START - CHUNK_WEEKS * WEEK;
  var weekCount = PLAN_WEEKS + CHUNK_WEEKS * 2;
  var weekPx = fitWeek();

  // The plan's 16 weeks fill the visible chart, but never narrower than 75px a week.
  function fitWeek() {
    return Math.max(MIN_WEEK_PX, scroller.clientWidth / PLAN_WEEKS);
  }

  function xOf(time) {
    return (time - rangeStart) / WEEK * weekPx;
  }

  function render() {
    var end = rangeStart + weekCount * WEEK;
    chart.style.setProperty('--week', weekPx + 'px');
    chart.style.width = weekCount * weekPx + 'px';
    plan.style.left = xOf(PLAN_START) + 'px';
    plan.style.width = PLAN_WEEKS * weekPx + 'px';

    var weeks = '';
    for (var i = 0; i < weekCount; i++) {
      var w = new Date(rangeStart + i * WEEK);
      weeks += '<div class="week">' + MONTHS[w.getUTCMonth()] + ' ' + w.getUTCDate() + '</div>';
    }
    weeksEl.innerHTML = weeks;

    var months = '';
    var lines = '';
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
  }

  // Grow the timeline by a chunk when the view gets within one screen of either end.
  // Prepending shifts everything right, so scrollLeft moves by the same amount to stay put.
  function extend() {
    var view = scroller.clientWidth;
    if (scroller.scrollLeft < view) {
      rangeStart -= CHUNK_WEEKS * WEEK;
      weekCount += CHUNK_WEEKS;
      render();
      scroller.scrollLeft += CHUNK_WEEKS * weekPx;
    } else if (scroller.scrollLeft + view > scroller.scrollWidth - view) {
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
    weekPx = fitWeek();
    render();
    scroller.scrollLeft = xOf(leftTime);
  });

  render();
  scroller.scrollLeft = xOf(PLAN_START);
  syncTodayArrow();
})();
