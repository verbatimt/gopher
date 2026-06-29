/// Parsed `/health` response (non-enveloped diagnostic shape).
class HealthStatus {
  final String status;
  final bool database;
  final bool redis;
  final String version;

  const HealthStatus({
    required this.status,
    required this.database,
    required this.redis,
    required this.version,
  });

  bool get healthy => status == 'healthy';

  factory HealthStatus.fromJson(Map<String, dynamic> json) {
    final services = (json['services'] as Map?)?.cast<String, dynamic>() ?? const {};
    return HealthStatus(
      status: json['status'] as String? ?? 'unknown',
      database: services['database'] as bool? ?? false,
      redis: services['redis'] as bool? ?? false,
      version: json['version'] as String? ?? '',
    );
  }
}
