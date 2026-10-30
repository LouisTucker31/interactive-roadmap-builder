// Workspace: the home page with every project, coming up, notes and templates.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Workspace: the home page above the projects. An overview as well as a library: a card
// per project (dates, progress, status, people, what's next), what's coming up across
// all of them, templates, tags and your notes. A new visit opens here; a refresh keeps
// you where you were (sessionStorage); the breadcrumb's "Workspace" and the W logo come
// back here, and the browser's Back button steps between here and a project.
var homeEl = document.querySelector('[data-home]');
var homeState = { sort: 'recent', view: 'grid', tag: '', q: '' };
var savedHome = localStore.getJSON(STORE.home);
if (savedHome) ['sort', 'view'].forEach(function (k) { if (savedHome[k]) homeState[k] = savedHome[k]; });
var homeMenu = null; // the project whose ⋯ menu is open

function saveHome() {
  localStore.set(STORE.home, JSON.stringify({ sort: homeState.sort, view: homeState.view }));
}

function onHome() {
  return app.classList.contains('on-home');
}

// A project's rows, deps and people: the open project's live, others read from storage
// with their dates moved onto this week's day numbering.
function projectPlan(id) {
  if (id === currentId) return { rows: data.rows, deps: data.deps, people: data.people };
  var saved = localStore.getJSON(planKey(id));
  if (!saved || saved.sig !== data.sig) return { rows: data.base.slice(), deps: data.baseDeps.slice(), people: data.basePeople.slice() };
  var shift = (saved.planStart - PLAN_START) / DAY;
  return {
    rows: saved.rows.map(function (r) {
      if (r.base != null) return data.base[r.base];
      var c = {};
      Object.keys(r).forEach(function (k) { c[k] = r[k]; });
      ['start', 'end', 'day'].forEach(function (k) { if (c[k] != null) c[k] += shift; });
      return c;
    }).filter(Boolean),
    deps: saved.deps || [],
    people: saved.people || []
  };
}

var NOW_DAY = (NOW - PLAN_START) / DAY;

// "today 09:00", "tomorrow", "in 3 days", "in 2 weeks", "in 4 months", or "2 days ago".
function relDay(d) {
  var days = Math.floor(d) - Math.floor(NOW_DAY);
  if (days === 0) return 'today' + (d % 1 ? ' ' + timeOf(d) : '');
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  var n = Math.abs(days);
  var span = n < 7 ? n + ' days' : n < 35 ? Math.round(n / 7) + (Math.round(n / 7) === 1 ? ' week' : ' weeks') : Math.round(n / 30.4) + (Math.round(n / 30.4) === 1 ? ' month' : ' months');
  return days > 0 ? 'in ' + span : span + ' ago';
}

// Everything a card shows about a project.
function projectSummary(p) {
  var plan = projectPlan(p.id);
  var rows = plan.rows;
  var count = function (type) { return rows.filter(function (r) { return r.type === type; }).length; };
  var tasks = rows.filter(function (r) { return r.type === 'task'; });
  var starts = rows.map(startDay);
  var ends = rows.map(function (r) { return r.end != null ? r.end : startDay(r); });
  var first = rows.length ? Math.min.apply(null, starts) : null;
  var last = rows.length ? Math.max.apply(null, ends) : null;
  var status = !rows.length ? 'empty' : NOW_DAY < first ? 'upcoming' : NOW_DAY > last ? 'finished' : 'active';
  var next = rows.filter(function (r) { return r.type !== 'phase' && startDay(r) >= NOW_DAY; })
    .sort(function (a, b) { return (a.type === 'milestone' ? 0 : 1) - (b.type === 'milestone' ? 0 : 1) || startDay(a) - startDay(b); })[0];
  var soonest = rows.filter(function (r) { return r.type !== 'phase' && startDay(r) >= NOW_DAY; }).sort(function (a, b) { return startDay(a) - startDay(b); })[0];
  return {
    p: p, plan: plan, milestones: count('milestone'), phases: count('phase'), tasks: tasks.length,
    progress: tasks.length ? tasks.reduce(function (s, r) { return s + (r.progress || 0); }, 0) / tasks.length : null,
    first: first, last: last, status: status, next: next || soonest,
    tags: tagsOf(p).map(tagById).filter(Boolean)
  };
}

