# AppShip

> AppShip is an open-source AI release assistant that analyzes your mobile app and prepares everything required for App Store and Google Play submission.

Ship your mobile app without spending hours inside App Store Connect and Google Play Console.

**Status: MVP 1 implemented (early development).** React Native projects only for now. See [docs/PRD.md](./docs/PRD.md) and [docs/TRD.md](./docs/TRD.md) for the full plan.

## Commands (MVP 1)

```bash
appship init                 # analyze your React Native project, ask a few questions
appship generate             # generate store metadata, privacy docs, legal drafts into .appship/
appship localize ko-KR ja-JP # translate generated listings into more locales
appship export fastlane      # export listings to fastlane deliver/supply layouts (offline)
appship doctor               # check submission readiness and rejection risks (offline)
```

`export fastlane` maps everything under `.appship/` into `fastlane/metadata/` (deliver) and `fastlane/metadata/android/` (supply), plus starter `Appfile`/`Fastfile` upload lanes — existing fastlane files are never overwritten without `--force`. Upload with `bundle exec fastlane ios upload_metadata` / `... android upload_metadata`.

`generate` and `localize` call an AI provider (Anthropic by default) — set `ANTHROPIC_API_KEY` or log in with `ant auth login`. `init` and `doctor` run fully offline. Translations go through the same store character-limit validation as generation; App Review notes are copied, not translated.

Supported projects: React Native CLI and Expo (managed) — identity and permissions are read from native files (`Info.plist`, `AndroidManifest.xml`, `project.pbxproj`, `build.gradle`) or from `app.json`'s `expo` config.

## Using doctor as a CI gate

`appship doctor` exits with code 1 when any error-severity check fails, so it works as a release gate:

```yaml
# .github/workflows/release-readiness.yml
name: Release readiness
on: [pull_request]
jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx appship doctor        # fails the job on ✗ errors
```

Add `--json` for machine-readable output; the full report is also written to `.appship/checklist/release-readiness.json`.

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
