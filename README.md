# AppShip

> AppShip is an open-source AI release assistant that analyzes your mobile app and prepares everything required for App Store and Google Play submission.

Ship your mobile app without spending hours inside App Store Connect and Google Play Console.

**Status: early development (MVP 1, not yet functional).** See [docs/PRD.md](./docs/PRD.md) and [docs/TRD.md](./docs/TRD.md) for the full plan.

## What it will do (MVP 1)

```bash
appship init      # analyze your React Native project, ask a few questions
appship generate  # generate store metadata, privacy docs, legal drafts into .appship/
appship doctor    # check submission readiness and rejection risks (offline)
```

## Principles

1. **AI never invents facts** — every finding carries evidence (file paths), and anything code can't prove is confirmed by you, not assumed.
2. **Your source code stays local** — scanning happens on your machine; only a summary (project type, permissions, SDK list) is sent to the AI provider.
3. **Nothing is submitted without explicit confirmation.**

## Development

```bash
npm install
npm run dev -- --help   # run the CLI
npm test                # run tests
npm run typecheck
```

## License

MIT
