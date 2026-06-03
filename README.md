# PR Diff Risk Score

`pr-diff-risk-score` is a GitHub Action that analyzes a pull request diff and comments with a 1-10 risk score, the main risk drivers, suggested reviewer areas, and short review guidance.

It is designed to help reviewers quickly spot risky PRs, especially in repositories where AI-generated or agent-authored changes are common. In context-aware mode, it can also use local repository history and explicitly configured Markdown architecture docs to explain why a small PR may be risky for this repository.

## Quick Start

```yaml
name: PR Risk Score

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  risk-score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: hiattco/pr-diff-risk-score@v0.1.0
        with:
          github-token: ${{ github.token }}
          fail-threshold: "0"
          comment-mode: update
          mode: heuristic
          history-mode: auto
          architecture-mode: off
```

Add this workflow to `.github/workflows/pr-risk-score.yml`. The action posts or updates PR comments when `comment-mode` is `update` or `new` and the workflow token has `issues: write` plus `pull-requests: write`.

Use `fail-threshold: "0"` to report risk without failing the workflow. Set it to `7`, for example, when high-risk PRs should fail CI.

## Permissions And Safe Setup

The workflow needs:

- `contents: read` to inspect repository files.
- `pull-requests: write` and `issues: write` to create or update the PR comment.

For open-source repositories, do not run unreviewed PR-local action code with write permissions. A safe dogfood pattern is:

- Use a trusted ref such as a release tag or a protected branch for the commenting job.
- Run PR-local action code separately with `comment-mode: off` and read-only permissions.

## Comment Output

The action posts or updates a PR comment like:

```text
Risk score: 7/10
Risk level: High
Review-quality score: 5/10
Overall score: 7/10

Main drivers:
- Database migration changed
- No tests updated
- Auth middleware touched

Review-quality drivers:
- No tests updated

Recommended labels:
- risk:high
- needs-tests
- needs-context
- review-carefully

Suggested reviewer area:
- backend/security

Review guidance:
- Verify migration safety and rollback path
- Confirm auth behavior is covered by tests
- Check for unintended access-control changes
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | `${{ github.token }}` | Token used to read PR files and write comments. |
| `fail-threshold` | No | `0` | Fails the action when the risk score is greater than or equal to this value. `0` disables failure. |
| `comment-mode` | No | `update` | `update` updates the previous bot comment, `new` always creates a new comment, and `off` only logs output. |
| `config-path` | No | `.github/pr-risk-score.yml` | Optional YAML config file path. |
| `mode` | No | `heuristic` | Judge mode. One of `heuristic`, `llm`, or `hybrid`. |
| `llm-model` | No | | Optional model override. Falls back to repository variable `LLM_MODEL` and then action defaults. |
| `history-mode` | No | `auto` | Repository history mode. One of `off`, `auto`, or `local-git`. |
| `history-days` | No | `180` | Lookback window for recent churn, bugfix, and revert history. |
| `bugfix-keywords` | No | `fix,bug,regression,revert,hotfix,incident` | Comma-separated commit-message keywords used to identify bugfix or revert history. |
| `architecture-mode` | No | `off` | Architecture adherence mode. One of `off`, `auto`, or `llm`. |
| `architecture-max-doc-chars` | No | `12000` | Maximum total Markdown architecture context sent to the architecture assessment. |

`heuristic` is the default. `llm` and `hybrid` call an OpenAI-compatible chat completion endpoint when `llm.enabled` is `true`. When `llm.enabled` is `false`, requesting `llm` or `hybrid` logs a warning and falls back to `heuristic`.

## Context-Aware Scoring

History scoring uses local Git history when available. For best results, add `actions/checkout@v4` with `fetch-depth: 0`. Existing workflows that do not checkout the repository still work; `history-mode: auto` skips gracefully when local history is unavailable.

Architecture scoring is LLM-only and evaluates only Markdown docs explicitly configured by path. It supports `.md`, `.mdx`, and `.markdown` text, including Mermaid fences as text. It does not OCR images or infer rules from arbitrary Markdown files. Use clear `must`/`should`/`may` architecture docs for the strongest signal.

## OpenRouter LLM Mode

The LLM path uses the OpenAI-compatible `/chat/completions` API. For OpenRouter, set these GitHub repository variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_BASE_URL` | Yes (for OpenRouter) | Chat endpoint base URL (for example `https://openrouter.ai/api/v1`). |
| `LLM_MODEL` | Yes (for OpenRouter) | Default chat model (for example `openrouter/owl-alpha`). |

Then in the workflow, pass `OPENAI_API_KEY`/`OPENROUTER_API_KEY` as a secret and let the action input use the repository variable:

