# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the packages use
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Monorepo scaffold: `packages/core` (`@nikpnevmatikos/svg-core`),
  `packages/react-native-svg` (`@nikpnevmatikos/svg-renderer`), Expo example app, CI.
- `svg-core`: dependency-free XML tokenizer, transform parsing, path data parsing with exact
  bounding boxes (arcs converted to cubics), presentation-attribute and inline-style
  resolution with inheritance, document builder producing a typed scene graph, pass-through
  render planner, minimal `querySelectorAll`, warnings for unsupported features.
- `svg-renderer`: `<SvgRenderer>` rendering a render plan through `react-native-svg`.
- Synthetic fixtures and a generator for 1k / 10k / 50k element benchmark files.
- Design document (`docs/DESIGN.md`).
