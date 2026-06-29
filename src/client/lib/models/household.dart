/// A household and its settings (from `/households/:id`).
class Household {
  final String id;
  final String name;
  final String timezone;
  final String locale;
  final List<String> activeModules;
  final String rewardCurrencyName;

  const Household({
    required this.id,
    required this.name,
    required this.timezone,
    required this.locale,
    required this.activeModules,
    required this.rewardCurrencyName,
  });

  factory Household.fromJson(Map<String, dynamic> json) {
    return Household(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      timezone: json['timezone'] as String? ?? 'UTC',
      locale: json['locale'] as String? ?? 'en-US',
      activeModules:
          (json['activeModules'] as List?)?.map((e) => e as String).toList() ?? const [],
      rewardCurrencyName: json['rewardCurrencyName'] as String? ?? 'Points',
    );
  }
}
