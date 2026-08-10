import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewReportSvg,
  deleteReviewFromList,
  fetchGitLabMergeRequest,
  normalizeReviewReport,
  postInlineRiskComments,
  postReportAndMaybeApprove
} from "../server.mjs";

const parsedMergeRequest = {
  origin: "https://gitlab.example.com",
  projectPath: "group/project",
  iid: "1167",
  canonicalUrl: "https://gitlab.example.com/group/project/-/merge_requests/1167"
};

const mergeRequestPayload = {
  iid: 1167,
  sha: "head-sha",
  title: "Fallback test",
  source_branch: "feature",
  target_branch: "main",
  diff_refs: { base_sha: "base-sha", head_sha: "head-sha" },
  author: { name: "Test" }
};

const sampleDiff = {
  old_path: "old.js",
  new_path: "old.js",
  diff: "@@ -1 +1 @@\n-old\n+new",
  deleted_file: true,
  too_large: false
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("GitLab diff retrieval falls back from Diffs to Changes and Compare", async () => {
  const originalFetch = globalThis.fetch;
  let mode = "changes";
  let calls = [];
  globalThis.fetch = async (value) => {
    const url = new URL(value);
    calls.push(url.pathname);
    if (url.pathname.endsWith("/merge_requests/1167")) return jsonResponse(mergeRequestPayload);
    if (url.pathname.endsWith("/merge_requests/1167/diffs")) return jsonResponse({ error: "server error" }, 500);
    if (url.pathname.endsWith("/merge_requests/1167/changes")) {
      return mode === "changes" ? jsonResponse({ changes: [sampleDiff] }) : jsonResponse({ error: "server error" }, 500);
    }
    if (url.pathname.endsWith("/repository/compare")) return jsonResponse({ diffs: [sampleDiff] });
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const fromChanges = await fetchGitLabMergeRequest(parsedMergeRequest, "token", false);
    assert.equal(fromChanges.diffs.length, 1);
    assert.ok(calls.some((value) => value.endsWith("/changes")));
    assert.ok(!calls.some((value) => value.endsWith("/repository/compare")));

    mode = "compare";
    calls = [];
    const fromCompare = await fetchGitLabMergeRequest(parsedMergeRequest, "token", false);
    assert.equal(fromCompare.diffs.length, 1);
    assert.ok(calls.some((value) => value.endsWith("/changes")));
    assert.ok(calls.some((value) => value.endsWith("/repository/compare")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitLab authentication falls back from PRIVATE-TOKEN to Bearer", async () => {
  const originalFetch = globalThis.fetch;
  const attempts = [];
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    const authMode = options.headers?.Authorization ? "bearer" : options.headers?.["PRIVATE-TOKEN"] ? "private" : "none";
    attempts.push({ path: url.pathname, authMode });
    if (authMode === "private") return jsonResponse({ message: "401 Unauthorized" }, 401);
    assert.equal(options.headers.Authorization, "Bearer token");
    if (url.pathname.endsWith("/merge_requests/1167")) return jsonResponse(mergeRequestPayload);
    if (url.pathname.endsWith("/merge_requests/1167/diffs")) return jsonResponse([sampleDiff]);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await fetchGitLabMergeRequest(parsedMergeRequest, "Bearer token", false);
    assert.equal(result.mr.iid, 1167);
    assert.equal(result.diffs.length, 1);
    assert.deepEqual(attempts.slice(0, 4).map((item) => item.authMode), ["private", "bearer", "private", "bearer"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitLab access errors expose the final status and safe server reason", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ message: "Access blocked by corporate SSO policy" }, 403);
  };

  try {
    await assert.rejects(
      () => fetchGitLabMergeRequest(parsedMergeRequest, "secret-token", false),
      /HTTP 403.*PRIVATE-TOKEN 和 Bearer.*Access blocked by corporate SSO policy/
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("medium-and-higher findings are posted to exact GitLab diff lines and deduplicated", async () => {
  const originalFetch = globalThis.fetch;
  const postedBodies = [];
  const postedPayloads = [];
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    assert.equal(url.pathname, "/api/v4/projects/group%2Fproject/merge_requests/1167/discussions");
    if ((options.method || "GET") === "GET") {
      return jsonResponse(postedBodies.map((body) => ({ notes: [{ body }] })));
    }
    assert.equal(options.method, "POST");
    const payload = JSON.parse(options.body);
    postedPayloads.push(payload);
    postedBodies.push(payload.body);
    return jsonResponse({ id: `discussion-${postedPayloads.length}` }, 201);
  };

  const mr = {
    diff_refs: { base_sha: "base-sha", start_sha: "start-sha", head_sha: "head-sha" }
  };
  const diffs = [{
    old_path: "service/algorithm_service/event.go",
    new_path: "service/algorithm_service/event.go",
    diff: "@@ -35,3 +35,5 @@ func handle() {\n context\n+dangerousCall()\n+return nil\n }"
  }];
  const report = {
    findings: [
      {
        title: "未校验输入就执行危险调用",
        severity: "high",
        path: "service/algorithm_service/event.go",
        line: 36,
        category: "security",
        description: "攻击者可以让服务执行未经校验的操作。",
        evidence: "新增的 dangerousCall() 在任何校验逻辑之前执行。",
        suggestion: "先验证输入和调用权限，失败时立即返回。",
        confidence: 0.98
      },
      {
        title: "返回值会掩盖调用失败",
        severity: "medium",
        path: "service/algorithm_service/event.go",
        line: 37,
        category: "maintainability",
        description: "固定返回 nil 会让上游误判操作成功。",
        evidence: "新增代码在危险调用后无条件返回 nil。",
        suggestion: "返回 dangerousCall 的实际错误。",
        confidence: 0.8
      }
    ]
  };

  try {
    const first = await postInlineRiskComments(parsedMergeRequest, "token", false, mr, diffs, report);
    assert.equal(first.posted, 2);
    assert.equal(first.skipped, 0);
    assert.equal(postedPayloads.length, 2);
    assert.deepEqual(postedPayloads[0].position, {
      position_type: "text",
      base_sha: "base-sha",
      start_sha: "start-sha",
      head_sha: "head-sha",
      old_path: "service/algorithm_service/event.go",
      new_path: "service/algorithm_service/event.go",
      new_line: 36
    });
    assert.match(postedPayloads[0].body, /问题：.*未校验输入就执行危险调用/);
    assert.match(postedPayloads[0].body, /依据：.*dangerousCall/);
    assert.match(postedPayloads[0].body, /建议修改：.*验证输入和调用权限/);
    assert.deepEqual(postedPayloads[1].position, {
      position_type: "text",
      base_sha: "base-sha",
      start_sha: "start-sha",
      head_sha: "head-sha",
      old_path: "service/algorithm_service/event.go",
      new_path: "service/algorithm_service/event.go",
      new_line: 37
    });
    assert.match(postedPayloads[1].body, /ReviewPilot · 中风险问题/);
    assert.match(postedPayloads[1].body, /问题：.*返回值会掩盖调用失败/);

    const second = await postInlineRiskComments(parsedMergeRequest, "token", false, mr, diffs, report);
    assert.equal(second.posted, 0);
    assert.equal(second.skipped, 2);
    assert.equal(second.items[0].status, "duplicate");
    assert.equal(postedPayloads.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inline-risk findings outside added diff lines are not posted", async () => {
  const originalFetch = globalThis.fetch;
  let postCount = 0;
  globalThis.fetch = async (_value, options = {}) => {
    if ((options.method || "GET") === "POST") postCount += 1;
    return jsonResponse([]);
  };

  try {
    const result = await postInlineRiskComments(
      parsedMergeRequest,
      "token",
      false,
      { diff_refs: { base_sha: "base", head_sha: "head" } },
      [{
        old_path: "service/algorithm_service/event.go",
        new_path: "service/algorithm_service/event.go",
        diff: "@@ -37,2 +37,2 @@\n-oldCall()\n+newCall()"
      }],
      { findings: [{
        title: "定位到了未修改的代码",
        severity: "critical",
        path: "service/algorithm_service/event.go",
        line: 38,
        category: "correctness",
        description: "不应发布。",
        evidence: "第 38 行不是新增行。",
        suggestion: "仅保留报告。",
        confidence: 0.9
      }] }
    );
    assert.equal(result.posted, 0);
    assert.equal(result.skipped, 1);
    assert.equal(postCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a passing report image is posted to the MR and the MR is approved", async () => {
  const originalFetch = globalThis.fetch;
  const noteBodies = [];
  let uploadCount = 0;
  let approvalCount = 0;
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    const method = options.method || "GET";
    if (url.pathname.endsWith("/merge_requests/1167/notes") && method === "GET") {
      return jsonResponse(noteBodies.map((body) => ({ body })));
    }
    if (url.pathname.endsWith("/uploads") && method === "POST") {
      uploadCount += 1;
      assert.match(options.headers["Content-Type"], /^multipart\/form-data; boundary=/);
      const multipart = options.body.toString("utf8");
      assert.match(multipart, /filename="reviewpilot-mr-1167-head-sha\.svg"/);
      assert.match(multipart, /Content-Type: image\/svg\+xml/);
      assert.match(multipart, /<svg[^>]+>/);
      return jsonResponse({ markdown: "![ReviewPilot report](/uploads/report.svg)" }, 201);
    }
    if (url.pathname.endsWith("/merge_requests/1167/notes") && method === "POST") {
      const payload = JSON.parse(options.body);
      noteBodies.push(payload.body);
      return jsonResponse({ id: 1, body: payload.body }, 201);
    }
    if (url.pathname.endsWith("/merge_requests/1167/approve") && method === "POST") {
      approvalCount += 1;
      assert.deepEqual(JSON.parse(options.body), { sha: "head-sha" });
      return jsonResponse({ approved: true }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const report = {
    summary: "没有发现阻塞合并的问题。",
    decision: "approve",
    risk: "low",
    score: 100,
    changedSummary: ["修复空值处理"],
    findings: [],
    testSuggestions: ["补充边界用例"],
    positiveNotes: ["改动范围清晰"]
  };
  const mr = {
    iid: 1167,
    title: "fix: handle empty input",
    source_branch: "fix/empty",
    target_branch: "main",
    sha: "head-sha",
    diff_refs: { head_sha: "head-sha" }
  };

  try {
    const first = await postReportAndMaybeApprove(parsedMergeRequest, "token", false, mr, report);
    assert.equal(first.status, "completed");
    assert.equal(first.posted, 1);
    assert.equal(first.approved, true);
    assert.equal(uploadCount, 1);
    assert.equal(approvalCount, 1);
    assert.match(noteBodies[0], /自动审查通过/);
    assert.match(noteBodies[0], /100\/100/);
    assert.match(noteBodies[0], /!\[ReviewPilot report\]\(\/uploads\/report\.svg\)/);
    assert.match(noteBodies[0], /<!-- reviewpilot:passing:/);

    const second = await postReportAndMaybeApprove(parsedMergeRequest, "token", false, mr, report);
    assert.equal(second.posted, 0);
    assert.equal(second.skipped, 1);
    assert.equal(second.approved, true);
    assert.equal(uploadCount, 1);
    assert.equal(noteBodies.length, 1);
    assert.equal(approvalCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a report with a low-risk finding is posted without approving the MR", async () => {
  const originalFetch = globalThis.fetch;
  const noteBodies = [];
  let approvalCount = 0;
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    const method = options.method || "GET";
    if (url.pathname.endsWith("/merge_requests/1167/notes") && method === "GET") {
      return jsonResponse([]);
    }
    if (url.pathname.endsWith("/uploads") && method === "POST") {
      return jsonResponse({ markdown: "![ReviewPilot report](/uploads/low-risk.svg)" }, 201);
    }
    if (url.pathname.endsWith("/merge_requests/1167/notes") && method === "POST") {
      const payload = JSON.parse(options.body);
      noteBodies.push(payload.body);
      return jsonResponse({ id: 2, body: payload.body }, 201);
    }
    if (url.pathname.endsWith("/merge_requests/1167/approve") && method === "POST") {
      approvalCount += 1;
      return jsonResponse({ approved: true }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const report = {
    summary: "发现一项低风险问题。",
    decision: "comment",
    risk: "low",
    score: 95,
    changedSummary: ["调整日志输出"],
    findings: [{
      title: "日志信息不够明确",
      severity: "low",
      path: "service/log.go",
      line: 12,
      category: "maintainability",
      description: "排障时可能缺少上下文。",
      evidence: "新增日志未包含请求标识。",
      suggestion: "增加请求标识。",
      confidence: 0.8
    }],
    testSuggestions: [],
    positiveNotes: []
  };
  const mr = {
    iid: 1167,
    title: "chore: update log",
    source_branch: "chore/log",
    target_branch: "main",
    sha: "head-sha",
    diff_refs: { head_sha: "head-sha" }
  };

  try {
    const result = await postReportAndMaybeApprove(parsedMergeRequest, "token", false, mr, report);
    assert.equal(result.mode, "report");
    assert.equal(result.attempted, 1);
    assert.equal(result.posted, 1);
    assert.equal(result.approved, false);
    assert.equal(approvalCount, 0);
    assert.match(noteBodies[0], /自动审查报告/);
    assert.match(noteBodies[0], /发现 \*\*1\*\* 个问题/);
    assert.match(noteBodies[0], /本次未请求 Approve/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the generated report image escapes untrusted text", () => {
  const svg = buildReviewReportSvg(
    { iid: 7, title: "<script>alert(1)</script>", source_branch: "feature", target_branch: "main" },
    {
      summary: "A & B",
      decision: "approve",
      score: 100,
      changedSummary: [],
      findings: [],
      testSuggestions: [],
      positiveNotes: []
    }
  );
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(svg, /A &amp; B/);
  assert.doesNotMatch(svg, /<script>/);
});

test("completed and failed review records can be deleted", () => {
  const reviews = [
    { id: "completed", status: "completed" },
    { id: "failed", status: "failed" }
  ];
  const completedResult = deleteReviewFromList(reviews, "completed");
  assert.equal(completedResult.status, "deleted");
  assert.deepEqual(reviews, [{ id: "failed", status: "failed" }]);
  const failedResult = deleteReviewFromList(reviews, "failed");
  assert.equal(failedResult.status, "deleted");
  assert.deepEqual(reviews, []);
});

test("active or missing review records are not deleted", () => {
  const reviews = [
    { id: "queued", status: "queued" },
    { id: "running", status: "running" }
  ];
  assert.equal(deleteReviewFromList(reviews, "queued").status, "active");
  assert.equal(deleteReviewFromList(reviews, "running").status, "active");
  assert.equal(deleteReviewFromList(reviews, "missing").status, "not_found");
  assert.equal(reviews.length, 2);
});

test("a review without findings always receives 100 points and approval", () => {
  const report = normalizeReviewReport({ score: 9, risk: "high", decision: "request_changes", findings: [] });
  assert.equal(report.score, 100);
  assert.equal(report.risk, "low");
  assert.equal(report.decision, "approve");
});

test("review scores are constrained to the highest finding severity", () => {
  const cases = [
    { severity: "low", original: 5, score: 90, risk: "low", decision: "comment" },
    { severity: "medium", original: 9, score: 70, risk: "medium", decision: "request_changes" },
    { severity: "high", original: 100, score: 69, risk: "high", decision: "request_changes" },
    { severity: "critical", original: 100, score: 39, risk: "critical", decision: "request_changes" }
  ];
  for (const item of cases) {
    const report = normalizeReviewReport({ score: item.original, findings: [{ severity: item.severity }] });
    assert.equal(report.score, item.score);
    assert.equal(report.risk, item.risk);
    assert.equal(report.decision, item.decision);
  }
});
