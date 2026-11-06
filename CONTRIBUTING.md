# Contributing

## Branch layout

- `dev` is where feature work lands.
- `main` receives merges from `dev` and hosts stable tags for the current major.
- Previous majors live on maintenance branches such as `v1`.
- Pre-release tags are cut from `dev`; stable tags are cut from `main`, or from the matching `vN` maintenance branch for an older major.

## Build

```bash
npm ci
npm run build
```

Do not hand-edit `dist/`. It is produced by `tsc --noEmit && ncc build src/index.ts -o dist --minify` and committed because GitHub Actions do not run a build step. It is the shipped artifact, not a disposable output.

## Tests

```bash
npm run test
npm run test:watch
```

Fixtures live in `tests/fixtures/`. Tests must not depend on network access or on a real Git repository; command execution and HTTP calls are injected.

CI does not run on branch pushes or pull requests. It runs only from the Self Release workflow, against the tag being released.

## Release process

1. Bump the version with `npm version <patch|minor|major>`.
2. Push the resulting tag to `dev` for a pre-release, to `main` for a stable release, or to the matching `vN` maintenance branch for an older major.
3. Watch the Self Release workflow. It runs the CI workflow against the tag first. If CI fails, the release job does not run. If CI passes, it generates and publishes the release, then moves the floating tag that matches the tag's major version.

## Major versions

A new major starts only for breaking changes. Before tagging the first release of a new major:

1. Land the workflow change that derives the floating tag from the tag's major version.
2. Tag the new major from `main`.
3. If the previous major is still supported, cut a maintenance branch from its last tag and backport the workflow change there before cutting further releases.

The workflow inside each tag moves that tag's major alias. This means `v1.5.0` moves `v1` and `v2.0.0` moves `v2`; a v2 release never moves a v1 alias.

## Floating tags

Each major has two aliases:

| Tag pushed      | Floating tag moved |
| --------------- | ------------------ |
| `v1.5.0`        | `v1`               |
| `v1.5.0-beta.1` | `v1-beta`          |
| `v2.0.0`        | `v2`               |
| `v2.0.0-beta.1` | `v2-beta`          |

All aliases are force-moved. Protect them with an organisation ruleset that prevents deletion but permits force-pushes from `github-actions[bot]`.

## Why the repository releases itself

The Self Release workflow uses `uses: ./`. That exercises the action against its own history on every release, so a broken action fails its own release.

## Pull requests

- Use Conventional Commits for the PR title.
- Add tests for behaviour changes.
- Rebuild and commit `dist/` before opening the PR.
- Update the README when inputs, outputs, or behaviour change.
- Do not use emojis in workflow files or step labels.
