// Tracks pty processes scoped to the IPC sender that created them. The
// store never reads from a sender that doesn't own the id, so a
// compromised renderer (or future webview) can't drive terminals it
// didn't spawn. The caller is responsible for actually killing ptys —
// the store just hands them back.

function createTerminalStore() {
  const terminals = new Map(); // id -> { sender, pty }
  let counter = 0;

  function create(sender, pty) {
    const id = ++counter;
    terminals.set(id, { sender, pty });
    return id;
  }

  function get(sender, id) {
    const entry = terminals.get(id);
    if (!entry || entry.sender !== sender) return null;
    return entry.pty;
  }

  function take(sender, id) {
    const entry = terminals.get(id);
    if (!entry || entry.sender !== sender) return null;
    terminals.delete(id);
    return entry.pty;
  }

  function takeAllForSender(sender) {
    const out = [];
    for (const [id, entry] of terminals) {
      if (entry.sender === sender) {
        out.push(entry.pty);
        terminals.delete(id);
      }
    }
    return out;
  }

  function takeAll() {
    const out = [...terminals.values()].map(e => e.pty);
    terminals.clear();
    return out;
  }

  function size() {
    return terminals.size;
  }

  return { create, get, take, takeAllForSender, takeAll, size };
}

module.exports = { createTerminalStore };