```yaml
name: PR Risk Score

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  risk-score:
    runs-on: ubuntu-latest
    env:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      OPENAI_BASE_URL: ${{ vars.OPENAI_BASE_URL }}
    steps:
      - uses: hiattco/pr-diff-risk-score@v0.1.0
        with:
          github-token: ${{ github.token }}
          llm-model: ${{ vars.LLM_MODEL }}
          comment-mode: update
          mode: hybrid
```

Use this config at `.github/pr-risk-score.yml`:

```yaml
mode: hybrid
llm:
  enabled: true
  provider: openai
  maxDiffChars: 6000
  requireJson: true
```

For OpenAI directly, set `OPENAI_API_KEY` and omit `OPENAI_BASE_URL`, or set `llm.baseUrl` in config. Do not commit API keys; store them as GitHub Actions secrets.

## Scoring

The scorer starts at `1` and adds points for risk signals, then clamps the final score between `1` and `10`.

| Signal | Points |
| --- | --- |
| 5+ / 15+ / 30+ files changed | +1 / +2 / +3 |
| 200+ / 700+ / 1500+ total line changes | +1 / +2 / +3 |
| Config or dependency files touched | +2 |
| Database or migration files touched | +3 |
| No tests changed | +2 |
| Sensitive auth, security, payment, privacy, or data paths touched | +3 |
| Generated-looking or bundled files changed | +2 |
| Any / 5+ deleted files | +1 / +2 |
| Hotspot or high-churn file touched | +2 |
| Recent bugfix or revert history touched | +2 / +3 |
| Architecture drift | +1 to +4 |

Risk levels:

| Score | Level |
| --- | --- |
| 1-3 | Low |
| 4-6 | Medium |
| 7-8 | High |
| 9-10 | Critical |

## Suggested Reviewer Areas

The action suggests reviewer areas from the strongest matching signals:

| Signal | Reviewer area |
| --- | --- |
| Auth or security touched | `backend/security` |
| Payment or billing touched | `payments` |
| Database or migration touched | `backend/database` |
| GitHub Actions or deployment config touched | `devops/platform` |
| Frontend files touched | `frontend` |
| Test-only PR | `standard-review` |
| Fallback | `codeowners/default` |

## Configuration

Create `.github/pr-risk-score.yml` to override weights, thresholds, path patterns, reviewer mappings, or judge-mode defaults.

```yaml
weights:
  noTestsChanged: 2
  migrationTouched: 3
  sensitiveTouched: 3

mode: heuristic
llm:
  enabled: false
  provider: openai
  # Set model via repository variable LLM_MODEL (for example: openrouter/owl-alpha)
  baseUrl: https://openrouter.ai/api/v1
  maxDiffChars: 6000
  requireJson: true

reviewers:
  auth:
    - backend/security
  payments:
    - payments
  database:
    - backend/database

patterns:
  tests:
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/__tests__/**"
    - "tests/**"

history:
  enabled: true
  mode: auto
  lookbackDays: 180
  recentCommitThreshold: 8
  churnThreshold: 500
  bugfixCommitThreshold: 2
  revertCommitThreshold: 1
  maxHotspotFilesShown: 5

architecture:
  enabled: true
  mode: auto
  strict: false
  context:
    docs:
      - id: backend
        paths:
          - docs/architecture/backend.md
        appliesTo:
          - src/api/**
          - src/services/**
```

Action inputs take precedence over config defaults. For example, `with: { mode: heuristic }` keeps the action in heuristic mode even if the config file sets another mode.

### Configuration Reference

Top-level options:

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `heuristic` | Default judge mode when the workflow input `mode` is omitted. One of `heuristic`, `llm`, or `hybrid`. |
| `weights` | See below | Point values added when a risk signal is present. Scores are clamped from 1 to 10. |
| `thresholds` | `lowMax: 3`, `mediumMax: 6`, `highMax: 8` | Score cutoffs for `Low`, `Medium`, `High`, and `Critical`. Scores above `highMax` are `Critical`. |
| `patterns` | See below | Glob groups used to classify changed files. |
| `reviewers` | See below | Suggested reviewer-area labels for matched file categories. |
| `llm` | Disabled | OpenAI-compatible LLM judge settings. Used only when LLM judging is enabled and selected by `mode`. |
| `history` | Enabled, `auto` | Local Git history settings for hotspot, churn, bugfix, and revert scoring. |
| `architecture` | Disabled | Markdown architecture-adherence settings. Requires explicit docs mapping and LLM config. |

LLM options:

