const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDeleteSequence, computeClickMoveSequence, lineRunBounds } = require('../lib/line-edit');

// Coordinate contract (verified against xterm's SelectionModel, NOT the
// typings — the d.ts "(1-based)" comment is wrong for getSelectionPosition):
//   columns are 0-based, rows are absolute buffer rows, end column exclusive.
//
// The fake buffer maps a row index to { isWrapped, text(fromCol, toCol) },
// mirroring what the renderer adapts from buffer.getLine(y) /
// line.translateToString(true, from, to): ranges are clamped to the row's
// written content, so unwritten trailing cells contribute NOTHING. This
// trimming is load-bearing — counting padding as characters made Backspace
// delete unselected text left of the selection (audit finding).

function makeGetLine(rows, cols) {
  return (y) => {
    const row = rows[y];
    if (!row) return null;
    return {
      isWrapped: !!row.isWrapped,
      text: row.textFn || ((a, b) => row.text.slice(a, b)),
    };
  };
}

const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const BS = '\x7f';

test('same-row selection right of the cursor: arrows right to selection end, then backspaces', () => {
  // "hello world", cursor at col 0, "world" (cols 6..11) selected.
  const seq = computeDeleteSequence({
    cursorX: 0,
    cursorAbsY: 0,
    selStart: { x: 6, y: 0 },
    selEnd: { x: 11, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, RIGHT.repeat(11) + BS.repeat(5));
});

test('same-row selection left of the cursor: arrows left to selection end, then backspaces', () => {
  // Cursor at end of "hello world" (col 11), "hello" (cols 0..5) selected.
  // Move left over " world" (6 cells) to land at col 5, delete 5 chars.
  const seq = computeDeleteSequence({
    cursorX: 11,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 5, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, LEFT.repeat(6) + BS.repeat(5));
});

test('cursor inside the selection: moves right to selection end, deletes whole selection', () => {
  const seq = computeDeleteSequence({
    cursorX: 5,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 11, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, RIGHT.repeat(6) + BS.repeat(11));
});

test('cursor exactly at selection end: no arrows, only backspaces', () => {
  const seq = computeDeleteSequence({
    cursorX: 11,
    cursorAbsY: 0,
    selStart: { x: 6, y: 0 },
    selEnd: { x: 11, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, BS.repeat(5));
});

test('selection spanning a soft-wrap boundary of the cursor line counts across rows', () => {
  // cols=10; "abcdefghijklmno" wraps into "abcdefghij" + "klmno".
  // Cursor at row 1 col 5 (end of text). Selection from row 0 col 5
  // through row 1 col 3: "fghij" + "klm" = 8 chars. Cursor is 2 cells
  // past the selection end ("no").
  const rows = [{ text: 'abcdefghij' }, { text: 'klmno', isWrapped: true }];
  const seq = computeDeleteSequence({
    cursorX: 5,
    cursorAbsY: 1,
    selStart: { x: 5, y: 0 },
    selEnd: { x: 3, y: 1 },
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, LEFT.repeat(2) + BS.repeat(8));
});

test('selection on a different unwrapped row returns null (old output stays untouched)', () => {
  const rows = [{ text: 'old output' }, { text: '' }, { text: 'prompt here' }];
  const seq = computeDeleteSequence({
    cursorX: 7,
    cursorAbsY: 2,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 3, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine(rows, 80),
  });
  assert.equal(seq, null);
});

test('selection extending below the cursor line run returns null', () => {
  const rows = [{ text: 'prompt' }, { text: 'below' }];
  const seq = computeDeleteSequence({
    cursorX: 6,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 2, y: 1 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine(rows, 80),
  });
  assert.equal(seq, null);
});

test('application cursor keys mode uses SS3-style arrow sequences', () => {
  const seq = computeDeleteSequence({
    cursorX: 0,
    cursorAbsY: 0,
    selStart: { x: 6, y: 0 },
    selEnd: { x: 11, y: 0 },
    cols: 80,
    applicationCursor: true,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, '\x1bOC'.repeat(11) + BS.repeat(5));
});

test('wide characters: counts characters, not cells', () => {
  // Two CJK chars occupy 4 cells. translateToString yields the char at its
  // head cell and nothing for the spacer cell; the fake mirrors that.
  const cellChars = ['你', '', '好', '', ' ', ' ', ' ', ' ', ' ', ' '];
  const rows = [{ textFn: (a, b) => cellChars.slice(a, b).join('') }];
  const seq = computeDeleteSequence({
    cursorX: 0,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 4, y: 0 },
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  // 2 arrow presses (one per character) and 2 backspaces, not 4.
  assert.equal(seq, RIGHT.repeat(2) + BS.repeat(2));
});

test('empty selection returns null', () => {
  const seq = computeDeleteSequence({
    cursorX: 0,
    cursorAbsY: 0,
    selStart: { x: 5, y: 0 },
    selEnd: { x: 5, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, null);
});

test('selection overshooting past end of text deletes only the real characters', () => {
  // Drag-selecting "world" but releasing 3 blank cells past the text
  // (selEnd.x = 14 on an 11-char row). The padding must contribute zero
  // arrows and zero backspaces — counting it deleted unselected text.
  const seq = computeDeleteSequence({
    cursorX: 11,
    cursorAbsY: 0,
    selStart: { x: 6, y: 0 },
    selEnd: { x: 14, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, BS.repeat(5));
});

test('selection entirely in blank cells returns null', () => {
  const seq = computeDeleteSequence({
    cursorX: 11,
    cursorAbsY: 0,
    selStart: { x: 20, y: 0 },
    selEnd: { x: 30, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, null);
});

test('full-row selection (Cmd+A shape, selEnd.x === cols) deletes the written row only', () => {
  // selectLines produces [0, row] → [cols, row]. "> hello" is 7 written
  // cells; cursor at end of text. Expect 7 backspaces, no arrow spam for
  // the 73 blank cells.
  const seq = computeDeleteSequence({
    cursorX: 7,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 80, y: 0 },
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: '> hello' }], 80),
  });
  assert.equal(seq, BS.repeat(7));
});

test('cursor on an earlier row than the selection end moves right across the wrap', () => {
  // Pins the cursorAbsY < selEnd.y branch of cursorBeforeEnd. Cursor row 0
  // col 2; selection on continuation row 1, cols 0..3. Move right over
  // "cdefghij" (8) + "klm" (3) = 11, then delete 3.
  const rows = [{ text: 'abcdefghij' }, { text: 'klmno', isWrapped: true }];
  const seq = computeDeleteSequence({
    cursorX: 2,
    cursorAbsY: 0,
    selStart: { x: 0, y: 1 },
    selEnd: { x: 3, y: 1 },
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, RIGHT.repeat(11) + BS.repeat(3));
});

test('astral emoji counts as one character, not two code units', () => {
  // '🎉' spans 2 cells and 2 UTF-16 code units but is 1 code point → 1
  // backspace. A code-unit count would delete the char before it too.
  const cellChars = ['🎉', '', 'x', ' ', ' ', ' ', ' ', ' ', ' ', ' '];
  const rows = [{ textFn: (a, b) => cellChars.slice(a, b).join('') }];
  const seq = computeDeleteSequence({
    cursorX: 3,
    cursorAbsY: 0,
    selStart: { x: 0, y: 0 },
    selEnd: { x: 2, y: 0 },
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, LEFT.repeat(1) + BS.repeat(1));
});

test('short (early-wrapped) first row contributes only its real characters', () => {
  // A wide char that did not fit in the last cell leaves the row 9 chars
  // long with a phantom trailing cell; the trimmed adapter must not count
  // it. Selection spans row 0 col 5 → row 1 col 1: "fghi" + "W" = 5 chars.
  const rows = [{ text: 'abcdefghi' }, { text: 'WXyz', isWrapped: true }];
  const seq = computeDeleteSequence({
    cursorX: 4,
    cursorAbsY: 1,
    selStart: { x: 5, y: 0 },
    selEnd: { x: 1, y: 1 },
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, LEFT.repeat(3) + BS.repeat(5));
});

// ──────────────────────────────────────
// lineRunBounds — the rows that make up the cursor's logical line
// ──────────────────────────────────────

test('lineRunBounds of an unwrapped line is just that row', () => {
  const getLine = makeGetLine([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 80);
  assert.deepEqual(lineRunBounds(getLine, 1), { runStart: 1, runEnd: 1 });
});

test('lineRunBounds walks up from a wrapped continuation row and down to the last one', () => {
  // Rows 1..3 are one logical line ("abc…" wrapped twice); cursor on row 2.
  const getLine = makeGetLine([
    { text: 'other' },
    { text: 'aaaaaaaaaa' },
    { text: 'bbbbbbbbbb', isWrapped: true },
    { text: 'cc', isWrapped: true },
    { text: 'next' },
  ], 10);
  assert.deepEqual(lineRunBounds(getLine, 2), { runStart: 1, runEnd: 3 });
});

// ──────────────────────────────────────
// computeClickMoveSequence — plain click walks the cursor on the input line
// ──────────────────────────────────────

test('click right of the cursor on the same row moves right per character', () => {
  // "hello world", cursor at col 0, click on col 6 → 6 right presses.
  const seq = computeClickMoveSequence({
    clickX: 6,
    clickAbsY: 0,
    cursorX: 0,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, RIGHT.repeat(6));
});

test('click left of the cursor on the same row moves left per character', () => {
  // Cursor at col 11 (end), click on col 6 → 5 left presses ("world").
  const seq = computeClickMoveSequence({
    clickX: 6,
    clickAbsY: 0,
    cursorX: 11,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, LEFT.repeat(5));
});

test('click on a soft-wrapped continuation of the cursor line walks across the wrap', () => {
  // cols=10; "abcdefghijklmno" wraps into "abcdefghij" + "klmno".
  // Cursor at row 1 col 5, click row 0 col 5 → "fghij" + "klmno" = 10 lefts.
  const rows = [{ text: 'abcdefghij' }, { text: 'klmno', isWrapped: true }];
  const seq = computeClickMoveSequence({
    clickX: 5,
    clickAbsY: 0,
    cursorX: 5,
    cursorAbsY: 1,
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, LEFT.repeat(10));
});

test('click on a different unwrapped row returns null (focus click, old output)', () => {
  const rows = [{ text: 'old output' }, { text: '' }, { text: 'prompt here' }];
  const seq = computeClickMoveSequence({
    clickX: 3,
    clickAbsY: 0,
    cursorX: 7,
    cursorAbsY: 2,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine(rows, 80),
  });
  assert.equal(seq, null);
});

test('click on the cursor cell returns null', () => {
  const seq = computeClickMoveSequence({
    clickX: 7,
    clickAbsY: 0,
    cursorX: 7,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, null);
});

test('click move uses SS3-style arrows in application cursor keys mode', () => {
  const seq = computeClickMoveSequence({
    clickX: 6,
    clickAbsY: 0,
    cursorX: 0,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: true,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, '\x1bOC'.repeat(6));
});

test('click below the cursor line run returns null', () => {
  const rows = [{ text: 'prompt here' }, { text: 'below' }];
  const seq = computeClickMoveSequence({
    clickX: 3,
    clickAbsY: 1,
    cursorX: 7,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine(rows, 80),
  });
  assert.equal(seq, null);
});

test('click in the blank area right of the text walks only to the end of text', () => {
  // Clicking col 40 on an 11-char row moves at most to end of line —
  // padding cells contribute no presses (a click there with the cursor
  // already at EOL sends nothing at all).
  const seq = computeClickMoveSequence({
    clickX: 40,
    clickAbsY: 0,
    cursorX: 5,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, RIGHT.repeat(6));
});

test('click in blank area with cursor at end of text sends nothing', () => {
  const seq = computeClickMoveSequence({
    clickX: 40,
    clickAbsY: 0,
    cursorX: 11,
    cursorAbsY: 0,
    cols: 80,
    applicationCursor: false,
    getLine: makeGetLine([{ text: 'hello world' }], 80),
  });
  assert.equal(seq, null);
});

test('click move counts characters, not cells, over wide characters', () => {
  // Two CJK chars occupy cells 0..4; clicking cell 4 is 2 presses, not 4.
  const cellChars = ['你', '', '好', '', ' ', ' ', ' ', ' ', ' ', ' '];
  const rows = [{ textFn: (a, b) => cellChars.slice(a, b).join('') }];
  const seq = computeClickMoveSequence({
    clickX: 4,
    clickAbsY: 0,
    cursorX: 0,
    cursorAbsY: 0,
    cols: 10,
    applicationCursor: false,
    getLine: makeGetLine(rows, 10),
  });
  assert.equal(seq, RIGHT.repeat(2));
});
