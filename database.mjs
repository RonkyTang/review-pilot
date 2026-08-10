import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("账号需为 3–32 位小写字母、数字、点、短横线或下划线");
  }
  return username;
}

export function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 10) throw new Error("密码至少需要 10 个字符");
  if (password.length > 200) throw new Error("密码长度不能超过 200 个字符");
  return password;
}

export function hashPassword(password, salt = randomBytes(16)) {
  const normalized = validatePassword(password);
  const derived = scryptSync(normalized, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString("base64"), hash: derived.toString("base64") };
}

export function verifyPassword(password, saltValue, hashValue) {
  try {
    const salt = Buffer.from(saltValue, "base64");
    const expected = Buffer.from(hashValue, "base64");
    const actual = scryptSync(String(password || ""), salt, expected.length, { N: 16384, r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function hashSecret(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function secretsMatch(value, expectedHash) {
  const actual = Buffer.from(hashSecret(value), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "未配置";
  const prefixLength = Math.min(6, Math.max(2, text.length - 4));
  const suffix = text.length > 4 ? text.slice(-4) : "";
  return `${text.slice(0, prefixLength)}${"•".repeat(8)}${suffix}`;
}

function decodeConfiguredMasterKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const key = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (key.length !== 32) throw new Error("REVIEWPILOT_MASTER_KEY 必须是 32 字节的 Base64 或 64 位十六进制字符串");
  return key;
}

export async function loadOrCreateMasterKey(dataDirectory, configuredValue = "") {
  const configured = decodeConfiguredMasterKey(configuredValue);
  if (configured) return configured;
  await fs.mkdir(dataDirectory, { recursive: true });
  const keyPath = path.join(dataDirectory, "master.key");
  try {
    const existing = Buffer.from((await fs.readFile(keyPath, "utf8")).trim(), "base64");
    if (existing.length !== 32) throw new Error("主密钥文件格式不正确");
    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const generated = randomBytes(32);
  try {
    await fs.writeFile(keyPath, `${generated.toString("base64")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = Buffer.from((await fs.readFile(keyPath, "utf8")).trim(), "base64");
    if (existing.length !== 32) throw new Error("主密钥文件格式不正确");
    return existing;
  }
}

function encryptValue(key, value, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptValue(key, value, context) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || "").split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("加密凭据格式不正确");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at
  };
}

function publicCredential(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    gitlabOrigin: row.gitlab_origin,
    gitlabTokenMask: row.gitlab_token_mask,
    gitlabAllowInsecureTls: Boolean(row.gitlab_allow_insecure_tls),
    openaiBaseUrl: row.openai_base_url,
    openaiKeyMask: row.openai_key_mask,
    openaiModel: row.openai_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicAutomation(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    gitlabOrigin: row.gitlab_origin,
    projectPath: row.project_path,
    projectUrl: `${row.gitlab_origin}/${row.project_path}`,
    targetBranch: row.target_branch || "",
    credentialId: row.credential_id,
    credentialName: row.credential_name || "",
    instructions: row.instructions || "",
    publishGitLabComments: Boolean(row.publish_gitlab_comments),
    enabled: Boolean(row.enabled),
    webhookConfigured: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ReviewPilotStore {
  constructor(databasePath, masterKey) {
    if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error("数据库主密钥必须为 32 字节");
    this.masterKey = masterKey;
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS credential_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        gitlab_origin TEXT NOT NULL,
        gitlab_token_encrypted TEXT NOT NULL,
        gitlab_token_mask TEXT NOT NULL,
        gitlab_allow_insecure_tls INTEGER NOT NULL DEFAULT 0,
        openai_base_url TEXT NOT NULL,
        openai_key_encrypted TEXT NOT NULL,
        openai_key_mask TEXT NOT NULL,
        openai_model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE INDEX IF NOT EXISTS credential_profiles_user_idx ON credential_profiles(user_id);
      CREATE TABLE IF NOT EXISTS automation_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        gitlab_origin TEXT NOT NULL,
        project_path TEXT NOT NULL,
        target_branch TEXT NOT NULL DEFAULT '',
        credential_id TEXT NOT NULL REFERENCES credential_profiles(id) ON DELETE RESTRICT,
        instructions TEXT NOT NULL DEFAULT '',
        publish_gitlab_comments INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        webhook_secret_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, gitlab_origin, project_path)
      );
      CREATE INDEX IF NOT EXISTS automation_rules_user_idx ON automation_rules(user_id);
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        automation_rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reviews_user_created_idx ON reviews(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS automation_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        mr_iid TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(rule_id, mr_iid, head_sha)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close() {
    this.database.close();
  }

  userCount() {
    return Number(this.database.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  }

  createUser({ username, displayName, password, role = "user" }) {
    const normalized = validateUsername(username);
    const safeDisplayName = String(displayName || normalized).trim().slice(0, 80) || normalized;
    const passwordData = hashPassword(password);
    const id = randomUUID();
    const now = nowIso();
    try {
      this.database.prepare(`
        INSERT INTO users (id, username, display_name, password_salt, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, normalized, safeDisplayName, passwordData.salt, passwordData.hash, role === "admin" ? "admin" : "user", now, now);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("该账号已经存在");
      throw error;
    }
    return this.getUser(id);
  }

  getUser(id) {
    return publicUser(this.database.prepare("SELECT * FROM users WHERE id = ?").get(id));
  }

  listUsers() {
    return this.database.prepare("SELECT * FROM users ORDER BY created_at ASC").all().map(publicUser);
  }

  authenticate(username, password) {
    const row = this.database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(normalizeUsername(username));
    if (!row || row.disabled || !verifyPassword(password, row.password_salt, row.password_hash)) return null;
    return publicUser(row);
  }

  setUserDisabled(id, disabled) {
    this.database.prepare("UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?").run(disabled ? 1 : 0, nowIso(), id);
    if (disabled) this.database.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return this.getUser(id);
  }

  changePassword(id, password) {
    const passwordData = hashPassword(password);
    const result = this.database.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?")
      .run(passwordData.salt, passwordData.hash, nowIso(), id);
    if (!result.changes) throw new Error("账号不存在");
    this.database.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }

  createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_LIFETIME_MS;
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    this.database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(hashSecret(token), userId, expiresAt, nowIso());
    return { token, expiresAt };
  }

  getUserForSession(token) {
    if (!token) return null;
    const row = this.database.prepare(`
      SELECT users.* FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.disabled = 0
    `).get(hashSecret(token), Date.now());
    return publicUser(row);
  }

  deleteSession(token) {
    if (token) this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSecret(token));
  }

  listCredentials(userId) {
    return this.database.prepare("SELECT * FROM credential_profiles WHERE user_id = ? ORDER BY created_at ASC").all(userId).map(publicCredential);
  }

  getCredential(userId, id) {
    return publicCredential(this.database.prepare("SELECT * FROM credential_profiles WHERE id = ? AND user_id = ?").get(id, userId));
  }

  getCredentialSecrets(userId, id) {
    const row = this.database.prepare("SELECT * FROM credential_profiles WHERE id = ? AND user_id = ?").get(id, userId);
    if (!row) return null;
    return {
      ...publicCredential(row),
      gitlabToken: decryptValue(this.masterKey, row.gitlab_token_encrypted, `${row.user_id}:gitlab`),
      openaiKey: decryptValue(this.masterKey, row.openai_key_encrypted, `${row.user_id}:openai`)
    };
  }

  saveCredential(userId, data, id = null) {
    const existing = id ? this.database.prepare("SELECT * FROM credential_profiles WHERE id = ? AND user_id = ?").get(id, userId) : null;
    if (id && !existing) throw new Error("没有找到该凭据配置");
    const name = String(data.name || existing?.name || "").trim().slice(0, 80);
    const gitlabOrigin = String(data.gitlabOrigin || existing?.gitlab_origin || "").trim().replace(/\/+$/, "");
    const openaiBaseUrl = String(data.openaiBaseUrl || existing?.openai_base_url || "").trim();
    const openaiModel = String(data.openaiModel || existing?.openai_model || "").trim().slice(0, 120);
    const gitlabToken = String(data.gitlabToken || "").trim();
    const openaiKey = String(data.openaiKey || "").trim();
    if (!name || !gitlabOrigin || !openaiBaseUrl || !openaiModel) throw new Error("请完整填写配置名称、GitLab 地址、OpenAI 地址和模型");
    if (!existing && (!gitlabToken || !openaiKey)) throw new Error("新建配置时必须填写 GitLab Token 和 OpenAI API Key");
    let gitlabUrl;
    try { gitlabUrl = new URL(gitlabOrigin); } catch { throw new Error("GitLab 地址格式不正确"); }
    if (!/^https?:$/.test(gitlabUrl.protocol)) throw new Error("GitLab 地址必须使用 http 或 https 协议");
    const normalizedOrigin = gitlabUrl.origin;
    const recordId = existing?.id || randomUUID();
    const now = nowIso();
    const gitlabEncrypted = gitlabToken
      ? encryptValue(this.masterKey, gitlabToken.replace(/^Bearer\s+/i, ""), `${userId}:gitlab`)
      : existing.gitlab_token_encrypted;
    const openaiEncrypted = openaiKey
      ? encryptValue(this.masterKey, openaiKey, `${userId}:openai`)
      : existing.openai_key_encrypted;
    try {
      this.database.prepare(`
        INSERT INTO credential_profiles (
          id, user_id, name, gitlab_origin, gitlab_token_encrypted, gitlab_token_mask,
          gitlab_allow_insecure_tls, openai_base_url, openai_key_encrypted, openai_key_mask,
          openai_model, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          gitlab_origin = excluded.gitlab_origin,
          gitlab_token_encrypted = excluded.gitlab_token_encrypted,
          gitlab_token_mask = excluded.gitlab_token_mask,
          gitlab_allow_insecure_tls = excluded.gitlab_allow_insecure_tls,
          openai_base_url = excluded.openai_base_url,
          openai_key_encrypted = excluded.openai_key_encrypted,
          openai_key_mask = excluded.openai_key_mask,
          openai_model = excluded.openai_model,
          updated_at = excluded.updated_at
      `).run(
        recordId, userId, name, normalizedOrigin, gitlabEncrypted,
        gitlabToken ? maskSecret(gitlabToken.replace(/^Bearer\s+/i, "")) : existing.gitlab_token_mask,
        data.gitlabAllowInsecureTls ? 1 : 0,
        openaiBaseUrl, openaiEncrypted,
        openaiKey ? maskSecret(openaiKey) : existing.openai_key_mask,
        openaiModel, existing?.created_at || now, now
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("配置名称已经存在");
      throw error;
    }
    return this.getCredential(userId, recordId);
  }

  deleteCredential(userId, id) {
    try {
      const result = this.database.prepare("DELETE FROM credential_profiles WHERE id = ? AND user_id = ?").run(id, userId);
      return Boolean(result.changes);
    } catch (error) {
      if (String(error.message).includes("FOREIGN KEY")) throw new Error("该配置正在被自动审查仓库使用，不能删除");
      throw error;
    }
  }

  listReviews(userId) {
    return this.database.prepare("SELECT payload_json FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT 200")
      .all(userId).map((row) => parseJson(row.payload_json, {}));
  }

  getReview(userId, id) {
    const row = this.database.prepare("SELECT payload_json FROM reviews WHERE id = ? AND user_id = ?").get(id, userId);
    return row ? parseJson(row.payload_json, null) : null;
  }

  insertReview(userId, review, automationRuleId = null) {
    this.database.prepare(`
      INSERT INTO reviews (id, user_id, automation_rule_id, status, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(review.id, userId, automationRuleId, review.status, review.createdAt, review.updatedAt, JSON.stringify(review));
    return review;
  }

  updateReview(userId, id, patch) {
    const review = this.getReview(userId, id);
    if (!review) return null;
    Object.assign(review, patch, { updatedAt: nowIso() });
    this.database.prepare("UPDATE reviews SET status = ?, updated_at = ?, payload_json = ? WHERE id = ? AND user_id = ?")
      .run(review.status, review.updatedAt, JSON.stringify(review), id, userId);
    return review;
  }

  deleteReview(userId, id) {
    const review = this.getReview(userId, id);
    if (!review) return { status: "not_found" };
    if (["queued", "running"].includes(review.status)) return { status: "active", review };
    this.database.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ?").run(id, userId);
    return { status: "deleted", review };
  }

  markInterruptedReviews() {
    const rows = this.database.prepare("SELECT id, user_id, payload_json FROM reviews WHERE status IN ('queued', 'running')").all();
    for (const row of rows) {
      const review = parseJson(row.payload_json, {});
      this.updateReview(row.user_id, row.id, {
        status: "failed",
        progress: "审查已中断",
        error: "服务上次停止时该 Review 尚未完成，请重新发起审查"
      });
    }
    return rows.length;
  }

  importLegacyReviews(userId, reviews) {
    if (this.database.prepare("SELECT value FROM metadata WHERE key = 'legacy_reviews_imported'").get()) return 0;
    let imported = 0;
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO reviews (id, user_id, automation_rule_id, status, created_at, updated_at, payload_json)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
    `);
    for (const review of Array.isArray(reviews) ? reviews : []) {
      if (!review?.id || review.ephemeral) continue;
      insert.run(review.id, userId, review.status || "failed", review.createdAt || nowIso(), review.updatedAt || nowIso(), JSON.stringify(review));
      imported += 1;
    }
    this.database.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('legacy_reviews_imported', ?)").run(nowIso());
    return imported;
  }

  listAutomations(userId) {
    return this.database.prepare(`
      SELECT automation_rules.*, credential_profiles.name AS credential_name
      FROM automation_rules
      JOIN credential_profiles ON credential_profiles.id = automation_rules.credential_id
      WHERE automation_rules.user_id = ?
      ORDER BY automation_rules.created_at ASC
    `).all(userId).map(publicAutomation);
  }

  getAutomation(userId, id) {
    const row = this.database.prepare(`
      SELECT automation_rules.*, credential_profiles.name AS credential_name
      FROM automation_rules
      JOIN credential_profiles ON credential_profiles.id = automation_rules.credential_id
      WHERE automation_rules.id = ? AND automation_rules.user_id = ?
    `).get(id, userId);
    return publicAutomation(row);
  }

  getAutomationForWebhook(id) {
    return this.database.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) || null;
  }

  saveAutomation(userId, data, id = null) {
    const existing = id ? this.database.prepare("SELECT * FROM automation_rules WHERE id = ? AND user_id = ?").get(id, userId) : null;
    if (id && !existing) throw new Error("没有找到该自动审查配置");
    const credential = this.getCredential(userId, data.credentialId || existing?.credential_id);
    if (!credential) throw new Error("请选择有效的凭据配置");
    const name = String(data.name || existing?.name || "").trim().slice(0, 80);
    const gitlabOrigin = String(data.gitlabOrigin || existing?.gitlab_origin || "").trim().replace(/\/+$/, "");
    const projectPath = String(data.projectPath || existing?.project_path || "").trim().replace(/^\/+|\/+$/g, "");
    if (!name || !gitlabOrigin || !projectPath) throw new Error("请完整填写自动化名称和仓库地址");
    if (credential.gitlabOrigin !== gitlabOrigin) throw new Error("仓库地址必须与所选 GitLab 凭据的服务器一致");
    const recordId = existing?.id || randomUUID();
    const webhookSecret = existing ? null : randomBytes(24).toString("base64url");
    const now = nowIso();
    try {
      this.database.prepare(`
        INSERT INTO automation_rules (
          id, user_id, name, gitlab_origin, project_path, target_branch, credential_id,
          instructions, publish_gitlab_comments, enabled, webhook_secret_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          gitlab_origin = excluded.gitlab_origin,
          project_path = excluded.project_path,
          target_branch = excluded.target_branch,
          credential_id = excluded.credential_id,
          instructions = excluded.instructions,
          publish_gitlab_comments = excluded.publish_gitlab_comments,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(
        recordId, userId, name, gitlabOrigin, projectPath,
        String(data.targetBranch ?? existing?.target_branch ?? "").trim().slice(0, 200),
        credential.id, String(data.instructions ?? existing?.instructions ?? "").slice(0, 2000),
        data.publishGitLabComments === false ? 0 : 1,
        data.enabled === false ? 0 : 1,
        existing?.webhook_secret_hash || hashSecret(webhookSecret), existing?.created_at || now, now
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("当前仓库已经配置了自动审查");
      throw error;
    }
    return { automation: this.getAutomation(userId, recordId), webhookSecret };
  }

  deleteAutomation(userId, id) {
    return Boolean(this.database.prepare("DELETE FROM automation_rules WHERE id = ? AND user_id = ?").run(id, userId).changes);
  }

  resetAutomationSecret(userId, id) {
    const secret = randomBytes(24).toString("base64url");
    const result = this.database.prepare("UPDATE automation_rules SET webhook_secret_hash = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(hashSecret(secret), nowIso(), id, userId);
    if (!result.changes) throw new Error("没有找到该自动审查配置");
    return secret;
  }

  claimAutomationEvent(ruleId, mrIid, headSha) {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO automation_events (id, rule_id, mr_iid, head_sha, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), ruleId, String(mrIid), String(headSha), nowIso());
    return Boolean(result.changes);
  }
}
