const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { displayNameFromEmail, normalizeEmail, nowIso, randomId } = require("./utils");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "mission-tracker.sqlite");
const DEFAULT_ADMIN_FILE = path.join(DATA_DIR, "local-admin.txt");

let dbInstance = null;

function openDatabase() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new DatabaseSync(DB_FILE);
  dbInstance.exec("PRAGMA foreign_keys = ON;");
  dbInstance.exec("PRAGMA journal_mode = WAL;");
  migrate(dbInstance);
  ensureDefaultAdmin(dbInstance);
  return dbInstance;
}

function migrate(db) {
  db.exec(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      password_hash text not null,
      display_name text not null,
      avatar_seed text not null,
      default_page_id text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists sessions (
      token_hash text primary key,
      user_id text not null references users(id) on delete cascade,
      expires_at text not null,
      created_at text not null
    );

    create table if not exists pages (
      id text primary key,
      owner_id text not null references users(id) on delete cascade,
      title text not null,
      slug text not null unique,
      visibility text not null default 'private' check (visibility in ('private', 'shared')),
      core_json text not null default '{}',
      revision integer not null default 1,
      content_hash text not null default '',
      last_writer_id text references users(id) on delete set null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists page_members (
      page_id text not null references pages(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      role text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
      display_name text not null,
      email text not null,
      avatar_seed text not null,
      joined_via text not null default 'direct',
      created_at text not null,
      primary key (page_id, user_id)
    );

    create table if not exists page_invites (
      id text primary key,
      page_id text not null references pages(id) on delete cascade,
      page_title text not null,
      invite_email text not null,
      role text not null check (role in ('viewer', 'commenter', 'editor')),
      invited_by text not null references users(id) on delete cascade,
      invited_by_name text not null,
      created_at text not null,
      expires_at text,
      accepted_at text,
      revoked_at text
    );

    create table if not exists share_links (
      id text primary key,
      page_id text not null references pages(id) on delete cascade,
      page_title text not null,
      token_hash text not null unique,
      token_hint text not null,
      role text not null check (role in ('viewer', 'commenter', 'editor')),
      created_by text not null references users(id) on delete cascade,
      created_by_name text not null,
      created_at text not null,
      expires_at text,
      revoked_at text
    );

    create table if not exists page_weeks (
      id text primary key,
      page_id text not null references pages(id) on delete cascade,
      week_key text not null,
      week_start text not null,
      week_end text not null,
      entries_json text not null default '{}',
      revision integer not null default 1,
      content_hash text not null default '',
      last_writer_id text references users(id) on delete set null,
      created_at text not null,
      updated_at text not null,
      unique (page_id, week_key)
    );

    create table if not exists comment_threads (
      id text primary key,
      page_id text not null references pages(id) on delete cascade,
      anchor text not null,
      status text not null default 'open' check (status in ('open', 'resolved')),
      author_id text references users(id) on delete set null,
      author_name text not null,
      resolved_by text references users(id) on delete set null,
      resolved_by_name text,
      created_at text not null,
      resolved_at text,
      last_activity_at text not null
    );

    create table if not exists comments (
      id text primary key,
      thread_id text not null references comment_threads(id) on delete cascade,
      page_id text not null references pages(id) on delete cascade,
      body text not null,
      author_id text references users(id) on delete set null,
      author_name text not null,
      created_at text not null,
      updated_at text not null,
      deleted_at text
    );

    create index if not exists sessions_user_idx on sessions(user_id);
    create index if not exists pages_owner_idx on pages(owner_id, updated_at desc);
    create index if not exists page_members_user_idx on page_members(user_id, created_at desc);
    create index if not exists page_invites_email_idx on page_invites(invite_email);
    create index if not exists share_links_hash_idx on share_links(token_hash);
    create index if not exists page_weeks_page_week_idx on page_weeks(page_id, week_key);
    create index if not exists comment_threads_page_anchor_idx on comment_threads(page_id, anchor, last_activity_at desc);
    create index if not exists comments_thread_idx on comments(thread_id, created_at);
  `);
}

function ensureDefaultAdmin(db) {
  const count = db.prepare("select count(*) as count from users").get().count;
  if (count > 0) return;

  const email = normalizeEmail(process.env.LOCAL_ADMIN_EMAIL || "admin@local");
  const password = process.env.LOCAL_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const user = {
    id: randomId(),
    email,
    password_hash: hashPassword(password),
    display_name: displayNameFromEmail(email),
    avatar_seed: email,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  db.prepare(`
    insert into users (id, email, password_hash, display_name, avatar_seed, created_at, updated_at)
    values (:id, :email, :password_hash, :display_name, :avatar_seed, :created_at, :updated_at)
  `).run(user);

  if (!process.env.LOCAL_ADMIN_PASSWORD) {
    fs.writeFileSync(
      DEFAULT_ADMIN_FILE,
      `Local Mission Tracker admin\nemail=${email}\npassword=${password}\n\nChange this password after first sign-in.\n`
    );
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function transaction(work) {
  const db = openDatabase();
  db.exec("begin immediate transaction");
  try {
    const result = work(db);
    db.exec("commit");
    return result;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

module.exports = {
  DB_FILE,
  hashPassword,
  openDatabase,
  transaction,
};
