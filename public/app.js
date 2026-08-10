const state = {
  reviews: [],
  credentials: [],
  automations: [],
  users: [],
  user: null,
  config: null,
  activeReviewId: null,
  activeReview: null,
  pollingTimer: null,
  search: "",
  setupRequired: false,
  webhookSecrets: {}
};

const sectionTitles = {
  overview: "代码审查总览",
  new: "发起新的 Review",
  automation: "仓库自动审查",
  history: "审查记录",
  settings: "系统配置"
};

const decisionLabels = {
  approve: "建议通过",
  comment: "建议关注",
  request_changes: "需要修改",
  completed: "已完成",
  failed: "失败",
  running: "审查中",
  queued: "排队中"
};

const severityLabels = { critical: "致命", high: "高", medium: "中", low: "低" };

function clearLegacyBrowserCredentials() {
  try { localStorage.removeItem("reviewpilot.credentials.v1"); } catch { /* Storage may be unavailable. */ }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function showToast(message, type = "") {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败，请稍后重试");
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function showAuth(status) {
  state.setupRequired = Boolean(status.setupRequired);
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#auth-screen").hidden = false;
  document.querySelector("#auth-title").textContent = state.setupRequired ? "创建首个管理员账号" : "登录 ReviewPilot";
  document.querySelector("#auth-description").textContent = state.setupRequired
    ? "首次启动需要创建管理员。已有审查记录会迁移到这个账号。"
    : "登录后访问你的凭据、自动审查仓库和历史报告。";
  document.querySelector("#setup-display-name").hidden = !state.setupRequired;
  document.querySelector("#setup-confirm-password").hidden = !state.setupRequired;
  const password = document.querySelector("#auth-password");
  password.autocomplete = state.setupRequired ? "new-password" : "current-password";
  document.querySelector("#auth-form .auth-submit").innerHTML = state.setupRequired ? "创建管理员并进入 <span>→</span>" : "登录 <span>→</span>";
}

function showApp() {
  document.querySelector("#auth-screen").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  document.querySelector("#current-user").textContent = state.user?.displayName || state.user?.username || "—";
}

function navigate(section) {
  document.querySelectorAll(".page-section").forEach((node) => node.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.section === section));
  document.querySelector(`#section-${section}`)?.classList.add("active");
  document.querySelector("#page-title").textContent = sectionTitles[section] || sectionTitles.overview;
  document.querySelector(".sidebar").classList.remove("open");
  history.replaceState(null, "", `#${section}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getDisplayStatus(review) {
  if (review.status !== "completed") return review.status;
  return review.report?.decision || "completed";
}

function renderReviewRow(review) {
  const status = getDisplayStatus(review);
  const score = review.report?.score != null ? `${review.report.score} / 100` : review.progress || "等待分析";
  const canForward = review.status === "completed" && Boolean(review.report);
  const canDelete = !["queued", "running"].includes(review.status);
  return `
    <div class="review-row" data-review-id="${escapeHtml(review.id)}" tabindex="0" role="button">
      <div class="review-main"><strong>${escapeHtml(review.title || `MR !${review.mrIid}`)}</strong><small>${review.trigger === "automation" ? "自动审查 · " : ""}${escapeHtml(review.project || "未知项目")} · !${escapeHtml(review.mrIid || "—")} · ${formatDate(review.createdAt)}</small></div>
      <div class="review-branch">${escapeHtml(review.sourceBranch || "—")} <span>→</span> ${escapeHtml(review.targetBranch || "—")}</div>
      <div class="review-score">${escapeHtml(score)}</div>
      <div class="review-project"><span class="status ${status}">${decisionLabels[status] || status}</span></div>
      <div class="review-row-actions">
        ${canForward ? '<button type="button" data-review-action="forward" aria-label="转发报告" title="生成转发图片">↗</button>' : ""}
        ${canDelete ? '<button type="button" data-review-action="delete" class="delete" aria-label="删除记录" title="删除记录">×</button>' : ""}
      </div>
      <div class="row-arrow">›</div>
    </div>`;
}

function renderDashboard() {
  const countedReviews = state.reviews.filter((review) => !review.ephemeral);
  const completed = countedReviews.filter((review) => review.status === "completed" && review.report);
  const allFindings = completed.flatMap((review) => review.report.findings || []);
  const approved = completed.filter((review) => review.report.decision === "approve").length;
  const running = countedReviews.filter((review) => ["queued", "running"].includes(review.status)).length;
  const average = completed.length ? Math.round(completed.reduce((sum, review) => sum + review.report.score, 0) / completed.length) : 0;

  document.querySelector("#metric-total").textContent = countedReviews.length;
  document.querySelector("#metric-findings").textContent = allFindings.length;
  document.querySelector("#metric-approved").textContent = approved;
  document.querySelector("#metric-running").textContent = running;
  document.querySelector("#quality-score").textContent = completed.length ? average : "—";
  document.querySelector("#quality-ring span").textContent = completed.length ? average : "—";
  document.querySelector("#quality-ring").style.background = completed.length
    ? `conic-gradient(var(--mint-strong) 0deg, var(--mint-strong) ${average * 3.6}deg, #e3e4dc ${average * 3.6}deg)`
    : "conic-gradient(#e3e4dc 0deg, #e3e4dc 360deg)";
  document.querySelector("#quality-trend").textContent = completed.length ? `${completed.length} 次已完成` : "等待数据";
  document.querySelector("#high-count").textContent = allFindings.filter((item) => ["critical", "high"].includes(item.severity)).length;
  document.querySelector("#medium-count").textContent = allFindings.filter((item) => item.severity === "medium").length;
  document.querySelector("#low-count").textContent = allFindings.filter((item) => item.severity === "low").length;

  const recent = document.querySelector("#recent-list");
  recent.innerHTML = countedReviews.length
    ? countedReviews.slice(0, 5).map(renderReviewRow).join("")
    : '<div class="empty-state"><b>还没有审查记录</b>发起一次 Review，或者先打开示例报告。</div>';
}

function renderHistory() {
  const query = state.search.toLowerCase().trim();
  const filtered = state.reviews.filter((review) => !review.ephemeral && (!query || `${review.title} ${review.project} ${review.mrIid}`.toLowerCase().includes(query)));
  document.querySelector("#history-list").innerHTML = filtered.length
    ? filtered.map(renderReviewRow).join("")
    : '<div class="empty-state"><b>没有匹配的记录</b>换一个项目名或 MR 标题试试。</div>';
}

function renderConfig() {
  if (!state.config) return;
  const badge = document.querySelector("#config-badge");
  const ready = state.credentials.length > 0;
  badge.className = `config-badge ${ready ? "ready" : ""}`;
  badge.querySelector("b").textContent = ready ? `${state.credentials.length} 组安全凭据` : "请先添加凭据";
  document.querySelector("#account-display-name").textContent = state.user?.displayName || "当前账号";
  document.querySelector("#account-username").textContent = `${state.user?.username || "—"} · ${state.user?.role === "admin" ? "管理员" : "普通用户"}`;
}

function renderCredentialOptions() {
  const options = state.credentials.length
    ? state.credentials.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.gitlabOrigin)} · ${escapeHtml(item.openaiModel)}</option>`).join("")
    : '<option value="">请先在系统配置中添加凭据</option>';
  for (const selector of ["#review-credential", "#automation-credential"]) {
    const node = document.querySelector(selector);
    const previous = node.value;
    node.innerHTML = options;
    if (state.credentials.some((item) => item.id === previous)) node.value = previous;
  }
}

function renderCredentials() {
  const list = document.querySelector("#credential-list");
  list.innerHTML = state.credentials.length ? state.credentials.map((item) => `
    <div class="config-list-item" data-credential-id="${escapeHtml(item.id)}">
      <div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.gitlabOrigin)} · ${escapeHtml(item.openaiBaseUrl)} · ${escapeHtml(item.openaiModel)}</p><small>GitLab ${escapeHtml(item.gitlabTokenMask)} · OpenAI ${escapeHtml(item.openaiKeyMask)}</small></div>
      <div class="item-actions"><button class="secondary" data-credential-action="edit" type="button">编辑</button><button class="danger-button" data-credential-action="delete" type="button">删除</button></div>
    </div>`).join("") : '<div class="empty-state"><b>还没有凭据配置</b>保存第一组配置后即可发起手动或自动审查。</div>';
  renderCredentialOptions();
  renderConfig();
}

function webhookUrl(rule) {
  return `${location.origin}/api/webhooks/gitlab/${encodeURIComponent(rule.id)}`;
}

function renderAutomations() {
  const list = document.querySelector("#automation-list");
  list.innerHTML = state.automations.length ? state.automations.map((item) => {
    const secret = state.webhookSecrets[item.id];
    return `<div class="automation-item" data-automation-id="${escapeHtml(item.id)}">
      <div class="automation-item-head"><div><span class="status ${item.enabled ? "completed" : "comment"}">${item.enabled ? "已启用" : "已暂停"}</span><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.projectUrl)}${item.targetBranch ? ` → ${escapeHtml(item.targetBranch)}` : " · 所有目标分支"}</p></div><div class="item-actions"><button class="secondary" data-automation-action="edit" type="button">编辑</button><button class="danger-button" data-automation-action="delete" type="button">删除</button></div></div>
      <div class="webhook-box"><label>Webhook URL</label><div><code>${escapeHtml(webhookUrl(item))}</code><button data-copy-value="${escapeHtml(webhookUrl(item))}" type="button">复制</button></div><label>Secret Token</label>${secret ? `<div><code>${escapeHtml(secret)}</code><button data-copy-value="${escapeHtml(secret)}" type="button">复制</button></div><p class="secret-warning">Secret 只在创建或重置后显示，请现在复制到 GitLab。</p>` : `<div><code>出于安全考虑不再显示</code><button data-automation-action="reset-secret" type="button">重置</button></div>`}</div>
      <small>使用 ${escapeHtml(item.credentialName)} · ${item.publishGitLabComments ? "同步 MR 评论" : "仅生成平台报告"}</small>
    </div>`;
  }).join("") : '<div class="empty-state"><b>还没有自动审查仓库</b>添加仓库后，按页面生成的信息配置 GitLab Webhook。</div>';
}

function renderUsers() {
  const adminCard = document.querySelector("#admin-users-card");
  adminCard.hidden = state.user?.role !== "admin";
  if (adminCard.hidden) return;
  document.querySelector("#user-list").innerHTML = state.users.map((item) => `
    <div class="config-list-item" data-user-id="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.displayName)}</strong><p>${escapeHtml(item.username)} · ${item.role === "admin" ? "管理员" : "普通用户"}</p></div><div>${item.id === state.user.id ? '<span class="setting-status ready">当前账号</span>' : `<button class="secondary" data-user-action="toggle" type="button">${item.disabled ? "启用" : "停用"}</button>`}</div></div>`).join("");
}

