// Shared by js/cloud.js and the app (js/app/*.js): the names things are kept under in this
// browser, safe access to storage, and escaping text for HTML.

// Storage keys. They start with "roadmap" from the app's earlier name. The synced ones are also
// the row keys in the account's Supabase table, so they keep their names.
var STORE = {
  // Synced to the account (js/cloud.js)
  projects: 'roadmapProjects',
  plan: 'roadmapPlan', // one per project: roadmapPlan:<project id>
  tags: 'roadmapTags',
  templates: 'roadmapTemplates',
  notes: 'roadmapNotes',
  profile: 'roadmapProfile',
  // This browser only
  current: 'roadmapCurrent',
  page: 'roadmapPage',
  view: 'roadmapView',
  list: 'roadmapList',
  board: 'roadmapBoard',
  cal: 'roadmapCal',
  home: 'roadmapHome',
  taskPanel: 'taskPanel',
  theme: 'theme', // also read by the inline script in index.html, before this file loads
  unsent: 'workspaceUnsent', // changes not yet sent to the account (js/cloud.js)
  // This tab only (sessionStorage)
  spot: 'roadmapSpot',
  history: 'roadmapHistory',
  calAt: 'roadmapCalAt',
  here: 'roadmapHere',
  goTo: 'roadmapGoTo',
  opened: 'roadmapOpened' // one per project: roadmapOpened:<project id>
};

function isSynced(key) {
  return [STORE.projects, STORE.plan, STORE.tags, STORE.templates, STORE.notes, STORE.profile].indexOf(key) >= 0 ||
    key.indexOf(STORE.plan + ':') === 0;
}

// localStorage and sessionStorage can throw when they're full or turned off in the browser
// (even reading window.localStorage can). Reads then come back empty, and set/remove say
// whether they worked, so each caller decides whether a failure matters.
function storageArea(name) {
  return {
    get: function (key) {
      try { return window[name].getItem(key); } catch (e) { return null; }
    },
    getJSON: function (key) {
      try { return JSON.parse(window[name].getItem(key)); } catch (e) { return null; } // unreadable counts as missing
    },
    set: function (key, value) {
      try { window[name].setItem(key, value); return true; } catch (e) { return false; }
    },
    remove: function (key) {
      try { window[name].removeItem(key); return true; } catch (e) { return false; }
    }
  };
}

var localStore = storageArea('localStorage');
var sessionStore = storageArea('sessionStorage');

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
