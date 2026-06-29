import '../core/api/api_client.dart';
import '../models/calendar_event.dart';

class CalendarService {
  final ApiClient _api;

  CalendarService(this._api);

  Future<List<CalendarOccurrence>> getCalendar(String householdId, DateTime from, DateTime to) {
    final f = from.toUtc().toIso8601String();
    final t = to.toUtc().toIso8601String();
    return _api.getEnveloped('/api/v1/households/$householdId/calendar?from=$f&to=$t', (r) {
      final list = (r as Map)['occurrences'] as List;
      return list.map((e) => CalendarOccurrence.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<void> createEvent(String householdId, Map<String, dynamic> body) async {
    await _api.postEnveloped('/api/v1/households/$householdId/events', body, (_) => null);
  }
}
