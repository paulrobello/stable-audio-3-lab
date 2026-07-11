# Contributing to Stable Audio 3 Lab

This guide explains how to set up a local development environment, run the verification gates, and land a change in Stable Audio 3 Lab. It is a personal lab project that is open to contributors; if you want to add a feature, fix a bug, or improve the docs, this is the path to follow.

The short version: clone, `npm install`, `cp .env.example .env.local`, `make pre-commit-install`, then run `make checkall` before you open a pull request against `main`.

## Table of Contents

- [Expectations](#expectations)
- [Development environment setup](#development-environment-setup)
- [Running the app and tests](#running-the-app-and-tests)
- [Linting and formatting](#linting-and-formatting)
- [Pre-commit hooks](#pre-commit-hooks)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [Project conventions](#project-conventions)
- [Working on the iOS app](#working-on-the-ios-app)
- [Need help?](#need-help)

## Expectations

This is a small, personal lab project that welcomes outside contributors. A few expectations keep it pleasant to work in:

- Be kind and assume good intent. Keep discussions focused on the work.
- Keep changes surgical and focused on the problem at hand. Avoid drive-by refactors of unrelated code.
- Match the surrounding style rather than reformatting files (see [Linting and formatting](#linting-and-formatting)).
- Verify before you submit. Run the gates and confirm the change behaves the way you claim.
- Never commit real secrets, tokens, or generated audio outputs (see [Pre-commit hooks](#pre-commit-hooks)).

## Development environment setup

### Prerequisites

- **Node.js 20+** and npm
- **Python 3.11+**
- **uv** (the Python package manager used by the runtime)
- **ffmpeg and ffprobe** on your `PATH` (used for crop/export and audio analysis)
- macOS on Apple Silicon for real model inference (the UI and tests run elsewhere, but generation targets Apple Silicon)

> **Note:** The steps below cover the web app and tests. For real Stable Audio 3 inference, including accepting the gated model terms, installing the vendored repo, and downloading MLX weights, follow the [Real Stable Audio 3 inference](README.md#real-stable-audio-3-inference) section of the README. You do not need any of that to run mock mode or the test suite.

### Step-by-step setup

1. **Clone the repository.**

   ```bash
   git clone https://github.com/paulrobello/stable-audio-3-lab.git
   cd stable-audio-3-lab
   ```

2. **Install JavaScript dependencies.**

   ```bash
   npm install
   ```

3. **Create your local environment file.**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` to match your machine. `.env.example` documents every supported variable; `.env.local` is gitignored and is where your own keys and paths belong.

4. **Install the pre-commit hooks.**

   ```bash
   make pre-commit-install
   ```

   This wires the hooks for both `pre-commit` and `pre-push` so the secret scan and type-check run before changes leave your machine.

5. **Verify the baseline build works.**

   ```bash
   make checkall
   ```

   If this is green, your environment is ready. If it fails, see [Need help?](#need-help).

## Running the app and tests

### Start the dev server

```bash
make dev
```

The dev server runs on **port 3007** and binds to `0.0.0.0` so other devices on your LAN can reach it. Related lifecycle targets:

```bash
make dev-stop      # kill whatever is on port 3007
make dev-restart   # stop, then start again
```

### Run the verification gates

| Command | What it runs |
| --- | --- |
| `make typecheck` | `tsc --noEmit` |
| `make test` | `vitest run`, then `python3 -m unittest discover -s tests -v` |
| `make build` | `next build` (production build) |
| `make checkall` | `make test` followed by `make build` |

`make checkall` is the authoritative gate. Run it before opening a pull request.

### Run a single test

To iterate on one TypeScript test:

```bash
npx vitest run lib/generation.test.ts
```

To iterate on one Python test:

```bash
python3 -m unittest tests.test_generate_audio
python3 -m unittest tests.test_audio_assessor_qwen_omni
```

## Linting and formatting

This project does not yet have a dedicated linter or formatter. Read this section before you change anything.

- **`make lint` is an alias for `make typecheck`.** It runs `tsc --noEmit` and nothing else. There is no ESLint or Biome step today.
- **`make fmt` is a no-op.** It prints a message and exits. No formatter is configured.

Because of this, style is enforced by review and by the existing code, not by a tool:

- **Do not reformat the codebase.** Match the formatting of the lines around your change.
- **Type-checking is mandatory before commit.** The pre-commit hook runs it for you; if you commit with `--no-verify`, run `make typecheck` yourself.
- Keep diffs small and focused on the actual change so reviewers can read them quickly.

## Pre-commit hooks

Pre-commit is configured in `.pre-commit-config.yaml` and runs on both `pre-commit` and `pre-push`. After `make pre-commit-install`, the following checks fire automatically:

- **gitleaks** scans staged content for secrets, API keys, and tokens.
- **Standard checks** from `pre-commit-hooks`: merge-conflict markers, private keys, end-of-file fixer, mixed line endings, trailing whitespace, plus YAML and JSON validation.
- **Local lint hook** runs `make lint`, which is the TypeScript type-check.

To run every hook across the whole repository (useful before pushing):

```bash
make pre-commit
```

To update hook versions to their latest:

```bash
make pre-commit-update
```

> **Security:** Never commit real API keys, tokens, passwords, or connection strings. Put all secrets — including provider TTS keys (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `DEEPGRAM_API_KEY` / `GEMINI_API_KEY`) — in the app's own `.env.local` (gitignored), never in shared developer credential files such as `~/.claude/.env` (the app no longer reads that file for TTS keys). gitleaks will catch most accidental leaks, but it is your responsibility to keep credentials out of git history. If a secret does slip in, rotate it immediately; rewriting history alone is not enough.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) with a short, imperative subject line. Reference the issue number in the body or subject when relevant.

```
feat(radio): add deepgram DJ announcement provider
fix(assess): correct load-throttle threshold comparison
docs: add CONTRIBUTING guide
chore(deps): bump zod to latest
refactor(library): extract slugification into a pure helper
```

Common prefixes:

| Prefix | Use for |
| --- | --- |
| `feat` | A new user-facing capability |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructuring with no behavior change |
| `chore` | Tooling, deps, config, CI |
| `test` | Adding or correcting tests |

Keep commits atomic: one logical change per commit, with a message that explains the why, not just the what.

## Pull request process

1. **Open a PR against `main`.** Branch from the latest `main` and give the branch a descriptive name.
2. **Verify locally first.** Run `make checkall` (and `make pre-commit`) and confirm it is green before requesting review. Do not rely on CI to find what your machine can.
3. **Describe the change.** The PR description should explain what changed, why, and how it was verified. Link the related issue with `Closes #123` or `Refs #123` when applicable.
4. **Keep diffs focused.** Surgical, reviewable changes land faster than bundled ones. If you spot unrelated dead code, mention it rather than deleting it in the same PR.
5. **Do not commit generated audio outputs.** The `public/outputs/`, `.stable-audio-assessments/`, and `.stable-audio-radio/` directories are gitignored runtime state; leave them out of your diff.
6. **Update documentation alongside code.** If your change alters behavior, an API route, an environment variable, or a workflow, update the README and any related docs in the same PR.

## Project conventions

- **Path alias.** `@/` maps to the project root in both `tsconfig.json` and `vitest.config.ts`. Import shared modules as `@/lib/generation`, not long relative paths.
- **Functional core in `lib/`.** Shared logic lives in `lib/` as pure, testable functions. Prefer pure functions and push side effects (spawning processes, reading the filesystem) to the edges.
- **Validate at route boundaries.** API routes in `app/api/` validate incoming requests with Zod schemas before doing anything else. See `lib/generation.ts` for the canonical pattern.
- **No shell injection.** Always pass argument arrays to `child_process.spawn` and friends; never interpolate user input into a shell string. The Python bridge and assessor subprocesses rely on this.
- **Metadata sidecars.** Every generated audio file is paired with a `.json` sidecar carrying full generation settings, timing, lineage, and any assessment result. Preserve and extend this contract when you touch library code.
- **Documentation accuracy matters.** The README is the source of truth for feature detail; `CLAUDE.md` captures architecture and conventions. Keep both current when behavior changes.

## Working on the iOS app

The native Swift companion lives in `apps/pardora-ios/` and is generated by xcodegen from `project.yml`. It has its own verification gate:

```bash
make pardora-generate     # regenerate the Xcode project from project.yml
make pardora-build        # build
make pardora-test         # test
make pardora-checkall     # the iOS gate (run before proposing iOS changes)
make pardora-run          # boot the Simulator in dark mode and launch the app
```

iOS changes are independent of the web app's `make checkall` gate. If your PR touches Swift, run `make pardora-checkall`; if it touches both, run both gates.

## Need help?

- Start with the [README FAQ](README.md#faq), which covers the most common setup and runtime questions.
- [`docs/troubleshooting/common-errors.md`](docs/troubleshooting/common-errors.md) covers common failure modes (gated-model 401s, missing `ffmpeg`/`yt-dlp`, Ollama down, assessor timeouts, port 3007 conflicts, auth-token misconfig) with diagnosis and fixes.
- [`docs/reference/api.md`](docs/reference/api.md) is the full HTTP API reference for every route.
- [`CLAUDE.md`](CLAUDE.md) documents the command set, architecture, and project conventions in depth.
- [`docs/DOCUMENTATION_STYLE_GUIDE.md`](docs/DOCUMENTATION_STYLE_GUIDE.md) defines the standards this and other docs follow.
- For the full environment variable reference, see [`.env.example`](.env.example).
