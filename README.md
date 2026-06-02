# PR Diff Risk Score

`pr-diff-risk-score` is a GitHub Action that analyzes a pull request diff and comments with a 1-10 review-quality risk score, the main review-risk drivers, suggested reviewer areas, and short review guidance.

It is designed to help reviewers spot review-quality risk patterns from diff signals (for example, sensitive path changes, missing tests, or bundled/generated files) before review work starts.

## Usage

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
```

The action posts or updates PR comments when `comment-mode` is `update` or `new` and the workflow token has `issues: write` plus `pull-requests: write`.

For open-source repositories, do not run unreviewed PR-local action code with write permissions. A safe dogfood pattern is:

- Use a trusted ref such as a release tag or a protected branch for the commenting job.
- Run PR-local action code separately with `comment-mode: off` and read-only permissions.

## Comment Output

The action posts or updates a PR comment like:

```text
Risk score: 7/10
Risk level: High

Main drivers:
- Database migration changed
- No tests updated
- Auth middleware touched

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

Create `.github/pr-risk-score.yml` to override weights, thresholds, path patterns, or reviewer mappings.

```yaml
weights:
  noTestsChanged: 2
  migrationTouched: 3
  sensitiveTouched: 3

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

## Development

```bash
npm install
npm test
npm run build
```

`npm run build` type-checks the TypeScript source and bundles the action into `dist/index.js`.

## License

MIT
