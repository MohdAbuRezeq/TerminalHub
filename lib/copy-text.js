// Pure logic for cleaning up text copied out of the terminal. No DOM, no
// xterm: the caller passes the raw selection and the terminal width.
//
// Two kinds of row break are not real line breaks and get undone here:
//
//   1. A row that fills the terminal to the last column. Some programs
//      break long lines themselves exactly at the edge, so xterm can't tell
//      it was one line. The two rows are glued back with nothing between.
//
//   2. A row broken at a word. Programs that draw their own paragraphs
//      (Claude Code and other TUIs) wrap at a word boundary a little before
//      the edge and end every row with a real newline. Pasted into an email
//      that gives a hard break in the middle of each sentence. The test: a
//      row was wrapped if the first word of the next row would not have fit
//      on it. A real break (end of a paragraph, a short sign-off line)
//      leaves room for that word, so it stays.
//
// The width such a program wraps at is unknown, only that it is close to the
// terminal width. WRAP_SLACK is how far short of the edge it may sit. The
// widest selected row raises the estimate when it is wider than that.
const WRAP_SLACK = 8;

// Rows that start a new item are never glued onto the row above, however
// full that row is.
const LIST_MARKER = /^(?:[-*+•●○▪◦>#]|\d+[.)])\s/;

function cleanCopiedText(raw, cols, startCol = 0) {
  const rows = raw.split('\n').map((row) => row.replace(/\s+$/, ''));
  // Width each row takes on screen. The first row of a selection may start
  // partway along its row, so the columns before it count as used.
  const widths = rows.map((row, i) => row.length + (i === 0 ? startCol : 0));
  const wrapWidth = Math.min(cols, Math.max(cols - WRAP_SLACK, ...widths));

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].trim();
    if (i === 0) {
      out.push(text);
      continue;
    }
    const prevText = rows[i - 1].trim();
    if (text.length === 0 || prevText.length === 0) {
      out.push(text);
    } else if (prevText.length >= cols) {
      out[out.length - 1] += text;
    } else if (
      !LIST_MARKER.test(text) &&
      widths[i - 1] + 1 + text.split(/\s/)[0].length > wrapWidth
    ) {
      out[out.length - 1] += ' ' + text;
    } else {
      out.push(text);
    }
  }
  return out.join('\n');
}

module.exports = { cleanCopiedText };
