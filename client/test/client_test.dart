import 'package:flutter_test/flutter_test.dart';
import 'package:reviewpilot_client/core/direct_review_service.dart';
import 'package:reviewpilot_client/core/models.dart';

void main() {
  test('parses a self-hosted GitLab merge request URL', () {
    final target = MergeRequestTarget.parse(
      'https://gitlab.example.com/team/service/-/merge_requests/42?tab=diffs',
    );

    expect(target.origin, 'https://gitlab.example.com');
    expect(target.projectPath, 'team/service');
    expect(target.iid, '42');
    expect(
      target.url,
      'https://gitlab.example.com/team/service/-/merge_requests/42',
    );
  });

  test('review records expose local report findings', () {
    final review = ReviewRecord.fromJson({
      'id': 'review-1',
      'title': 'MR !42',
      'status': 'completed',
      'report': {
        'summary': '发现一个问题',
        'decision': 'request_changes',
        'risk': 'medium',
        'score': 80,
        'changedSummary': <String>[],
        'findings': [
          {
            'title': '竞态条件',
            'severity': 'medium',
            'path': 'service.dart',
            'line': 38,
            'category': '并发安全',
            'description': '并发更新可能覆盖数据',
            'evidence': '读写之间没有同步',
            'suggestion': '使用事务',
          },
        ],
        'testSuggestions': <String>[],
        'positiveNotes': <String>[],
      },
    });

    expect(review.report?.score, 80);
    expect(review.report?.findings.single.location, 'service.dart:38');
  });
}
