import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/task.dart';
import '../../providers/task_provider.dart';

/// Task detail with the ordered workflow-step checklist (toggling a step calls the API and
/// reflects auto-completion) and a Mark Complete action. Passive steps are styled distinctly.
class TaskDetailScreen extends StatefulWidget {
  final String taskId;

  const TaskDetailScreen({super.key, required this.taskId});

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  Task? _task;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final task = await context.read<TaskProvider>().fetchTask(widget.taskId);
    if (mounted) {
      setState(() {
        _task = task;
        _loading = false;
      });
    }
  }

  Future<void> _toggle(WorkflowStep step, bool value) async {
    final updated = await context.read<TaskProvider>().toggleStep(widget.taskId, step.id, value);
    if (updated != null && mounted) setState(() => _task = updated);
  }

  Future<void> _complete() async {
    await context.read<TaskProvider>().completeTask(widget.taskId);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final task = _task;
    return Scaffold(
      appBar: AppBar(title: Text(task?.title ?? 'Task')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : task == null
              ? const Center(child: Text('Task not found'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (task.description != null && task.description!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(task.description!, style: theme.textTheme.bodyMedium),
                      ),
                    Text('Status: ${task.status}', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 12),
                    if (task.steps.isNotEmpty) ...[
                      Text('Steps', style: theme.textTheme.titleMedium),
                      for (final step in task.steps)
                        CheckboxListTile(
                          value: step.isCompleted,
                          onChanged: (v) => _toggle(step, v ?? false),
                          title: Text(
                            step.description,
                            style: step.passive
                                ? theme.textTheme.bodyMedium?.copyWith(fontStyle: FontStyle.italic)
                                : null,
                          ),
                          subtitle: step.passive ? const Text('Passive') : null,
                          controlAffinity: ListTileControlAffinity.leading,
                        ),
                      const SizedBox(height: 12),
                    ],
                    if (!task.isCompleted)
                      FilledButton.icon(
                        onPressed: _complete,
                        icon: const Icon(Icons.check),
                        label: const Text('Mark complete'),
                      ),
                  ],
                ),
    );
  }
}
