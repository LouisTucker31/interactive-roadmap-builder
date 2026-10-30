// Project tags and the tag popup.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Project tags: the tags beside the project name. Tags are a shared list (kept in this
// browser apart from the plan), so projects can share them; a project can have any
// number. The top bar shows the first with "+n" for the rest. Clicking it opens a popup
// listing every tag to tick on or off, find or create one, edit a tag's name and
// colour, or delete it.
var tagBtn = document.querySelector('[data-tag-btn]');
var tagPop = document.querySelector('[data-tag-pop]');
var tags = null;
var projectTags = [];
var tagEditing = null; // the tag open in the editor, or null for the list

// A project's tags as a list (projects used to have a single `tag`).
function tagsOf(p) {
  if (Array.isArray(p.tags)) return p.tags.slice();
  return p.tag ? [p.tag] : [];
}

function loadTags() {
  var saved = localStore.getJSON(STORE.tags);
  tags = Array.isArray(saved) ? saved : [];
  var fresh = localStore.getJSON(STORE.projects);
  // Take another tab's changes, unless it deleted this project; this tab keeps what it had then.
  if (Array.isArray(fresh) && fresh.some(function (x) { return x.id === currentId; })) projects = fresh;
  projectTags = tagsOf(project()).filter(tagById);
}

function saveTags() {
  var p = project();
  p.tags = projectTags.slice();
  delete p.tag;
  saveProjects();
  saveData(STORE.tags, JSON.stringify(tags));
}

function tagById(id) {
  return tags.filter(function (t) { return t.id === id; })[0] || null;
}

function renderTagBtn() {
  var on = projectTags.map(tagById).filter(Boolean);
  var t = on[0];
  tagBtn.innerHTML = t ? '# ' + esc(t.name) + (on.length > 1 ? '<span class="pill-more">+' + (on.length - 1) + '</span>' : '') : '+ Add tag';
  tagBtn.classList.toggle('empty', !t);
  tagBtn.style.setProperty('--c', t ? t.color : '');
  tagBtn.title = t ? on.map(function (x) { return '# ' + x.name; }).join(', ') + ' · click to change' : 'Tag this project';
  if (app.getAttribute('data-page') === 'settings') setTimeout(renderSettings, 0); // its tag list too
}

var PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path></svg>';

function renderTagPop() {
  if (tagEditing) {
    var t = tagEditing;
    tagPop.innerHTML = '<div class="popup-head">Edit tag</div>' +
      '<div class="popup-body"><input type="text" maxlength="40" value="' + esc(t.name) + '" aria-label="Tag name" data-tag-name>' +
      '<div class="person-colors" role="radiogroup" aria-label="Tag colour">' + COLORS.map(function (c) {
        return '<label class="swatch small"><input type="radio" name="tagColor" value="' + c[1] + '"' + (c[1] === t.color ? ' checked' : '') +
          ' aria-label="' + c[0] + '"><span style="background: ' + c[1] + '" title="' + c[0] + '"></span></label>';
      }).join('') + '</div>' +
      '<p class="popup-note">Changes show on every project with this tag.</p><p class="popup-error" hidden data-tag-err></p></div>' +
      '<div class="popup-foot"><button class="btn del" type="button" data-tag-delete>Delete tag</button>' +
      '<button class="btn" type="button" data-tag-back>Cancel</button><button class="primary" type="button" data-tag-save>Save</button></div>';
    tagPop.querySelector('[data-tag-name]').select();
    return;
  }
  tagPop.innerHTML = '<div class="popup-head">Project tags</div>' +
    '<div class="popup-body"><input type="text" maxlength="40" placeholder="Find or create a tag" aria-label="Find or create a tag" data-tag-q>' +
    '<div class="popup-list" role="listbox" aria-multiselectable="true" aria-label="Tags" data-tag-list></div></div>' +
    '<div class="popup-foot" data-tag-foot></div>';
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
    return '<div class="popup-row' + (on ? ' on' : '') + '"><button type="button" class="popup-pick popup-check" role="option" aria-selected="' + on + '" data-tag-pick="' + esc(t.id) + '">' +
      '<b class="popup-box" aria-hidden="true"></b><i style="background: ' + esc(t.color) + '"></i><span>' + esc(t.name) + '</span>' +
      (on && projectTags[0] === t.id && projectTags.length > 1 ? '<em>Shown first</em>' : '') + '</button>' +
      '<button type="button" class="popup-edit" aria-label="Edit ' + esc(t.name) + '" title="Edit tag" data-tag-edit="' + esc(t.id) + '">' + PENCIL + '</button></div>';
  }).join('') +
    (q && !exact ? '<button type="button" class="popup-create" data-tag-create>+ Create tag “' + esc(q) + '”</button>' : '') +
    (!shown.length && !q ? '<p class="popup-empty">No tags yet. Type a name to create one.</p>' : '');
  var n = projectTags.length;
  var foot = tagPop.querySelector('[data-tag-foot]');
  foot.hidden = !n;
  foot.innerHTML = '<span class="popup-count">' + (n === 1 ? '1 tag on this project' : n + ' tags on this project') + '</span>' +
    '<button class="popup-remove" type="button" data-tag-remove>Remove ' + (n === 1 ? 'it' : 'all') + '</button>';
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
  if (!tagPop.hidden && !e.target.closest('.tag-wrap')) openTagPop(false);
});
window.addEventListener('storage', function (e) {
  if (e.key !== STORE.tags && e.key !== STORE.projects) return;
  loadTags();
  renderTagBtn();
  renderProjBtn(); // a rename in another tab
  document.title = project().name;
  if (!tagPop.hidden && !tagEditing) renderTagList();
});

loadTags();
renderTagBtn();
