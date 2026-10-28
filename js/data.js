// Roadmap shown on the Gantt chart. Rows are drawn top to bottom in this order.
// Days are offsets from the Monday of the current week (day 0); a task's `end` is the
// day it finishes before (exclusive). Subtasks name their `parent` and draw lighter.
// A task's `color` is optional (blue by default). Any row can name a `person` from `people`.
// Starts empty: add tasks, milestones and phases with the New task button.
//
// Row shapes:
//   { id: 'wireframes', type: 'task', name: 'Wireframes', start: 0, end: 18, color: '#8458e0', progress: 0.58 }
//   { id: 'email-templates', type: 'task', parent: 'notifications', name: 'Email templates', start: 32, end: 43 }
//   { id: 'standup', type: 'task', name: 'Stand-up', start: 2 + 10 / 24 }   (no end: happens at a moment, day 2 10:00)
//   { id: 'design-signoff', type: 'milestone', name: 'Design sign-off', day: 32 }   (add end: 34 for a start and finish diamond)
//   { type: 'phase', name: 'Phase 3 — Build', start: 0 }
window.ROADMAP = {
  rows: [],

  // [from, to]: `to` can't start until `from` is done, e.g. ['wireframes', 'ui-mockups'].
  deps: [],

  // People to put on rows, e.g. { id: 'priya-shah', name: 'Priya Shah', color: '#8b5cf0' }.
  // More can be added from the task form; those are saved in the browser with the plan.
  people: []
};
