import 'user.dart';

/// Resolution state of the auth-gated app: `unknown` until startup restore completes.
enum AuthStatus { unknown, unauthenticated, authenticated }

/// An active authenticated session.
class AuthSession {
  final User user;
  final String accessToken;
  final String householdId;

  const AuthSession({
    required this.user,
    required this.accessToken,
    required this.householdId,
  });

  AuthSession copyWith({User? user, String? accessToken, String? householdId}) {
    return AuthSession(
      user: user ?? this.user,
      accessToken: accessToken ?? this.accessToken,
      householdId: householdId ?? this.householdId,
    );
  }

  bool get hasHousehold => householdId.isNotEmpty;
}

/// Canonical role names (mirrors the server catalog).
class RoleNames {
  RoleNames._();
  static const supervising = 'supervising_user';
  static const unsupervised = 'unsupervised_user';
  static const supervised = 'supervised_user';
}
