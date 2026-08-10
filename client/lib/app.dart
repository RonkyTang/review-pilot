import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/app_controller.dart';
import 'core/models.dart';
import 'core/report_export.dart';

class ReviewPilotApp extends StatefulWidget {
  const ReviewPilotApp({super.key, required this.controller});

  final ReviewPilotController controller;

  @override
  State<ReviewPilotApp> createState() => _ReviewPilotAppState();
}

class _ReviewPilotAppState extends State<ReviewPilotApp> {
  @override
  void initState() {
    super.initState();
    widget.controller.initialize();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ReviewPilot',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff8ce5b0),
          brightness: Brightness.dark,
          surface: const Color(0xff101c24),
        ),
        scaffoldBackgroundColor: const Color(0xff0b151c),
        cardTheme: const CardThemeData(color: Color(0xff12222c), elevation: 0),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Color(0xff142630),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(12)),
          ),
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Color(0xff101c24),
        ),
        navigationRailTheme: const NavigationRailThemeData(
          backgroundColor: Color(0xff101c24),
        ),
        useMaterial3: true,
      ),
      home: AnimatedBuilder(
        animation: widget.controller,
        builder: (context, _) => widget.controller.loading
            ? const _LoadingScreen()
            : HomeShell(controller: widget.controller),
      ),
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.radar, size: 52, color: Color(0xff8ce5b0)),
          SizedBox(height: 20),
          CircularProgressIndicator(),
          SizedBox(height: 14),
          Text('正在读取本地数据…'),
        ],
      ),
    ),
  );
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.controller});
  final ReviewPilotController controller;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  var _index = 0;

  static const _destinations = [
    NavigationDestination(
      icon: Icon(Icons.dashboard_outlined),
      selectedIcon: Icon(Icons.dashboard),
      label: '总览',
    ),
    NavigationDestination(
      icon: Icon(Icons.add_circle_outline),
      selectedIcon: Icon(Icons.add_circle),
      label: '发起审查',
    ),
    NavigationDestination(
      icon: Icon(Icons.sync_outlined),
      selectedIcon: Icon(Icons.sync),
      label: '自动审查',
    ),
    NavigationDestination(
      icon: Icon(Icons.history),
      selectedIcon: Icon(Icons.manage_history),
      label: '记录',
    ),
    NavigationDestination(
      icon: Icon(Icons.tune),
      selectedIcon: Icon(Icons.settings),
      label: '配置',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardPage(
        controller: widget.controller,
        onStartReview: () => setState(() => _index = 1),
      ),
      NewReviewPage(controller: widget.controller),
      AutomationPage(controller: widget.controller),
      HistoryPage(controller: widget.controller),
      SettingsPage(controller: widget.controller),
    ];
    final wide = MediaQuery.sizeOf(context).width >= 920;
    final error = widget.controller.lastError;
    final content = Column(
      children: [
        if (error != null)
          MaterialBanner(
            content: Text(error),
            leading: const Icon(
              Icons.error_outline,
              color: Colors.orangeAccent,
            ),
            actions: [
              TextButton(
                onPressed: widget.controller.clearError,
                child: const Text('知道了'),
              ),
            ],
          ),
        if (widget.controller.busy)
          LinearProgressIndicator(semanticsLabel: widget.controller.activity),
        Expanded(
          child: IndexedStack(index: _index, children: pages),
        ),
      ],
    );
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.radar, color: Color(0xff8ce5b0)),
            SizedBox(width: 10),
            Text('ReviewPilot'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '立即检查自动审查仓库',
            onPressed: widget.controller.busy
                ? null
                : widget.controller.scanAutomations,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: _index,
                  onDestinationSelected: (value) =>
                      setState(() => _index = value),
                  labelType: NavigationRailLabelType.all,
                  destinations: _destinations
                      .map(
                        (item) => NavigationRailDestination(
                          icon: item.icon,
                          selectedIcon: item.selectedIcon,
                          label: Text(item.label),
                        ),
                      )
                      .toList(),
                ),
                const VerticalDivider(width: 1),
                Expanded(child: content),
              ],
            )
          : content,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (value) => setState(() => _index = value),
              destinations: _destinations,
            ),
    );
  }
}

