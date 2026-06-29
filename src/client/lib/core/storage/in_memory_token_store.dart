import 'token_store.dart';

/// In-memory [TokenStore] for tests and ephemeral contexts — no platform channels.
class InMemoryTokenStore implements TokenStore {
  String? _token;

  @override
  Future<String?> readAccessToken() async => _token;

  @override
  Future<void> writeAccessToken(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}
