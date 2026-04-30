# Mission Tracker

Mission Tracker is a local-first collaborative daily operating system for mission, identity votes, daily actions, reflection, principle capture, and inline discussion.

The app now runs as a single local Node server:

```text
Browser SPA -> Node REST API + SSE -> SQLite
```

No Supabase account is required.

## Run Locally

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:4173
```

The server creates and uses:

- `data/mission-tracker.sqlite`
- `data/local-admin.txt` on the first run if no user exists

Open `data/local-admin.txt` to get the generated first admin password, or set your own before first start:

```bash
LOCAL_ADMIN_EMAIL=you@example.com LOCAL_ADMIN_PASSWORD=change-me node server.js
```

On Windows PowerShell:

```powershell
$env:LOCAL_ADMIN_EMAIL="you@example.com"
$env:LOCAL_ADMIN_PASSWORD="change-me"
node server.js
```

## Access From Other Devices

By default the server binds to `127.0.0.1` for safety.

For trusted LAN access:

```bash
HOST=0.0.0.0 node server.js
```

On Windows PowerShell:

```powershell
$env:HOST="0.0.0.0"
node server.js
```

Then open the LAN URL printed by the server, such as:

```text
http://192.168.x.x:4173
```

For private multi-device access across networks, prefer Tailscale or ZeroTier. Do not expose this directly to the public internet without HTTPS, rate limiting, backups, and stronger operational controls.

## Architecture

Runtime backend modules:

- `server.js`: startup, static file serving, SPA route fallback
- `server/api.js`: REST router
- `server/db.js`: SQLite connection and schema initialization
- `server/auth.js`: local users, password hashing, session cookies
- `server/permissions.js`: page role checks
- `server/realtime.js`: Server-Sent Events page notifications
- `server/services/pages.js`: pages, weeks, members, invites, share links
- `server/services/comments.js`: comment threads and replies

Frontend modules:

- `src/controller.js`: app orchestration
- `src/state/*`: state schema, scoring, week grouping, three-way merge
- `src/storage/repository-http.js`: local REST/SSE repository
- `src/ui/*`: DOM handles and render functions

The controller still talks to a repository interface. The storage implementation is now HTTP/SSE instead of browser-side Supabase.

## Data Model

SQLite tables:

- `users`
- `sessions`
- `pages`
- `page_members`
- `page_invites`
- `share_links`
- `page_weeks`
- `comment_threads`
- `comments`

Tracker entries are stored by page and ISO week in `page_weeks`.

## Collaboration Model

Roles:

- `viewer`: read page, weeks, people, comments
- `commenter`: viewer + create/reply/resolve comment threads
- `editor`: commenter + edit page core and week entries
- `owner`: editor + manage members, invites, and share links

Sharing options:

- direct email invite
- share link with viewer/commenter/editor role

Share-link tokens are stored hashed in SQLite. The raw link is shown only when created.

## Conflict Handling

Writes use revision checks:

- page core updates require `expectedRevision`
- week updates require `expectedRevision`
- stale updates return `409 Conflict`

The frontend keeps:

- last remote base snapshot
- local draft
- fresh remote snapshot

When a conflict occurs, it runs a three-way merge and asks the user to choose if the same field changed on both sides.

## Inline Comments

Comments attach to stable anchors, for example:

- `core:mission`
- `entry:2026-04-30:reflection:lesson`
- `entry:2026-04-30:principle:mechanism`
- `entry:2026-04-30:action:rl_deep_work`

The right sidebar shows field-specific threads with replies and resolve/reopen controls.

## Legacy Data

The old local JSON files are no longer the collaboration source of truth:

- `data/core.json`
- `data/weeks/*.json`

They are only used as a legacy import source when creating the first page for a user.

## Build

```bash
npm run build
```

This copies frontend sources into `public/`.

## Test

```bash
npm test
```

The test suite exercises the local SQLite backend: page save conflicts, comments, invites, and share-link membership.

## Security Notes

- Passwords are hashed with Node `crypto.scrypt`.
- Sessions use `HttpOnly` cookies and server-side session rows.
- `.gitignore` excludes the SQLite database and generated admin credential file.
- Binding to LAN with `HOST=0.0.0.0` is for trusted networks only.
# Mission Tracker

Mission Tracker is a collaborative daily operating system for mission, identity votes, daily actions, reflection, principle capture, and inline discussion.

The current product direction is no longer "one user's local tracker blob". It now supports:

- multiple accounts
- multiple pages per account
- shared pages with role-based access
- share links and email invites
- inline comment threads on concrete fields
- conflict-safe sync across devices

## Run locally

Start the local static/file server:

```bash
node server.js
```

Then open:

- `http://127.0.0.1:4173`

The local server now defaults to loopback for safety. Set `HOST=0.0.0.0` only on a trusted network.

## What runs where

### Local server

`server.js` is now a private local helper. It still serves static files and the legacy local JSON API, but it is **not** the public collaboration backend.

### Public production path

Public deployment should be:

1. static frontend
2. Supabase Auth
3. Supabase Postgres + RLS
4. Supabase Realtime

The collaborative app depends on Supabase for:

- page ownership
- memberships and invites
- share-link redemption
- week persistence
- comments
- conflict-safe sync

## Architecture

Read the detailed pipeline and layering notes here:

- [`docs/collaboration-pipeline.md`](./docs/collaboration-pipeline.md)
- [`docs/foundation-bu-er-guo.md`](./docs/foundation-bu-er-guo.md)

High-level layers:

- `src/state`: schemas, normalization, scoring, compaction, merge
- `src/storage`: Supabase repository and local draft cache
- `src/ui`: pure render functions and DOM map
- `src/controller.js`: orchestration for auth, routing, sync, sharing, comments

`public/` is generated output. Source of truth lives in:

- `app.js`
- `index.html`
- `styles.css`
- `src/**`

## Data model

### Legacy personal storage

These tables still exist so older single-user data can be migrated into the new page model:

- `mission_tracker_profiles`
- `mission_tracker_weeks`

### Collaborative storage

The new collaboration model centers on pages:

- `mission_tracker_pages`
- `mission_tracker_page_members`
- `mission_tracker_page_invites`
- `mission_tracker_share_links`
- `mission_tracker_page_weeks`
- `mission_tracker_comment_threads`
- `mission_tracker_comments`

Daily tracker content is still stored by ISO week, but now under `page_id` instead of `user_id`.

## Inline comments

Comments are anchored to specific fields. Examples:

- `core:mission`
- `entry:2026-04-30:reflection:lesson`
- `entry:2026-04-30:principle:pattern`
- `entry:2026-04-30:action:rl_deep_work`

This allows a shared page to behave more like a collaborative document than a plain form.

## Conflict handling

The app keeps a local draft and a last-synced base snapshot. Saves use revision checks on the page row and week rows.

If another device changed the same page:

1. the app reloads the latest remote bundle
2. runs a three-way merge
3. auto-merges safe changes
4. asks the user to choose when the same field changed on both sides

This is the minimum acceptable behavior for cross-device editing. Silent overwrite would be a design failure.

## Build for static hosting

```bash
npm run build
```

This copies source files into `public/`, including the module tree under `src/`.

## Vercel + Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. In Supabase Auth, set the site URL and redirect URLs for your deployed frontend.
4. In Vercel project environment variables, set:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

5. Deploy with:

- build command: `node scripts/build-public.js`
- output directory: `public`

The included `vercel.json` rewrites `/p/*` and `/join/*` back to `index.html` so deep-linked collaborative routes work.

## Config

Use `config.public.example.js` as the template for local static testing:

```js
window.MISSION_TRACKER_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

## Security notes

- Do not expose a Supabase service role key in frontend code.
- Keep RLS enabled and audited.
- Treat `server.js` as local-only infrastructure.
- Share links are stored as token hashes and redeemed after login.

If you expose the local JSON write API to the public internet, you are bypassing the actual security model and inviting data corruption.
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
