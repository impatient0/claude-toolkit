import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflow } from '../scripts/reflow-docs.mjs';

test('splits a paragraph at sentence ends, one sentence per line', () => {
  assert.equal(reflow('One sentence here. Another one follows.\n'), 'One sentence here.\nAnother one follows.\n');
});

test('a colon inside an inline code span is not a sentence boundary', () => {
  assert.equal(
    reflow('The token `--radius: 4px` sets it. Next sentence.\n'),
    'The token `--radius: 4px` sets it.\nNext sentence.\n',
  );
});

test('a semicolon inside an inline code span is not a sentence boundary', () => {
  assert.equal(
    reflow('Run `cd x; B=1 make` to build. Then test.\n'),
    'Run `cd x; B=1 make` to build.\nThen test.\n',
  );
});

test('an unbalanced paren inside a code span does not suppress later splits', () => {
  assert.equal(reflow('Call `foo(` to start. Next sentence.\n'), 'Call `foo(` to start.\nNext sentence.\n');
});

test('reflow is idempotent, which is what makes --check exact', () => {
  const source = 'Set `a: 1` and `b; C` here. Call `f(` next: Then stop.\nA wrapped\nparagraph. Ends.\n';
  const once = reflow(source);
  assert.equal(reflow(once), once);
});
