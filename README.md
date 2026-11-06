# releaselog

[![Release](https://img.shields.io/github/v/release/devs-des1re/releaselog?include_prereleases)](https://github.com/devs-des1re/releaselog/releases)
[![License](https://img.shields.io/github/license/devs-des1re/releaselog)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](./.nvmrc)
[![Marketplace](https://img.shields.io/badge/marketplace-releaselog-blue)](https://github.com/marketplace/actions/releaselog)
[![Tests](https://img.shields.io/github/actions/workflow/status/devs-des1re/releaselog/ci.yml?branch=main&label=tests)](https://github.com/devs-des1re/releaselog/actions/workflows/ci.yml)

`releaselog` turns the commits between two Git tags into structured release notes and publishes them as a GitHub Release, an appended `CHANGELOG.md` entry, and an output string. It classifies conventional commits, links PRs and contributors, and can optionally rewrite the prose with an AI provider. Without AI, the output is fully deterministic.

With `breaking-changes: true`, commits marked with `!` or a `BREAKING CHANGE:` footer are listed under Breaking Changes instead of their normal section.

## Minimal workflow

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      current-tag:
        required: false
        type: string
      previous-tag:
        required: false
        type: string
      dry-run:
        required: false
        type: boolean
        default: false

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true

      - uses: devs-des1re/releaselog@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          dev-branch: dev
          current-tag: ${{ inputs.current-tag }}
          previous-tag: ${{ inputs.previous-tag }}
          dry-run: ${{ inputs.dry-run }}
```

`fetch-depth: 0` is required. The action reads tags and full history.

## Full workflow

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      current-tag:
        required: false
        type: string
      previous-tag:
        required: false
        type: string
      dry-run:
        required: false
        type: boolean
        default: false

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true

      - uses: devs-des1re/releaselog@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }} # needs contents: write
          dev-branch: dev # branch used for pre-release work
          main-branch: main # branch used for stable releases
          current-tag: ${{ inputs.current-tag }} # empty on a tag push uses GITHUB_REF
          previous-tag: ${{ inputs.previous-tag }} # empty means auto-detect
          dry-run: ${{ inputs.dry-run }} # write outputs and files without publishing
          publish: true # create or update the GitHub Release
          release-name: ${{ inputs.current-tag }} # empty means the current tag
          release-draft: false # create the release as a draft
          release-prerelease: auto # mirror the tag, or force true or false
          output-file: '' # write the generated Markdown here
          changelog-file: '' # append a versioned entry here
          template-path: '' # full Handlebars template override
          config-path: .releaselog.yml # optional YAML configuration file
          tag-order: semver # semver or date
          base-version-granularity: patch # patch or minor pre-release grouping
          exclude-bots: false # skip bot authors
          include-merge-commits: true # keep non-squash merge commits
          include-pr-numbers: true # link trailing PR numbers
          breaking-changes: true # emit a Breaking Changes section
          allow-post-tag-commits: false # use the tag SHA, not the branch head
          require-contributor-pings: false # fail when an author is unresolved
          contributor-ping-fuzzy-name-search: false # optional full-name search
          humanize: false # rewrite descriptions with AI
          ai-mode: vercel # vercel or raw
          ai-provider: openai # openai, anthropic, google, or openai-compatible
          ai-model: gpt-4o-mini # provider model identifier
          ai-endpoint: '' # base URL for openai-compatible
          ai-api-key: ${{ secrets.OPENAI_API_KEY }} # required when humanize is true
          ai-temperature: 0.3 # sampling temperature from 0 to 1
          ai-system-prompt: '' # override the default prompt
          ai-on-error: fallback # keep the raw changelog, or fail
```

## Inputs

| Input                                | Required      | Default           | Description                                                                 |
| ------------------------------------ | ------------- | ----------------- | --------------------------------------------------------------------------- |
| `token`                              | yes           | -                 | GitHub token with `contents: write`. `GITHUB_TOKEN` or a PAT.               |
| `dev-branch`                         | yes           | -                 | Branch for pre-release work.                                                |
| `main-branch`                        | no            | `main`            | Branch for stable releases.                                                 |
| `current-tag`                        | no            | trigger ref       | Tag being released.                                                         |
| `previous-tag`                       | no            | auto              | Override auto-detection. Trusted verbatim, with no validation.              |
| `dry-run`                            | no            | `false`           | Generate, emit outputs, and write files; skip publishing. AI still runs.    |
| `publish`                            | no            | `true`            | Toggle GitHub Release publishing.                                           |
| `release-name`                       | no            | current tag       | Release name.                                                               |
| `release-draft`                      | no            | `false`           | Create the release as a draft.                                              |
| `release-prerelease`                 | no            | `auto`            | `auto` mirrors the tag; `true` or `false` forces it.                        |
| `output-file`                        | no            | empty             | Write the generated Markdown to this path. Written in `dry-run` too.        |
| `changelog-file`                     | no            | empty             | Append a versioned entry to this file. Written in `dry-run` too.            |
| `template-path`                      | no            | empty             | Handlebars template that replaces the built-in renderer.                    |
| `config-path`                        | no            | `.releaselog.yml` | YAML configuration file. Absence is ignored.                                |
| `tag-order`                          | no            | `semver`          | `semver` or `date`.                                                         |
| `base-version-granularity`           | no            | `patch`           | `patch` or `minor`. Defines "same base version" for pre-release resolution. |
| `exclude-bots`                       | no            | `false`           | Skip `*[bot]` authors.                                                      |
| `include-merge-commits`              | no            | `true`            | When `false`, drop non-squash merge commits.                                |
| `include-pr-numbers`                 | no            | `true`            | Extract trailing `(#123)` and link the PR.                                  |
| `breaking-changes`                   | no            | `false`           | Emit a Breaking Changes section when breaking commits exist.                |
| `allow-post-tag-commits`             | no            | `false`           | Use the branch head instead of the tag commit as the range end.             |
| `require-contributor-pings`          | no            | `false`           | Fail when an author cannot be resolved to a GitHub login.                   |
| `contributor-ping-fuzzy-name-search` | no            | `false`           | Enable the fourth resolution step: search users by full name.               |
| `humanize`                           | no            | `false`           | Rewrite the changelog with an AI provider.                                  |
| `ai-mode`                            | no            | `vercel`          | `vercel` or `raw`.                                                          |
| `ai-provider`                        | no            | `openai`          | `openai`, `anthropic`, `google`, or `openai-compatible`.                    |
| `ai-model`                           | no            | `gpt-4o-mini`     | Model identifier.                                                           |
| `ai-endpoint`                        | no            | empty             | Base URL override. Required for `openai-compatible`.                        |
| `ai-api-key`                         | when humanize | -                 | Provider API key.                                                           |
| `ai-temperature`                     | no            | `0.3`             | Sampling temperature from 0 to 1.                                           |
| `ai-system-prompt`                   | no            | empty             | Override the default humanisation prompt.                                   |
| `ai-on-error`                        | no            | `fallback`        | `fallback` keeps the raw changelog and warns; `fail` stops the action.      |

Inputs override `.releaselog.yml`. Defaults are applied after the config file is merged, so a value left unset falls through to config and then to the default above.

## Outputs

| Output         | Description                                              |
| -------------- | -------------------------------------------------------- |
| `changelog`    | Full generated Markdown.                                 |
| `previous-tag` | Resolved previous tag, empty on the first release.       |
| `current-tag`  | Resolved current tag.                                    |
| `release-url`  | Created or edited release URL, empty when not published. |
| `humanized`    | `true` or `false`.                                       |

## How tags are resolved

Tags are read from Git, never inferred from dates unless `tag-order: date`.

- A **stable** tag takes the newest stable tag that is an ancestor of the current tag and reachable from `main-branch`.
- A **pre-release** tag first looks for an earlier pre-release of the same base version. With the default `patch` granularity, `v0.2.0-beta.2` looks for `v0.2.0-beta.1`. It then falls back to the stable release of that base (`v0.2.0`).
- If neither exists, the newest stable tag that is an ancestor of the current tag and reachable from `dev-branch` is used.
- With `base-version-granularity: minor`, pre-releases are grouped by major and minor version, so `v0.2.0-beta.1` and `v0.2.1-beta.1` share the `v0.2` base.
- If no previous tag exists, the release is treated as a first release and the Full Change Log links to the commit list for the tag.
- `previous-tag` overrides all of the above and is used verbatim. It is not checked for existence or ancestry.

Tag names should be valid semver, with a leading `v` when that is your convention.

## AI setup

Humanisation rewrites the description of each bullet while preserving headings, section names, bullet count, SHA links, PR links, mentions, and the compare URL.

OpenAI:

```yaml
- uses: devs-des1re/releaselog@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    dev-branch: dev
    humanize: true
    ai-provider: openai
    ai-model: gpt-4o-mini
    ai-api-key: ${{ secrets.OPENAI_API_KEY }}
    ai-on-error: fallback
```

Anthropic:

```yaml
- uses: devs-des1re/releaselog@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    dev-branch: dev
    humanize: true
    ai-provider: anthropic
    ai-model: claude-3-5-sonnet-latest
    ai-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Ollama or another OpenAI-compatible endpoint:

```yaml
- uses: devs-des1re/releaselog@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    dev-branch: dev
    humanize: true
    ai-provider: openai-compatible
    ai-endpoint: http://localhost:11434/v1
    ai-model: llama3.2
    ai-api-key: ollama
```

GitHub-hosted runners cannot reach a service on your laptop. Point `ai-endpoint` at a reachable host when using a self-hosted model.

With `ai-on-error: fallback`, a failed AI call logs a warning, publishes the raw changelog, and emits `humanized: false`. With `fail`, the action stops before publishing.

## Customisation

Every setting is optional. The file is loaded from `config-path`, and inputs win when both are set.

```yaml
tag:
  order: semver
  base_version_granularity: patch
sections:
  breaking: { enabled: true, header: 'Breaking Changes' }
  features: { header: 'New Features' }
  fixes: { header: 'Bug Fixes' }
  docs: { header: 'Docs Changes' }
  other: { header: 'Other Changes' }
template: ./templates/release.hbs
commits:
  exclude_bots: false
  include_merge_commits: true
  include_pr_numbers: true
  allow_post_tag_commits: false
contributors:
  require_pings: false
  fuzzy_name_search: false
humanize:
  enabled: false
  mode: vercel
  provider: openai
  model: gpt-4o-mini
  endpoint: ''
  temperature: 0.3
  on_error: fallback
publish:
  release: true
  draft: false
  prerelease: auto
  output_file: ''
  changelog_file: ''
```

A custom Handlebars template replaces the entire built-in renderer. It receives:

- `breaking_changes`, `new_features`, `bug_fixes`, `docs_changes`, `other_changes`, `contributors`
- `tag`, `previous_tag`, `compare_url`, `owner`, `repo`

Each commit exposes `sha`, `shortSha`, `desc`, `commitUrl`, `prNumber`, `prUrl`, `type`, `scope`, and `breaking`. Each contributor exposes `login`, `name`, `email`, `commitCount`, and `resolved`.

<!-- prettier-ignore -->
```hbs
# {{tag}}

{{#if breaking_changes.length}}
## Breaking Changes
{{#each breaking_changes}}
- {{desc}} ([{{shortSha}}]({{commitUrl}})){{#if prNumber}} ([#{{prNumber}}]({{prUrl}})){{/if}}
{{/each}}
{{/if}}

{{#if new_features.length}}
## New Features
{{#each new_features}}
- {{desc}} ([{{shortSha}}]({{commitUrl}})){{#if prNumber}} ([#{{prNumber}}]({{prUrl}})){{/if}}
{{/each}}
{{/if}}

## Contributors
{{#each contributors}}
- {{#if login}}@{{login}}{{else}}{{name}}{{/if}} has made {{commitCount}} commit(s)
{{/each}}

## Full Change Log
{{compare_url}}
```

Descriptions are pre-escaped for Markdown, so custom templates should use `{{desc}}` rather than `{{{desc}}}`.

When `changelog-file` is set, each run appends a `## <tag>` entry followed by the generated Markdown, separated by a blank line.

## Floating tags

Each major version gets its own stable and pre-release alias:

- `@v1` tracks the latest `v1.x` stable release.
- `@v1-beta` tracks the latest `v1.x` pre-release.
- `@v2` tracks the latest `v2.x` stable release.
- `@v2-beta` tracks the latest `v2.x` pre-release.

The self-release workflow reads the major version from the tag, so `v1.5.0` moves only `v1`, `v2.0.0` moves only `v2`, and their pre-releases move the matching `-beta` alias. A v2 release never moves a v1 alias.

All aliases are force-moved. Protect them with an organisation ruleset that prevents deletion but permits force-pushes from `github-actions[bot]`.

If you continue maintaining v1 after v2, keep a `v1` branch for v1 fixes. The workflow inside each tag moves that tag's major alias, so backport the floating-tag workflow change to the maintenance branch before cutting further v1 releases.

## Troubleshooting

**Shallow clone.** Read tags and history by setting `fetch-depth: 0` and `fetch-tags: true` on `actions/checkout`.

**Permission denied when publishing.** The workflow needs `permissions: contents: write`, and the token must be able to create releases.

**Contributors are not pinged.** By default unresolved authors render by name and a warning is logged. Set `require-contributor-pings: true` to fail instead, and enable `contributor-ping-fuzzy-name-search: true` to add the optional name-search step. Name search can mis-ping common names.

**AI output did not change.** Check the `humanized` output. With `ai-on-error: fallback`, provider errors keep the raw changelog and log a warning.

**No previous tag was found.** That is first-release mode. The action still publishes and links the Full Change Log to the tag's commit list.

## Migration from devs-des1re/actions

The original action exposed no inputs. This action is additive: every new input is opt-in or has a matching default, so existing tag-push workflows keep working.

## For maintainers

Feature work lands on `dev`; `main` receives merges from `dev` and hosts stable tags. When a new major starts, previous majors move to maintenance branches such as `v1`. A tag push runs CI against that tag before publishing, so a failed CI run blocks the release. The action is built with `tsc` and bundled with `@vercel/ncc`, and `dist/` is committed because GitHub Actions do not run a build step. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full release process. The repository releases itself with `uses: ./`, so a broken action fails its own release.

## License

MIT. See [LICENSE](./LICENSE).
