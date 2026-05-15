// Pure split-container layout helpers. No DOM access — caller passes in
// the indices and acts on the result.

// Pick the index of the divider adjacent to a pane that's about to be
// removed. Prefers the divider BEFORE the pane, unless the pane is the
// first child — then takes the divider AFTER.
//
// Returns null when there's only one pane (no dividers exist).
function pickAdjacentDivider(paneIndex, totalChildren) {
  if (totalChildren <= 1) return null;
  if (paneIndex > 0) return paneIndex - 1;
  return paneIndex + 1;
}

module.exports = { pickAdjacentDivider };
