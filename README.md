# AppShip

> AppShip is an open-source AI release assistant that analyzes your mobile app and prepares everything required for App Store and Google Play submission.

Ship your mobile app without spending hours inside App Store Connect and Google Play Console.

**Status: MVP 3 implemented (early development).** React Native, Expo, Flutter, native iOS, and native Android projects. See [docs/PRD.md](./docs/PRD.md) and [docs/TRD.md](./docs/TRD.md) for the full plan.

## Commands

```bash
appship init                 # analyze your React Native project, ask a few questions
appship generate             # generate store metadata, privacy docs, legal drafts into .appship/
appship localize ko-KR ja-JP # translate generated listings into more locales
appship export fastlane      # export listings to fastlane deliver/supply layouts (offline)
appship export ci            # generate GitHub Actions workflows (readiness gate + release)
appship upload ios           # upload a built .ipa to TestFlight via fastlane
appship upload android       # upload a built .aab to a Play track (default: internal)
appship screenshots flows    # turn the screenshot plan into Maestro flows (offline)
appship screenshots capture  # run the flows on a device/emulator via Maestro
appship submit ios           # submit the latest uploaded build for App Store review
appship submit android       # promote a tested Play track to production review
appship doctor               # check submission readiness and rejection risks (offline)
appship review analyze r.txt # turn a store rejection message into a fix plan
appship rules update         # fetch the latest policy rules & SDK signatures
```

`export fastlane` maps everything under `.appship/` into `fastlane/metadata/` (deliver) and `fastlane/metadata/android/` (supply), plus starter `Appfile`/`Fastfile` upload lanes — existing fastlane files are never overwritten without `--force`. Upload with `bundle exec fastlane ios upload_metadata` / `... android upload_metadata`.

`export ci` writes two GitHub Actions workflows: a readiness gate that runs `appship doctor` on every PR (works out of the box — doctor is offline), and a `workflow_dispatch` release pipeline that builds, uploads via `appship upload --yes`, and optionally submits. The build steps are project-specific, so they carry `TODO(appship)` markers for you to finish (Android is pre-filled for gradle/Expo prebuild; iOS signing needs your fastlane match setup). Existing workflow files are never overwritten without `--force`.

`upload` finds your newest built artifact (or takes `--ipa`/`--aab`), shows exactly what will run, asks for confirmation (`--yes` to skip, required in CI), then delegates to the fastlane lanes from `export fastlane`. fastlane owns store auth — set up an App Store Connect API key / Play service account per fastlane's docs.

`submit` is the confirmation-gated final step. It first runs the doctor checks for the target store and refuses on error-severity failures (`--force` to override), shows exactly what will run, then asks for confirmation (`--yes` to skip, required in CI). iOS submits the latest build already on App Store Connect (`--build-number` to pick one) with manual release after approval; Android promotes a tested track (`--from-track`, default `internal`) to `--track` (default `production`). Like `upload`, it delegates to the `:submit_review` fastlane lanes from `export fastlane` — re-export with `--force` if your Fastfile predates them.

`screenshots flows` generates one [Maestro](https://maestro.mobile.dev) flow per screen in the plan; each flow carries a navigation TODO that only you can fill in (appship can't know how to reach your screens). `capture` refuses to run while TODOs remain, then runs `maestro test` and drops PNGs into `.appship/screenshots/raw/`. Your edited flows are never overwritten without `--force`.

`review analyze` reads a rejection message you copied from App Store Connect / Play Console into a text file, and produces per-issue fix steps, the appship commands that help, and (for issues resolvable by replying) a draft response to the review team — written to `.appship/review/rejection-analysis.md`. Guidelines are only cited when the message cites them; nothing is invented beyond the message and the scanned project facts.

Store policies change between releases, so the doctor rules and SDK signature database are plain data files that can be refreshed without a new CLI version: `appship rules update` downloads them from this repository into `~/.appship/data-cache` (schema-validated before anything is written; nothing partial is ever observable), `rules status` shows what is in use, and `rules reset` returns to the bundled files. If a cached file ever stops parsing (e.g. you run a much newer rule format with an old CLI), appship silently falls back to its bundled data.

`generate`, `localize`, and `review analyze` call an AI provider (Anthropic by default) — set `ANTHROPIC_API_KEY` or log in with `ant auth login`. `init` and `doctor` run fully offline. Translations go through the same store character-limit validation as generation; App Review notes are copied, not translated.

Supported projects: React Native CLI, Expo (managed), Flutter, native iOS (`.xcodeproj` at the root), and native Android (`settings.gradle` + `app/` module) — identity and permissions are read from native files (`Info.plist`, `AndroidManifest.xml`, `project.pbxproj`, `build.gradle`), from `app.json`'s `expo` config, or from `pubspec.yaml`. SDK detection matches npm packages, Dart/Flutter packages, CocoaPods, and Gradle Maven coordinates, plus source patterns in JS/TS, Dart, Swift, Kotlin, and Java.

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
