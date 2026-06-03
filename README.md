# PR Diff Risk Score

`pr-diff-risk-score` is a GitHub Action that analyzes a pull request diff and comments with a 1-10 risk score, the main risk drivers, suggested reviewer areas, and short review guidance.

It is designed to help reviewers quickly spot risky PRs, especially in repositories where AI-generated or agent-authored changes are common.

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
      - uses: hiattco/pr-diff-risk-score@v0.1.0
        with:
          github-token: ${{ github.token }}
          fail-threshold: "0"
          comment-mode: update
          mode: heuristic
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

`heuristic` is the default. `llm` and `hybrid` call an OpenAI-compatible chat completion endpoint when `llm.enabled` is `true`. When `llm.enabled` is `false`, requesting `llm` or `hybrid` logs a warning and falls back to `heuristic`.

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
```

Action inputs take precedence over config defaults. For example, `with: { mode: heuristic }` keeps the action in heuristic mode even if the config file sets another mode.

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
