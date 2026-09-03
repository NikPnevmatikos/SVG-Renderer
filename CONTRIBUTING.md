# Contributing

Thanks for considering contributing to SVG Renderer! This doc covers the essentials.

## Development setup

Requires Node 20+.

```bash
git clone https://github.com/NikPnevmatikos/SVG-Renderer.git
cd SVG-Renderer
npm install           # installs all workspace dependencies
npm run build         # builds packages/core then packages/react-native-svg
npm test              # runs every package's unit tests
npm run typecheck
```

Run the example app in the browser with `npm run example:web`, or on a device with
`npm run android -w example` / `npm run ios -w example` (requires a local Expo setup).

## Project layout

```
packages/core/               svg-core        pure TypeScript, zero dependencies
packages/react-native-svg/   svg-renderer    react-native-svg backend
example/                     Expo app: fixture gallery and benchmarks
fixtures/                    synthetic and open-licensed SVG fixtures
benchmarks/                  fixture generators and Node performance tests
docs/DESIGN.md               architecture, decisions, roadmap
```

## Ground rules

- **Correctness first, measured performance second.** A change that speeds things up but
  changes the picture is a bug. Add a fixture that shows the case you fixed.
- **Nothing silently dropped.** Unsupported SVG features must produce a `SvgWarning`.
- **Core stays pure.** No native code, no React, no runtime dependencies in `packages/core`.
- **Fixtures must be redistributable.** Only synthetic files you created or files under an
  open license may be committed. Never commit client-owned or copyrighted drawings.
- **Tests accompany code.** Unit tests live next to the module (`*.test.ts`).

## Pull requests

1. Fork and create a branch from `main`.
2. Keep changes focused; one topic per PR.
3. Run `npm run build && npm run typecheck && npm test` before pushing.
4. Describe *what* changed and *why*; link the issue when there is one.
5. Add an entry to `CHANGELOG.md` under *Unreleased*.

## Reporting bugs

Please include the smallest SVG that reproduces the problem, the platform (iOS / Android /
web), and the library version. If the file is confidential, reduce it to a minimal synthetic
example that shows the same behaviour.

## Code of conduct

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
