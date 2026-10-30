// Moving around the timeline: panning, scrolling, zoom, the view switcher, full screen, and the task list panel beside it.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

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
    return '<span class="avatar" style="background: ' + safeColor(p.color, AVATAR_COLORS[0]) + '" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>';
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
  try { scroller.setPointerCapture(e.pointerId); } catch (err) { /* the pointer has already gone */ }
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
  if (move) return moveItemTo(e.clientX);
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
  if (app && app.classList.contains('on-home')) return; // hidden on Workspace: don't record its reset position
  extend();
  syncTodayArrow();
  syncPanelScroll();
  saveSpot();
  if (move && move.lastX != null) moveItemTo(move.lastX); // keep a moving item under the mouse
}, { passive: true });

todayBtn.addEventListener('click', function () {
  scrollToTime(home(), 0);
});

// Keep the same date at the left edge when the window is resized.
// Watches the chart area itself, so it also catches the task panel opening or closing. It starts
// in start.js: its first call comes straight away and redraws, which needs every file loaded.
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

// Task list panel: one row per plan row, lined up with the chart and following its
// vertical scroll. The arrow opens and closes it; the choice is remembered per browser.
var panel = document.querySelector('[data-panel]');
var panelToggle = panel.querySelector('[data-panel-toggle]');
var taskRowsEl = panel.querySelector('[data-task-rows]');
var chartBody = chart.querySelector('.body');

function renderTaskList() {
  if (workload) return renderPeopleList();
  if (!data.rows.length) {
    taskRowsEl.innerHTML = '<div class="task-row empty">Nothing here yet.&nbsp;<button type="button" data-empty-add>Add a task</button></div>';
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
      return '<div class="task-row ph"' + attrs + (row.color ? ' style="' + colorVar(row).slice(2) + '"' : '') + tip(row.name + ' · ' + itemLabel(row)) + '><i class="row-icon"></i><span class="row-name">' + esc(row.name) + '</span>' + more + '</div>';
    }
    if (row.type === 'milestone') {
      return '<div class="task-row ms"' + attrs + tip(row.name + ' · ' + itemLabel(row)) + '><i class="row-icon"></i>' +
        '<span class="row-name">' + esc(row.name) + '</span>' + more + '</div>';
    }
    return '<div class="task-row ' + (row.parent ? 'sub' : 'top') + '"' + attrs + tip(row.name + ' · ' + itemLabel(row)) +
      '><i class="row-icon"' + (row.color ? ' style="' + colorVar(row).slice(2) + '"' : '') + '></i>' +
      '<span class="row-name">' + esc(row.name) + '</span>' +
      (row.progress ? '<span class="meta">' + Math.round(row.progress * 100) + '%</span>' : '') +
      more + '</div>';
  }).join('') +
    // The empty row after the last one adds a new task; it only shows itself on hover.
    '<div class="task-row add" role="button" tabindex="0" title="Add a task" data-add-row><i class="row-icon"></i><span class="row-name">New task</span></div>';
}

// Workload: the panel lists people, each as tall as their lanes, with how many items they
// have and any overload. Clicking one goes to their first item.
function renderPeopleList() {
  if (!wl) wl = workloadLayout();
  var overloaded = wl.blocks.filter(function (bk) { return bk.overDays > 0; }).length;
  panel.querySelector('.task-panel-title').textContent = 'People' + (overloaded ? ' · ' + overloaded + ' overloaded' : '');
  taskRowsEl.innerHTML = wl.blocks.map(function (bk) {
    var n = bk.rows.length;
    var state = bk.overDays > 0 ? 'over' : n ? 'ok' : 'idle';
    var sub = n ? n + (n === 1 ? ' item' : ' items') : 'Nothing assigned';
    if (bk.overDays > 0) sub += ' · ' + duration({ start: 0, end: bk.overDays }) + ' overlap';
    var face = bk.p ? avatar(bk.p) : '<span class="person-avatar none" aria-hidden="true"></span>';
    var name = bk.p ? bk.p.name : 'Unassigned';
    var tip = state === 'over' ? 'More than one task at once for ' + duration({ start: 0, end: bk.overDays })
      : state === 'ok' ? 'No overlapping work' : 'No work assigned';
    return '<div class="task-row workload-person' + (bk.p ? '' : ' none') + '" role="button" tabindex="0" data-person="' + esc(bk.id) + '" style="height: ' + bk.lanes * ROW_PX + 'px' +
      (bk.p ? '; --c: ' + safeColor(bk.p.color, AVATAR_COLORS[0]) : '') + '" title="' +
      esc(name + ' · ' + sub + ' · click to go to their first item') + '">' + face +
      '<span class="workload-who"><span class="row-name">' + esc(name) + '</span><span class="workload-sub">' + esc(sub) + '</span></span>' +
      '<i class="workload-dot ' + state + '" title="' + tip + '"></i></div>';
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
  localStore.set(STORE.taskPanel, open ? 'open' : 'closed');
}

panelToggle.addEventListener('click', function () {
  setPanel(!panel.classList.contains('open'));
});

// Scrolling over the list scrolls the chart with it (both share one scroll position).
panel.querySelector('.task-panel-body').addEventListener('wheel', function (e) {
  e.preventDefault();
  var unit = e.deltaMode === 1 ? 16 : 1;
  stopGlide();
  scroller.scrollTop += e.deltaY * unit;
  scroller.scrollLeft += e.deltaX * unit;
}, { passive: false });

renderTaskList();
if (localStore.get(STORE.taskPanel) === 'open') setPanel(true);

// Zoom controls: −/+ step through ZOOM_STEPS, the % label opens a menu of set zooms.
var zoomOut = document.querySelector('[data-zoom-out]');
var zoomIn = document.querySelector('[data-zoom-in]');
var zoomLabel = document.querySelector('[data-zoom-label]');
var zoomMenu = document.querySelector('[data-zoom-menu]');

zoomMenu.innerHTML =
  '<button type="button" role="menuitemradio" data-zoom="fit">Fit to screen</button>' +
  '<div class="dropdown-sep" role="separator"></div>' +
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
  if (!zoomMenu.hidden && !e.target.closest('.zoom-wrap')) showZoomMenu(false);
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
