// The theme, projects and their defaults, saving, and the date helpers everything uses.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
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
  var saved = localStore.get(STORE.theme);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

function setThemeMode(mode) {
  if (mode === 'system') localStore.remove(STORE.theme);
  else localStore.set(STORE.theme, mode);
  root.setAttribute('data-theme', mode === 'system' ? (systemDark.matches ? 'dark' : 'light') : mode);
  syncToggle();
}

if (systemDark.addEventListener) {
  systemDark.addEventListener('change', function () { if (themeMode() === 'system') setThemeMode('system'); });
}

syncToggle();

// The account's data (projects, plans, tags, templates, notes, profile) is saved here. If this
// browser can't store a change (its storage is full or turned off), say so rather than lose it
// quietly. Signed in, js/cloud.js still sends the change to the account.
function saveData(key, value) {
  if (localStore.set(key, value)) return;
  var warning = document.querySelector('[data-save-warning]');
  warning.querySelector('p').textContent = window.cloud && window.cloud.email()
    ? 'This browser couldn’t store your latest change (its storage may be full), but it’s still being saved to your account.'
    : 'Your latest change couldn’t be saved: this browser’s storage may be full or turned off.';
  warning.hidden = false;
}

document.querySelector('[data-save-warning] button').addEventListener('click', function () {
  document.querySelector('[data-save-warning]').hidden = true;
});

// Projects: each has a name, tags and its own saved plan (under STORE.plan:<id>). The
// open project is remembered in this browser; switching reloads the page. A new account
// has none: it starts on an empty Workspace, and NO_PROJECT stands in until there's one
// to open.
var NO_PROJECT = { id: null, name: 'Workspace' };
var projects = localStore.getJSON(STORE.projects);
if (!Array.isArray(projects)) projects = [];
var currentId = localStore.get(STORE.current);
if (!projects.some(function (p) { return p.id === currentId; })) currentId = projects.length ? projects[0].id : null;

function project() {
  return projects.filter(function (p) { return p.id === currentId; })[0] || NO_PROJECT;
}

function planKey(id) {
  return STORE.plan + ':' + (id || currentId);
}

function saveProjects() {
  saveData(STORE.projects, JSON.stringify(projects));
}

function projectId(name) {
  var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  var id = base;
  for (var n = 2; projects.some(function (p) { return p.id === id; }); n++) id = base + '-' + n;
  return id;
}

// Opening a project goes into it (not Workspace), as a new step in the browser's history.
// It opens on the Timeline at today, or on the page and view chosen in the project's
// Settings → Defaults.
function openProject(id) {
  localStore.set(STORE.current, id);
  localStore.set(STORE.page, 'timeline');
  sessionStore.remove(STORE.spot);
  sessionStore.remove(STORE.opened + ':' + id); // so its opening defaults apply
  sessionStore.set(STORE.here, 'project');
  if (location.hash !== '#project') history.pushState(null, '', '#project');
  location.reload();
}

document.title = project().name;

// Project defaults, set in Settings: the first day of the week (1 Monday, 0 Sunday), the
// page and view to open on, and what new items start with.
function defaults() {
  return project().defaults || {};
}

var WEEK_START = defaults().weekStart === 0 ? 0 : 1;

// Shortcut keys as the computer in use names them: ⌘ ⌥ ⇧ on a Mac, Ctrl Alt Shift elsewhere.
// shortcut(['mod', 'shift', 'Z']) gives "⌘⇧Z" on a Mac and "Ctrl+Shift+Z" elsewhere.
var MAC = /mac|iphone|ipad/i.test(navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform);
var KEYS = MAC ? { mod: '⌘', alt: '⌥', shift: '⇧' } : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };

function shortcut(keys) {
  return keys.map(function (k) { return KEYS[k] || k; }).join(MAC ? '' : '+');
}

// A colour from saved data, only if it's a plain #rrggbb; anything else could carry extra CSS
// into the style attribute it's written into, so it gets the fallback instead.
function safeColor(color, fallback) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback;
}

// Dates, times and row ids, used everywhere. (Days are offsets from PLAN_START; see timeline.js.)
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

// "5 days" for all-day rows; "1d 2h 30m" style for timed ones.
function duration(row) {
  var start = row.type === 'milestone' ? row.day : row.start;
  var mins = Math.round((row.end - start) * 1440);
  if (!(start % 1) && !(row.end % 1)) return mins / 1440 + (mins === 1440 ? ' day' : ' days');
  return [[Math.floor(mins / 1440), 'd'], [Math.floor(mins / 60) % 24, 'h'], [mins % 60, 'm']].filter(function (p) {
    return p[0];
  }).map(function (p) { return p[0] + p[1]; }).join(' ');
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

function uniqueId(name) {
  var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  var id = base;
  for (var n = 2; rowIndex[id] != null; n++) id = base + '-' + n;
  return id;
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
  var saved = localStore.getJSON(planKey());
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
  saveData(planKey(), JSON.stringify(plan));
}
