/// Parsed form of the server response envelope:
/// `{ version, statusCode, success, message, result }` (see docs/api-conventions.md).
class Envelope {
  final String version;
  final int statusCode;
  final bool success;
  final String message;
  final dynamic result;

  const Envelope({
    required this.version,
    required this.statusCode,
    required this.success,
    required this.message,
    required this.result,
  });

  factory Envelope.fromJson(Map<String, dynamic> json) {
    return Envelope(
      version: json['version'] as String? ?? 'v1',
      statusCode: (json['statusCode'] as num?)?.toInt() ?? 0,
      success: json['success'] as bool? ?? false,
      message: json['message'] as String? ?? '',
      result: json['result'],
    );
  }
}
