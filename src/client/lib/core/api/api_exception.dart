/// Typed error thrown by [ApiClient] when a request fails — either a transport error
/// (`statusCode == 0`) or a non-success envelope. The [message] is the server's
/// user-facing string and is safe to surface in the UI (e.g. via a snackbar).
class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException(this.statusCode, this.message);

  bool get isNetworkError => statusCode == 0;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
