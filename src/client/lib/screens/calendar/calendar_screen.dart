import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:table_calendar/table_calendar.dart';

import '../../core/constants.dart';
import '../../models/calendar_event.dart';
import '../../providers/auth_provider.dart';
import '../../providers/calendar_provider.dart';
import '../../widgets/module_guard.dart';
import '../../widgets/notification_bell.dart';
import '../../widgets/status_badge.dart';

/// Role-aware month calendar (table_calendar). Days carry markers for events/appointments
/// and task due dates; selecting a day lists that day's occurrences.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay;
  CalendarFormat _format = CalendarFormat.month;

  @override
  void initState() {
    super.initState();
    _selectedDay = _focusedDay;
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMonth(_focusedDay));
  }

  void _loadMonth(DateTime month) {
    final auth = context.read<AuthProvider>();
    if (auth.householdId.isEmpty) return;
    final from = DateTime(month.year, month.month - 1, 21);
    final to = DateTime(month.year, month.month + 1, 7);
    context.read<CalendarProvider>().loadRange(auth.householdId, from, to);
  }

  @override
  Widget build(BuildContext context) {
    final calendar = context.watch<CalendarProvider>();
    final day = _selectedDay ?? _focusedDay;
    final dayItems = calendar.forDay(day);

    return Scaffold(
      appBar: AppBar(title: const Text('Calendar'), actions: const [NotificationBell()]),
      body: ModuleGuard(
        module: AppModules.calendar,
        child: Column(
          children: [
            TableCalendar<CalendarOccurrence>(
              firstDay: DateTime.utc(2020),
              lastDay: DateTime.utc(2032),
              focusedDay: _focusedDay,
              calendarFormat: _format,
              selectedDayPredicate: (d) => _selectedDay != null && isSameDay(d, _selectedDay),
              eventLoader: calendar.forDay,
              onFormatChanged: (f) => setState(() => _format = f),
              onDaySelected: (selected, focused) {
                setState(() {
                  _selectedDay = selected;
                  _focusedDay = focused;
                });
              },
              onPageChanged: (focused) {
                _focusedDay = focused;
                _loadMonth(focused);
              },
            ),
            const Divider(height: 1),
            Expanded(
              child: dayItems.isEmpty
                  ? Center(
                      child: Text('Nothing scheduled', style: Theme.of(context).textTheme.bodyMedium),
                    )
                  : ListView(
                      children: [for (final o in dayItems) _OccurrenceTile(occurrence: o)],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OccurrenceTile extends StatelessWidget {
  final CalendarOccurrence occurrence;

  const _OccurrenceTile({required this.occurrence});

  IconData get _icon => switch (occurrence.type) {
        'task' => Icons.check_circle_outline,
        'appointment' => Icons.event_available_outlined,
        _ => Icons.event_outlined,
      };

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(_icon),
      title: Text(occurrence.title),
      subtitle: Text(occurrence.type),
      trailing: occurrence.status == 'completed'
          ? const StatusBadge('Done', tone: StatusTone.success)
          : null,
      onTap: () => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(occurrence.title),
          content: Text('${occurrence.type} · ${occurrence.status}'),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
        ),
      ),
    );
  }
}
