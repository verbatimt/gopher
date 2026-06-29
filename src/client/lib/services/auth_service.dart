import 'dart:convert';

import '../core/api/api_client.dart';
import '../models/user.dart';

/// Result of an authenticating call (register/login/accept-invite): the profile, the
/// access token, and the household id (decoded from the token).
class AuthResult {
  final User user;
  final String accessToken;
  final String householdId;

  const AuthResult({required this.user, required this.accessToken, required this.householdId});
}

/// Per-domain auth API (register/login/logout/refresh/me/accept-invite).
class AuthService {
  final ApiClient _api;

  AuthService(this._api);

  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
    String? timezone,
  }) {
    return _api.postEnveloped(
      '/api/v1/auth/register',
      {
        'email': email,
        'password': password,
        'displayName': displayName,
        'timezone': ?timezone,
      },
      _parseAuth,
    );
  }

  Future<AuthResult> login({required String email, required String password}) {
    return _api.postEnveloped('/api/v1/auth/login', {'email': email, 'password': password}, _parseAuth);
  }

  Future<AuthResult> acceptInvite({required String token, String? password, String? displayName}) {
    return _api.postEnveloped(
      '/api/v1/auth/accept-invite',
      {
        'token': token,
        'password': ?password,
        'displayName': ?displayName,
      },
      _parseAuth,
    );
  }

  /// Returns a fresh access token (relies on the httpOnly refresh cookie).
  Future<String> refresh() {
    return _api.postEnveloped(
      '/api/v1/auth/refresh',
      null,
      (result) => (result as Map)['accessToken'] as String,
    );
  }

  Future<void> logout() async {
    await _api.postEnveloped('/api/v1/auth/logout', null, (_) => null);
  }

  Future<User> fetchMe() {
    return _api.getEnveloped('/api/v1/auth/me', (result) => _user(result));
  }

  Future<User> updateProfile(Map<String, dynamic> patch) {
    return _api.patchEnveloped('/api/v1/auth/me', patch, (result) => _user(result));
  }

  Future<void> forgotPassword(String email) async {
    await _api.postEnveloped('/api/v1/auth/forgot-password', {'email': email}, (_) => null);
  }

  AuthResult _parseAuth(dynamic result) {
    final map = (result as Map).cast<String, dynamic>();
    final accessToken = map['accessToken'] as String;
    return AuthResult(
      user: User.fromJson((map['user'] as Map).cast<String, dynamic>()),
      accessToken: accessToken,
      householdId: householdIdFromToken(accessToken),
    );
  }

  User _user(dynamic result) =>
      User.fromJson(((result as Map)['user'] as Map).cast<String, dynamic>());
}

Map<String, dynamic> _decodeJwt(String token) {
  final parts = token.split('.');
  if (parts.length < 2) return const {};
  final payload = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
  return jsonDecode(payload) as Map<String, dynamic>;
}

/// Decode the `householdId` claim from a JWT access token (no verification — display only).
String householdIdFromToken(String token) {
  try {
    return _decodeJwt(token)['householdId'] as String? ?? '';
  } catch (_) {
    return '';
  }
}

/// Decode the comma-separated `roles` claim from a JWT access token.
List<String> rolesFromToken(String token) {
  try {
    final roles = _decodeJwt(token)['roles'];
    if (roles is String) return roles.split(',').where((r) => r.isNotEmpty).toList();
    return const [];
  } catch (_) {
    return const [];
  }
}
