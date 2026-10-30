// The profile popup: you, the theme, shortcuts and your account.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Profile: the avatar at the bottom of the rail opens a popup about you (not the
// project): your name, email and avatar colour (kept in this browser until there are
// accounts), the theme, the keyboard shortcuts, and account actions that arrive with
// accounts. Views: the main one, 'edit' for the profile form, 'keys' for shortcuts.
var profBtn = document.querySelector('[data-profile-btn]');
var profPop = document.querySelector('[data-profile-pop]');
var profView = 'main';
var me = { name: '', email: '', color: '#dfae2f' }; // a new account's name comes from signing up
var savedMe = localStore.getJSON(STORE.profile);
if (savedMe) Object.keys(me).forEach(function (k) { if (savedMe[k] != null) me[k] = savedMe[k]; });

function saveMe() {
  saveData(STORE.profile, JSON.stringify(me));
}

function renderProfBtn() {
  profBtn.textContent = initials(me.name || '?');
  profBtn.style.background = safeColor(me.color, AVATAR_COLORS[0]);
  profBtn.title = (me.name || 'Your profile') + ' · your profile';
}

var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

// The account comes from Supabase (js/cloud.js): who's signed in, and whether changes
// have reached it.
function signedIn() {
  return !!(window.cloud && window.cloud.email());
}

function accountEmail() {
  return window.cloud ? window.cloud.email() : '';
}

function cloudNote() {
  var s = document.documentElement.getAttribute('data-cloud');
  if (!signedIn()) return 'Workspace · saved in this browser only';
  return s === 'offline' ? 'Offline · changes are kept here and saved when you’re back online'
    : s === 'too-big' ? 'Some of your data is too large to save to your account, so it’s only kept in this browser'
    : s === 'saving' ? 'Saving to your account…' : 'Workspace · saved to your account';
}

window.addEventListener('cloud-status', function () {
  var note = profPop.querySelector('[data-pf-status]');
  if (note) note.textContent = cloudNote();
});

