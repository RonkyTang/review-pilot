import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  ReviewPilotStore,
  hashPassword,
  secretsMatch,
  validateUsername,
  verifyPassword
} from "../database.mjs";

function withStore(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "reviewpilot-database-test-"));
  const databasePath = path.join(directory, "reviewpilot.db");
  const store = new ReviewPilotStore(databasePath, randomBytes(32));
  try {
    return callback(store, databasePath);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("passwords are hashed and usernames are normalized", () => {
  assert.equal(validateUsername("  Reviewer.One  "), "reviewer.one");
  const password = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", password.salt, password.hash), true);
  assert.equal(verifyPassword("wrong password", password.salt, password.hash), false);
  assert.throws(() => hashPassword("short"), /至少需要 10/);
});

test("users, sessions and encrypted credentials are isolated by user", () => withStore((store, databasePath) => {
  const admin = store.createUser({ username: "admin", displayName: "管理员", password: "admin-password-123", role: "admin" });
  const developer = store.createUser({ username: "developer", displayName: "开发者", password: "developer-password-123" });
  assert.equal(store.authenticate("ADMIN", "admin-password-123").id, admin.id);
  assert.equal(store.authenticate("admin", "wrong-password"), null);

  const session = store.createSession(admin.id);
  assert.equal(store.getUserForSession(session.token).id, admin.id);
  store.deleteSession(session.token);
  assert.equal(store.getUserForSession(session.token), null);

  const gitlabToken = "gitlab-test-token";
  const openaiKey = "openai-test-key";
  const credential = store.saveCredential(admin.id, {
    name: "公司配置",
    gitlabOrigin: "https://gitlab.example.com/",
    gitlabToken,
    gitlabAllowInsecureTls: true,
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiKey,
    openaiModel: "gpt-test"
  });
  assert.equal(credential.gitlabOrigin, "https://gitlab.example.com");
  assert.equal("gitlabToken" in credential, false);
  assert.equal("openaiKey" in credential, false);
  assert.equal(store.getCredential(developer.id, credential.id), null);
  const decrypted = store.getCredentialSecrets(admin.id, credential.id);
  assert.equal(decrypted.gitlabToken, gitlabToken);
  assert.equal(decrypted.openaiKey, openaiKey);
  const databaseBytes = readFileSync(databasePath).toString("utf8");
  assert.doesNotMatch(databaseBytes, /gitlab-test-token|openai-test-key/);
}));

test("review records and automation rules stay within their owning account", () => withStore((store) => {
  const first = store.createUser({ username: "first", displayName: "First", password: "first-password-123" });
  const second = store.createUser({ username: "second", displayName: "Second", password: "second-password-123" });
  const credential = store.saveCredential(first.id, {
    name: "GitLab",
    gitlabOrigin: "https://gitlab.example.com",
    gitlabToken: "gitlab-automation-test-token",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiKey: "openai-automation-test-key",
    openaiModel: "gpt-test"
  });
  const { automation, webhookSecret } = store.saveAutomation(first.id, {
    name: "Service",
    gitlabOrigin: "https://gitlab.example.com",
    projectPath: "team/service",
    credentialId: credential.id,
    targetBranch: "main",
    publishGitLabComments: true,
    enabled: true
  });
  assert.equal(store.listAutomations(second.id).length, 0);
  assert.equal(secretsMatch(webhookSecret, store.getAutomationForWebhook(automation.id).webhook_secret_hash), true);
  assert.equal(store.claimAutomationEvent(automation.id, "42", "sha-1"), true);
  assert.equal(store.claimAutomationEvent(automation.id, "42", "sha-1"), false);
  assert.throws(() => store.deleteCredential(first.id, credential.id), /正在被自动审查仓库使用/);

  const now = new Date().toISOString();
  const review = { id: randomUUID(), status: "queued", createdAt: now, updatedAt: now, title: "MR !42" };
  store.insertReview(first.id, review, automation.id);
  assert.equal(store.listReviews(first.id).length, 1);
  assert.equal(store.listReviews(second.id).length, 0);
  assert.equal(store.getReview(second.id, review.id), null);
  assert.equal(store.deleteReview(first.id, review.id).status, "active");
  store.updateReview(first.id, review.id, { status: "completed" });
  assert.equal(store.deleteReview(first.id, review.id).status, "deleted");
}));

test("legacy reviews are imported only once for the first administrator", () => withStore((store) => {
  const user = store.createUser({ username: "owner", displayName: "Owner", password: "owner-password-123", role: "admin" });
  const now = new Date().toISOString();
  const reviews = [{ id: "legacy-review", status: "completed", createdAt: now, updatedAt: now, title: "Legacy" }];
  assert.equal(store.importLegacyReviews(user.id, reviews), 1);
  assert.equal(store.importLegacyReviews(user.id, reviews), 0);
  assert.equal(store.listReviews(user.id)[0].title, "Legacy");
}));