class _PageFrame extends StatelessWidget {
  const _PageFrame({
    required this.title,
    required this.subtitle,
    required this.child,
    this.action,
  });
  final String title;
  final String subtitle;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    slivers: [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 12),
        sliver: SliverToBoxAdapter(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.headlineMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      subtitle,
                      style: Theme.of(
                        context,
                      ).textTheme.bodyMedium?.copyWith(color: Colors.white60),
                    ),
                  ],
                ),
              ),
              ?action,
            ],
          ),
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 40),
        sliver: SliverToBoxAdapter(child: child),
      ),
    ],
  );
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({
    super.key,
    required this.controller,
    required this.onStartReview,
  });
  final ReviewPilotController controller;
  final VoidCallback onStartReview;

  @override
  Widget build(BuildContext context) {
    final completed = controller.reviews
        .where((item) => item.status == 'completed')
        .length;
    final issues = controller.reviews
        .where((item) => item.report?.findings.isNotEmpty == true)
        .length;
    final active = controller.reviews.where((item) => item.isActive).length;
    return _PageFrame(
      title: '代码审查总览',
      subtitle: '所有数据都保存在这台设备，GitLab 与 OpenAI 由客户端直接访问。',
      action: FilledButton.icon(
        onPressed: onStartReview,
        icon: const Icon(Icons.add),
        label: const Text('发起审查'),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _MetricCard(
                label: '全部审查',
                value: '${controller.reviews.length}',
                icon: Icons.fact_check_outlined,
              ),
              _MetricCard(
                label: '已完成',
                value: '$completed',
                icon: Icons.check_circle_outline,
              ),
              _MetricCard(
                label: '发现问题',
                value: '$issues',
                icon: Icons.warning_amber,
              ),
              _MetricCard(
                label: '正在运行',
                value: '$active',
                icon: Icons.hourglass_top,
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            '最近审查',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          if (controller.reviews.isEmpty)
            _EmptyState(
              icon: Icons.code,
              title: '还没有审查记录',
              detail: controller.credentials.isEmpty
                  ? '先到“配置”添加 GitLab/OpenAI 凭据。'
                  : '发起第一个 Merge Request 审查。',
            )
          else
            ...controller.reviews
                .take(6)
                .map(
                  (item) => ReviewTile(
                    review: item,
                    onTap: () => showReviewDetails(context, controller, item),
                  ),
                ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 210,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xff8ce5b0), size: 30),
            const SizedBox(width: 14),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value, style: Theme.of(context).textTheme.headlineSmall),
                Text(label),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

class NewReviewPage extends StatefulWidget {
  const NewReviewPage({super.key, required this.controller});
  final ReviewPilotController controller;

  @override
  State<NewReviewPage> createState() => _NewReviewPageState();
}

class _NewReviewPageState extends State<NewReviewPage> {
  final _formKey = GlobalKey<FormState>();
  final _url = TextEditingController();
  final _model = TextEditingController();
  final _instructions = TextEditingController();
  String? _credentialId;
  bool _publish = true;

  @override
  void dispose() {
    _url.dispose();
    _model.dispose();
    _instructions.dispose();
    super.dispose();
  }

  void _chooseCredential(String? value) {
    setState(() => _credentialId = value);
    final profile = widget.controller.credentials
        .where((item) => item.id == value)
        .firstOrNull;
    if (profile != null) _model.text = profile.openaiModel;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      final review = await widget.controller.startReview(
        url: _url.text,
        credentialId: _credentialId!,
        model: _model.text,
        instructions: _instructions.text,
        publishGitLabComments: _publish,
      );
      if (!mounted) return;
      await showReviewDetails(context, widget.controller, review);
    } catch (error) {
      if (mounted) _showError(context, error);
    }
  }

  @override
  Widget build(BuildContext context) => _PageFrame(
    title: '发起新的 Review',
    subtitle: '客户端直接读取 GitLab Diff，并调用所选配置中的 OpenAI API。',
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _url,
                    decoration: const InputDecoration(
                      labelText: 'GitLab Merge Request 地址',
                      hintText:
                          'https://gitlab.company.com/team/project/-/merge_requests/42',
                    ),
                    keyboardType: TextInputType.url,
                    validator: (value) =>
                        (value ?? '').trim().isEmpty ? '请填写 MR 地址' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: _credentialId,
                    decoration: const InputDecoration(
                      labelText: 'GitLab/OpenAI 凭据配置',
                    ),
                    items: widget.controller.credentials
                        .map(
                          (item) => DropdownMenuItem(
                            value: item.id,
                            child: Text(item.name),
                          ),
                        )
                        .toList(),
                    onChanged: _chooseCredential,
                    validator: (value) => value == null ? '请先选择凭据配置' : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _model,
                    decoration: const InputDecoration(labelText: '本次使用的模型'),
                    validator: (value) =>
                        (value ?? '').trim().isEmpty ? '请填写模型名称' : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _instructions,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: '审查重点（可选）',
                      hintText: '例如：重点检查并发安全、权限边界和数据一致性',
                    ),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('同步评论到 GitLab'),
                    subtitle: const Text('中高风险行评论；无问题时发布报告并请求 Approve'),
                    value: _publish,
                    onChanged: (value) => setState(() => _publish = value),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed:
                        widget.controller.busy ||
                            widget.controller.credentials.isEmpty
                        ? null
                        : _submit,
                    icon: const Icon(Icons.auto_awesome),
                    label: Text(
                      widget.controller.busy
                          ? widget.controller.activity
                          : '开始 AI Review',
                    ),
                  ),
                  if (widget.controller.credentials.isEmpty) ...[
                    const SizedBox(height: 12),
                    const Text(
                      '请先在“配置”页面添加 GitLab Token 和 OpenAI API Key。',
                      style: TextStyle(color: Colors.orangeAccent),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class AutomationPage extends StatelessWidget {
  const AutomationPage({super.key, required this.controller});
  final ReviewPilotController controller;

  @override
  Widget build(BuildContext context) => _PageFrame(
    title: '仓库自动审查',
    subtitle: '客户端每分钟轮询一次；仅在应用运行期间生效，移动端关闭后会暂停。',
    action: FilledButton.icon(
      onPressed: controller.credentials.isEmpty
          ? null
          : () => showAutomationEditor(context, controller),
      icon: const Icon(Icons.add),
      label: const Text('添加仓库'),
    ),
    child: controller.automations.isEmpty
        ? const _EmptyState(
            icon: Icons.sync,
            title: '还没有自动审查仓库',
            detail: '新建配置时会记录当前 MR，只审查后续新 MR 或新提交。',
          )
        : Column(
            children: controller.automations
                .map(
                  (rule) => Card(
                    child: ListTile(
                      leading: Icon(
                        rule.enabled ? Icons.sync : Icons.pause_circle_outline,
                        color: rule.enabled
                            ? const Color(0xff8ce5b0)
                            : Colors.white38,
                      ),
                      title: Text(rule.name),
                      subtitle: Text(
                        '${rule.projectUrl}\n${rule.targetBranch.isEmpty ? '全部目标分支' : '目标分支：${rule.targetBranch}'} · ${rule.credentialName}',
                      ),
                      isThreeLine: true,
                      trailing: PopupMenuButton<String>(
                        onSelected: (action) async {
                          if (action == 'edit') {
                            await showAutomationEditor(
                              context,
                              controller,
                              rule: rule,
                            );
                          }
                          if (action == 'delete' &&
                              context.mounted &&
                              await _confirm(context, '删除自动审查配置？')) {
                            await controller.deleteAutomation(rule.id);
                          }
                        },
                        itemBuilder: (_) => const [
                          PopupMenuItem(value: 'edit', child: Text('编辑')),
                          PopupMenuItem(value: 'delete', child: Text('删除')),
                        ],
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
  );
}

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key, required this.controller});
  final ReviewPilotController controller;

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  var _search = '';

  @override
  Widget build(BuildContext context) {
    final query = _search.toLowerCase();
    final items = widget.controller.reviews
        .where(
          (item) => '${item.title} ${item.project} ${item.mrIid}'
              .toLowerCase()
              .contains(query),
        )
        .toList();
    return _PageFrame(
      title: '审查记录',
      subtitle: '报告只保存在当前设备，可查看、转发或删除。',
      child: Column(
        children: [
          TextField(
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              labelText: '搜索项目、标题或 MR 编号',
            ),
            onChanged: (value) => setState(() => _search = value),
          ),
          const SizedBox(height: 14),
          if (items.isEmpty)
            const _EmptyState(
              icon: Icons.history,
              title: '没有匹配的审查记录',
              detail: '完成审查后，报告会出现在这里。',
            )
          else
            ...items.map(
              (item) => ReviewTile(
                review: item,
                onTap: () =>
                    showReviewDetails(context, widget.controller, item),
              ),
            ),
        ],
      ),
    );
  }
}

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.controller});
  final ReviewPilotController controller;

  @override
  Widget build(BuildContext context) => _PageFrame(
    title: '本地配置',
    subtitle: 'Token 和 API Key 保存在系统钥匙串/安全存储，完整密钥不会写入本地报告文件。',
    action: FilledButton.icon(
      onPressed: () => showCredentialEditor(context, controller),
      icon: const Icon(Icons.add),
      label: const Text('添加配置'),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (controller.credentials.isEmpty)
          const _EmptyState(
            icon: Icons.key,
            title: '还没有凭据配置',
            detail: '添加 GitLab Token、OpenAI API 地址、API Key 和默认模型。',
          )
        else
          ...controller.credentials.map(
            (profile) => Card(
              child: ListTile(
                leading: const Icon(Icons.key, color: Color(0xff8ce5b0)),
                title: Text(profile.name),
                subtitle: Text(
                  '${profile.gitlabOrigin}\nGitLab ${profile.gitlabTokenMask} · OpenAI ${profile.openaiKeyMask}\n${profile.openaiModel}',
                ),
                isThreeLine: true,
                trailing: PopupMenuButton<String>(
                  onSelected: (action) async {
                    if (action == 'edit') {
                      await showCredentialEditor(
                        context,
                        controller,
                        profile: profile,
                      );
                    }
                    if (action == 'delete' &&
                        context.mounted &&
                        await _confirm(context, '删除“${profile.name}”及其本地密钥？')) {
                      try {
                        await controller.deleteCredential(profile.id);
                      } catch (error) {
                        if (context.mounted) _showError(context, error);
                      }
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('编辑')),
                    PopupMenuItem(value: 'delete', child: Text('删除')),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: 22),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '本地数据说明',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  '• 配置元数据、自动化规则和审查记录：应用专属目录\n• GitLab Token 与 OpenAI API Key：操作系统安全存储\n• 不连接 ReviewPilot 服务端，也不上传本地历史记录',
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class ReviewTile extends StatelessWidget {
  const ReviewTile({super.key, required this.review, required this.onTap});
  final ReviewRecord review;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = review.status == 'failed'
        ? Colors.redAccent
        : review.isActive
        ? Colors.orangeAccent
        : review.report?.findings.isEmpty == true
        ? const Color(0xff8ce5b0)
        : Colors.amber;
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: .15),
          child: review.report == null
              ? Icon(Icons.code, color: color)
              : Text(
                  '${review.report!.score}',
                  style: TextStyle(color: color, fontWeight: FontWeight.w700),
                ),
        ),
        title: Text(review.title, maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          '${review.project} · MR !${review.mrIid.isEmpty ? '—' : review.mrIid}\n${review.isActive ? review.progress : _statusLabel(review)}',
        ),
        isThreeLine: true,
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

String _statusLabel(ReviewRecord review) {
  if (review.status == 'failed') return '失败：${review.error}';
  final findings = review.report?.findings.length ?? 0;
  return findings == 0 ? '建议通过' : '发现 $findings 个问题';
}

Future<void> showReviewDetails(
  BuildContext context,
  ReviewPilotController controller,
  ReviewRecord initial,
) async {
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => Dialog.fullscreen(
      child: AnimatedBuilder(
        animation: controller,
        builder: (context, _) {
          final review =
              controller.reviews
                  .where((item) => item.id == initial.id)
                  .firstOrNull ??
              initial;
          return Scaffold(
            appBar: AppBar(
              leading: IconButton(
                onPressed: () => Navigator.pop(dialogContext),
                icon: const Icon(Icons.close),
              ),
              title: Text(review.title),
              actions: [
                if (review.url.isNotEmpty)
                  IconButton(
                    tooltip: '打开 GitLab MR',
                    onPressed: () => launchUrl(
                      Uri.parse(review.url),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.open_in_new),
                  ),
                if (review.report != null)
                  IconButton(
                    tooltip: '转发报告图片',
                    onPressed: () async {
                      try {
                        await ReportExport.share(review, dialogContext);
                      } catch (error) {
                        if (dialogContext.mounted) {
                          _showError(dialogContext, error);
                        }
                      }
                    },
                    icon: const Icon(Icons.ios_share),
                  ),
                if (review.canDelete)
                  IconButton(
                    tooltip: '删除',
                    onPressed: () async {
                      if (await _confirm(dialogContext, '删除这条审查记录？')) {
                        await controller.deleteReview(review.id);
                        if (dialogContext.mounted) Navigator.pop(dialogContext);
                      }
                    },
                    icon: const Icon(Icons.delete_outline),
                  ),
              ],
            ),
            body: review.isActive
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        const SizedBox(height: 16),
                        Text(review.progress),
                      ],
                    ),
                  )
                : ReviewReportView(review: review),
          );
        },
      ),
    ),
  );
}

class ReviewReportView extends StatelessWidget {
  const ReviewReportView({super.key, required this.review});
  final ReviewRecord review;

  @override
  Widget build(BuildContext context) {
    if (review.status == 'failed') {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(30),
          child: Text(
            review.error,
            style: const TextStyle(color: Colors.redAccent),
          ),
        ),
      );
    }
    final report = review.report;
    if (report == null) return const Center(child: Text('报告数据不可用'));
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 50),
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            Chip(
              avatar: const Icon(Icons.score, size: 18),
              label: Text('${report.score}/100'),
            ),
            Chip(label: Text(_decisionLabel(report.decision))),
            Chip(label: Text('风险：${_severityLabel(report.risk)}')),
            Chip(label: Text('${report.findings.length} 个问题')),
          ],
        ),
        const SizedBox(height: 16),
        _ReportSection(title: '审查结论', child: Text(report.summary)),
        _ReportSection(
          title: '本次修改',
          child: _BulletList(report.changedSummary),
        ),
        _ReportSection(
          title: '发现的问题',
          child: report.findings.isEmpty
              ? const Text(
                  '没有发现明确问题。',
                  style: TextStyle(color: Color(0xff8ce5b0)),
                )
              : Column(
                  children: report.findings
                      .map((finding) => _FindingCard(finding: finding))
                      .toList(),
                ),
        ),
        _ReportSection(
          title: '建议补充的测试',
          child: _BulletList(report.testSuggestions),
        ),
        if (report.positiveNotes.isNotEmpty)
          _ReportSection(
            title: '做得不错',
            child: _BulletList(report.positiveNotes),
          ),
      ],
    );
  }
}