| Option | Default | Meaning |
| --- | --- | --- |
| `llm.enabled` | `false` | Allows LLM judging. If `false`, `llm` and `hybrid` modes fall back to heuristic scoring with a warning. |
| `llm.provider` | `openai` | Provider hint. Use `openrouter` to enable OpenRouter-specific optional headers. |
| `llm.model` | | Model name. Prefer workflow input `llm-model` or repository variable `LLM_MODEL` for repo-level control. |
| `llm.baseUrl` | | OpenAI-compatible API base URL. Environment variables `OPENAI_BASE_URL`, `OPENAI_API_BASE_URL`, and `OPENROUTER_BASE_URL` are also supported. |
| `llm.maxDiffChars` | `6000` | Maximum diff characters sent to the generic LLM judge. Long diffs are truncated. |
| `llm.requireJson` | `true` | Requests and requires structured JSON from the provider. |

Weight options:

| Option | Default | Meaning |
| --- | --- | --- |
| `weights.filesChanged5` | `1` | Points for PRs changing at least 5 files. |
| `weights.filesChanged15` | `2` | Points for PRs changing at least 15 files. |
| `weights.filesChanged30` | `3` | Points for PRs changing at least 30 files. |
| `weights.linesChanged200` | `1` | Points for PRs with at least 200 added/deleted lines. |
| `weights.linesChanged700` | `2` | Points for PRs with at least 700 added/deleted lines. |
| `weights.linesChanged1500` | `3` | Points for PRs with at least 1500 added/deleted lines. |
| `weights.configTouched` | `2` | Points when config, dependency, CI, or runtime files are touched. |
| `weights.migrationTouched` | `3` | Points when database, migration, or schema files are touched. |
| `weights.noTestsChanged` | `2` | Points when no configured test files are changed. |
| `weights.sensitiveTouched` | `3` | Points when auth, security, payment, privacy, or data paths are touched. |
| `weights.generatedTouched` | `2` | Points when generated-looking, bundled, minified, or lock files are touched. |
| `weights.deletedFiles` | `1` | Points when at least one file is deleted. |
| `weights.manyDeletedFiles` | `2` | Points when at least five files are deleted. |
| `weights.hotspotTouched` | `2` | Points when changed files have high recent commit activity. |
| `weights.highChurnTouched` | `2` | Points when changed files have high recent addition/deletion churn. |
| `weights.bugfixHotspotTouched` | `2` | Points when changed files have recent bugfix-related commit history. |
| `weights.recentlyRevertedTouched` | `3` | Points when changed files have recent revert-related history. |
| `weights.architectureMinorDrift` | `1` | Points for the highest architecture finding severity of `minor`. |
| `weights.architectureModerateDrift` | `2` | Points for the highest architecture finding severity of `moderate`. |
| `weights.architectureMajorDrift` | `3` | Points for the highest architecture finding severity of `major`. |
| `weights.architectureCriticalDrift` | `4` | Points for the highest architecture finding severity of `critical`. |

Pattern groups:

| Option | Meaning |
| --- | --- |
| `patterns.config` | Files that indicate CI, dependency, deployment, or runtime configuration changes. |
| `patterns.tests` | Files counted as tests. Used to decide whether a PR changed tests and whether a PR is test-only. |
| `patterns.migrations` | Database, migration, schema, or persistence paths. |
| `patterns.sensitive` | High-risk auth, security, payment, privacy, or data paths. |
| `patterns.auth` | Auth/security paths used for reviewer-area suggestions. |
| `patterns.payments` | Payment/billing paths used for reviewer-area suggestions. |
| `patterns.database` | Database paths used for reviewer-area suggestions. |
| `patterns.devops` | CI, deploy, infra, and platform paths used for reviewer-area suggestions. |
| `patterns.frontend` | Frontend paths used for reviewer-area suggestions. |
| `patterns.generated` | Generated, bundled, minified, build-output, or lockfile paths. History scoring ignores these when possible. |

Reviewer mappings:

| Option | Default | Meaning |
| --- | --- | --- |
| `reviewers.auth` | `backend/security` | Suggested reviewer area for auth/security changes. |
| `reviewers.payments` | `payments` | Suggested reviewer area for payment/billing changes. |
| `reviewers.database` | `backend/database` | Suggested reviewer area for database/migration changes. |
| `reviewers.devops` | `devops/platform` | Suggested reviewer area for CI/deploy/infra changes. |
| `reviewers.frontend` | `frontend` | Suggested reviewer area for frontend changes. |
| `reviewers.testOnly` | `standard-review` | Suggested reviewer area for PRs that only change tests. |
| `reviewers.default` | `codeowners/default` | Fallback reviewer area when no specific category matches. |

History options:

