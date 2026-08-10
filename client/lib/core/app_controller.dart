import 'dart:async';

import 'package:flutter/foundation.dart';

import 'direct_review_service.dart';
import 'local_store.dart';
import 'models.dart';

class ReviewPilotController extends ChangeNotifier {
  ReviewPilotController(this.store, {DirectReviewService? reviewService})
    : reviewService = reviewService ?? DirectReviewService();

  final LocalReviewPilotStore store;
  final DirectReviewService reviewService;

  bool loading = true;
  bool busy = false;
  String activity = '';
  String? lastError;
  List<CredentialProfile> credentials = const [];
  List<AutomationRule> automations = const [];
  List<ReviewRecord> reviews = const [];
  Timer? _automationTimer;
  bool _automationScanRunning = false;

  Future<void> initialize() async {
    try {
      await store.initialize();
      _reload();
      _automationTimer = Timer.periodic(
        const Duration(minutes: 1),
        (_) => scanAutomations(),
      );
    } catch (error) {
      lastError = _message(error);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void _reload() {
    credentials = store.credentials;
    automations = store.automations;
    reviews = store.reviews;
    notifyListeners();
  }

  Future<CredentialProfile> saveCredential({
    String? id,
    required String name,
    required String gitlabOrigin,
    required String gitlabToken,
    required bool gitlabAllowInsecureTls,
    required String openaiBaseUrl,
    required String openaiKey,
    required String openaiModel,
  }) async {
    final result = await store.saveCredential(
      id: id,
      name: name,
      gitlabOrigin: gitlabOrigin,
      gitlabToken: gitlabToken,
      gitlabAllowInsecureTls: gitlabAllowInsecureTls,
      openaiBaseUrl: openaiBaseUrl,
      openaiKey: openaiKey,
      openaiModel: openaiModel,
    );
    _reload();
    return result;
  }

  Future<void> deleteCredential(String id) async {
    await store.deleteCredential(id);
    _reload();
  }

  Future<AutomationRule> saveAutomation({
    String? id,
    required String name,
    required String projectUrl,
    required String targetBranch,
    required String credentialId,
    required String instructions,
    required bool publishGitLabComments,
    required bool enabled,
  }) async {
    final existing = id == null
        ? null
        : automations.where((item) => item.id == id).firstOrNull;
    final profile = credentials
        .where((item) => item.id == credentialId)
        .firstOrNull;
    if (profile == null) throw const FormatException('请选择凭据配置');
    var heads = existing?.lastReviewedHeads ?? <String, String>{};
    if (existing == null) {
      final secrets = await store.credentialSecrets(credentialId);
      final current = await reviewService.listOpenMergeRequests(
        credentials: secrets,
        projectUrl: projectUrl,
        targetBranch: targetBranch,
      );
      heads = {
        for (final mr in current)
          jsonText(mr['iid']): jsonText(
            mr['sha'],
            jsonText((mr['diff_refs'] as Map?)?['head_sha']),
          ),
      };
    }
    final rule = AutomationRule(
      id: existing?.id ?? store.newId(),
      name: name.trim(),
      projectUrl: projectUrl.trim().replaceAll(RegExp(r'/+$'), ''),
      targetBranch: targetBranch.trim(),
      credentialId: credentialId,
      credentialName: profile.name,
      instructions: instructions.trim(),
      publishGitLabComments: publishGitLabComments,
      enabled: enabled,
      lastReviewedHeads: heads,
    );
    await store.saveAutomation(rule);
    _reload();
    return rule;
  }

  Future<void> deleteAutomation(String id) async {
    await store.deleteAutomation(id);
    _reload();
  }

  Future<ReviewRecord> startReview({
    required String url,
    required String credentialId,
    required String model,
    required String instructions,
    required bool publishGitLabComments,
  }) async {
    if (busy) throw const FormatException('已有审查任务正在运行，请稍后再试');
    final secrets = await store.credentialSecrets(credentialId);
    busy = true;
    activity = '正在启动审查';
    lastError = null;
    notifyListeners();
    try {
      final result = await reviewService.run(
        id: store.newId(),
        mergeRequestUrl: url,
        credentials: secrets,
        instructions: instructions,
        model: model,
        publishGitLabComments: publishGitLabComments,
        onPatch: (review) async {
          activity = jsonText(review['progress']);
          await store.upsertReview(review);
          _reload();
        },
      );
      return ReviewRecord.fromJson(result);
    } finally {
      busy = false;
      activity = '';
      _reload();
    }
  }

  Future<void> deleteReview(String id) async {
    final review = reviews.where((item) => item.id == id).firstOrNull;
    if (review?.isActive == true) {
      throw const FormatException('进行中的 Review 不能删除');
    }
    await store.deleteReview(id);
    _reload();
  }

  Future<void> scanAutomations() async {
    if (_automationScanRunning ||
        busy ||
        automations.every((item) => !item.enabled)) {
      return;
    }
    _automationScanRunning = true;
    try {
      for (final originalRule in List<AutomationRule>.from(
        automations.where((item) => item.enabled),
      )) {
        var rule = originalRule;
        try {
          final secrets = await store.credentialSecrets(rule.credentialId);
          final mergeRequests = await reviewService.listOpenMergeRequests(
            credentials: secrets,
            projectUrl: rule.projectUrl,
            targetBranch: rule.targetBranch,
          );
          for (final mr in mergeRequests.reversed) {
            final iid = jsonText(mr['iid']);
            final sha = jsonText(
              mr['sha'],
              jsonText((mr['diff_refs'] as Map?)?['head_sha']),
            );
            if (iid.isEmpty ||
                sha.isEmpty ||
                rule.lastReviewedHeads[iid] == sha) {
              continue;
            }
            final projectUrl = rule.projectUrl.replaceAll(RegExp(r'/+$'), '');
            await startReview(
              url: '$projectUrl/-/merge_requests/$iid',
              credentialId: rule.credentialId,
              model: secrets.profile.openaiModel,
              instructions: rule.instructions,
              publishGitLabComments: rule.publishGitLabComments,
            );
            final updatedHeads = {...rule.lastReviewedHeads, iid: sha};
            rule = AutomationRule(
              id: rule.id,
              name: rule.name,
              projectUrl: rule.projectUrl,
              targetBranch: rule.targetBranch,
              credentialId: rule.credentialId,
              credentialName: rule.credentialName,
              instructions: rule.instructions,
              publishGitLabComments: rule.publishGitLabComments,
              enabled: rule.enabled,
              lastReviewedHeads: updatedHeads,
            );
            await store.saveAutomation(rule);
          }
        } catch (error) {
          lastError = '自动审查“${rule.name}”失败：${_message(error)}';
          notifyListeners();
        }
      }
    } finally {
      _automationScanRunning = false;
      _reload();
    }
  }

  void clearError() {
    lastError = null;
    notifyListeners();
  }

  String _message(Object error) => error is FormatException
      ? error.message
      : error.toString().replaceFirst('Exception: ', '');

  @override
  void dispose() {
    _automationTimer?.cancel();
    super.dispose();
  }
}