class _ReportSection extends StatelessWidget {
  const _ReportSection({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    ),
  );
}

class _FindingCard extends StatelessWidget {
  const _FindingCard({required this.finding});
  final ReviewFinding finding;
  @override
  Widget build(BuildContext context) {
    final color =
        {
          'critical': Colors.redAccent,
          'high': Colors.redAccent,
          'medium': Colors.amber,
          'low': Colors.lightBlueAccent,
        }[finding.severity] ??
        Colors.white60;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: color, width: 4)),
        color: const Color(0xff0f1d25),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${_severityLabel(finding.severity)} · ${finding.title}',
            style: TextStyle(color: color, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            '${finding.location} · ${finding.category}',
            style: const TextStyle(color: Color(0xff8ce5b0)),
          ),
          const SizedBox(height: 10),
          Text(finding.description),
          const SizedBox(height: 8),
          Text(
            '依据：${finding.evidence}',
            style: const TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 8),
          Text(
            '建议：${finding.suggestion}',
            style: const TextStyle(color: Color(0xffbce8cc)),
          ),
        ],
      ),
    );
  }
}

class _BulletList extends StatelessWidget {
  const _BulletList(this.items);
  final List<String> items;
  @override
  Widget build(BuildContext context) => items.isEmpty
      ? const Text('—')
      : Column(
          children: items
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '•  ',
                        style: TextStyle(color: Color(0xff8ce5b0)),
                      ),
                      Expanded(child: Text(item)),
                    ],
                  ),
                ),
              )
              .toList(),
        );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.detail,
  });
  final IconData icon;
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(34),
      child: Column(
        children: [
          Icon(icon, size: 44, color: Colors.white38),
          const SizedBox(height: 12),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 5),
          Text(
            detail,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white60),
          ),
        ],
      ),
    ),
  );
}

