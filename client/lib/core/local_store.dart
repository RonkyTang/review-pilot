import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'models.dart';

class CredentialSecrets {
  const CredentialSecrets({
    required this.profile,
    required this.gitlabToken,
    required this.openaiKey,
  });

  final CredentialProfile profile;
  final String gitlabToken;
  final String openaiKey;
}

class LocalReviewPilotStore {
  LocalReviewPilotStore({FlutterSecureStorage? secureStorage})
    : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _secureStorage;
  final Uuid _uuid = const Uuid();
  File? _file;
  JsonMap _data = {
    'version': 1,
    'credentials': <dynamic>[],
    'automations': <dynamic>[],
    'reviews': <dynamic>[],
  };
  Future<void> _writeQueue = Future.value();

  Future<void> initialize() async {
    final directory = await getApplicationSupportDirectory();
    await directory.create(recursive: true);
    _file = File('${directory.path}${Platform.pathSeparator}reviewpilot.json');
    await _recoverInterruptedWrite();
    try {
      final decoded = jsonDecode(await _file!.readAsString());
      if (decoded is Map) _data = Map<String, dynamic>.from(decoded);
    } catch (_) {
      await _persist();
    }
  }

  List<CredentialProfile> get credentials =>
      _jsonList('credentials').map(CredentialProfile.fromJson).toList();

  List<AutomationRule> get automations =>
      _jsonList('automations').map(AutomationRule.fromJson).toList();

  List<ReviewRecord> get reviews =>
      _jsonList('reviews').map(ReviewRecord.fromJson).toList()..sort(
        (a, b) => (b.createdAt ?? DateTime(1970)).compareTo(
          a.createdAt ?? DateTime(1970),
        ),
      );

  List<JsonMap> _jsonList(String key) =>
      (_data[key] is List ? _data[key] as List : const <dynamic>[])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

