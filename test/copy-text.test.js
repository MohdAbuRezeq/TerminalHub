const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanCopiedText } = require('../lib/copy-text');

// Word-wrap `text` the way a TUI does: 2-space indent, break at a word,
// stay within `width` columns, every row ends in a real newline.
function tuiWrap(text, width) {
  const rows = [];
  let row = ' ';
  for (const word of text.split(' ')) {
    if (row.length + 1 + word.length > width) {
      rows.push(row);
      row = ' ';
    }
    row += ' ' + word;
  }
  rows.push(row);
  return rows.join('\n');
}

const PARA_1 =
  'Mir ist bei anderen Hochschulen aufgefallen, dass zum Jahresende oft noch etwas Budget übrig ist, ' +
  'das bis Dezember genutzt werden muss. Falls das bei euch auch so ist: Wir könnten GründerCafé noch ' +
  'dieses Jahr gemeinsam starten, ich richte alles schnell ein, und die Rechnung kommt im Dezember.';
const PARA_2 =
  'Und wenn es bei euch eher 2027 passt, ist das natürlich auch total in Ordnung. Sag mir einfach, ' +
  'wann es für dich besser passt, dann melde ich mich dann wieder.';

test('an email wrapped by a TUI comes out as whole paragraphs', () => {
  const cols = 106;
  const raw = [
    '  Hallo [Name],',
    '',
    '  ich hoffe, bei dir ist alles gut und das Semester läuft entspannt!',
    '',
    tuiWrap(PARA_1, cols - 4),
    '',
    tuiWrap(PARA_2, cols - 4),
    '',
    '  Liebe Grüße',
    '  Moe',
  ].join('\n');

  assert.equal(
    cleanCopiedText(raw, cols),
    [
      'Hallo [Name],',
      '',
      'ich hoffe, bei dir ist alles gut und das Semester läuft entspannt!',
      '',
      PARA_1,
      '',
      PARA_2,
      '',
      'Liebe Grüße',
      'Moe',
    ].join('\n'),
  );
});

test('wrapping right at the terminal edge is undone too', () => {
  const cols = 80;
  assert.equal(cleanCopiedText(tuiWrap(PARA_1, cols), cols), PARA_1);
});

test('short lines stay on their own rows', () => {
  assert.equal(cleanCopiedText('Liebe Grüße\nMoe', 100), 'Liebe Grüße\nMoe');
  assert.equal(cleanCopiedText('$ ls\nmain.js\npackage.json', 100), '$ ls\nmain.js\npackage.json');
});

test('a selection that starts partway along a row counts the skipped columns', () => {
  const cols = 60;
  const rows = tuiWrap(PARA_2, cols - 4).split('\n');
  const startCol = 20;
  const raw = [rows[0].slice(startCol), ...rows.slice(1)].join('\n');
  assert.equal(cleanCopiedText(raw, cols, startCol), PARA_2.slice(startCol - 2));
});

test('a list item is not glued onto a full row above it', () => {
  const cols = 60;
  const full = 'x'.repeat(55);
  assert.equal(
    cleanCopiedText(`- ${full}\n- second item\n2. third item`, cols),
    `- ${full}\n- second item\n2. third item`,
  );
});

test('a row that fills the terminal is glued back with no space', () => {
  const cols = 20;
  assert.equal(cleanCopiedText('a'.repeat(20) + '\nbbb', cols), 'a'.repeat(20) + 'bbb');
});

test('trailing spaces and blank rows are kept tidy', () => {
  assert.equal(cleanCopiedText('one   \n\n  two  ', 80), 'one\n\ntwo');
});