Future<void> showCredentialEditor(
  BuildContext context,
  ReviewPilotController controller, {
  CredentialProfile? profile,
}) async {
  final name = TextEditingController(text: profile?.name);
  final gitlab = TextEditingController(text: profile?.gitlabOrigin);
  final gitlabToken = TextEditingController();
  final openai = TextEditingController(
    text: profile?.openaiBaseUrl ?? 'https://api.openai.com/v1',
  );
  final openaiKey = TextEditingController();
  final model = TextEditingController(
    text: profile?.openaiModel ?? 'gpt-5.4-mini',
  );
  var insecure = profile?.gitlabAllowInsecureTls ?? false;
  final formKey = GlobalKey<FormState>();
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: Text(profile == null ? '添加凭据配置' : '编辑凭据配置'),
        content: SizedBox(
          width: 620,
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: '配置名称'),
                    validator: _required,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: gitlab,
                    decoration: const InputDecoration(labelText: 'GitLab 地址'),
                    keyboardType: TextInputType.url,
                    validator: _required,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: gitlabToken,
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: 'GitLab Token',
                      hintText: profile == null
                          ? ''
                          : '留空表示保留 ${profile.gitlabTokenMask}',
                    ),
                    validator: profile == null ? _required : null,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('忽略 GitLab HTTPS 证书错误'),
                    subtitle: const Text('仅用于可信内网的自签名或过期证书'),
                    value: insecure,
                    onChanged: (value) =>
                        setDialogState(() => insecure = value),
                  ),
                  TextFormField(
                    controller: openai,
                    decoration: const InputDecoration(
                      labelText: 'OpenAI API 地址',
                      helperText: '需兼容 Responses API；远程地址必须使用 HTTPS',
                    ),
                    keyboardType: TextInputType.url,
                    validator: _required,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: openaiKey,
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: 'OpenAI API Key',
                      hintText: profile == null
                          ? ''
                          : '留空表示保留 ${profile.openaiKeyMask}',
                    ),
                    validator: profile == null ? _required : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: model,
                    decoration: const InputDecoration(labelText: '默认模型'),
                    validator: _required,
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () async {
              if (!formKey.currentState!.validate()) return;
              try {
                await controller.saveCredential(
                  id: profile?.id,
                  name: name.text,
                  gitlabOrigin: gitlab.text,
                  gitlabToken: gitlabToken.text,
                  gitlabAllowInsecureTls: insecure,
                  openaiBaseUrl: openai.text,
                  openaiKey: openaiKey.text,
                  openaiModel: model.text,
                );
                if (dialogContext.mounted) Navigator.pop(dialogContext);
              } catch (error) {
                if (dialogContext.mounted) _showError(dialogContext, error);
              }
            },
            child: const Text('保存'),
          ),
        ],
      ),
    ),
  );
  for (final item in [name, gitlab, gitlabToken, openai, openaiKey, model]) {
    item.dispose();
  }
}