var STATUS_WORD = { empty: 'Empty', upcoming: 'Upcoming', active: 'In progress', finished: 'Finished' };

function avatarsHtml(people) {
  return '<span class="avatar-stack">' + people.slice(0, 4).map(function (q) {
    return '<span class="person-avatar" style="background: ' + safeColor(q.color, AVATAR_COLORS[0]) + '" title="' + esc(q.name) + '">' + esc(initials(q.name)) + '</span>';
  }).join('') + (people.length > 4 ? '<span class="avatar-more">+' + (people.length - 4) + '</span>' : '') + '</span>';
}

function cardHtml2(s) {
  var p = s.p;
  var pct = s.progress == null ? null : Math.round(s.progress * 100);
  var tags = s.tags.slice(0, 2).map(function (t) { return '<span class="pill" style="--c: ' + safeColor(t.color, '') + '"># ' + esc(t.name) + '</span>'; }).join('') +
    (s.tags.length > 2 ? '<span class="avatar-more">+' + (s.tags.length - 2) + '</span>' : '');
  var dates = s.first == null ? 'No dates yet' : listDate(s.first) + ' – ' + listDate(s.last);
  var next = s.next ? '<span class="project-next"><i class="kind-mark' + (s.next.type === 'milestone' ? ' ms' : '') + '" style="' + colorVar(s.next).slice(2) + '"></i>' +
    '<span class="project-next-name">' + esc(s.next.name) + '</span><span class="project-next-when">' + esc(relDay(startDay(s.next))) + '</span></span>'
    : '<span class="project-next none">' + (s.status === 'empty' ? 'Nothing planned yet' : 'Nothing else coming up') + '</span>';
  var menu = homeMenu === p.id ? '<div class="dropdown project-menu" role="menu">' +
    '<button type="button" role="menuitem" data-hact="open">Open</button>' +
    '<button type="button" role="menuitem" data-hact="rename">Rename…</button>' +
    '<button type="button" role="menuitem" data-hact="duplicate">Duplicate</button>' +
    '<button type="button" role="menuitem" data-hact="template">Save as template…</button>' +
    '<div class="dropdown-sep" role="separator"></div>' +
    '<button type="button" role="menuitem" data-hact="pin">' + (p.pinned ? 'Unpin' : 'Pin to top') + '</button>' +
    '<button type="button" role="menuitem" data-hact="archive">' + (p.archived ? 'Unarchive' : 'Archive') + '</button>' +
    '<div class="dropdown-sep" role="separator"></div>' +
    '<button type="button" role="menuitem" class="danger" data-hact="delete"' + (projects.length < 2 ? ' disabled title="Your only project can’t be deleted"' : '') + '>Delete…</button></div>' : '';
  return '<article class="project-card s-' + s.status + (p.archived ? ' archived' : '') + '" data-proj="' + esc(p.id) + '" tabindex="0" role="button" title="Open ' + esc(p.name) + '">' +
    '<div class="project-card-top">' + (p.archived ? '<span class="project-status">Archived</span>' : '<span class="project-status ' + s.status + '">' + STATUS_WORD[s.status] + '</span>') +
    (p.id === currentId ? '<span class="project-current">Last open</span>' : '') +
    (p.pinned ? '<span class="project-pin" title="Pinned to the top">' + PIN_ICON + '</span>' : '') +
    '<button type="button" class="project-menu-btn" aria-label="More for ' + esc(p.name) + '" title="More" aria-haspopup="menu" aria-expanded="' + (homeMenu === p.id) + '" data-hmenu>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button>' + menu + '</div>' +
    '<h3>' + esc(p.name) + '</h3>' +
    (tags ? '<div class="project-tags">' + tags + '</div>' : '') +
    (p.description ? '<p class="project-desc">' + esc(p.description) + '</p>' : '') +
    '<div class="project-dates">' + ICON_CAL + esc(dates) + '</div>' +
    '<div class="project-counts"><span><b>' + s.milestones + '</b> ' + (s.milestones === 1 ? 'milestone' : 'milestones') + '</span>' +
    '<span><b>' + s.phases + '</b> ' + (s.phases === 1 ? 'phase' : 'phases') + '</span>' +
    '<span><b>' + s.tasks + '</b> ' + (s.tasks === 1 ? 'task' : 'tasks') + '</span></div>' +
    (pct == null ? '' : '<div class="project-progress" title="' + pct + '% of tasks done"><span class="card-progress"><b style="width: ' + pct + '%"></b></span><span class="project-pct">' + pct + '%</span></div>') +
    '<div class="project-card-foot">' + next + avatarsHtml(s.plan.people) + '</div></article>';
}

var PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';

// Coming up across every live (not archived) project, a heading per day: milestones and
// phases from today on, up to `max` items; the project's name shows when there's more
// than one project involved.
function comingUpHtml(all, max) {
  var soon = [];
  all.forEach(function (s) {
    if (s.p.archived) return;
    s.plan.rows.forEach(function (r) {
      if ((r.type === 'milestone' || r.type === 'phase') && startDay(r) >= Math.floor(NOW_DAY)) soon.push({ r: r, p: s.p });
    });
  });
  if (!soon.length) return '<p class="coming-up-empty">No milestones or phases coming up.</p>';
  soon.sort(function (a, b) { return startDay(a.r) - startDay(b.r) || (a.r.type === 'milestone' ? -1 : 1); });
  var several = soon.some(function (x) { return x.p !== soon[0].p; });
  var days = [];
  soon.slice(0, max).forEach(function (x) {
    var d = Math.floor(startDay(x.r));
    if (!days.length || days[days.length - 1].d !== d) days.push({ d: d, items: [] });
    days[days.length - 1].items.push(x);
  });
  var more = soon.length - Math.min(max, soon.length);
  return days.map(function (g) {
    var date = new Date(PLAN_START + g.d * DAY);
    return '<div class="coming-day"><div class="coming-day-head"><b>' + WEEKDAYS[date.getUTCDay()] + ' ' + date.getUTCDate() + ' ' + MONTHS[date.getUTCMonth()] + '</b>' +
      '<em>' + esc(relDay(g.d)) + '</em></div><ul class="coming-up">' + g.items.map(function (x) {
        var s = startDay(x.r);
        return '<li><button type="button" data-home-goto="' + esc(x.p.id) + '" data-item="' + esc(x.r.id) + '" title="Open it in ' + esc(x.p.name) + '">' +
          '<span class="coming-up-time">' + (s % 1 ? timeOf(s) : 'All day') + '</span>' +
          '<i class="kind-mark ' + (x.r.type === 'milestone' ? 'ms' : 'ph') + '" style="' + colorVar(x.r).slice(2) + '"></i>' +
          '<span class="coming-up-name">' + esc(x.r.name) + '</span>' + (several ? '<span class="coming-up-project">' + esc(x.p.name) + '</span>' : '') + '</button></li>';
      }).join('') + '</ul></div>';
  }).join('') + (more ? '<p class="coming-up-empty">+ ' + more + ' more after that</p>' : '');
}

