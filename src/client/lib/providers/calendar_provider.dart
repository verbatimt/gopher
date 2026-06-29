import 'dart:async';

import '../models/calendar_event.dart';
import '../services/calendar_service.dart';
import 'base_provider.dart';

/// Calendar occurrences for the visible range. Live-refreshes on `calendar.changed`.
class CalendarProvider extends BaseProvider {
  final CalendarService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  String? _householdId;
  DateTime? _from;
  DateTime? _to;
  List<CalendarOccurrence> _occurrences = [];

  CalendarProvider(this._service);

  List<CalendarOccurrence> get occurrences => List.unmodifiable(_occurrences);

  Future<void> loadRange(String householdId, DateTime from, DateTime to) async {
    _householdId = householdId;
    _from = from;
    _to = to;
    final result = await runGuarded(() => _service.getCalendar(householdId, from, to));
    if (result != null) {
      _occurrences = result;
      notifyListeners();
    }
  }

  List<CalendarOccurrence> forDay(DateTime day) {
    return _occurrences
        .where((o) => o.date.year == day.year && o.date.month == day.month && o.date.day == day.day)
        .toList();
  }

  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      if (event['type'] == 'calendar.changed' &&
          _householdId != null &&
          _from != null &&
          _to != null) {
        loadRange(_householdId!, _from!, _to!);
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
