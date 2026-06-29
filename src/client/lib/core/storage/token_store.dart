/// Abstraction over secure token persistence. The app depends on this interface so the
/// transport/auth layers stay testable (see [InMemoryTokenStore]) and platform-agnostic.
abstract class TokenStore {
  Future<String?> readAccessToken();
  Future<void> writeAccessToken(String token);
  Future<void> clear();
}
