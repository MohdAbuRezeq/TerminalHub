const test = require('node:test');
const assert = require('node:assert/strict');
const { pickAdjacentDivider } = require('../lib/divider');

// Split-container DOM layout is always alternating: [P, D, P, D, ..., P].
// For N panes the container has 2N-1 children.
//
// When a pane is removed, exactly one adjacent divider must also go.
// Rule: prefer the divider BEFORE the pane (paneIndex - 1), unless the
// pane is the first child — then take the divider AFTER (paneIndex + 1).
// This keeps the remaining children alternating correctly.
//
// The original onExit handler always removed the LAST divider regardless
// of which pane exited. For first-pane exit in a 3+ pane layout that
// stranded a leading orphan divider. These tests cover all positions.

test('one pane, no dividers — returns null', () => {
  assert.equal(pickAdjacentDivider(0, 1), null);
});

test('two panes: first pane exits — removes the only divider (after)', () => {
  // Layout: [P0, D, P1]. paneIndex 0 → remove child 1.
  assert.equal(pickAdjacentDivider(0, 3), 1);
});

test('two panes: second pane exits — removes the only divider (before)', () => {
  // Layout: [P0, D, P1]. paneIndex 2 → remove child 1.
  assert.equal(pickAdjacentDivider(2, 3), 1);
});

test('three panes: first pane exits — removes divider after', () => {
  // Layout: [P0, D, P1, D, P2]. paneIndex 0 → remove child 1.
  // Original bug: removed last divider (child 3), leaving [P0, D, P1, P2]
  // with a leading orphan divider when P0 was eventually removed.
  assert.equal(pickAdjacentDivider(0, 5), 1);
});

test('three panes: middle pane exits — removes divider before', () => {
  // Layout: [P0, D, P1, D, P2]. paneIndex 2 → remove child 1.
  // Either neighbor is fine; we pick "before" for consistency with the
  // existing closePaneInSession behavior.
  assert.equal(pickAdjacentDivider(2, 5), 1);
});

test('three panes: last pane exits — removes divider before', () => {
  // Layout: [P0, D, P1, D, P2]. paneIndex 4 → remove child 3.
  assert.equal(pickAdjacentDivider(4, 5), 3);
});

test('four panes: first pane exits — removes child 1', () => {
  // Layout: [P0, D, P1, D, P2, D, P3]. paneIndex 0 → remove child 1.
  assert.equal(pickAdjacentDivider(0, 7), 1);
});

test('four panes: third pane exits — removes child 3 (before)', () => {
  // Layout: [P0, D, P1, D, P2, D, P3]. paneIndex 4 → remove child 3.
  assert.equal(pickAdjacentDivider(4, 7), 3);
});