function commentSyncMarkup(sync) {
  if (!sync?.enabled) return "";
  if (["approval", "report"].includes(sync.mode)) {
    const details = [];
    if (sync.posted) details.push("报告图片已评论");
    else if (sync.skipped) details.push("报告图片已存在");
    if (sync.mode === "approval") {
      if (sync.approved) details.push("MR 已 Approve");
      else details.push("MR Approve 未完成");
    } else {
      details.push("存在问题，未请求 Approve");
    }
    const firstError = sync.error || (sync.items || []).find((item) => item.status === "failed")?.reason;
    const tone = sync.status === "failed" ? "failed" : sync.status === "partial" ? "partial" : "success";
    const title = sync.mode === "approval" ? "GitLab 通过同步" : "GitLab 报告同步";
    return `<div class="sync-banner ${tone}"><span>${tone === "success" ? "✓" : "!"}</span><div><strong>${title}</strong><p>${escapeHtml(details.join(" · "))}${firstError ? `：${escapeHtml(firstError)}` : ""}</p></div></div>`;
  }
  const details = [];
  if (sync.posted) details.push(`已发布 ${sync.posted} 条`);
  if (sync.skipped) details.push(`跳过 ${sync.skipped} 条`);
  if (sync.failed) details.push(`失败 ${sync.failed} 条`);
  if (!details.length) details.push("没有需要发布的中高风险问题");
  const firstError = sync.error || (sync.items || []).find((item) => item.status === "failed")?.reason;
  const tone = sync.status === "failed" ? "failed" : sync.status === "partial" ? "partial" : "success";
  return `<div class="sync-banner ${tone}"><span>${tone === "success" ? "↗" : "!"}</span><div><strong>GitLab 中高风险行内评论</strong><p>${escapeHtml(details.join(" · "))}${firstError ? `：${escapeHtml(firstError)}` : ""}</p></div></div>`;
}

