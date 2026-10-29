/**
 * INI parsing with section inheritance.
 *
 * Section headers support an inheritance directive:
 *
 *   [child : parent]
 *
 * meaning the child section receives every key from parent unless the child
 * defines that key itself. Child values override parent values; parents are
 * themselves resolved before they are copied, so chains like
 * [c : b], [b : a] resolve transitively.
 *
 * Multi-parent inheritance ([c : b a]) is deliberately NOT supported. The
 * brief is ambiguous about merge order, and supporting it would force a
 * decision about left-vs-right precedence that has no obviously correct
 * answer. One clear rule beats a clever compromise.
 */

/**
 * Raised when two sections inherit from each other, directly or transitively.
 * Carries the path so callers can report where the cycle was detected.
 */
export class InheritanceCycleError extends Error {
  constructor(path) {
    super(`Inheritance cycle detected: ${path.join(' -> ')}`);
    this.name = 'InheritanceCycleError';
    this.path = path;
  }
}

/**
 * Raised when a section names a parent that is never defined.
 */
export class UnknownParentError extends Error {
  constructor(section, parent) {
    super(`Section "${section}" inherits from unknown parent "${parent}"`);
    this.name = 'UnknownParentError';
    this.section = section;
    this.parent = parent;
  }
}

/**
 * Strip an INI-style comment (introduced by # or ;) from a line.
 * A # or ; only starts a comment when it begins the line or follows
 * whitespace, so values like "a=1;b" survive intact.
 */
function stripComment(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '#' || c === ';') {
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

/**
 * Split a section header into [name, parent].
 * Returns null for lines that are not section headers.
 */
function parseSectionHeader(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') {
    return null;
  }
  const colon = inner.indexOf(':');
  if (colon === -1) {
    return { name: inner, parent: null };
  }
  const name = inner.slice(0, colon).trim();
  const parent = inner.slice(colon + 1).trim();
  if (name === '') {
    return null;
  }
  return { name, parent: parent === '' ? null : parent };
}

/**
 * Lex an INI text into an ordered list of sections with their own keys.
 * Keys before any section header are collected under the implicit "__root__"
 * section, which never participates in inheritance.
 */
export function lexINI(text) {
  const lines = text.split('\n');
  const sections = [];
  let current = { name: '__root__', parent: null, ownKeys: {} };
  sections.push(current);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Remove \r so files written with CRLF line endings parse the same as LF.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = parseSectionHeader(line);
    if (header) {
      current = { name: header.name, parent: header.parent, ownKeys: {} };
      sections.push(current);
      continue;
    }
    const stripped = stripComment(line).trim();
    if (stripped === '') {
      continue;
    }
    const eq = stripped.indexOf('=');
    if (eq === -1) {
      // A bare word with no '=' is silently ignored. INI has no syntax for it,
      // and erroring would reject real-world files that contain stray notes.
      continue;
    }
    const key = stripped.slice(0, eq).trim();
    const value = stripped.slice(eq + 1).trim();
    current.ownKeys[key] = value;
  }

  return sections;
}

/**
 * Resolve inheritance for a section, returning its fully-merged key set.
 *
 * Resolution is memoised per parse so each parent is resolved exactly once.
 * An in-progress Set guards against cycles: if we revisit a section whose
 * resolution has not finished, the chain is circular.
 */
export function resolveSection(section, byName, memo, inProgress) {
  if (memo.has(section.name)) {
    return memo.get(section.name);
  }
  if (inProgress.has(section.name)) {
    throw new InheritanceCycleError([...inProgress, section.name]);
  }
  inProgress.add(section.name);

  let merged = {};
  if (section.parent) {
    const parent = byName.get(section.parent);
    if (!parent) {
      throw new UnknownParentError(section.name, section.parent);
    }
    const parentMerged = resolveSection(parent, byName, memo, inProgress);
    for (const k of Object.keys(parentMerged)) {
      merged[k] = parentMerged[k];
    }
  }
  for (const k of Object.keys(section.ownKeys)) {
    merged[k] = section.ownKeys[k];
  }

  inProgress.delete(section.name);
  memo.set(section.name, merged);
  return merged;
}

/**
 * Parse an INI string with section inheritance and return a plain object
 * mapping section name -> { key: value }.
 *
 * The implicit root section (keys before any header) is returned under the
 * key "__root__" so it does not collide with a real section named root.
 */
export function parseINI(text) {
  const sections = lexINI(text);
  const byName = new Map();
  const order = [];
  for (const s of sections) {
    if (!byName.has(s.name)) {
      order.push(s.name);
    } else {
      // Duplicate header: later one wins for ownKeys, parent is overwritten.
      // This matches how most INI readers behave for repeated sections.
      const idx = order.indexOf(s.name);
      if (idx !== -1) {
        order.splice(idx, 1);
      }
      order.push(s.name);
    }
    byName.set(s.name, s);
  }

  const memo = new Map();
  const result = {};
  for (const name of order) {
    result[name] = resolveSection(byName.get(name), byName, memo, new Set());
  }
  return result;
}