| Option | Default | Meaning |
| --- | --- | --- |
| `history.enabled` | `true` | Allows local Git history scoring. |
| `history.mode` | `auto` | `off` disables history, `auto` skips if local Git history is unavailable, and `local-git` expects a local checkout but warns/skips instead of crashing when unavailable. |
| `history.lookbackDays` | `180` | Number of days of Git history to inspect. |
| `history.recentCommitThreshold` | `8` | Recent commit count that marks a changed file as a hotspot. |
| `history.churnThreshold` | `500` | Recent additions plus deletions that mark a changed file as high churn. |
| `history.bugfixCommitThreshold` | `2` | Bugfix-related commit count that adds bugfix hotspot risk. |
| `history.revertCommitThreshold` | `1` | Revert-related commit count that adds recent-revert risk. |
| `history.maxHotspotFilesShown` | `5` | Maximum hotspot files shown in the PR comment and retained in summary display. |
| `history.bugfixKeywords` | `fix`, `bug`, `regression`, `revert`, `hotfix`, `incident` | Commit-message keywords used to count bugfix-related history. |

Architecture options:

| Option | Default | Meaning |
| --- | --- | --- |
| `architecture.enabled` | `false` | Allows architecture scoring. Also set `architecture.mode` and configure `architecture.context.docs`. |
| `architecture.mode` | `off` | `off` disables scoring, `auto` runs only when docs and LLM config are available, and `llm` attempts LLM scoring when enabled. |
| `architecture.strict` | `false` | When `true` with `architecture.mode: llm`, invalid or unavailable LLM assessment fails instead of skipping. |
| `architecture.maxDocChars` | `12000` | Maximum Markdown doc context sent to the architecture assessment. |
| `architecture.maxDiffChars` | `8000` | Maximum diff context sent to the architecture assessment. |
| `architecture.includePrBody` | `true` | Reserved for including PR body context in architecture assessment. |
| `architecture.requireMappedDocs` | `false` | Reserved for stricter behavior when no configured docs match changed files. Current behavior skips without adding risk. |
| `architecture.maxFindingsShown` | `5` | Maximum architecture findings intended for display. |
| `architecture.context.docs` | `[]` | Explicit doc groups mapping Markdown files to changed-file globs. The action does not auto-read arbitrary Markdown files. |
| `architecture.severityWeights.minor` | `1` | Architecture score weight for minor drift. |
| `architecture.severityWeights.moderate` | `2` | Architecture score weight for moderate drift. |
| `architecture.severityWeights.major` | `3` | Architecture score weight for major drift. |
| `architecture.severityWeights.critical` | `4` | Architecture score weight for critical drift. |

Architecture doc group options:

| Option | Meaning |
| --- | --- |
| `id` | Stable identifier used in findings and JSON output. |
| `label` | Optional human-readable name for the doc group. |
| `paths` | Markdown doc paths to load. Supported extensions are `.md`, `.mdx`, and `.markdown`. |
| `appliesTo` | Glob patterns for changed files governed by the docs. At least one changed file must match for the group to be evaluated. |

See `examples/openrouter-workflow.yml` for a full reusable workflow template using repo variables.

## Development

```bash
npm install
npm test
npm run build
npm run ci
```

`npm run build` type-checks the TypeScript source and bundles the action into `dist/index.js`. `npm run ci` runs typecheck, tests, and build in the same order used by CI.

When changing `src/**`, commit the regenerated `dist/index.js` and `dist/index.js.map` files. GitHub Actions run the bundled `dist/index.js`, not the TypeScript source.

### Testing LLM Mode

Run the mocked OpenAI-compatible endpoint tests:

```bash
npm test -- tests/llm.test.ts
```

Run the full CI gate and regenerate the bundled action:

```bash
npm run ci
```

To test against OpenRouter from a workflow, add `OPENROUTER_API_KEY` as a repository secret, set `OPENAI_BASE_URL` (for example via repository variables), set `mode: hybrid` or `mode: llm`, and use the LLM config shown above.

## Configuration-first "how to"

1. Set repo variables:
   - `OPENAI_BASE_URL` (required for OpenRouter)
   - `LLM_MODEL` (model for all runs unless overridden by workflow input)
2. Set `OPENROUTER_API_KEY` or `OPENAI_API_KEY` as a secret.
3. Keep `.github/pr-risk-score.yml` provider + scorer settings; omit `llm.model` unless you want hard-coded per-repo behavior.
4. In workflow input, pass `llm-model: ${{ vars.LLM_MODEL }}`.

A practical example with these defaults is:

```yaml
jobs:
  risk-score:
    runs-on: ubuntu-latest
    env:
      OPENAI_BASE_URL: ${{ vars.OPENAI_BASE_URL }}
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    steps:
      - uses: hiattco/pr-diff-risk-score@v0.1.0
        with:
          github-token: ${{ github.token }}
          llm-model: ${{ vars.LLM_MODEL }}
          mode: hybrid
```

## License

MIT
