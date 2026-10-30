// Runs in <head>, before the page is drawn.
(function () {
  'use strict';

  // Set the theme now so dark mode doesn't flash light on load. STORE.theme in js/shared.js
  // is the same key; that file isn't loaded yet.
  var saved;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* storage off: follow the system setting */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  // Keep the app out of sight until you are signed in and it has started (js/cloud.js).
  document.documentElement.classList.add('booting');

  // Never show the app inside another site's frame, where it could be overlaid to trick clicks.
  // (The host can't send frame-ancestors on GitHub Pages; see README.md.)
  if (window.top !== window.self) document.documentElement.classList.add('framed');
})();
