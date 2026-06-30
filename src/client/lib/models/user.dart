/// Authenticated user profile (from `/auth/me`, login, register).
class User {
  final String id;
  final String email;
  final String displayName;
  final String? avatarUrl;
  final String timezone;
  final String currency;

  /// The caller's `household_members` id in the current household (from `/auth/me`); null when
  /// not yet fetched or when the user has no membership. Lets self-scoped clients (e.g. vitals,
  /// EP-0044) address their own member without `members:read`.
  final String? memberId;

  const User({
    required this.id,
    required this.email,
    required this.displayName,
    this.avatarUrl,
    required this.timezone,
    required this.currency,
    this.memberId,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      email: json['email'] as String,
      displayName: json['displayName'] as String? ?? '',
      avatarUrl: json['avatarUrl'] as String?,
      timezone: json['timezone'] as String? ?? 'UTC',
      currency: json['currency'] as String? ?? 'USD',
      memberId: json['memberId'] as String?,
    );
  }
}
