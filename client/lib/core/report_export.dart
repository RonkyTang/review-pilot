import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'models.dart';

class ReportExport {
  static Future<void> share(ReviewRecord review, BuildContext context) async {
    final report = review.report;
    if (report == null) throw const FormatException('报告尚未完成');
    final box = context.findRenderObject() as RenderBox?;
    final shareOrigin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    final bytes = await _render(review, report);
    final directory = await getTemporaryDirectory();
    final safeProject = review.project.replaceAll(
      RegExp(r'[^a-zA-Z0-9_\-\u4e00-\u9fff]+'),
      '-',
    );
    final file = File(
      '${directory.path}${Platform.pathSeparator}ReviewPilot-$safeProject-MR-${review.mrIid}.png',
    );
    await file.writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: 'image/png')],
        text: '${review.title} · ReviewPilot AI Code Review',
        sharePositionOrigin: shareOrigin,
      ),
    );
  }

  static Future<List<int>> _render(
    ReviewRecord review,
    ReviewReport report,
  ) async {
    const width = 1200.0;
    const padding = 70.0;
    const maxHeight = 16000.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(
      const Rect.fromLTWH(0, 0, width, maxHeight),
      Paint()..color = const Color(0xff0d1821),
    );
    var y = 60.0;

    double text(
      String value,
      double x,
      double maxWidth, {
      double size = 21,
      Color color = const Color(0xffd5dddc),
      FontWeight weight = FontWeight.w400,
      int? maxLines,
    }) {
      final painter = TextPainter(
        text: TextSpan(
          text: value.isEmpty ? '—' : value,
          style: TextStyle(
            fontSize: size,
            color: color,
            fontWeight: weight,
            height: 1.45,
          ),
        ),
        textDirection: TextDirection.ltr,
        maxLines: maxLines,
        ellipsis: maxLines == null ? null : '…',
      )..layout(maxWidth: maxWidth);
      painter.paint(canvas, Offset(x, y));
      final height = painter.height;
      y += height;
      return height;
    }

    void section(String title, [String detail = '']) {
      y += 34;
      canvas.drawRect(
        Rect.fromLTWH(padding, y + 8, 9, 9),
        Paint()..color = const Color(0xffa8f0c6),
      );
      text(
        title,
        padding + 24,
        500,
        size: 25,
        color: Colors.white,
        weight: FontWeight.w700,
        maxLines: 1,
      );
      if (detail.isNotEmpty) {
        final saved = y;
        y -= 36;
        text(
          detail,
          width - padding - 230,
          230,
          size: 17,
          color: const Color(0xff84989e),
          maxLines: 1,
        );
        y = saved;
      }
      y += 12;
    }

    text(
      'REVIEWPILOT · AI CODE REVIEW',
      padding,
      600,
      size: 18,
      color: const Color(0xffa8f0c6),
      weight: FontWeight.w700,
      maxLines: 1,
    );
    y += 32;
    final titleY = y;
    text(
      review.title,
      padding,
      830,
      size: 38,
      color: const Color(0xfff7f8f4),
      weight: FontWeight.w700,
      maxLines: 2,
    );
    final afterTitle = y;
    y = titleY;
    text(
      '${report.score}',
      width - padding - 170,
      170,
      size: 48,
      color: const Color(0xffa8f0c6),
      weight: FontWeight.w700,
      maxLines: 1,
    );
    y = afterTitle + 10;
    text(
      '${review.project} · MR !${review.mrIid} · ${review.sourceBranch} → ${review.targetBranch}',
      padding,
      width - padding * 2,
      size: 18,
      color: const Color(0xff819399),
      maxLines: 2,
    );

    section('审查结论', _decisionLabel(report.decision));
    final summaryTop = y;
    final summaryPainter = TextPainter(
      text: TextSpan(
        text: report.summary,
        style: const TextStyle(
          fontSize: 23,
          color: Color(0xffd5dddc),
          height: 1.55,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: width - padding * 2 - 56);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(
          padding,
          summaryTop,
          width - padding * 2,
          summaryPainter.height + 56,
        ),
        const Radius.circular(12),
      ),
      Paint()..color = const Color(0xff172832),
    );
    y += 28;
    summaryPainter.paint(canvas, Offset(padding + 28, y));
    y += summaryPainter.height + 28;

    section('本次修改', '${report.changedSummary.length} 项');
    for (final item in report.changedSummary.take(8)) {
      canvas.drawCircle(
        Offset(padding + 7, y + 14),
        4,
        Paint()..color = const Color(0xffa8f0c6),
      );
      text(item, padding + 28, width - padding * 2 - 28, size: 20, maxLines: 4);
      y += 8;
    }

    section('发现的问题', '${report.findings.length} 项');
    if (report.findings.isEmpty) {
      text(
        '没有发现需要修改或关注的风险项。',
        padding,
        width - padding * 2,
        color: const Color(0xffa8f0c6),
      );
    }
    for (final finding in report.findings.take(20)) {
      if (y > maxHeight - 650) break;
      final color = _severityColor(finding.severity);
      final top = y;
      final description = _measure(
        finding.description,
        width - padding * 2 - 52,
        19,
        5,
      );
      final evidence = _measure(
        '依据：${finding.evidence}',
        width - padding * 2 - 52,
        18,
        5,
      );
      final suggestion = _measure(
        '建议：${finding.suggestion}',
        width - padding * 2 - 52,
        18,
        5,
      );
      final cardHeight =
          150 + description.height + evidence.height + suggestion.height;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(padding, top, width - padding * 2, cardHeight),
          const Radius.circular(12),
        ),
        Paint()..color = const Color(0xff14242d),
      );
      canvas.drawRect(
        Rect.fromLTWH(padding, top, 7, cardHeight),
        Paint()..color = color,
      );
      y += 25;
      text(
        '${_severityLabel(finding.severity)} · ${finding.title}',
        padding + 28,
        width - padding * 2 - 56,
        size: 23,
        color: color,
        weight: FontWeight.w700,
        maxLines: 3,
      );
      y += 7;
      text(
        '${finding.location} · ${finding.category}',
        padding + 28,
        width - padding * 2 - 56,
        size: 17,
        color: const Color(0xff83b49d),
        maxLines: 2,
      );
      y += 8;
      description.paint(canvas, Offset(padding + 28, y));
      y += description.height + 8;
      evidence.paint(canvas, Offset(padding + 28, y));
      y += evidence.height + 8;
      suggestion.paint(canvas, Offset(padding + 28, y));
      y = top + cardHeight + 18;
    }

    section('建议补充的测试', '${report.testSuggestions.length} 项');
    for (final item in report.testSuggestions.take(10)) {
      canvas.drawCircle(
        Offset(padding + 7, y + 14),
        4,
        Paint()..color = const Color(0xffa8f0c6),
      );
      text(item, padding + 28, width - padding * 2 - 28, size: 20, maxLines: 4);
      y += 8;
    }
    if (report.positiveNotes.isNotEmpty) {
      section('做得不错', '${report.positiveNotes.length} 项');
      for (final item in report.positiveNotes.take(8)) {
        text('•  $item', padding, width - padding * 2, size: 20, maxLines: 4);
        y += 7;
      }
    }
    y += 50;
    text(
      'ReviewPilot · 自动生成的 AI Code Review 报告',
      padding,
      width - padding * 2,
      size: 15,
      color: const Color(0xff5f747b),
      maxLines: 1,
    );
    final height = y.ceil().clamp(600, maxHeight.toInt());
    final picture = recorder.endRecording();
    final image = await picture.toImage(width.toInt(), height);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    picture.dispose();
    if (data == null) throw const FormatException('无法生成报告图片');
    return data.buffer.asUint8List();
  }

  static TextPainter _measure(
    String value,
    double width,
    double size,
    int maxLines,
  ) => TextPainter(
    text: TextSpan(
      text: value,
      style: TextStyle(
        fontSize: size,
        color: const Color(0xffc5d0d0),
        height: 1.45,
      ),
    ),
    textDirection: TextDirection.ltr,
    maxLines: maxLines,
    ellipsis: '…',
  )..layout(maxWidth: width);

  static String _decisionLabel(String value) =>
      {
        'approve': '建议通过',
        'comment': '建议关注',
        'request_changes': '需要修改',
      }[value] ??
      value;
  static String _severityLabel(String value) =>
      {'critical': '致命', 'high': '高', 'medium': '中', 'low': '低'}[value] ??
      value;
  static Color _severityColor(String value) =>
      {
        'critical': Colors.redAccent,
        'high': Colors.redAccent,
        'medium': Colors.amber,
        'low': Colors.lightBlueAccent,
      }[value] ??
      Colors.white60;
}
