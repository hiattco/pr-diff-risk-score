# AGENTS.md

Project-specific instructions for coding agents working in this repository.

## End-User Documentation

Every branch or PR that changes user-facing behavior, configuration, action inputs, outputs, comments, workflow setup, or operational requirements must update end-user documentation in the same branch.

Required checks before opening or updating a PR:

- Update `README.md` for new or changed public behavior.
- Document every new or changed configuration option, including its default, valid values, and practical meaning.
- Update workflow examples when setup requirements change, such as checkout depth, permissions, secrets, variables, or action inputs.
- Update output/comment examples when labels, scores, JSON fields, reviewer areas, or guidance change.
- Keep regenerated `dist/index.js` and `dist/index.js.map` in sync with source changes.
- Mention documentation changes in the PR summary and include the verification command used.

Do not treat docs as follow-up work for user-facing changes. If a change is not worth documenting for end users, reconsider whether it belongs in the PR.
