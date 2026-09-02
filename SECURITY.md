# Security Policy

## Supported versions

Only the latest published version receives security updates. Please upgrade before reporting.

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Instead, report privately using one of the following:

1. **Preferred:** open a private security advisory at
   [https://github.com/NikPnevmatikos/SVG-Renderer/security/advisories/new](https://github.com/NikPnevmatikos/SVG-Renderer/security/advisories/new)
2. Email: `nikpnevmatikos.oss@gmail.com`

Include:

- A description of the issue
- Steps to reproduce (minimal SVG input, library version, platform)
- Impact assessment if you have one

You will receive an initial response within a few days. We appreciate responsible disclosure
and will credit you in the release notes unless you prefer otherwise.

## Scope

The library parses untrusted SVG, so relevant concerns include:

- Parser inputs that cause excessive CPU or memory use (deeply nested documents, huge
  attribute values, pathological path data)
- Regex-based parsing that could suffer catastrophic backtracking
- `<image href>` and `<use href>` handling that could reach unexpected URLs
- Any code path that passes unsanitized document content to platform APIs

Bugs outside this scope (rendering glitches, layout differences) should be filed as regular
public issues.
