/// Authenticated user profile (from `/auth/me`, login, register).
class User {
  final String id;
  final String email;
  final String displayName;
  final String? avatarUrl;
  final String timezone;
  final String currency;

  const User({
    required this.id,
    required this.email,
    required this.displayName,
    this.avatarUrl,
    required this.timezone,
    required this.currency,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      email: json['email'] as String,
      displayName: json['displayName'] as String? ?? '',
      avatarUrl: json['avatarUrl'] as String?,
      timezone: json['timezone'] as String? ?? 'UTC',
      currency: json['currency'] as String? ?? 'USD',
    );
  }
}
