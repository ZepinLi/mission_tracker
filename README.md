# Mission Tracker

A local, dependency-free tracker for mission, identity votes, daily actions, and principle iteration.

Open `index.html` in a browser. Data is saved in browser `localStorage` under `missionTracker.v1`.

## Foundation

This project is grounded in the “不贰过” loop: every meaningful mistake should become a principle, mechanism, or daily action that makes the same mistake less likely to repeat.

Read the foundation document: [`docs/foundation-bu-er-guo.md`](./docs/foundation-bu-er-guo.md).

## Current Kernel

The tracker is built around this durable loop:

1. Mission core
2. Three identities
3. Daily action inputs
4. Reflection
5. Principle/mechanism capture
6. 7-day visual review
7. JSON export/import

Default identities:

- Entrepreneur
- RL Researcher
- Family Man

Default actions:

- RL deep work
- Research artifact
- Reality contact
- Venture build
- Family presence
- Wife companionship

## Data Shape

```json
{
  "core": {
    "version": 1,
    "mission": "...",
    "identities": [],
    "actions": []
  },
  "entries": {
    "2026-04-25": {
      "actions": {
        "rl_deep_work": {
          "value": 90,
          "note": "..."
        }
      },
      "reflection": {
        "oneThing": "...",
        "avoid": "...",
        "win": "...",
        "lesson": "..."
      },
      "principle": {
        "pattern": "...",
        "principle": "...",
        "mechanism": "..."
      }
    }
  },
  "systemLog": []
}
```

## Iteration Points

- Add a new identity in `defaultCore.identities`.
- Add a new daily action in `defaultCore.actions`.
- Keep action ids stable after real usage begins.
- Export data before schema changes.
- Use `core.version` for future migrations.
