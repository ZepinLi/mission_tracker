# Mission Tracker

A local, dependency-free tracker for mission, identity votes, daily actions, and principle iteration.

Run the local server and open the tracker in a browser:

```bash
node server.js
```

Then visit `http://127.0.0.1:4173` on this Mac, or use the LAN URL printed by the server, such as `http://192.168.x.x:4173`, from another device on the same network. Data is auto-saved as structured local files: `data/core.json` for mission/core settings and `data/weeks/YYYY-Www.json` for weekly entries. Use `Save now` for an explicit confirmed save, and use `Export` for a portable JSON backup. Opening `index.html` directly with `file://` still works, but it can only use browser fallback storage because browsers cannot silently write local files from static pages.

## Conda (recommended for safe local isolation)

This repo does not need npm packages; it only needs Node.js to run `server.js`.

If `conda-forge` is unreachable on your network (common behind proxies or in some regions), skip Conda and install Node via Homebrew or a Node version manager instead:

```bash
# Option A: Homebrew (macOS)
brew install node
node -v

# Option B: nvm (Node Version Manager)
# Install nvm first (see https://github.com/nvm-sh/nvm), then:
nvm install 22
nvm use 22
node -v
```

1) Install Miniforge (Conda) on macOS:

```bash
curl -L -o Miniforge3-MacOSX-$(uname -m).sh \
  https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-$(uname -m).sh
bash Miniforge3-MacOSX-$(uname -m).sh
```

2) Create the project environment from `environment.yml`:

```bash
conda env create -f environment.yml
conda activate mission-tracker
node -v
```

If the `conda env create` step fails with an HTTP/connection error, you can either:

- Use the Homebrew/nvm route above, or
- Configure a reachable mirror for conda-forge, then retry.

Example mirror setup (TUNA, often works in mainland China):

```bash
conda config --set show_channel_urls yes
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/
conda config --set channel_priority strict
conda env create -f environment.yml
```

3) Run:

```bash
node server.js
```

Next time you open a new terminal:

```bash
conda activate mission-tracker
node server.js
```

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
- Default runtime data lives in `data/core.json` and `data/weeks/YYYY-Www.json` when served by `server.js`.
- Use `core.version` for future migrations.

## Public Access Options

`127.0.0.1` is only for this Mac. `192.168.x.x` works only on the same local network. To make Mission Tracker accessible to everyone or third parties, choose one of these modes:

1. Public frontend only

   Deploy `index.html`, `app.js`, and `styles.css` to a static host such as GitHub Pages, Netlify, Vercel, or Cloudflare Pages. This makes the UI public. Without the local `server.js` API, each visitor's data stays in that visitor's browser fallback storage.

2. Public frontend plus private local data

   Keep `server.js` local for your own writing workflow, and deploy a public read-only/demo frontend separately. This is safest if third parties only need to inspect the product/UI.

3. Public multi-user app

   Move persistence from local JSON files to a hosted database/API with authentication, permissions, and backups. This is the right direction if third parties should create, edit, or share tracker data.

Avoid exposing `server.js` directly to the public internet without authentication. Its `/api/state` endpoint can write tracker data, so a public tunnel would allow outsiders to overwrite local files unless access control is added first.

## Vercel + Supabase Production Path

1. Create a Supabase project and run `supabase/schema.sql` in the Supabase SQL editor.
2. In Supabase Auth settings, configure the production Site URL and allowed redirect URLs for your Vercel domain.
3. In Vercel project environment variables, set:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

4. Deploy with Vercel. The build command is `node scripts/build-public.js`, and the output directory is `public`.
5. Public users can sign up or sign in. Their tracker data is stored in Supabase under RLS policies:
   - `mission_tracker_profiles`: one row per user for mission/core settings
   - `mission_tracker_weeks`: one row per user per ISO week for daily entries

Security notes:

- The anon key is safe to expose in the browser only when RLS policies are enabled and correct.
- Do not put a Supabase service role key in frontend code or Vercel public/static config.
- The local `server.js` remains useful for private local JSON workflows, but the public product path should use Supabase.
