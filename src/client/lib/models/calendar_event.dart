/// A single expanded calendar occurrence (from `GET /calendar`).
class CalendarOccurrence {
  final String itemId;
  final String type; // event | appointment | task
  final String title;
  final DateTime date; // calendar day (UTC-encoded)
  final String status;
  final bool allDay;

  const CalendarOccurrence({
    required this.itemId,
    required this.type,
    required this.title,
    required this.date,
    required this.status,
    required this.allDay,
  });

  factory CalendarOccurrence.fromJson(Map<String, dynamic> json) {
    final raw = json['date'] as String? ?? '1970-01-01';
    // The occurrence date is a calendar day (YYYY-MM-DD), not a timestamp — parse it as a
    // local midnight so the day never shifts via a timezone offset.
    final parts = raw.split('-');
    final date = parts.length == 3
        ? DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]))
        : DateTime(1970);
    return CalendarOccurrence(
      itemId: json['itemId'] as String,
      type: json['type'] as String? ?? 'event',
      title: json['title'] as String? ?? '',
      date: date,
      status: json['status'] as String? ?? 'pending',
      allDay: json['allDay'] as bool? ?? false,
    );
  }
}
