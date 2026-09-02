# Fixtures

SVG files used by tests, the example app and benchmarks.

- `synthetic/` — hand-written files that exercise specific features. Redistributable.
- `generated/` — large grids produced by `npm run fixtures:generate` (git-ignored).

Rules:

- Only synthetic files or files under an open license may be committed. Client-owned or
  copyrighted drawings never go into this repository; keep them in a git-ignored
  `fixtures-private/` folder if you need them locally.
- Name files after what they test (`text-anchors.svg`, not `test3.svg`).
- When adding a file exported from a design tool, note the tool and version in a comment at
  the top of the file.
