// Roadmap shown on the Gantt chart. Rows are drawn top to bottom in this order.
// Days are offsets from the Monday of the current week (day 0); a task's `end` is the
// day it finishes before (exclusive). Subtasks name their `parent` and draw lighter.
window.ROADMAP = {
  people: {
    AR: { color: '#de4f87' },
    DV: { color: '#dfae2f' },
    JN: { color: '#8fb83a' },
    MC: { color: '#e57f3a' },
    PS: { color: '#8b5cf0' },
    SK: { color: '#dc4c4c' }
  },

  rows: [
    { id: 'wireframes', type: 'task', name: 'Wireframes', start: 0, end: 18, owner: 'PS', progress: 0.58 },
    { id: 'ui-mockups', type: 'task', name: 'UI mockups', start: 18, end: 31, owner: 'JN' },
    { id: 'design-signoff', type: 'milestone', name: 'Design sign-off', day: 32 },

    { type: 'phase', name: 'Phase 3 — Build', start: 0 },
    { id: 'notifications', type: 'task', name: 'Notifications service', start: 0, end: 64, owner: 'SK' },
    { id: 'email-templates', type: 'task', parent: 'notifications', name: 'Email templates', start: 32, end: 43, owner: 'MC' },
    { id: 'push-pipeline', type: 'task', parent: 'notifications', name: 'Push pipeline', start: 43, end: 54, owner: 'AR' },
    { id: 'digest-scheduler', type: 'task', parent: 'notifications', name: 'Digest scheduler', start: 54, end: 64, owner: 'PS' },
    { id: 'frontend', type: 'task', name: 'Frontend implementation', start: 22, end: 98, owner: 'JN' },
    { id: 'mobile-pass', type: 'task', parent: 'frontend', name: 'Mobile pass', start: 64, end: 76, owner: 'SK' },
    { id: 'auth-screens', type: 'task', parent: 'frontend', name: 'Auth screens', start: 76, end: 88, owner: 'MC' },
    { id: 'dashboard-layout', type: 'task', parent: 'frontend', name: 'Dashboard layout', start: 88, end: 97, owner: 'AR' },
    { id: 'frontend-complete', type: 'milestone', name: 'Frontend complete', day: 98 },
    { id: 'admin-dashboard', type: 'task', name: 'Admin dashboard', start: 40, end: 69, owner: 'PS' }
  ],

  // [from, to]: `to` can't start until `from` is done.
  deps: [
    ['wireframes', 'ui-mockups'],
    ['ui-mockups', 'design-signoff'],
    ['design-signoff', 'email-templates'],
    ['design-signoff', 'mobile-pass'],
    ['design-signoff', 'admin-dashboard'],
    ['email-templates', 'push-pipeline'],
    ['push-pipeline', 'digest-scheduler'],
    ['digest-scheduler', 'frontend-complete'],
    ['mobile-pass', 'auth-screens'],
    ['auth-screens', 'dashboard-layout'],
    ['dashboard-layout', 'frontend-complete']
  ]
};
