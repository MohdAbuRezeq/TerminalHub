const test = require('node:test');
const assert = require('node:assert/strict');
const { createTerminalStore } = require('../lib/terminal-store');

// Fake pty so we don't pull in node-pty.
function fakePty(label) {
  return { label, killed: false, kill() { this.killed = true; } };
}

test('create assigns monotonically increasing ids starting at 1', () => {
  const store = createTerminalStore();
  const a = store.create('senderA', fakePty('a'));
  const b = store.create('senderA', fakePty('b'));
  const c = store.create('senderB', fakePty('c'));
  assert.equal(a, 1);
  assert.equal(b, 2);
  assert.equal(c, 3);
});

test('get returns the pty when the sender owns the id', () => {
  const store = createTerminalStore();
  const pty = fakePty('a');
  const id = store.create('senderA', pty);
  assert.equal(store.get('senderA', id), pty);
});

test('get returns null when a different sender asks for the id', () => {
  const store = createTerminalStore();
  const pty = fakePty('a');
  const id = store.create('senderA', pty);
  // A compromised or unrelated renderer cannot reach into another
  // sender's terminals.
  assert.equal(store.get('senderB', id), null);
});

test('get returns null for an unknown id', () => {
  const store = createTerminalStore();
  assert.equal(store.get('senderA', 999), null);
});

test('take removes and returns the pty when the sender owns it', () => {
  const store = createTerminalStore();
  const pty = fakePty('a');
  const id = store.create('senderA', pty);
  assert.equal(store.take('senderA', id), pty);
  // Subsequent gets should fail.
  assert.equal(store.get('senderA', id), null);
  assert.equal(store.size(), 0);
});

test('take returns null and leaves the pty in place when sender does not own it', () => {
  const store = createTerminalStore();
  const pty = fakePty('a');
  const id = store.create('senderA', pty);
  assert.equal(store.take('senderB', id), null);
  // Original owner can still reach it.
  assert.equal(store.get('senderA', id), pty);
  assert.equal(store.size(), 1);
});

test('takeAllForSender returns and removes only that sender\'s terminals', () => {
  const store = createTerminalStore();
  const a1 = fakePty('a1');
  const a2 = fakePty('a2');
  const b1 = fakePty('b1');
  const idA1 = store.create('senderA', a1);
  store.create('senderA', a2);
  const idB1 = store.create('senderB', b1);

  const removed = store.takeAllForSender('senderA');
  assert.deepEqual(removed.map(p => p.label).sort(), ['a1', 'a2']);
  assert.equal(store.size(), 1);
  assert.equal(store.get('senderB', idB1), b1);
  assert.equal(store.get('senderA', idA1), null);
});

test('takeAll empties the store and returns every pty', () => {
  const store = createTerminalStore();
  const a = fakePty('a');
  const b = fakePty('b');
  store.create('senderA', a);
  store.create('senderB', b);

  const all = store.takeAll();
  assert.deepEqual(all.map(p => p.label).sort(), ['a', 'b']);
  assert.equal(store.size(), 0);
});

test('takeAllForSender returns empty array when sender owns nothing', () => {
  const store = createTerminalStore();
  store.create('senderA', fakePty('a'));
  assert.deepEqual(store.takeAllForSender('senderB'), []);
  assert.equal(store.size(), 1);
});
