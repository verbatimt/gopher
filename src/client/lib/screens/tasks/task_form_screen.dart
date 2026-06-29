import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../providers/task_provider.dart';

enum SchedulingIntent { today, tomorrow, exact }

/// Create a task or recurring task. The scheduling-intent picker enforces conditional
/// required fields (Exact requires both a date and a time).
class TaskFormScreen extends StatefulWidget {
  const TaskFormScreen({super.key});

  @override
  State<TaskFormScreen> createState() => _TaskFormScreenState();
}

class _TaskFormScreenState extends State<TaskFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  SchedulingIntent _intent = SchedulingIntent.today;
  DateTime? _exactDate;
  TimeOfDay? _exactTime;
  bool _repeats = false;
  String _frequency = 'daily';
  int _interval = 1;
  bool _busy = false;
  String? _scheduleError;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  DateTime _resolveStart() {
    final now = DateTime.now();
    switch (_intent) {
      case SchedulingIntent.today:
        return DateTime(now.year, now.month, now.day, 9);
      case SchedulingIntent.tomorrow:
        return DateTime(now.year, now.month, now.day + 1, 9);
      case SchedulingIntent.exact:
        final d = _exactDate!;
        final t = _exactTime!;
        return DateTime(d.year, d.month, d.day, t.hour, t.minute);
    }
  }

  Future<void> _submit() async {
    setState(() => _scheduleError = null);
    if (!_formKey.currentState!.validate()) return;
    if (_intent == SchedulingIntent.exact && (_exactDate == null || _exactTime == null)) {
      setState(() => _scheduleError = 'Pick both a date and a time for an exact schedule.');
      return;
    }

    setState(() => _busy = true);
    final provider = context.read<TaskProvider>();
    final startsAt = _resolveStart().toUtc().toIso8601String();
    final ok = _repeats
        ? await provider.createRecurringTask({
            'title': _title.text.trim(),
            'startsAt': startsAt,
            'recurrence': {'frequency': _frequency, 'interval': _interval},
          })
        : await provider.createTask({'title': _title.text.trim(), 'startsAt': startsAt});

    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      context.pop();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not create the task')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New task')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder()),
              validator: (v) => validateRequired(v, 'Title'),
            ),
            const SizedBox(height: 16),
            Text('When', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            SegmentedButton<SchedulingIntent>(
              segments: const [
                ButtonSegment(value: SchedulingIntent.today, label: Text('Today')),
                ButtonSegment(value: SchedulingIntent.tomorrow, label: Text('Tomorrow')),
                ButtonSegment(value: SchedulingIntent.exact, label: Text('Exact')),
              ],
              selected: {_intent},
              onSelectionChanged: (s) => setState(() => _intent = s.first),
            ),
            if (_intent == SchedulingIntent.exact) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: DateTime.now(),
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2032),
                        );
                        if (picked != null) setState(() => _exactDate = picked);
                      },
                      child: Text(_exactDate == null ? 'Pick date' : '${_exactDate!.toLocal()}'.split(' ').first),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () async {
                        final picked = await showTimePicker(context: context, initialTime: TimeOfDay.now());
                        if (picked != null) setState(() => _exactTime = picked);
                      },
                      child: Text(_exactTime == null ? 'Pick time' : _exactTime!.format(context)),
                    ),
                  ),
                ],
              ),
            ],
            if (_scheduleError != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_scheduleError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 16),
            SwitchListTile(
              value: _repeats,
              onChanged: (v) => setState(() => _repeats = v),
              title: const Text('Repeats'),
              contentPadding: EdgeInsets.zero,
            ),
            if (_repeats) ...[
              Row(
                children: [
                  const Text('Every'),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 64,
                    child: TextFormField(
                      initialValue: '1',
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(border: OutlineInputBorder()),
                      onChanged: (v) => _interval = int.tryParse(v) ?? 1,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _frequency,
                      decoration: const InputDecoration(border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(value: 'daily', child: Text('Days')),
                        DropdownMenuItem(value: 'weekly', child: Text('Weeks')),
                        DropdownMenuItem(value: 'monthly', child: Text('Months')),
                        DropdownMenuItem(value: 'yearly', child: Text('Years')),
                      ],
                      onChanged: (v) => setState(() => _frequency = v ?? 'daily'),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Create'),
            ),
          ],
        ),
      ),
    );
  }
}
