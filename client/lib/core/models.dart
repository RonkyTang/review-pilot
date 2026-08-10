typedef JsonMap = Map<String, dynamic>;

String jsonText(dynamic value, [String fallback = '']) {
  final text = value?.toString() ?? '';
  return text.isEmpty ? fallback : text;
}

bool jsonBool(dynamic value) => value == true || value == 1 || value == 'true';

List<String> jsonStrings(dynamic value) => value is List
    ? value
          .map((item) => jsonText(item))
          .where((item) => item.isNotEmpty)
          .toList()
    : const [];

class UserAccount {
  const UserAccount({
    required this.id,
    required this.username,
    required this.displayName,
    required this.role,
    required this.disabled,
  });

  factory UserAccount.fromJson(JsonMap json) => UserAccount(
    id: jsonText(json['id']),
    username: jsonText(json['username']),
    displayName: jsonText(json['displayName'], jsonText(json['username'])),
    role: jsonText(json['role'], 'user'),
    disabled: jsonBool(json['disabled']),
  );

  final String id;
  final String username;
  final String displayName;
  final String role;
  final bool disabled;

  bool get isAdmin => role == 'admin';
}

class CredentialProfile {
  const CredentialProfile({
    required this.id,
    required this.name,
    required this.gitlabOrigin,
    required this.gitlabTokenMask,
    required this.gitlabAllowInsecureTls,
    required this.openaiBaseUrl,
    required this.openaiKeyMask,
    required this.openaiModel,
  });

  factory CredentialProfile.fromJson(JsonMap json) => CredentialProfile(
    id: jsonText(json['id']),
    name: jsonText(json['name'], '未命名配置'),
    gitlabOrigin: jsonText(json['gitlabOrigin']),
    gitlabTokenMask: jsonText(json['gitlabTokenMask'], '未配置'),
    gitlabAllowInsecureTls: jsonBool(json['gitlabAllowInsecureTls']),
    openaiBaseUrl: jsonText(json['openaiBaseUrl']),
    openaiKeyMask: jsonText(json['openaiKeyMask'], '未配置'),
    openaiModel: jsonText(json['openaiModel']),
  );

  final String id;
  final String name;
  final String gitlabOrigin;
  final String gitlabTokenMask;
  final bool gitlabAllowInsecureTls;
  final String openaiBaseUrl;
  final String openaiKeyMask;
  final String openaiModel;

  JsonMap toJson() => {
    'id': id,
    'name': name,
    'gitlabOrigin': gitlabOrigin,
    'gitlabTokenMask': gitlabTokenMask,
    'gitlabAllowInsecureTls': gitlabAllowInsecureTls,
    'openaiBaseUrl': openaiBaseUrl,
    'openaiKeyMask': openaiKeyMask,
    'openaiModel': openaiModel,
  };
}

class AutomationRule {
  const AutomationRule({
    required this.id,
    required this.name,
    required this.projectUrl,
    required this.targetBranch,
    required this.credentialId,
    required this.credentialName,
    required this.instructions,
    required this.publishGitLabComments,
    required this.enabled,
    required this.lastReviewedHeads,
  });

  factory AutomationRule.fromJson(JsonMap json) => AutomationRule(
    id: jsonText(json['id']),
    name: jsonText(json['name'], '未命名仓库'),
    projectUrl: jsonText(json['projectUrl']),
    targetBranch: jsonText(json['targetBranch']),
    credentialId: jsonText(json['credentialId']),
    credentialName: jsonText(json['credentialName']),
    instructions: jsonText(json['instructions']),
    publishGitLabComments: jsonBool(json['publishGitLabComments']),
    enabled: jsonBool(json['enabled']),
    lastReviewedHeads: json['lastReviewedHeads'] is Map
        ? Map<String, String>.from(
            (json['lastReviewedHeads'] as Map).map(
              (key, value) => MapEntry(key.toString(), value.toString()),
            ),
          )
        : const {},
  );

  final String id;
  final String name;
  final String projectUrl;
  final String targetBranch;
  final String credentialId;
  final String credentialName;
  final String instructions;
  final bool publishGitLabComments;
  final bool enabled;
  final Map<String, String> lastReviewedHeads;

