import 'package:shared_preferences/shared_preferences.dart';

import 'token_store.dart';

/// Web [TokenStore] backed by `localStorage` (via shared_preferences).
///
/// The web client is served over **plain HTTP** on `http://gopher.local` (LAN-only, no TLS —
/// EP-0041). That origin is **not** a browser "secure context", so the Web Crypto `crypto.subtle`
/// API is unavailable and `flutter_secure_storage`'s web backend throws on every read/write.
/// We therefore persist the token in `localStorage` instead.
///
/// Only the short-lived (15-minute) **access token** is stored here. The real secret — the
/// refresh token — stays in an `httpOnly` cookie the browser keeps out of JavaScript's reach
/// (EP-0011), so this matches the project's trusted-LAN / plain-HTTP threat model.
class WebTokenStore implements TokenStore {
  static const String _accessTokenKey = 'gopher.access_token';

  Future<SharedPreferences> get _prefs => SharedPreferences.getInstance();

  @override
  Future<String?> readAccessToken() async => (await _prefs).getString(_accessTokenKey);

  @override
  Future<void> writeAccessToken(String token) async =>
      (await _prefs).setString(_accessTokenKey, token);

  @override
  Future<void> clear() async => (await _prefs).remove(_accessTokenKey);
}