function reportMarkup(review) {
  if (["queued", "running"].includes(review.status)) {
    return `<div class="loading-report"><div class="loader"></div><h3>${escapeHtml(review.progress || "正在审查")}</h3><p>AI 正在理解这次代码变更，你可以关闭窗口稍后再看。</p></div>`;
  }
  if (review.status === "failed") {
    return `<div class="error-card"><strong>这次审查没有完成</strong><p>${escapeHtml(review.error || "发生未知错误")}</p></div>`;
  }
  const report = review.report;
  if (!report) return '<div class="empty-state"><b>报告暂不可用</b>请稍后刷新。</div>';
  const findings = (report.findings || []).map((finding) => `
    <article class="finding ${escapeHtml(finding.severity)}">
      <div class="finding-head">
        <div class="finding-title"><span class="severity ${escapeHtml(finding.severity)}">${severityLabels[finding.severity] || finding.severity}</span><strong>${escapeHtml(finding.title)}</strong></div>
        <span class="confidence">置信度 ${Math.round(Number(finding.confidence || 0) * 100)}%</span>
      </div>
      <div class="file-line">${escapeHtml(finding.path)}${finding.line ? `:${finding.line}` : ""} · ${escapeHtml(finding.category)}</div>
      <div class="finding-body">
        <p>${escapeHtml(finding.description)}</p>
        <p><b>依据：</b>${escapeHtml(finding.evidence)}</p>
        <p class="suggestion"><b>建议：</b>${escapeHtml(finding.suggestion)}</p>
      </div>
    </article>`).join("");

  return `
    <section class="report-hero">
      <div class="score-box"><strong>${report.score}</strong><small>REVIEW SCORE</small></div>
      <div class="report-summary"><span class="status ${report.decision}">${decisionLabels[report.decision]}</span><p>${escapeHtml(report.summary)}</p></div>
    </section>
    <div class="report-meta">
      ${review.trigger === "automation" ? `<span>自动审查 · ${escapeHtml(review.automationName || "仓库规则")}</span>` : ""}
      <span>${escapeHtml(review.project)} · !${escapeHtml(review.mrIid)}</span>
      <span>${escapeHtml(review.sourceBranch)} → ${escapeHtml(review.targetBranch)}</span>
      <span>${review.stats?.files || 0} files</span>
      <span><b class="add">+${review.stats?.additions || 0}</b> / <b class="del">-${review.stats?.deletions || 0}</b></span>
    </div>
    ${commentSyncMarkup(review.commentSync)}
    <section class="report-section"><h3>本次修改</h3><ul class="summary-list">${(report.changedSummary || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
    <section class="report-section"><h3>发现的问题 · ${(report.findings || []).length}</h3>${findings || '<div class="empty-state"><b>没有发现明确问题</b>这次变更的风险较低。</div>'}</section>
    <section class="report-section"><h3>建议补充的测试</h3><ul class="test-list">${(report.testSuggestions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无额外建议</li>"}</ul></section>
    ${(report.positiveNotes || []).length ? `<section class="report-section"><h3>做得不错</h3><ul class="test-list">${report.positiveNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}`;
}

function truncateForImage(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function wrapCanvasLines(context, value, maxWidth, maxLength = 400) {
  const paragraphs = truncateForImage(value, maxLength).split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : ["—"];
}

function createReportCanvas(review) {
  const width = 1200;
  const padding = 72;
  const contentWidth = width - padding * 2;
  const report = review.report;
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  const fontFamily = '"PingFang SC", "Microsoft YaHei", Arial, sans-serif';
  const severityColors = { critical: "#ef6b59", high: "#ef6b59", medium: "#d5a84d", low: "#67a6d8" };

  function render(context, shouldDraw) {
    let y = 62;
    const paintLines = (lines, x, top, font, color, lineHeight) => {
      context.font = font;
      context.fillStyle = color;
      if (shouldDraw) lines.forEach((line, index) => context.fillText(line, x, top + index * lineHeight));
      return lines.length * lineHeight;
    };
    const prepareLines = (value, font, maxWidth, maxLength) => {
      context.font = font;
      return wrapCanvasLines(context, value, maxWidth, maxLength);
    };
    const drawSectionTitle = (title, detail = "") => {
      if (shouldDraw) {
        context.fillStyle = "#a8f0c6";
        context.fillRect(padding, y - 17, 8, 8);
        context.font = `700 24px ${fontFamily}`;
        context.fillStyle = "#f4f7f4";
        context.fillText(title, padding + 22, y);
        if (detail) {
          context.font = `400 18px ${fontFamily}`;
          context.fillStyle = "#8da0a5";
          context.fillText(detail, padding + 190, y);
        }
      }
      y += 34;
    };
    const drawList = (items, maxItems = 10) => {
      for (const item of items.slice(0, maxItems)) {
        const font = `400 20px ${fontFamily}`;
        const lines = prepareLines(item, font, contentWidth - 42, 220);
        if (shouldDraw) {
          context.fillStyle = "#a8f0c6";
          context.beginPath();
          context.arc(padding + 8, y - 6, 4, 0, Math.PI * 2);
          context.fill();
        }
        const height = paintLines(lines, padding + 28, y, font, "#c6d1d2", 31);
        y += height + 10;
      }
    };

    if (shouldDraw) {
      context.fillStyle = "#0d1821";
      context.fillRect(0, 0, width, context.canvas.height);
      context.fillStyle = "#a8f0c6";
      context.font = `700 18px ${fontFamily}`;
      context.fillText("REVIEWPILOT · AI CODE REVIEW", padding, y);
      context.fillStyle = "#29404a";
      context.fillRect(width - padding - 150, y - 25, 150, 2);
    }
    y += 54;

    const titleFont = `700 38px ${fontFamily}`;
    const titleLines = prepareLines(review.title || `MR !${review.mrIid}`, titleFont, 830, 160).slice(0, 2);
    const titleHeight = paintLines(titleLines, padding, y, titleFont, "#f7f8f4", 52);
    if (shouldDraw) {
      context.fillStyle = "#a8f0c6";
      context.font = `700 42px ${fontFamily}`;
      context.textAlign = "right";
      context.fillText(String(report.score ?? "—"), width - padding, y + 8);
      context.font = `400 14px ${fontFamily}`;
      context.fillStyle = "#819399";
      context.fillText("REVIEW SCORE", width - padding, y + 33);
      context.textAlign = "left";
    }
    y += titleHeight + 18;
    const metadata = `${review.project || "未知项目"} · MR !${review.mrIid || "—"} · ${review.sourceBranch || "—"} → ${review.targetBranch || "—"}`;
    const metadataLines = prepareLines(metadata, `400 18px ${fontFamily}`, contentWidth, 260);
    y += paintLines(metadataLines, padding, y, `400 18px ${fontFamily}`, "#819399", 28) + 44;

    drawSectionTitle("审查结论", decisionLabels[report.decision] || report.decision || "");
    const summaryFont = `400 23px ${fontFamily}`;
    const summaryLines = prepareLines(report.summary, summaryFont, contentWidth - 56, 700);
    const summaryHeight = summaryLines.length * 36 + 50;
    if (shouldDraw) {
      context.fillStyle = "#172832";
      context.fillRect(padding, y, contentWidth, summaryHeight);
    }
    paintLines(summaryLines, padding + 28, y + 31, summaryFont, "#d5dddc", 36);
    y += summaryHeight + 52;

    drawSectionTitle("本次修改", `${(report.changedSummary || []).length} 项`);
    drawList(report.changedSummary || [], 8);
    y += 42;

    const findings = report.findings || [];
    drawSectionTitle("发现的问题", `${findings.length} 项`);
    let renderedFindings = 0;
    for (const finding of findings.slice(0, 20)) {
      const titleFontFinding = `700 23px ${fontFamily}`;
      const bodyFont = `400 19px ${fontFamily}`;
      const labelFont = `700 18px ${fontFamily}`;
      const title = prepareLines(finding.title, titleFontFinding, contentWidth - 180, 150).slice(0, 3);
      const location = prepareLines(`${finding.path || "未知文件"}${finding.line ? `:${finding.line}` : ""} · ${finding.category || "未分类"}`, `400 17px ${fontFamily}`, contentWidth - 48, 240).slice(0, 2);
      const description = prepareLines(finding.description, bodyFont, contentWidth - 48, 220);
      const evidence = prepareLines(`依据：${finding.evidence || "未提供"}`, bodyFont, contentWidth - 48, 260);
      const suggestion = prepareLines(`建议：${finding.suggestion || "未提供"}`, bodyFont, contentWidth - 48, 260);
      const cardHeight = 38 + title.length * 33 + location.length * 27 + description.length * 29 + evidence.length * 29 + suggestion.length * 29 + 66;
      if (y + cardHeight > 12_600) break;
      if (shouldDraw) {
        context.fillStyle = "#14242d";
        context.fillRect(padding, y, contentWidth, cardHeight);
        context.fillStyle = severityColors[finding.severity] || "#67a6d8";
        context.fillRect(padding, y, 6, cardHeight);
        context.font = labelFont;
        context.fillText((severityLabels[finding.severity] || finding.severity || "风险").toUpperCase(), padding + 26, y + 37);
      }
      let cardY = y + 33;
      cardY += paintLines(title, padding + 138, cardY, titleFontFinding, "#f2f5f2", 33) + 14;
      cardY += paintLines(location, padding + 26, cardY, `400 17px ${fontFamily}`, "#83b49d", 27) + 17;
      cardY += paintLines(description, padding + 26, cardY, bodyFont, "#c5d0d0", 29) + 12;
      cardY += paintLines(evidence, padding + 26, cardY, bodyFont, "#aebbbc", 29) + 12;
      if (shouldDraw) {
        context.fillStyle = "#20372f";
        context.fillRect(padding + 20, cardY - 6, contentWidth - 40, suggestion.length * 29 + 22);
      }
      paintLines(suggestion, padding + 34, cardY + 8, bodyFont, "#bce8cc", 29);
      y += cardHeight + 18;
      renderedFindings += 1;
    }
    if (!findings.length) {
      y += paintLines(["没有发现明确问题"], padding, y, `400 20px ${fontFamily}`, "#8da0a5", 31) + 18;
    } else if (renderedFindings < findings.length) {
      y += paintLines([`图片展示前 ${renderedFindings} 项，其余 ${findings.length - renderedFindings} 项请查看网页报告。`], padding, y, `400 18px ${fontFamily}`, "#d5a84d", 28) + 18;
    }
    y += 34;

    drawSectionTitle("建议补充的测试", `${(report.testSuggestions || []).length} 项`);
    drawList(report.testSuggestions || [], 10);
    if ((report.positiveNotes || []).length) {
      y += 32;
      drawSectionTitle("做得不错", `${report.positiveNotes.length} 项`);
      drawList(report.positiveNotes, 8);
    }
    y += 58;
    if (shouldDraw) {
      context.fillStyle = "#5f747b";
      context.font = `400 15px ${fontFamily}`;
      context.fillText(`生成时间 ${new Date().toLocaleString("zh-CN")} · ReviewPilot`, padding, y);
    }
    return y + 58;
  }

  const height = Math.min(Math.ceil(render(measureContext, false)), 16_000);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  render(context, true);
  return canvas;
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器没有生成图片数据")), "image/png");
  });
}

async function forwardReview(review, button) {
  if (!review?.report || review.status !== "completed") {
    showToast("报告完成后才能生成转发图片", "error");
    return;
  }
  if (button) button.disabled = true;
  try {
    const canvas = createReportCanvas(review);
    const blob = await canvasToPng(canvas);
    const project = String(review.project || "review").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-");
    const filename = `ReviewPilot-${project}-MR-${review.mrIid || "report"}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("报告图片已生成，可以直接转发");
  } catch (error) {
    showToast(`生成图片失败：${error.message}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteReview(review) {
  if (!review || review.ephemeral) return;
  if (["queued", "running"].includes(review.status)) {
    showToast("进行中的 Review 不能删除", "error");
    return;
  }
  if (!window.confirm(`确认删除“${review.title || `MR !${review.mrIid}`}”的审查记录吗？删除后无法恢复。`)) return;
  try {
    await api(`/api/reviews/${encodeURIComponent(review.id)}`, { method: "DELETE" });
    state.reviews = state.reviews.filter((item) => item.id !== review.id);
    if (state.activeReviewId === review.id) closeDrawer();
    renderDashboard();
    renderHistory();
    showToast("审查记录已删除");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openDrawer(review) {
  state.activeReviewId = review.id;
  state.activeReview = review;
  document.querySelector("#drawer-title").textContent = review.title || `MR !${review.mrIid}`;
  document.querySelector("#drawer-content").innerHTML = reportMarkup(review);
  const forwardButton = document.querySelector("#drawer-forward");
  const deleteButton = document.querySelector("#drawer-delete");
  forwardButton.hidden = !(review.status === "completed" && review.report);
  deleteButton.hidden = Boolean(review.ephemeral) || ["queued", "running"].includes(review.status);
  document.querySelector("#review-drawer").classList.add("open");
  document.querySelector("#review-drawer").setAttribute("aria-hidden", "false");
  document.querySelector("#drawer-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";
  if (["queued", "running"].includes(review.status)) startPolling(review.id);
}

function closeDrawer() {
  document.querySelector("#review-drawer").classList.remove("open");
  document.querySelector("#review-drawer").setAttribute("aria-hidden", "true");
  document.querySelector("#drawer-backdrop").classList.remove("open");
  document.body.style.overflow = "";
  state.activeReviewId = null;
  state.activeReview = null;
}

async function refreshReviews() {
  state.reviews = await api("/api/reviews");
  renderDashboard();
  renderHistory();
}

function startPolling() {
  if (state.pollingTimer) return;
  state.pollingTimer = setInterval(async () => {
    try {
      const previous = new Map(state.reviews.map((item) => [item.id, item.status]));
      state.reviews = await api("/api/reviews");
      renderDashboard(); renderHistory();
      const activeReview = state.reviews.find((item) => item.id === state.activeReviewId);
      if (activeReview) {
        state.activeReview = activeReview;
        document.querySelector("#drawer-title").textContent = activeReview.title || `MR !${activeReview.mrIid}`;
        document.querySelector("#drawer-content").innerHTML = reportMarkup(activeReview);
        document.querySelector("#drawer-forward").hidden = !(activeReview.status === "completed" && activeReview.report);
        document.querySelector("#drawer-delete").hidden = ["queued", "running"].includes(activeReview.status);
      }
      const finished = state.reviews.find((item) => ["queued", "running"].includes(previous.get(item.id)) && !["queued", "running"].includes(item.status));
      if (finished) {
        showToast(finished.status === "completed" ? "AI Review 已完成" : "Review 失败，请查看详情", finished.status === "failed" ? "error" : "");
      }
    } catch { /* Keep polling through brief local network errors. */ }
  }, 4000);
}

async function createDemo() {
  const button = document.querySelector("#demo-button");
  button.disabled = true;
  try {
    const review = await api("/api/reviews/demo", { method: "POST" });
    openDrawer(review);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function resetCredentialForm() {
  const form = document.querySelector("#credential-form");
  form.reset();
  form.elements.id.value = "";
  form.elements.openaiBaseUrl.value = "https://api.openai.com/v1";
  form.elements.openaiModel.value = "gpt-5.4-mini";
  document.querySelector("#credential-cancel").hidden = true;
}

function editCredential(id) {
  const item = state.credentials.find((entry) => entry.id === id);
  if (!item) return;
  const form = document.querySelector("#credential-form");
  form.elements.id.value = item.id;
  form.elements.name.value = item.name;
  form.elements.gitlabOrigin.value = item.gitlabOrigin;
  form.elements.gitlabToken.value = "";
  form.elements.gitlabAllowInsecureTls.checked = item.gitlabAllowInsecureTls;
  form.elements.openaiBaseUrl.value = item.openaiBaseUrl;
  form.elements.openaiModel.value = item.openaiModel;
  form.elements.openaiKey.value = "";
  document.querySelector("#credential-cancel").hidden = false;
  navigate("settings");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetAutomationForm() {
  const form = document.querySelector("#automation-form");
  form.reset();
  form.elements.id.value = "";
  form.elements.publishGitLabComments.checked = true;
  form.elements.enabled.checked = true;
  document.querySelector("#automation-cancel").hidden = true;
  renderCredentialOptions();
}

function editAutomation(id) {
  const item = state.automations.find((entry) => entry.id === id);
  if (!item) return;
  const form = document.querySelector("#automation-form");
  form.elements.id.value = item.id;
  form.elements.name.value = item.name;
  form.elements.credentialId.value = item.credentialId;
  form.elements.projectUrl.value = item.projectUrl;
  form.elements.targetBranch.value = item.targetBranch;
  form.elements.instructions.value = item.instructions;
  form.elements.publishGitLabComments.checked = item.publishGitLabComments;
  form.elements.enabled.checked = item.enabled;
  document.querySelector("#automation-cancel").hidden = false;
  navigate("automation");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadWorkspace() {
  const baseRequests = [api("/api/config"), api("/api/credentials"), api("/api/automations"), api("/api/reviews")];
  [state.config, state.credentials, state.automations, state.reviews] = await Promise.all(baseRequests);
  state.user = state.config.user;
  state.users = state.user.role === "admin" ? await api("/api/users") : [];
  showApp();
  navigate(location.hash.slice(1) in sectionTitles ? location.hash.slice(1) : "overview");
  renderCredentials();
  renderAutomations();
  renderUsers();
  renderDashboard();
  renderHistory();
  startPolling();
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-section]");
  const link = event.target.closest("[data-section-link]");
  const start = event.target.closest('[data-action="start-review"]');
  const reviewAction = event.target.closest("[data-review-action]");
  const reviewRow = event.target.closest("[data-review-id]");
  const credentialAction = event.target.closest("[data-credential-action]");
  const credentialRow = event.target.closest("[data-credential-id]");
  const automationAction = event.target.closest("[data-automation-action]");
  const automationRow = event.target.closest("[data-automation-id]");
  const userAction = event.target.closest("[data-user-action]");
  const userRow = event.target.closest("[data-user-id]");
  const copy = event.target.closest("[data-copy-value]");
  if (nav) navigate(nav.dataset.section);
  if (link) navigate(link.dataset.sectionLink);
  if (start) navigate("new");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copyValue); showToast("已复制到剪贴板"); }
    catch { showToast("复制失败，请手动选择文本", "error"); }
  }
  if (reviewAction && reviewRow) {
    event.stopPropagation();
    const review = state.reviews.find((item) => item.id === reviewRow.dataset.reviewId);
    if (reviewAction.dataset.reviewAction === "forward") void forwardReview(review, reviewAction);
    if (reviewAction.dataset.reviewAction === "delete") void deleteReview(review);
    return;
  }
  if (credentialAction && credentialRow) {
    const id = credentialRow.dataset.credentialId;
    if (credentialAction.dataset.credentialAction === "edit") editCredential(id);
    if (credentialAction.dataset.credentialAction === "delete" && window.confirm("确认删除这组凭据配置吗？")) {
      try {
        await api(`/api/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.credentials = state.credentials.filter((item) => item.id !== id);
        renderCredentials();
        showToast("凭据配置已删除");
      } catch (error) { showToast(error.message, "error"); }
    }
    return;
  }
  if (automationAction && automationRow) {
    const id = automationRow.dataset.automationId;
    if (automationAction.dataset.automationAction === "edit") editAutomation(id);
    if (automationAction.dataset.automationAction === "delete" && window.confirm("确认删除这个仓库的自动审查配置吗？")) {
      try {
        await api(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.automations = state.automations.filter((item) => item.id !== id);
        delete state.webhookSecrets[id];
        renderAutomations();
        showToast("自动审查配置已删除");
      } catch (error) { showToast(error.message, "error"); }
    }
    if (automationAction.dataset.automationAction === "reset-secret" && window.confirm("重置后 GitLab 中的旧 Secret 会立即失效，确认继续吗？")) {
      try {
        const result = await api(`/api/automations/${encodeURIComponent(id)}/reset-secret`, { method: "POST" });
        state.webhookSecrets[id] = result.webhookSecret;
        renderAutomations();
        showToast("Webhook Secret 已重置，请立即更新 GitLab");
      } catch (error) { showToast(error.message, "error"); }
    }
    return;
  }
  if (userAction && userRow) {
    const account = state.users.find((item) => item.id === userRow.dataset.userId);
    if (!account) return;
    try {
      const updated = await api(`/api/users/${encodeURIComponent(account.id)}/disabled`, { method: "PUT", body: JSON.stringify({ disabled: !account.disabled }) });
      state.users = state.users.map((item) => item.id === updated.id ? updated : item);
      renderUsers();
      showToast(updated.disabled ? "账号已停用" : "账号已启用");
    } catch (error) { showToast(error.message, "error"); }
    return;
  }
  if (reviewRow) {
    const review = state.reviews.find((item) => item.id === reviewRow.dataset.reviewId);
    if (review) openDrawer(review);
  }
});

