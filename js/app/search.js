// Search in the top bar.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Search: type in the top bar to find anything in the plan by its name, phase, person
// or type. Results update as you type; click one (or pick it with ↑/↓ and Enter) to go
// to it on the page you're on, where it lights up for a moment. Ctrl+F (⌘F on a Mac) jumps here.
var searchIn = document.querySelector('[data-search-input]');
var searchRes = document.querySelector('[data-search-results]');
var searchHits = [];
var searchSel = 0;
document.querySelector('[data-search-kbd]').textContent = shortcut(['mod', 'F']);

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
    var hay = [r.name, phaseName(r), who ? who.name : '', kind, r.notes || ''].join(' ').toLowerCase();
    if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return null;
    var name = r.name.toLowerCase();
    // Names starting with the search come first, then names containing it, then the rest.
    return { r: r, rank: name.indexOf(q) === 0 ? 0 : name.indexOf(q) > 0 ? 1 : 2, i: i };
  }).filter(Boolean).sort(function (a, b) { return a.rank - b.rank || a.i - b.i; }).slice(0, 8).map(function (h) { return h.r; });
  searchSel = 0;
  searchRes.innerHTML = searchHits.length ? searchHits.map(function (r, i) {
    var who = personById(r.person);
    var ic = r.type === 'phase' ? '<i class="list-icon ph" style="' + colorVar(r).slice(2) + '"></i>' : r.type === 'milestone' ? '<i class="list-icon ms"></i>'
      : '<i class="list-icon' + (r.parent ? ' sub' : '') + '" style="' + colorVar(r).slice(2) + '"></i>';
    var meta = [r.type === 'task' ? (r.parent ? 'Subtask' : 'Task') : r.type === 'milestone' ? 'Milestone' : 'Phase', r.type === 'phase' ? '' : phaseName(r), who ? who.name : '']
      .filter(Boolean).map(esc).join(' · ');
    return '<div class="search-result" role="option" id="sr-' + i + '" data-id="' + esc(r.id) + '">' + ic +
      '<span class="search-result-text"><span class="search-result-name">' + markWords(r.name, words) + '</span><span class="search-result-meta">' + meta + '</span></span>' +
      '<span class="search-result-date">' + esc(itemLabel(r)) + '</span></div>';
  }).join('') : '<div class="search-empty">Nothing matches “' + esc(searchIn.value.trim()) + '”</div>';
  showResults(true);
  syncSearchSel();
}

function showResults(open) {
  searchRes.hidden = !open;
  searchIn.setAttribute('aria-expanded', String(open));
  if (!open) searchIn.removeAttribute('aria-activedescendant');
}

function syncSearchSel() {
  Array.prototype.forEach.call(searchRes.querySelectorAll('.search-result'), function (el, i) {
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
    var target = boardCols.querySelector(row.type === 'phase' ? '.board-col[data-col="' + q + '"]' : '.card[data-id="' + q + '"]');
    if (target) {
      if (row.type === 'phase') target.classList.add('fresh');
      target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    setTimeout(function () { if (freshId === id) freshId = null; }, 2200);
    return;
  }
  if (page !== 'list') return goToRow(id);
  var sel = '.list-row[data-id="' + q + '"]';
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
  var el = e.target.closest('.search-result[data-id]');
  if (el) goToItem(el.getAttribute('data-id'));
});
searchRes.addEventListener('mousemove', function (e) {
  var el = e.target.closest('.search-result');
  var i = Array.prototype.indexOf.call(searchRes.querySelectorAll('.search-result'), el);
  if (el && i !== searchSel) {
    searchSel = i;
    syncSearchSel();
  }
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && !dialog.open) {
    e.preventDefault();
    var box = onHome() ? homeEl.querySelector('[data-home-q]') : searchIn; // Workspace finds projects
    box.focus();
    box.select();
  }
});