Future<void> showAutomationEditor(
  BuildContext context,
  ReviewPilotController controller, {
  AutomationRule? rule,
}) async {
  final name = TextEditingController(text: rule?.name);
  final project = TextEditingController(text: rule?.projectUrl);
  final branch = TextEditingController(text: rule?.targetBranch);
  final instructions = TextEditingController(text: rule?.instructions);
  var credentialId =
      rule?.credentialId ?? controller.credentials.firstOrNull?.id;
  var publish = rule?.publishGitLabComments ?? true;
  var enabled = rule?.enabled ?? true;
  final formKey = GlobalKey<FormState>();
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: Text(rule == null ? '添加自动审查仓库' : '编辑自动审查仓库'),
        content: SizedBox(
          width: 620,
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: '配置名称'),
                    validator: _required,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: project,
                    decoration: const InputDecoration(labelText: 'GitLab 仓库地址'),
                    validator: _required,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: credentialId,
                    decoration: const InputDecoration(labelText: '凭据配置'),
                    items: controller.credentials
                        .map(
                          (item) => DropdownMenuItem(
                            value: item.id,
                            child: Text(item.name),
                          ),
                        )
                        .toList(),
                    onChanged: (value) =>
                        setDialogState(() => credentialId = value),
                    validator: (value) => value == null ? '请选择凭据配置' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: branch,
                    decoration: const InputDecoration(labelText: '目标分支（可选）'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: instructions,
                    maxLines: 3,
                    decoration: const InputDecoration(labelText: '审查重点（可选）'),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('同步 GitLab 评论'),
                    value: publish,
                    onChanged: (value) => setDialogState(() => publish = value),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('启用前台轮询'),
                    value: enabled,
                    onChanged: (value) => setDialogState(() => enabled = value),
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () async {
              if (!formKey.currentState!.validate()) return;
              try {
                await controller.saveAutomation(
                  id: rule?.id,
                  name: name.text,
                  projectUrl: project.text,
                  targetBranch: branch.text,
                  credentialId: credentialId!,
                  instructions: instructions.text,
                  publishGitLabComments: publish,
                  enabled: enabled,
                );
                if (dialogContext.mounted) Navigator.pop(dialogContext);
              } catch (error) {
                if (dialogContext.mounted) _showError(dialogContext, error);
              }
            },
            child: const Text('保存'),
          ),
        ],
      ),
    ),
  );
  for (final item in [name, project, branch, instructions]) {
    item.dispose();
  }
}

String? _required(String? value) =>
    (value ?? '').trim().isEmpty ? '此项不能为空' : null;

Future<bool> _confirm(BuildContext context, String message) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('请确认'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认'),
          ),
        ],
      ),
    ) ??
    false;

void _showError(BuildContext context, Object error) {
  final message = error is FormatException
      ? error.message
      : error.toString().replaceFirst('Exception: ', '');
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: Colors.red.shade700),
  );
}

String _decisionLabel(String value) =>
    {'approve': '建议通过', 'comment': '建议关注', 'request_changes': '需要修改'}[value] ??
    value;
String _severityLabel(String value) =>
    {'critical': '致命', 'high': '高', 'medium': '中', 'low': '低'}[value] ?? value;
