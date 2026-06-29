// Dashboard aggregate (EP-0031). Sections are conditionally present (by role + active
// modules), so the payload is kept as a loose section map with typed accessors; the screen
// renders only the sections that are present.

class DashboardData {
  final Map<String, dynamic> sections;

  const DashboardData(this.sections);

  factory DashboardData.fromJson(Map<String, dynamic> json) =>
      DashboardData((json['sections'] as Map?)?.cast<String, dynamic>() ?? const {});

  bool has(String key) => sections.containsKey(key);

  Map<String, dynamic> section(String key) =>
      (sections[key] as Map?)?.cast<String, dynamic>() ?? const {};

  List<Map<String, dynamic>> list(String key, String field) =>
      ((section(key)[field] as List?) ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();

  int intOf(String key, String field) => (section(key)[field] as num?)?.toInt() ?? 0;
}