  String newId() => _uuid.v4();

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
    final profiles = credentials;
    final existingIndex = id == null
        ? -1
        : profiles.indexWhere((item) => item.id == id);
    final existing = existingIndex < 0 ? null : profiles[existingIndex];
    final profileId = existing?.id ?? newId();
    final cleanGitLabToken = gitlabToken.trim();
    final cleanOpenAIKey = openaiKey.trim();
    if (existing == null &&
        (cleanGitLabToken.isEmpty || cleanOpenAIKey.isEmpty)) {
      throw const FormatException('新建配置时必须填写 GitLab Token 和 OpenAI API Key');
    }
    if (cleanGitLabToken.isNotEmpty) {
      await _secureStorage.write(
        key: 'credential.$profileId.gitlab',
        value: cleanGitLabToken,
      );
    }
    if (cleanOpenAIKey.isNotEmpty) {
      await _secureStorage.write(
        key: 'credential.$profileId.openai',
        value: cleanOpenAIKey,
      );
    }
    final profile = CredentialProfile(
      id: profileId,
      name: name.trim(),
      gitlabOrigin: gitlabOrigin.trim().replaceAll(RegExp(r'/+$'), ''),
      gitlabTokenMask: cleanGitLabToken.isEmpty
          ? existing!.gitlabTokenMask
          : _maskSecret(cleanGitLabToken),
      gitlabAllowInsecureTls: gitlabAllowInsecureTls,
      openaiBaseUrl: openaiBaseUrl.trim().replaceAll(RegExp(r'/+$'), ''),
      openaiKeyMask: cleanOpenAIKey.isEmpty
          ? existing!.openaiKeyMask
          : _maskSecret(cleanOpenAIKey),
      openaiModel: openaiModel.trim(),
    );
    if (existingIndex < 0) {
      profiles.add(profile);
    } else {
      profiles[existingIndex] = profile;
    }
    _data['credentials'] = profiles.map((item) => item.toJson()).toList();
    await _persist();
    return profile;
  }

  Future<CredentialSecrets> credentialSecrets(String id) async {
    final profile = credentials.where((item) => item.id == id).firstOrNull;
    if (profile == null) throw const FormatException('凭据配置不存在');
    final gitlabToken =
        await _secureStorage.read(key: 'credential.$id.gitlab') ?? '';
    final openaiKey =
        await _secureStorage.read(key: 'credential.$id.openai') ?? '';
    if (gitlabToken.isEmpty || openaiKey.isEmpty) {
      throw const FormatException('系统安全存储中的 Token 或 API Key 已丢失');
    }
    return CredentialSecrets(
      profile: profile,
      gitlabToken: gitlabToken,
      openaiKey: openaiKey,
    );
  }

  Future<void> deleteCredential(String id) async {
    if (automations.any((item) => item.credentialId == id)) {
      throw const FormatException('该配置正在被自动审查仓库使用，请先删除对应自动化配置');
    }
    _data['credentials'] = credentials
        .where((item) => item.id != id)
        .map((item) => item.toJson())
        .toList();
    await _secureStorage.delete(key: 'credential.$id.gitlab');
    await _secureStorage.delete(key: 'credential.$id.openai');
    await _persist();
  }

  Future<AutomationRule> saveAutomation(AutomationRule rule) async {
    final rules = automations;
    final index = rules.indexWhere((item) => item.id == rule.id);
    if (index < 0) {
      rules.add(rule);
    } else {
      rules[index] = rule;
    }
    _data['automations'] = rules.map((item) => item.toJson()).toList();
    await _persist();
    return rule;
  }

  Future<void> deleteAutomation(String id) async {
    _data['automations'] = automations
        .where((item) => item.id != id)
        .map((item) => item.toJson())
        .toList();
    await _persist();
  }

  Future<void> upsertReview(JsonMap review) async {
    final items = _jsonList('reviews');
    final id = jsonText(review['id']);
    final index = items.indexWhere((item) => jsonText(item['id']) == id);
    if (index < 0) {
      items.add(review);
    } else {
      items[index] = review;
    }
    _data['reviews'] = items;
    await _persist();
  }

  Future<void> deleteReview(String id) async {
    _data['reviews'] = _jsonList(
      'reviews',
    ).where((item) => jsonText(item['id']) != id).toList();
    await _persist();
  }

  Future<void> _persist() {
    final snapshot = jsonEncode(_data);
    _writeQueue = _writeQueue.then((_) async {
      final file = _file;
      if (file == null) return;
      final temporary = File('${file.path}.tmp');
      await temporary.writeAsString(snapshot, flush: true);
      if (!Platform.isWindows) {
        await temporary.rename(file.path);
        return;
      }

      final backup = File('${file.path}.bak');
      if (await backup.exists()) await backup.delete();
      final hadPreviousFile = await file.exists();
      if (hadPreviousFile) await file.rename(backup.path);
      try {
        await temporary.rename(file.path);
      } catch (_) {
        if (hadPreviousFile && !await file.exists() && await backup.exists()) {
          await backup.rename(file.path);
        }
        rethrow;
      }
      if (await backup.exists()) {
        try {
          await backup.delete();
        } catch (_) {
          // A stale backup is harmless and will be cleaned on next startup.
        }
      }
    });
    return _writeQueue;
  }

  Future<void> _recoverInterruptedWrite() async {
    final file = _file;
    if (file == null) return;
    final backup = File('${file.path}.bak');
    final temporary = File('${file.path}.tmp');
    if (!await file.exists() && await backup.exists()) {
      await backup.rename(file.path);
    } else if (await file.exists() && await backup.exists()) {
      await backup.delete();
    }
    if (await temporary.exists()) await temporary.delete();
  }

  String _maskSecret(String value) {
    if (value.length <= 6) return '${value.substring(0, 2)}••••••••';
    return '${value.substring(0, 6)}••••••••${value.substring(value.length - 4)}';
  }
}
