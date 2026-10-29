import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseINI,
  lexINI,
  resolveSection,
  InheritanceCycleError,
  UnknownParentError,
} from '../src/core.js';

test('simple section without inheritance', () => {
  const r = parseINI('[server]\nhost = localhost\nport = 8080\n');
  assert.deepEqual(r.server, { host: 'localhost', port: '8080' });
});

test('child inherits from parent', () => {
  const r = parseINI(
    '[base]\ntimeout = 30\nretries = 3\n' +
    '[prod : base]\nhost = prod.example\n'
  );
  assert.deepEqual(r.prod, {
    timeout: '30',
    retries: '3',
    host: 'prod.example',
  });
});

test('child overrides parent value', () => {
  const r = parseINI(
    '[base]\ntimeout = 30\n' +
    '[fast : base]\ntimeout = 5\n'
  );
  assert.equal(r.fast.timeout, '5');
});

test('transitive inheritance chain resolves', () => {
  const r = parseINI(
    '[a]\nx = 1\n' +
    '[b : a]\ny = 2\n' +
    '[c : b]\nz = 3\n'
  );
  assert.deepEqual(r.c, { x: '1', y: '2', z: '3' });
});

test('root-level keys go into __root__', () => {
  const r = parseINI('app = demo\n[server]\nport = 80\n');
  assert.deepEqual(r.__root__, { app: 'demo' });
  assert.deepEqual(r.server, { port: '80' });
});

test('comments starting with # or ; are stripped', () => {
  const r = parseINI(
    '# full-line comment\n' +
    '[s]\nkey = val ; trailing comment\n'
  );
  assert.equal(r.s.key, 'val');
});

test('semicolons inside values are preserved', () => {
  const r = parseINI('[s]\nurl = http://x;p=1\n');
  assert.equal(r.s.url, 'http://x;p=1');
});

test('blank lines are ignored', () => {
  const r = parseINI('\n\n[s]\n\nkey = v\n\n');
  assert.deepEqual(r.s, { key: 'v' });
});

test('duplicate sections: later ownKeys replace earlier', () => {
  const r = parseINI('[s]\na = 1\n[s]\nb = 2\n');
  assert.deepEqual(r.s, { b: '2' });
});

test('CRLF line endings parse like LF', () => {
  const r = parseINI('[s]\r\nkey = v\r\n');
  assert.deepEqual(r.s, { key: 'v' });
});

test('direct cycle throws InheritanceCycleError', () => {
  assert.throws(
    () => parseINI('[a : b]\n[b : a]\n'),
    (e) => e instanceof InheritanceCycleError && e.path.includes('a') && e.path.includes('b')
  );
});

test('transitive cycle throws InheritanceCycleError', () => {
  assert.throws(
    () => parseINI('[a : c]\n[b : a]\n[c : b]\n'),
    (e) => e instanceof InheritanceCycleError
  );
});

test('unknown parent throws UnknownParentError', () => {
  assert.throws(
    () => parseINI('[child : ghost]\n'),
    (e) => e instanceof UnknownParentError && e.section === 'child' && e.parent === 'ghost'
  );
});

test('bare word with no equals is ignored', () => {
  const r = parseINI('[s]\nnotakey\nkey = v\n');
  assert.deepEqual(r.s, { key: 'v' });
});

test('parent with no own keys still resolves', () => {
  const r = parseINI('[empty : base]\n[base]\nk = 1\n');
  assert.deepEqual(r.empty, { k: '1' });
});

test('multi-parent directive is treated as a single parent name', () => {
  // The library does not support multi-parent inheritance; the token after
  // ':' is taken literally as one parent name, so [c : b a] looks for a
  // section literally named "b a".
  assert.throws(
    () => parseINI('[c : b a]\n'),
    (e) => e instanceof UnknownParentError && e.parent === 'b a'
  );
});

test('lexINI returns ordered section objects', () => {
  const sections = lexINI('[a]\nx=1\n[b : a]\ny=2\n');
  assert.equal(sections.length, 3);
  assert.equal(sections[0].name, '__root__');
  assert.equal(sections[1].name, 'a');
  assert.equal(sections[2].name, 'b');
  assert.equal(sections[2].parent, 'a');
  assert.deepEqual(sections[1].ownKeys, { x: '1' });
});

test('resolveSection memoises so a parent is resolved once', () => {
  const sections = lexINI('[base]\nk=1\n[c1 : base]\n[c2 : base]\n');
  const byName = new Map();
  for (const s of sections) byName.set(s.name, s);
  const memo = new Map();
  const r1 = resolveSection(byName.get('c1'), byName, memo, new Set());
  assert.equal(memo.size, 2); // base + c1
  const r2 = resolveSection(byName.get('c2'), byName, memo, new Set());
  assert.equal(memo.size, 3); // base + c1 + c2
  assert.deepEqual(r1, { k: '1' });
  assert.deepEqual(r2, { k: '1' });
});

test('self-inheritance is detected as a cycle', () => {
  assert.throws(
    () => parseINI('[a : a]\n'),
    (e) => e instanceof InheritanceCycleError
  );
});

test('whitespace around section names and parent names is trimmed', () => {
  const r = parseINI('[  child  :  parent  ]\n[parent]\nk = 1\n');
  assert.deepEqual(r.child, { k: '1' });
});

test('empty header is ignored', () => {
  const r = parseINI('[]\nkey = v\n');
  assert.deepEqual(r.__root__, { key: 'v' });
});

test('header with colon but empty child name is ignored', () => {
  // [: parent] has no name before the colon, so it is not a valid header.
  const r = parseINI('[: parent]\n[parent]\nk = 1\n');
  assert.deepEqual(r.__root__, {});
  assert.deepEqual(r.parent, { k: '1' });
});

test('value with leading equals sign', () => {
  const r = parseINI('[s]\nkey = =value\n');
  assert.equal(r.s.key, '=value');
});
