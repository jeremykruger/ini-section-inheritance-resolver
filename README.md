# ini-section-inheritance-resolver

Parses INI files with section inheritance directives like `[child : parent]` and produces merged configuration objects.

## Usage

```js
import { parseINI } from 'ini-section-inheritance-resolver';

const config = parseINI(`
[base]
timeout = 30
retries = 3

[prod : base]
host = prod.example
timeout = 60
`);

// config.prod === { timeout: '60', retries: '3', host: 'prod.example' }
// config.base === { timeout: '30', retries: '3' }
// config.__root__ === {}
```

Exports:
- `parseINI(text)` — returns `{ [sectionName]: { key: value } }`.
- `InheritanceCycleError` — thrown when a section inherits from itself, directly or transitively; has a `.path` array.
- `UnknownParentError` — thrown when a section names a parent that is never defined; has `.section` and `.parent`.

## Why

Configuration files accumulate. A staging environment is a production environment with two values changed; a local dev box is staging with a different host. Writing those as full copies means every future edit to the base must be repeated in every child. `[child : parent]` lets each child declare only what differs.

The trade-off: this is a line-oriented parser, not a schema validator. Values are strings. There is no type coercion, no list syntax, no nested sections. If you need those, reach for a richer format.

## Edges you will hit

- **Multi-parent inheritance is not supported.** `[c : b a]` is parsed as a child inheriting from a section literally named `"b a"`, which will throw `UnknownParentError`. Supporting multiple parents would force a decision about left-vs-right precedence with no obviously correct answer, so the library makes one rule: one parent per section.
- **Keys before any section header** are collected under `__root__`. This keeps them accessible without inventing a section.
- **Comments** start with `#` or `;` at the start of a line or after whitespace. A `;` inside a value (`url = http://x;p=1`) is preserved.
- **Duplicate sections**: the last definition wins. A second `[s]` header replaces the first section's own keys; the parent directive from the last header is used.
- **CRLF** line endings are handled transparently.