document.querySelector("#review-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  values.publishGitLabComments = form.elements.publishGitLabComments.checked;
  button.disabled = true;
  button.textContent = "正在提交…";
  try {
    const review = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify(values)
    });
    state.reviews.unshift(review);
    form.querySelector('[name="url"]').value = "";
    form.querySelector('[name="instructions"]').value = "";
    renderDashboard(); renderHistory(); openDrawer(review);
    showToast("已开始读取 Merge Request");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = '开始 AI Review <span>→</span>';
  }
});

document.querySelector("#demo-button").addEventListener("click", createDemo);
document.querySelector("#drawer-forward").addEventListener("click", (event) => void forwardReview(state.activeReview, event.currentTarget));
document.querySelector("#drawer-delete").addEventListener("click", () => void deleteReview(state.activeReview));
document.querySelector("#drawer-close").addEventListener("click", closeDrawer);
document.querySelector("#drawer-backdrop").addEventListener("click", closeDrawer);
document.querySelector(".mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.querySelector("#history-search").addEventListener("input", (event) => { state.search = event.target.value; renderHistory(); });
document.querySelector("#credential-cancel").addEventListener("click", resetCredentialForm);
document.querySelector("#automation-cancel").addEventListener("click", resetAutomationForm);

document.querySelector("#credential-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  values.gitlabAllowInsecureTls = form.elements.gitlabAllowInsecureTls.checked;
  const id = values.id;
  try {
    const saved = await api(id ? `/api/credentials/${encodeURIComponent(id)}` : "/api/credentials", { method: id ? "PUT" : "POST", body: JSON.stringify(values) });
    const index = state.credentials.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.credentials[index] = saved; else state.credentials.push(saved);
    resetCredentialForm();
    renderCredentials();
    showToast("凭据已加密保存");
  } catch (error) { showToast(error.message, "error"); }
});