function renderProfile() {
  if (profView === 'password') {
    profPop.innerHTML = '<div class="profile-head"><button type="button" class="profile-back" aria-label="Back" data-pf-view="main">' + BACK + '</button>Change password</div>' +
      '<div class="profile-body">' +
      '<label class="settings-field"><span class="field-label">New password <em>at least 8 characters</em></span><input type="password" autocomplete="new-password" minlength="8" data-pf-pw></label>' +
      '<label class="settings-field"><span class="field-label">New password again</span><input type="password" autocomplete="new-password" data-pf-pw2></label>' +
      '<p class="popup-error" hidden data-pf-err></p><p class="profile-ok" hidden data-pf-ok>Password changed.</p></div>' +
      '<div class="popup-foot"><button class="btn" type="button" data-pf-view="main">Cancel</button><button class="primary" type="button" data-pf-pwsave>Change password</button></div>';
    profPop.querySelector('[data-pf-pw]').focus();
    return;
  }
  if (profView === 'edit') {
    profPop.innerHTML = '<div class="profile-head"><button type="button" class="profile-back" aria-label="Back" data-pf-view="main">' + BACK + '</button>Edit profile</div>' +
      '<div class="profile-body">' +
      '<label class="settings-field"><span class="field-label">Display name</span><input type="text" maxlength="60" value="' + esc(me.name) + '" autocomplete="name" data-pf-name></label>' +
      // The email is the account's sign-in, so it's shown here but not edited.
      '<div class="settings-field"><span class="field-label">Email</span><div class="profile-email">' + (accountEmail() ? esc(accountEmail()) : 'Not signed in') + '</div>' +
      '<span class="profile-hint">Your sign-in email. It can’t be changed here.</span></div>' +
      '<div class="settings-field"><span class="field-label">Avatar colour</span><div class="person-colors" role="radiogroup" aria-label="Avatar colour">' + AVATAR_COLORS.map(function (c) {
        return '<label class="swatch small"><input type="radio" name="pfColor" value="' + c + '"' + (c === me.color ? ' checked' : '') + ' aria-label="Colour ' + c + '"><span style="background: ' + c + '"></span></label>';
      }).join('') + '</div></div>' +
      '<p class="popup-error" hidden data-pf-err></p></div>' +
      '<div class="popup-foot"><button class="btn" type="button" data-pf-view="main">Cancel</button><button class="primary" type="button" data-pf-save>Save</button></div>';
    profPop.querySelector('[data-pf-name]').focus();
    return;
  }
  if (profView === 'keys') {
    var keys = [
      [KEYS.mod + ' Z', 'Undo'],
      MAC ? [KEYS.mod + ' ' + KEYS.shift + ' Z', 'Redo (also ⌘ Y)'] : [KEYS.mod + ' Y', 'Redo (also Ctrl Shift Z)'],
      [KEYS.mod + ' F', 'Search'],
      ['N', 'New task'], ['T', 'Back to today (timeline, workload, calendar)'], ['Esc', 'Close a popup, or put back an item being moved'],
      ['↑ ↓ Enter', 'Pick a search result'], ['Enter', 'Open the selected row or card (from the task list: its details)'],
      ['E', 'Edit the selected task list row'], [KEYS.alt + ' ↑ ↓', 'Move the selected task list row'],
      ['Hold, then drag', 'Move an item on the timeline']
    ];
    profPop.innerHTML = '<div class="profile-head"><button type="button" class="profile-back" aria-label="Back" data-pf-view="main">' + BACK + '</button>Keyboard shortcuts</div>' +
      '<dl class="profile-keys">' + keys.map(function (k) {
        // Each key in its own cap; "Hold, then drag" is one step, so one cap.
        var caps = k[0].indexOf(',') >= 0 ? [k[0]] : k[0].split(' ');
        return '<dt>' + caps.map(function (x) { return '<kbd>' + esc(x) + '</kbd>'; }).join('') + '</dt><dd>' + esc(k[1]) + '</dd>';
      }).join('') + '</dl>';
    profPop.querySelector('.profile-back').focus();
    return;
  }
  var mode = themeMode();
  profPop.innerHTML = '<div class="profile-me">' +
    '<span class="person-avatar profile-avatar" style="background: ' + safeColor(me.color, AVATAR_COLORS[0]) + '" aria-hidden="true">' + esc(initials(me.name || '?')) + '</span>' +
    '<div class="profile-who"><b>' + esc(me.name || 'Your name') + '</b><span>' + (accountEmail() ? esc(accountEmail()) : 'Not signed in') + '</span></div>' +
    '<button type="button" class="btn" data-pf-view="edit">Edit</button></div>' +
    '<div class="profile-section"><span class="profile-label">Appearance</span><div class="segmented" role="group" aria-label="Theme">' +
    [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(function (o) {
      return '<button type="button" aria-pressed="' + (mode === o[0]) + '" data-pf-theme="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div></div>' +
    '<div class="profile-section profile-links"><button type="button" class="profile-link" data-pf-view="keys">Keyboard shortcuts' + CHEV + '</button></div>' +
    '<div class="profile-section profile-links"><span class="profile-label">Account</span>' +
    '<button type="button" class="profile-link" data-pf-view="password"' + (signedIn() ? '' : ' disabled') + '>Change password' + CHEV + '</button>' +
    '<button type="button" class="profile-link danger" data-pf-signout' + (signedIn() ? '' : ' disabled') + '>Sign out</button></div>' +
    '<div class="profile-foot" data-pf-status>' + cloudNote() + '</div>';
  var first = profPop.querySelector('[data-pf-view="edit"]');
  if (first) first.focus();
}

// The popup sits in the middle of the screen (see .profpop), over a dimmed backdrop.
var profBack = document.createElement('div');
profBack.className = 'profile-backdrop';
profBack.hidden = true;
profPop.parentNode.insertBefore(profBack, profPop);

function openProfile(open) {
  profView = 'main';
  profPop.hidden = !open;
  profBack.hidden = !open;
  profBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    renderProfile();
  }
}

function saveProfileForm() {
  var name = profPop.querySelector('[data-pf-name]').value.trim().replace(/\s+/g, ' ');
  var err = profPop.querySelector('[data-pf-err]');
  if (!name) {
    err.textContent = 'Add your display name.';
    err.hidden = false;
    return;
  }
  var col = profPop.querySelector('[name="pfColor"]:checked');
  me = { name: name, email: me.email, color: col ? col.value : me.color };
  saveMe();
  renderProfBtn();
  if (onHome()) renderHome(); // the greeting and avatar on Workspace too
  profView = 'main';
  renderProfile();
}

profBtn.addEventListener('click', function () { openProfile(profPop.hidden); });
profPop.addEventListener('click', function (e) {
  var view = e.target.closest('[data-pf-view]');
  var theme = e.target.closest('[data-pf-theme]');
  if (view) {
    profView = view.getAttribute('data-pf-view');
    renderProfile();
  } else if (theme) {
    setThemeMode(theme.getAttribute('data-pf-theme'));
    renderProfile();
  } else if (e.target.closest('[data-pf-save]')) {
    saveProfileForm();
  } else if (e.target.closest('[data-pf-pwsave]')) {
    savePassword();
  } else if (e.target.closest('[data-pf-signout]')) {
    e.target.closest('[data-pf-signout]').disabled = true;
    e.target.closest('[data-pf-signout]').textContent = 'Signing out…';
    window.cloud.signOut();
  }
});

function savePassword() {
  var pw = profPop.querySelector('[data-pf-pw]').value;
  var pw2 = profPop.querySelector('[data-pf-pw2]').value;
  var err = profPop.querySelector('[data-pf-err]');
  var btn = profPop.querySelector('[data-pf-pwsave]');
  err.hidden = true;
  if (pw.length < 8) err.textContent = 'Use at least 8 characters.';
  else if (pw !== pw2) err.textContent = 'The two passwords don’t match.';
  if (pw.length < 8 || pw !== pw2) {
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  window.cloud.changePassword(pw).then(function () {
    profPop.querySelector('[data-pf-ok]').hidden = false;
    setTimeout(function () {
      profView = 'main';
      if (!profPop.hidden) renderProfile();
    }, 1200);
  }, function (e2) {
    err.textContent = e2 && e2.message ? e2.message : 'Your password wasn’t changed. Check your connection and try again.';
    err.hidden = false;
    btn.disabled = false;
  });
}
profPop.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (profView !== 'main') {
      profView = 'main';
      renderProfile();
      return;
    }
    openProfile(false);
    profBtn.focus();
  } else if (e.key === 'Enter' && profView === 'password' && e.target.matches('input')) {
    e.preventDefault();
    savePassword();
  } else if (e.key === 'Enter' && profView === 'edit' && e.target.matches('input[type=text]')) {
    e.preventDefault();
    saveProfileForm();
  }
});
document.addEventListener('pointerdown', function (e) {
  if (!profPop.hidden && !profPop.contains(e.target) && !profBtn.contains(e.target)) openProfile(false);
});

// The rail's moon/sun changes the theme too; keep the popup's switch in step.
toggle.addEventListener('click', function () { if (!profPop.hidden && profView === 'main') renderProfile(); });
window.addEventListener('storage', function (e) {
  if (e.key !== STORE.profile) return;
  try { me = JSON.parse(e.newValue) || me; } catch (err) { /* unreadable: keep this tab's copy */ }
  renderProfBtn();
});
renderProfBtn();
