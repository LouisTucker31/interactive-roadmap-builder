// Switching pages from the rail.
// Part of the app: js/cloud.js loads js/app/*.js in order once you're signed in; they share one scope.
'use strict';

// Pages: the rail switches between the timeline, the list and the board. The list and
// board sit over the timeline rather than replacing it, so the chart keeps its scroll
// position underneath.
function setPage(page) {
  app.setAttribute('data-page', page);
  pageBtns.forEach(function (btn) {
    var on = btn.getAttribute('data-page-btn') === page;
    btn.classList.toggle('on', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  closePeek();
  localStore.set(STORE.page, page);
  if (page === 'settings') setTimeout(renderSettings, 0); // after start-up has loaded tags and templates
  // Workload redraws the timeline by person, with the people panel always open.
  if ((page === 'workload') !== workload) {
    workload = page === 'workload';
    if (!workload) panel.querySelector('.task-panel-title').textContent = 'Task';
    var open = localStore.get(STORE.taskPanel) === 'open';
    panel.classList.toggle('open', workload || open);
    renderPlan();
    renderTaskList();
    syncPanelScroll();
  }
}

pageBtns.forEach(function (btn) {
  btn.addEventListener('click', function () { setPage(btn.getAttribute('data-page-btn')); });
});

renderList();
var savedPage = localStore.get(STORE.page);
if (firstOpen && defaults().openPage) savedPage = defaults().openPage;
setPage(['list', 'board', 'workload', 'calendar', 'settings'].indexOf(savedPage) >= 0 ? savedPage : 'timeline');
