const crypto = require("crypto");
const { hashPassword, openDatabase } = require("./db");
const {
  cookie,
  displayNameFromEmail,
  normalizeEmail,
  nowIso,
  parseCookies,
  randomId,
  randomToken,
  sha256,
} = require("./utils");

const SESSION_COOKIE = "mt_session";
const SESSION_DAYS = 30;

function verifyPassword(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    defaultPageId: row.default_page_id || "",
  };
}

function userById(db, userId) {
  return db
    .prepare("select id, email, display_name, avatar_seed, default_page_id from users where id = ?")
    .get(userId);
}

function createSession(db, userId) {
  const rawToken = randomToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare(`
    insert into sessions (token_hash, user_id, expires_at, created_at)
    values (?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, nowIso());
  return {
    rawToken,
    cookie: cookie(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    }),
  };
}

function clearSessionCookie() {
  return cookie(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

function currentUserFromRequest(req) {
  const db = openDatabase();
  const cookies = parseCookies(req.headers.cookie || "");
  const rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const session = db
    .prepare("select token_hash, user_id, expires_at from sessions where token_hash = ?")
    .get(tokenHash);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) db.prepare("delete from sessions where token_hash = ?").run(tokenHash);
    return null;
  }
  return serializeUser(userById(db, session.user_id));
}

function requireUser(req) {
  const user = currentUserFromRequest(req);
  if (!user) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }
  return user;
}

function signUp({ email, password }) {
  const db = openDatabase();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !String(password || "").trim()) {
    const error = new Error("Email and password are required");
    error.status = 400;
    throw error;
  }
  const existing = db.prepare("select id from users where email = ?").get(normalizedEmail);
  if (existing) {
    const error = new Error("Account already exists");
    error.status = 409;
    throw error;
  }
  const now = nowIso();
  const user = {
    id: randomId(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    display_name: displayNameFromEmail(normalizedEmail),
    avatar_seed: normalizedEmail,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    insert into users (id, email, password_hash, display_name, avatar_seed, created_at, updated_at)
    values (:id, :email, :password_hash, :display_name, :avatar_seed, :created_at, :updated_at)
  `).run(user);
  const session = createSession(db, user.id);
  return {
    user: serializeUser(userById(db, user.id)),
    sessionCookie: session.cookie,
  };
}

function signIn({ email, password }) {
  const db = openDatabase();
  const normalizedEmail = normalizeEmail(email);
  const userRow = db.prepare("select * from users where email = ?").get(normalizedEmail);
  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }
  const session = createSession(db, userRow.id);
  return {
    user: serializeUser(userById(db, userRow.id)),
    sessionCookie: session.cookie,
  };
}

function signOut(req) {
  const db = openDatabase();
  const cookies = parseCookies(req.headers.cookie || "");
  const rawToken = cookies[SESSION_COOKIE];
  if (rawToken) {
    db.prepare("delete from sessions where token_hash = ?").run(sha256(rawToken));
  }
  return clearSessionCookie();
}

function updateProfile(userId, payload) {
  const db = openDatabase();
  const displayName = String(payload.displayName || payload.display_name || "").trim();
  const defaultPageId = payload.defaultPageId || payload.default_page_id || null;
  if (displayName) {
    db.prepare("update users set display_name = ?, updated_at = ? where id = ?").run(
      displayName,
      nowIso(),
      userId
    );
  }
  if (defaultPageId !== undefined) {
    db.prepare("update users set default_page_id = ?, updated_at = ? where id = ?").run(
      defaultPageId,
      nowIso(),
      userId
    );
  }
  return serializeUser(userById(db, userId));
}

module.exports = {
  currentUserFromRequest,
  requireUser,
  serializeUser,
  signIn,
  signOut,
  signUp,
  updateProfile,
};
