import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'token_store.dart';

/// Production [TokenStore] backed by flutter_secure_storage (Keychain / Keystore /
/// encrypted web storage). The access token is the only secret held client-side; the
/// refresh token lives in an httpOnly cookie (EP-0011).
class SecureTokenStore implements TokenStore {
  static const String _accessTokenKey = 'gopher.access_token';

  final FlutterSecureStorage _storage;

  SecureTokenStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  @override
  Future<String?> readAccessToken() => _storage.read(key: _accessTokenKey);

  @override
  Future<void> writeAccessToken(String token) =>
      _storage.write(key: _accessTokenKey, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _accessTokenKey);
}