document.querySelector("#automation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  values.publishGitLabComments = form.elements.publishGitLabComments.checked;
  values.enabled = form.elements.enabled.checked;
  const id = values.id;
  try {
    const result = await api(id ? `/api/automations/${encodeURIComponent(id)}` : "/api/automations", { method: id ? "PUT" : "POST", body: JSON.stringify(values) });
    const saved = result.automation;
    const index = state.automations.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.automations[index] = saved; else state.automations.push(saved);
    if (result.webhookSecret) state.webhookSecrets[saved.id] = result.webhookSecret;
    resetAutomationForm();
    renderAutomations();
    renderConfig();
    showToast(result.webhookSecret ? "已创建，请立即复制 Webhook Secret" : "自动审查配置已更新");
  } catch (error) { showToast(error.message, "error"); }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    showToast("密码已修改，其他登录会话已退出");
  } catch (error) { showToast(error.message, "error"); }
});

document.querySelector("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const created = await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    state.users.push(created);
    form.reset();
    renderUsers();
    showToast("账号已创建");
  } catch (error) { showToast(error.message, "error"); }
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (state.setupRequired && values.password !== values.passwordConfirm) return showToast("两次输入的密码不一致", "error");
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api(state.setupRequired ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: JSON.stringify(values) });
    state.user = result.user;
    form.reset();
    await loadWorkspace();
    showToast(state.setupRequired ? "管理员账号已创建" : "登录成功");
  } catch (error) { showToast(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* Clear the UI even if the session already expired. */ }
  clearInterval(state.pollingTimer);
  state.pollingTimer = null;
  state.user = null;
  const status = await api("/api/auth/status");
  showAuth(status);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
  const row = event.target.closest?.("[data-review-id]");
  if (row && !event.target.closest?.("button") && (event.key === "Enter" || event.key === " ")) row.click();
});

async function init() {
  clearLegacyBrowserCredentials();
  try {
    const status = await api("/api/auth/status");
    if (!status.authenticated) return showAuth(status);
    state.user = status.user;
    await loadWorkspace();
  } catch (error) {
    showToast(`无法连接本地服务：${error.message}`, "error");
    showAuth({ setupRequired: false });
  }
}

init();
