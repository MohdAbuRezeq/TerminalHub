// Pure logic for mouse-driven editing of the shell's input line. The
// terminal can't edit the line directly — the shell owns it — so both
// features synthesize what a user would type:
//   - computeClickMoveSequence: arrow presses that walk the cursor to a
//     clicked cell on the line being edited.
//   - computeDeleteSequence: arrow presses to the selection end, then one
//     backspace per selected character.
// No DOM, no xterm — the caller adapts the buffer behind getLine().
//
// Coordinate contract (matches xterm's getSelectionPosition() as implemented,
// not as documented): columns 0-based, rows absolute buffer rows, selection
// end column exclusive, start always before end.

// The editable region is the cursor's logical line: its row plus any
// soft-wrapped continuation rows around it.
function lineRunBounds(getLine, y) {
  let runStart = y;
  while (runStart > 0) {
    const line = getLine(runStart);
    if (!line || !line.isWrapped) break;
    runStart--;
  }
  let runEnd = y;
  for (;;) {
    const next = getLine(runEnd + 1);
    if (!next || !next.isWrapped) break;
    runEnd++;
  }
  return { runStart, runEnd };
}

// Concatenate the buffer text between two positions, (fromY,fromX) inclusive
// to (toY,toX) exclusive, walking across row boundaries.
function textBetween(getLine, cols, fromX, fromY, toX, toY) {
  let out = '';
  for (let y = fromY; y <= toY; y++) {
    const line = getLine(y);
    if (!line) return null;
    const a = y === fromY ? fromX : 0;
    const b = y === toY ? toX : cols;
    out += line.text(a, b);
  }
  return out;
}

// Arrow keys and backspaces both operate on characters, not cells, so all
// counts are code points: a wide CJK char spans 2 cells but is 1 press.
function charCount(s) {
  return Array.from(s).length;
}

function arrowKey(applicationCursor, right) {
  return (applicationCursor ? '\x1bO' : '\x1b[') + (right ? 'C' : 'D');
}

// Compute the escape sequence that walks the cursor to the clicked cell, or
// null when the click shouldn't move anything (click off the line being
// edited, unreadable rows, already on the cursor cell) — the caller then
// treats the click as a plain focus click.
function computeClickMoveSequence({ clickX, clickAbsY, cursorX, cursorAbsY, cols, applicationCursor, getLine }) {
  const { runStart, runEnd } = lineRunBounds(getLine, cursorAbsY);
  if (clickAbsY < runStart || clickAbsY > runEnd) return null;

  const clickBeforeCursor =
    clickAbsY < cursorAbsY || (clickAbsY === cursorAbsY && clickX < cursorX);
  const moveText = clickBeforeCursor
    ? textBetween(getLine, cols, clickX, clickAbsY, cursorX, cursorAbsY)
    : textBetween(getLine, cols, cursorX, cursorAbsY, clickX, clickAbsY);
  if (moveText === null) return null;
  const moveCount = charCount(moveText);
  if (moveCount === 0) return null;

  return arrowKey(applicationCursor, !clickBeforeCursor).repeat(moveCount);
}

// Compute the escape sequence that deletes the selected text, or null when
// the deletion shouldn't be attempted (selection outside the line being
// edited, unreadable rows, empty selection) — the caller then lets the
// keypress through untouched.
function computeDeleteSequence({ cursorX, cursorAbsY, selStart, selEnd, cols, applicationCursor, getLine }) {
  // Selections outside the cursor's logical line are old output.
  const { runStart, runEnd } = lineRunBounds(getLine, cursorAbsY);
  if (selStart.y < runStart || selEnd.y > runEnd) return null;

  const selText = textBetween(getLine, cols, selStart.x, selStart.y, selEnd.x, selEnd.y);
  if (selText === null) return null;
  const deleteCount = charCount(selText);
  if (deleteCount === 0) return null;

  const cursorBeforeEnd =
    cursorAbsY < selEnd.y || (cursorAbsY === selEnd.y && cursorX < selEnd.x);
  const moveText = cursorBeforeEnd
    ? textBetween(getLine, cols, cursorX, cursorAbsY, selEnd.x, selEnd.y)
    : textBetween(getLine, cols, selEnd.x, selEnd.y, cursorX, cursorAbsY);
  if (moveText === null) return null;

  return arrowKey(applicationCursor, cursorBeforeEnd).repeat(charCount(moveText)) +
    '\x7f'.repeat(deleteCount);
}

module.exports = { computeClickMoveSequence, computeDeleteSequence, lineRunBounds };
