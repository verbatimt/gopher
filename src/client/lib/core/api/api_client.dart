import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants.dart';
import '../storage/token_store.dart';
import 'api_exception.dart';
import 'envelope.dart';
import 'http_client_factory.dart';

/// Transport layer. Builds requests against the configured base URL, injects the bearer
/// token, parses the response envelope, and throws a typed [ApiException] on failure.
/// `/api/v1` calls use the enveloped methods; `/health` (non-enveloped) uses [getRaw].
///
/// On a 401 it performs a single silent refresh (via [tokenRefresher], single-flight) and
/// retries the request once; if refresh fails, the 401 propagates so the caller can route
/// to login (EP-0015).
class ApiClient {
  final String baseUrl;
  final http.Client _client;
  final TokenStore _tokenStore;

  /// Attempts a token refresh; returns true if a fresh access token is now available.
  Future<bool> Function()? tokenRefresher;
  Future<bool>? _refreshInFlight;
  bool _isRefreshing = false;

  ApiClient({
    String? baseUrl,
    http.Client? client,
    required TokenStore tokenStore,
    this.tokenRefresher,
  })  : baseUrl = baseUrl ?? AppConstants.apiBaseUrl,
        _client = client ?? createHttpClient(),
        // ignore: prefer_initializing_formals
        _tokenStore = tokenStore;

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, String>> _headers({bool json = false}) async {
    final token = await _tokenStore.readAccessToken();
    return <String, String>{
      if (json) 'content-type': 'application/json',
      if (token != null && token.isNotEmpty) 'authorization': 'Bearer $token',
    };
  }

  Future<T> getEnveloped<T>(String path, T Function(dynamic result) parse) {
    return _retry(() => _enveloped(() async => _client.get(_uri(path), headers: await _headers()), parse));
  }

  Future<T> postEnveloped<T>(String path, Object? body, T Function(dynamic result) parse) {
    return _retry(() => _enveloped(
          () async => _client.post(_uri(path), headers: await _headers(json: true), body: jsonEncode(body)),
          parse,
        ));
  }

  Future<T> patchEnveloped<T>(String path, Object? body, T Function(dynamic result) parse) {
    return _retry(() => _enveloped(
          () async => _client.patch(_uri(path), headers: await _headers(json: true), body: jsonEncode(body)),
          parse,
        ));
  }

  Future<T> deleteEnveloped<T>(String path, T Function(dynamic result) parse) {
    return _retry(() => _enveloped(() async => _client.delete(_uri(path), headers: await _headers()), parse));
  }

  /// GET a non-enveloped endpoint (e.g. `/health`); returns the decoded JSON as-is.
  Future<dynamic> getRaw(String path) {
    return _retry(() async {
      final res = await _safe(() async => _client.get(_uri(path), headers: await _headers()));
      return _decode(res.body);
    });
  }

  Future<T> _retry<T>(Future<T> Function() op) async {
    try {
      return await op();
    } on ApiException catch (e) {
      // Don't attempt a refresh while the refresh request itself is in flight (avoids
      // recursion when /auth/refresh returns 401).
      if (e.statusCode == 401 && tokenRefresher != null && !_isRefreshing && await _refreshOnce()) {
        return op(); // single retry with the new token; no further refresh
      }
      rethrow;
    }
  }

  Future<bool> _refreshOnce() {
    return _refreshInFlight ??= _doRefresh();
  }

  Future<bool> _doRefresh() async {
    _isRefreshing = true;
    try {
      return await tokenRefresher!();
    } catch (_) {
      return false;
    } finally {
      _isRefreshing = false;
      _refreshInFlight = null;
    }
  }

  Future<T> _enveloped<T>(
    Future<http.Response> Function() request,
    T Function(dynamic result) parse,
  ) async {
    final res = await _safe(request);
    return parse(_unwrap(res));
  }

  Future<http.Response> _safe(Future<http.Response> Function() request) async {
    try {
      return await request();
    } catch (_) {
      throw const ApiException(0, 'Could not reach the server. Check your connection.');
    }
  }

  dynamic _unwrap(http.Response res) {
    final decoded = _decode(res.body);
    if (decoded is! Map) {
      throw ApiException(res.statusCode, 'The server returned an unexpected response.');
    }
    final envelope = Envelope.fromJson(decoded.cast<String, dynamic>());
    if (!envelope.success) {
      final status = envelope.statusCode != 0 ? envelope.statusCode : res.statusCode;
      final message = envelope.message.isNotEmpty ? envelope.message : 'Request failed.';
      throw ApiException(status, message);
    }
    return envelope.result;
  }

  dynamic _decode(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }
}