function greeting() {
  var h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderHome() {
  var all = projects.map(projectSummary);
  var q = homeState.q.trim().toLowerCase();
  var archivedN = all.filter(function (s) { return s.p.archived; }).length;
  if (!archivedN) homeState.archived = false;
  var shown = all.filter(function (s) {
    if (s.p.archived && !homeState.archived) return false;
    if (homeState.tag && !s.tags.some(function (t) { return t.id === homeState.tag; })) return false;
    if (!q) return true;
    return [s.p.name, s.p.description || ''].concat(s.tags.map(function (t) { return t.name; })).join(' ').toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) {
    // Pinned first, then archived last, then the chosen order.
    if (!!a.p.pinned !== !!b.p.pinned) return a.p.pinned ? -1 : 1;
    if (!!a.p.archived !== !!b.p.archived) return a.p.archived ? 1 : -1;
    if (homeState.sort === 'name') return a.p.name.toLowerCase() < b.p.name.toLowerCase() ? -1 : 1;
    if (homeState.sort === 'start') return (a.first == null ? Infinity : a.first) - (b.first == null ? Infinity : b.first);
    return (b.p.openedAt || 0) - (a.p.openedAt || 0);
  });
  var today = new Date(TODAY);
  var first = (me.name || '').split(' ')[0];
  var filterTag = homeState.tag && tagById(homeState.tag);

  // Tags in use, with how many projects have each.
  var tagUse = tags.map(function (t) {
    return { t: t, n: all.filter(function (s) { return s.tags.indexOf(t) >= 0; }).length };
  }).filter(function (x) { return x.n; });
  var openNotes = notes.filter(function (n) { return !n.done; });

  homeEl.innerHTML =
    '<header class="home-head"><div class="home-brand">' +
    '<span class="logo" aria-hidden="true"><svg viewBox="0 0 32 32" width="22" height="22"><path d="M6.5 9.5l4.2 13 5.3-10.2 5.3 10.2 4.2-13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>' +
    '<span class="home-brand-name">Workspace</span></div>' +
    '<div class="home-tools"><button class="btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="notes-pop" title="Notes" data-home-notes><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"></path><path d="M15 3v4a2 2 0 0 0 2 2h4"></path></svg><span class="btn-label">Notes</span><b class="notes-badge"' + (openNotes.length ? '' : ' hidden') + ' data-notes-count>' + (openNotes.length || '') + '</b></button>' +
    '<label class="search home-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>' +
    '<input type="text" placeholder="Find a project" aria-label="Find a project" value="' + esc(homeState.q) + '" data-home-q></label>' +
    '<button type="button" class="primary" data-home-new><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>New project</button>' +
    '<button type="button" class="avatar home-avatar" style="background: ' + safeColor(me.color, AVATAR_COLORS[0]) + '" title="Your profile" data-home-profile>' + esc(initials(me.name || '?')) + '</button></div></header>' +
    // The projects on the left under the greeting and view controls; the overview
    // runs down the right from the top.
    '<div class="home-wrap"><div class="home-main"><div class="home-hello"><h1>' + greeting() + (first ? ', ' + esc(first) : '') + '</h1><p>' + WEEKDAYS_LONG[today.getUTCDay()] + ' ' + today.getUTCDate() + ' ' + MONTHS_LONG[today.getUTCMonth()] +
    ' · ' + projects.length + (projects.length === 1 ? ' project' : ' projects') + '</p></div>' +
    '<div class="home-bar"><div class="segmented" role="group" aria-label="Show projects as">' +
    '<button type="button" aria-pressed="' + (homeState.view === 'grid') + '" data-home-view="grid">Grid</button>' +
    '<button type="button" aria-pressed="' + (homeState.view === 'list') + '" data-home-view="list">List</button></div>' +
    '<label class="home-sort"><span class="toolbar-label">Sort</span><select data-home-sort>' +
    [['recent', 'Recently opened'], ['name', 'Name'], ['start', 'Start date']].map(function (o) {
      return '<option value="' + o[0] + '"' + (homeState.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></label>' +
    (filterTag ? '<button type="button" class="home-filter" data-home-tag="" title="Show every project"># ' + esc(filterTag.name) + ' <span aria-hidden="true">×</span></button>' : '') +
    (archivedN ? '<button type="button" class="btn toggle-btn home-archived-btn" aria-pressed="' + !!homeState.archived + '" data-home-archived>' +
      (homeState.archived ? 'Hide archived' : 'Show archived') + ' <b class="hidden-count">' + archivedN + '</b></button>' : '') +
    '</div><h2 class="home-label">Projects</h2>' +
    '<div class="home-grid' + (homeState.view === 'list' ? ' as-list' : '') + '">' +
    (shown.length ? shown.map(cardHtml2).join('') : !projects.length ? '<p class="home-empty">No projects yet. Create your first one to get started.</p>' : '<p class="home-empty">No projects match' + (q ? ' “' + esc(homeState.q) + '”' : '') + (filterTag ? ' with # ' + esc(filterTag.name) : '') + '.</p>') +
    '<button type="button" class="project-card project-add" data-home-new><span>+</span>New project</button></div></div>' +
    '<aside class="home-side"><h2 class="home-label">Overview</h2>' +
    '<section class="home-box"><h2>Coming up</h2>' + comingUpHtml(all, 8) + '</section>' +
    '<section class="home-box"><h2>Notes</h2>' +
    '<input type="text" class="home-note-add" maxlength="300" placeholder="Add a note and press Enter" aria-label="Add a note" data-home-note>' +
    (openNotes.length ? '<ul class="home-notes">' + openNotes.slice(0, 6).map(function (n) {
      return '<li><label class="note-check"><input type="checkbox" aria-label="Mark as done" data-home-note-done="' + esc(n.id) + '"><span></span></label><span>' + esc(n.text) + '</span></li>';
    }).join('') + '</ul>' + (openNotes.length > 6 ? '<p class="coming-up-empty">+ ' + (openNotes.length - 6) + ' more in Notes</p>' : '') : '<p class="coming-up-empty">Nothing to do.</p>') + '</section>' +
    '<section class="home-box"><h2>Templates</h2>' + (templates.length ? '<ul class="home-list">' + templates.map(function (t) {
      return '<li><span><b>' + esc(t.name) + '</b><span>' + itemsWord(t.rows.length) + '</span></span><button type="button" class="btn" data-home-tpl="' + esc(t.id) + '">Use</button></li>';
    }).join('') + '</ul>' : '<p class="coming-up-empty">Save a project as a template to start new ones from it.</p>') + '</section>' +
    '<section class="home-box"><h2>Tags</h2>' + (tagUse.length ? '<div class="home-tag-list">' + tagUse.map(function (x) {
      return '<button type="button" class="pill' + (homeState.tag === x.t.id ? ' on' : '') + '" style="--c: ' + safeColor(x.t.color, '') + '" aria-pressed="' + (homeState.tag === x.t.id) + '" data-home-tag="' + (homeState.tag === x.t.id ? '' : esc(x.t.id)) + '"># ' + esc(x.t.name) + ' <span class="hidden-count">' + x.n + '</span></button>';
    }).join('') + '</div>' : '<p class="coming-up-empty">No tags on any project yet.</p>') + '</section>' +
    '</aside></div>';
  // The Notes popup, if open from here, belongs to the new button now.
  if (!notesPop.hidden && !document.body.contains(notesFrom)) {
    notesFrom = homeEl.querySelector('[data-home-notes]');
    notesFrom.setAttribute('aria-expanded', 'true');
  }
  var qIn = homeEl.querySelector('[data-home-q]');
  if (homeEl.getAttribute('data-typing')) {
    qIn.focus();
    qIn.setSelectionRange(qIn.value.length, qIn.value.length);
  }
}

var WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Show Workspace (push it as a history step unless coming Back to it).
var homeSpot = null; // where the timeline was when Workspace opened

function goHome(fromHistory) {
  sessionStore.set(STORE.here, 'home');
  if (!fromHistory && location.hash) history.pushState(null, '', location.pathname + location.search);
  // The chart is hidden on Workspace (and its scroll drops to the start), so remember where
  // it was for coming back.
  if (!onHome()) homeSpot = { time: timeAt(scroller.scrollLeft), top: scroller.scrollTop };
  closePeek();
  hideTip();
  if (!notesPop.hidden) openNotes(false); // its button is going
  app.classList.add('on-home');
  homeEl.hidden = false;
  homeMenu = null;
  document.title = 'Workspace';
  renderHome();
}

// Back into the open project, without a reload.
function leaveHome(fromHistory) {
  sessionStore.set(STORE.here, 'project');
  if (!fromHistory && location.hash !== '#project') history.pushState(null, '', '#project');
  if (!notesPop.hidden) openNotes(false); // its button is going
  app.classList.remove('on-home');
  homeEl.hidden = true;
  document.title = project().name;
  project().openedAt = Date.now();
  saveProjects();
  onResize(); // the chart was hidden; lay it out again
  if (homeSpot) { // back where you were before going to Workspace
    scroller.scrollLeft = xOf(homeSpot.time);
    scroller.scrollTop = homeSpot.top;
    extend();
    syncTodayArrow();
    saveSpot();
  }
}

// Opening a project from here starts fresh, like opening it anew: the Timeline at today
// (as the Today/Now button), unless its Settings choose another page or view. Back
// from Workspace, by contrast, returns to wherever you were.
function openFromHome(id) {
  if (id !== currentId) return openProject(id);
  leaveHome();
  var d = defaults();
  setPage(d.openPage || 'timeline');
  if (SCALES[d.openScale] && SCALES[d.openScale] !== scale) setScale(d.openScale);
  recentre(home());
  scroller.scrollLeft = xOf(home());
  scroller.scrollTop = 0;
  extend();
  syncTodayArrow();
  saveSpot();
}

// A small dialog over Workspace: name a new project (blank or from a template), rename
// one, save one as a template, or delete one.
function homeDialog(html, onSubmit) {
  actForm.innerHTML = html;
  actDialog.showModal();
  var first = actForm.querySelector('input[type=text]');
  if (first) first.select();
  actForm.onsubmit = function (e) {
    e.preventDefault();
    onSubmit();
  };
}

function newProjectDialog(templateId) {
  homeDialog('<div class="dialog-head"><h2 id="act-title">New project</h2></div><div class="dialog-body">' +
    '<label class="field"><span class="field-label">Name</span><input type="text" maxlength="60" placeholder="e.g. Ex THUNDER" data-np-name></label>' +
    '<div class="field"><span class="field-label">Start from</span><div class="new-project-from">' +
    '<label class="new-project-option"><input type="radio" name="npFrom" value=""' + (templateId ? '' : ' checked') + '><span><b>Blank</b><em>An empty project</em></span></label>' +
    templates.map(function (t) {
      return '<label class="new-project-option"><input type="radio" name="npFrom" value="' + esc(t.id) + '"' + (templateId === t.id ? ' checked' : '') + '><span><b>' + esc(t.name) + '</b><em>Template · ' + itemsWord(t.rows.length) + ', starting today</em></span></label>';
    }).join('') + '</div></div><p class="popup-error" hidden data-np-err></p></div>' +
    '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="primary" type="submit">Create and open</button></div>', function () {
    var name = actForm.querySelector('[data-np-name]').value.trim().replace(/\s+/g, ' ');
    if (!name) {
      var err = actForm.querySelector('[data-np-err]');
      err.textContent = 'Give the project a name.';
      err.hidden = false;
      return actForm.querySelector('[data-np-name]').focus();
    }
    var from = actForm.querySelector('[name="npFrom"]:checked');
    var t = from && from.value ? templates.filter(function (x) { return x.id === from.value; })[0] : null;
    var id = projectId(name);
    if (t) {
      var copy = JSON.parse(JSON.stringify(t));
      var shift = (TODAY - PLAN_START) / DAY - t.day0;
      copy.rows.forEach(function (r) { ['start', 'end', 'day'].forEach(function (k) { if (r[k] != null) r[k] += shift; }); });
      saveData(planKey(id), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people)));
    }
    projects.push({ id: id, name: name, tags: t ? t.tags || (t.tag ? [t.tag] : []) : [], openedAt: Date.now() });
    saveProjects();
    openProject(id);
  });
  if (!templateId) actForm.querySelector('[data-np-name]').focus();
}

function homeAction(act, id) {
  var p = projects.filter(function (x) { return x.id === id; })[0];
  if (!p) return;
  homeMenu = null;
  if (act === 'open') return openFromHome(id);
  if (act === 'pin' || act === 'archive') {
    var flag = act === 'pin' ? 'pinned' : 'archived';
    if (p[flag]) delete p[flag];
    else p[flag] = true;
    saveProjects();
    return renderHome();
  }
  if (act === 'rename') {
    return homeDialog('<div class="dialog-head"><h2 id="act-title">Rename project</h2></div><div class="dialog-body">' +
      '<label class="field"><span class="field-label">Name</span><input type="text" maxlength="60" value="' + esc(p.name) + '" data-rn-name></label></div>' +
      '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="primary" type="submit">Save</button></div>', function () {
      var name = actForm.querySelector('[data-rn-name]').value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      p.name = name;
      saveProjects();
      renderProjBtn();
      actDialog.close();
      renderHome();
    });
  }
  if (act === 'duplicate') {
    var name = p.name + ' (copy)';
    var nid = projectId(name);
    var plan = projectPlan(id);
    var copy = JSON.parse(JSON.stringify(plan));
    saveData(planKey(nid), JSON.stringify(savedPlan(copy.rows, copy.deps, copy.people)));
    projects.push({ id: nid, name: name, tags: tagsOf(p), description: p.description, openedAt: Date.now() });
    saveProjects();
    return renderHome();
  }
  if (act === 'template') {
    return homeDialog('<div class="dialog-head"><h2 id="act-title">Save as template</h2></div><div class="dialog-body">' +
      '<label class="field"><span class="field-label">Template name</span><input type="text" maxlength="60" value="' + esc(p.name) + '" data-tn-name></label>' +
      '<p class="act-note">Progress is cleared, and dates move so a new project starts from the day it’s made.</p></div>' +
      '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="primary" type="submit">Save template</button></div>', function () {
      var name = actForm.querySelector('[data-tn-name]').value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      var copy = JSON.parse(JSON.stringify(projectPlan(id)));
      copy.rows.forEach(function (r) { delete r.progress; r.added = true; });
      var day0 = copy.rows.length ? Math.floor(Math.min.apply(null, copy.rows.map(startDay))) : 0;
      var same = templates.filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
      templates = templates.filter(function (t) { return t !== same; }).concat([{
        id: same ? same.id : 'tpl-' + Date.now().toString(36), name: name, tags: tagsOf(p), day0: day0, rows: copy.rows, deps: copy.deps, people: copy.people
      }]);
      saveTemplates();
      actDialog.close();
      renderHome();
    });
  }
  if (act === 'delete' && projects.length > 1) {
    homeDialog('<div class="dialog-head"><h2 id="act-title">Delete ' + esc(p.name) + '?</h2></div><div class="dialog-body">' +
      '<p class="act-warn">This deletes the project and everything in it, for good. It can’t be undone.</p>' +
      '<label class="checkbox"><input type="checkbox" data-del-ok> I understand this project will be gone for good</label>' +
      '<label class="field"><span class="field-label">Type <b>' + esc(p.name) + '</b> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-del-name></label></div>' +
      '<div class="dialog-foot"><button class="btn" type="button" data-act-close>Cancel</button><button class="btn del" type="submit" disabled data-del-go>Delete project</button></div>', function () {
      var go = actForm.querySelector('[data-del-go]');
      if (go.disabled) return;
      projects = projects.filter(function (x) { return x.id !== id; });
      saveProjects();
      localStore.remove(planKey(id));
      actDialog.close();
      if (id === currentId) {
        // The open project went: make another the current one, staying on Workspace.
        localStore.set(STORE.current, projects[0].id);
        location.reload();
      } else {
        renderHome();
      }
    });
    var ok = actForm.querySelector('[data-del-ok]');
    var typed = actForm.querySelector('[data-del-name]');
    var sync = function () {
      var go = actForm.querySelector('[data-del-go]');
      var ready = ok.checked && typed.value.trim() === p.name;
      go.disabled = !ready;
      go.classList.toggle('armed', ready);
    };
    ok.addEventListener('change', sync);
    typed.addEventListener('input', sync);
    actForm.querySelector('[data-act-close]').focus();
  }
}

homeEl.addEventListener('click', function (e) {
  var t = e.target;
  var card = t.closest('.project-card[data-proj]');
  var act = t.closest('[data-hact]');
  var tag = t.closest('[data-home-tag]');
  var go = t.closest('[data-home-goto]');
  var view = t.closest('[data-home-view]');
  var tpl = t.closest('[data-home-tpl]');
  if (act) return homeAction(act.getAttribute('data-hact'), card.getAttribute('data-proj'));
  if (t.closest('[data-hmenu]')) {
    homeMenu = homeMenu === card.getAttribute('data-proj') ? null : card.getAttribute('data-proj');
    renderHome();
    var first = homeEl.querySelector('.project-menu button');
    if (first) first.focus();
    return;
  }
  if (t.closest('[data-home-new]')) return newProjectDialog();
  if (tpl) return newProjectDialog(tpl.getAttribute('data-home-tpl'));
  if (t.closest('[data-home-profile]')) return openProfile(true);
  var nb = t.closest('[data-home-notes]');
  if (nb) return openNotes(notesPop.hidden || notesFrom !== nb, nb);
  if (tag) homeState.tag = tag.getAttribute('data-home-tag');
  else if (view) homeState.view = view.getAttribute('data-home-view');
  else if (t.closest('[data-home-archived]')) homeState.archived = !homeState.archived;
  else if (go) {
    var itemId = go.getAttribute('data-item');
    if (go.getAttribute('data-home-goto') === currentId) {
      leaveHome();
      return setTimeout(function () { goToItem(itemId); }, 50);
    }
    sessionStore.set(STORE.goTo, itemId);
    return openProject(go.getAttribute('data-home-goto'));
  } else if (card && !t.closest('.project-menu')) return openFromHome(card.getAttribute('data-proj'));
  else if (homeMenu && !t.closest('.project-menu')) homeMenu = null;
  else return;
  saveHome();
  renderHome();
});
homeEl.addEventListener('input', function (e) {
  if (!e.target.matches('[data-home-q]')) return;
  homeState.q = e.target.value;
  homeEl.setAttribute('data-typing', '1');
  renderHome();
  homeEl.removeAttribute('data-typing');
});
homeEl.addEventListener('change', function (e) {
  var t = e.target;
  if (t.matches('[data-home-sort]')) {
    homeState.sort = t.value;
    saveHome();
    renderHome();
  } else if (t.matches('[data-home-note-done]')) {
    var n = noteById(t.getAttribute('data-home-note-done'));
    if (n) n.done = true;
    saveNotes();
    renderHome();
  }
});
homeEl.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t.matches('[data-home-note]') && e.key === 'Enter') {
    e.preventDefault();
    var text = t.value.trim();
    if (!text) return;
    notes.push({ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text, done: false });
    saveNotes();
    renderHome();
    homeEl.querySelector('[data-home-note]').focus();
  } else if (t.matches('.project-card[data-proj]') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openFromHome(t.getAttribute('data-proj'));
  } else if (e.key === 'Escape' && homeMenu) {
    e.preventDefault();
    homeMenu = null;
    renderHome();
  }
});
Array.prototype.forEach.call(document.querySelectorAll('[data-go-home]'), function (b) {
  b.addEventListener('click', function () { goHome(); });
});
// The browser's Back and Forward step between Workspace and the project.
window.addEventListener('popstate', function () {
  if (location.hash === '#project') leaveHome(true);
  else goHome(true);
});
// Keep Workspace up to date with changes from other tabs.
window.addEventListener('storage', function () { if (onHome() && !actDialog.open) renderHome(); });
