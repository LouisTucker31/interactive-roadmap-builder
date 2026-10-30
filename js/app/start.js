// Start-up: where to open, closing popups with Esc, tooltips, the window.workspace hooks, and the first draw.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Where to start: a new visit opens Workspace; a refresh stays where you were.
var here = sessionStore.get(STORE.here);
if (here === 'project' && projects.length) { // with no projects yet there's only Workspace
  project().openedAt = Date.now();
  saveProjects();
  if (location.hash !== '#project' && !/access_token|error=/.test(location.hash)) history.replaceState(null, '', '#project');
} else {
  if (location.hash === '#project') history.replaceState(null, '', location.pathname + location.search); // leave sign-in links to Supabase
  setTimeout(function () { goHome(true); }, 0);
}
// Going to an item from Workspace's Coming up, once the project has opened.
var goToId = sessionStore.get(STORE.goTo);
sessionStore.remove(STORE.goTo);
if (goToId && here === 'project') setTimeout(function () { goToItem(goToId); }, 300);

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
  if (homeMenu) {
    homeMenu = null;
    renderHome();
    closed = true;
  }
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
var TIP_SEL = '[title], [data-tip-title], button, .person-pick';
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

// After changing window.WORKSPACE, call workspace.refresh() to redraw the plan and stats.
// workspace.reset() removes everything in the open project.
window.workspace = {
  refresh: refresh,
  reset: function () {
    localStore.remove(planKey());
    location.reload();
  }
};

// Start at today, or where this tab was before a refresh if it's still on the same view.
var spot = sessionStore.getJSON(STORE.spot);
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

if (window.ResizeObserver) new ResizeObserver(onResize).observe(scroller);
else window.addEventListener('resize', onResize);
