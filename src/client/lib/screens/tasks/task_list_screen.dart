import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants.dart';
import '../../models/auth_state.dart';
import '../../models/task.dart';
import '../../providers/auth_provider.dart';
import '../../providers/task_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';
import '../../widgets/status_badge.dart';

class TaskListScreen extends StatefulWidget {
  const TaskListScreen({super.key});

  @override
  State<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends State<TaskListScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.householdId.isNotEmpty) context.read<TaskProvider>().load(auth.householdId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final auth = context.watch<AuthProvider>();
    final canCreate = auth.roles.any(
      (r) => r == RoleNames.supervising || r == RoleNames.unsupervised,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Tasks'), actions: const [NotificationBell()]),
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: () => context.push('/tasks/new'),
              icon: const Icon(Icons.add),
              label: const Text('New task'),
            )
          : null,
      body: ModuleGuard(
        module: AppModules.tasks,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Wrap(
                spacing: 8,
                children: [
                  for (final (label, value) in const [('All', null), ('Pending', 'pending'), ('Done', 'completed')])
                    ChoiceChip(
                      label: Text(label),
                      selected: provider.statusFilter == value,
                      onSelected: (_) => context.read<TaskProvider>().setStatusFilter(value),
                    ),
                ],
              ),
            ),
            Expanded(
              child: provider.tasks.isEmpty
                  ? Center(child: Text('No tasks', style: Theme.of(context).textTheme.bodyMedium))
                  : RefreshIndicator(
                      onRefresh: () => context.read<TaskProvider>().load(auth.householdId),
                      child: ListView(
                        children: [for (final task in provider.tasks) _TaskTile(task: task)],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TaskTile extends StatelessWidget {
  final Task task;

  const _TaskTile({required this.task});

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (task.status) {
      'completed' => ('Done', StatusTone.success),
      'skipped' => ('Skipped', StatusTone.neutral),
      'in_progress' => ('In progress', StatusTone.warning),
      _ => ('Pending', StatusTone.neutral),
    };
    return ListTile(
      leading: Icon(task.isCompleted ? Icons.check_circle : Icons.radio_button_unchecked),
      title: Text(task.title),
      subtitle: task.unskippable ? const Text('Unskippable') : null,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          StatusBadge(label, tone: tone),
          if (!task.isCompleted)
            IconButton(
              tooltip: 'Mark complete',
              icon: const Icon(Icons.done),
              onPressed: () => context.read<TaskProvider>().completeTask(task.id),
            ),
        ],
      ),
      onTap: () => context.push('/tasks/${task.id}'),
    );
  }
}