  JsonMap toJson() => {
    'id': id,
    'name': name,
    'projectUrl': projectUrl,
    'targetBranch': targetBranch,
    'credentialId': credentialId,
    'credentialName': credentialName,
    'instructions': instructions,
    'publishGitLabComments': publishGitLabComments,
    'enabled': enabled,
    'lastReviewedHeads': lastReviewedHeads,
  };
}

class ReviewFinding {
  const ReviewFinding({
    required this.title,
    required this.severity,
    required this.path,
    required this.line,
    required this.category,
    required this.description,
    required this.evidence,
    required this.suggestion,
  });

  factory ReviewFinding.fromJson(JsonMap json) => ReviewFinding(
    title: jsonText(json['title'], '未命名问题'),
    severity: jsonText(json['severity'], 'low'),
    path: jsonText(json['path']),
    line: json['line'] is num ? (json['line'] as num).toInt() : null,
    category: jsonText(json['category']),
    description: jsonText(json['description']),
    evidence: jsonText(json['evidence']),
    suggestion: jsonText(json['suggestion']),
  );

  final String title;
  final String severity;
  final String path;
  final int? line;
  final String category;
  final String description;
  final String evidence;
  final String suggestion;

  String get location => '$path${line == null ? '' : ':$line'}';
}

class ReviewReport {
  const ReviewReport({
    required this.summary,
    required this.decision,
    required this.risk,
    required this.score,
    required this.changedSummary,
    required this.findings,
    required this.testSuggestions,
    required this.positiveNotes,
  });

  factory ReviewReport.fromJson(JsonMap json) => ReviewReport(
    summary: jsonText(json['summary']),
    decision: jsonText(json['decision'], 'completed'),
    risk: jsonText(json['risk'], 'low'),
    score: json['score'] is num ? (json['score'] as num).round() : 0,
    changedSummary: jsonStrings(json['changedSummary']),
    findings: json['findings'] is List
        ? (json['findings'] as List)
              .whereType<Map>()
              .map(
                (item) =>
                    ReviewFinding.fromJson(Map<String, dynamic>.from(item)),
              )
              .toList()
        : const [],
    testSuggestions: jsonStrings(json['testSuggestions']),
    positiveNotes: jsonStrings(json['positiveNotes']),
  );

  final String summary;
  final String decision;
  final String risk;
  final int score;
  final List<String> changedSummary;
  final List<ReviewFinding> findings;
  final List<String> testSuggestions;
  final List<String> positiveNotes;
}

class ReviewRecord {
  const ReviewRecord({
    required this.id,
    required this.url,
    required this.title,
    required this.project,
    required this.mrIid,
    required this.status,
    required this.progress,
    required this.error,
    required this.createdAt,
    required this.sourceBranch,
    required this.targetBranch,
    required this.trigger,
    required this.ephemeral,
    required this.report,
    required this.raw,
  });

  factory ReviewRecord.fromJson(JsonMap json) => ReviewRecord(
    id: jsonText(json['id']),
    url: jsonText(json['url']),
    title: jsonText(json['title'], 'MR !${jsonText(json['mrIid'], '—')}'),
    project: jsonText(json['project']),
    mrIid: jsonText(json['mrIid']),
    status: jsonText(json['status'], 'queued'),
    progress: jsonText(json['progress']),
    error: jsonText(json['error']),
    createdAt: DateTime.tryParse(jsonText(json['createdAt'])),
    sourceBranch: jsonText(json['sourceBranch']),
    targetBranch: jsonText(json['targetBranch']),
    trigger: jsonText(json['trigger'], 'manual'),
    ephemeral: jsonBool(json['ephemeral']),
    report: json['report'] is Map
        ? ReviewReport.fromJson(
            Map<String, dynamic>.from(json['report'] as Map),
          )
        : null,
    raw: Map<String, dynamic>.from(json),
  );

  final String id;
  final String url;
  final String title;
  final String project;
  final String mrIid;
  final String status;
  final String progress;
  final String error;
  final DateTime? createdAt;
  final String sourceBranch;
  final String targetBranch;
  final String trigger;
  final bool ephemeral;
  final ReviewReport? report;
  final JsonMap raw;

  bool get isActive => status == 'queued' || status == 'running';
  bool get canDelete => !ephemeral && !isActive;

  JsonMap toJson() => raw;
}
