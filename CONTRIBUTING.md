# Contributing

Thanks for helping improve `pr-diff-risk-score`.

## Development

```bash
npm install
npm test
npm run build
```

`npm run build` type-checks the TypeScript source and updates the bundled action in `dist/index.js`.

## Pull requests

- Keep changes focused.
- Add or update tests when behavior changes.
- Run `npm run ci` before requesting review.
- Include the generated `dist/index.js` bundle when changing `src/**`.

## Security issues

Do not open a public issue for suspected vulnerabilities. Follow the reporting process in `SECURITY.md`.
