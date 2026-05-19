# No Second Mistake

`不贰过` is a local personal operating system for turning daily signals into better systems.

It is intentionally quiet: one day, one or more mistake cards, one principle, one mechanism, and an optional AI dynamics model to help reason about the forces behind the day.

## Overview

Mission Tracker is currently optimized as a local-first personal app, not a collaboration product.

The default experience has no login, comments, sharing, members, invites, or public workspace management. Those older collaboration modules remain in the repository for future work, but they are not part of the primary app surface.

## Core Loop

Each daily card follows the same `No Second Mistake` loop:

1. `Signal / Mistake` - what happened, without self-blame.
2. `Root Condition` - what made the event likely.
3. `Principle` - the reusable rule extracted from the event.
4. `Mechanism / Next Move` - the system, default, or action that prevents repetition.

A single date can hold multiple Daily Loop cards. Use `Add page` to create another card, `Delete` to remove the active card, and `Spread` / `Stack` to review the day as a small poker-card deck.

## Features

- Local daily journal for `不贰过`.
- Multi-card Daily Loop per date, with numbered card badges.
- Ambition anchors for `Entrepreneur`, `RL Research`, and `Family`.
- Autosave to the local Node server.
- Floating manual save island for deliberate `save everything now`.
- AI Dynamics panel for analysis, follow-up conversation, and saved conclusions.
- Human-approved Memory layer for durable patterns, principles, mechanisms, and experiments.
- Saved analysis reader with a large, readable modal view.

## Local Usage

Start the local app:

```bash
npm run local:start
```

Open it in the browser:

```bash
npm run local:open
```

The app runs at:

```text
http://127.0.0.1:4173
```

Stop or restart:

```bash
npm run local:stop
npm run local:restart
```

Optional macOS autostart:

```bash
npm run local:install-autostart
npm run local:uninstall-autostart
```

## AI Setup

Create a local `.env` file in the project root:

```bash
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
OPENAI_BASE_URL=https://api.gptsapi.net/v1
```

Then restart the local app:

```bash
npm run local:restart
```

The API key is read only by the local Node server. It is not embedded in browser code.

## Data & Privacy

Personal tracker data is stored locally:

```text
data/personal-tracker.json
```

Daily records, saved analyses, and accepted memory all live in this local file.

Local data files and `.env` should stay out of git. The app is designed for personal local use first; do not expose it directly to the public internet without adding production-grade authentication, HTTPS, backups, and operational controls.

## Development

Top-level source files are the source of truth:

```text
index.html
styles.css
src/
server/
```

Generated browser artifacts live in:

```text
public/
```

Build generated assets:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Useful static checks:

```bash
node --check server.js
find src server scripts public/src -name '*.js' -print0 | xargs -0 -n1 node --check
node --test test/local-backend.test.js
```
