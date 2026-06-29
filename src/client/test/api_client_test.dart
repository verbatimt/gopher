import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/api/api_exception.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

ApiClient _build(MockClient mock, [InMemoryTokenStore? store]) => ApiClient(
      baseUrl: 'http://test',
      client: mock,
      tokenStore: store ?? InMemoryTokenStore(),
    );

void main() {
  test('parses the enveloped result', () async {
    final mock = MockClient(
      (req) async => http.Response(
        jsonEncode({
          'version': 'v1',
          'statusCode': 200,
          'success': true,
          'message': 'OK',
          'result': {'value': 42},
        }),
        200,
        headers: {'content-type': 'application/json'},
      ),
    );
    final value = await _build(mock).getEnveloped<int>(
      '/api/v1/x',
      (r) => (r as Map)['value'] as int,
    );
    expect(value, 42);
  });

  test('throws a typed ApiException when success is false', () async {
    final mock = MockClient(
      (req) async => http.Response(
        jsonEncode({
          'version': 'v1',
          'statusCode': 409,
          'success': false,
          'message': 'duplicate',
          'result': null,
        }),
        409,
      ),
    );
    expect(
      () => _build(mock).getEnveloped('/api/v1/x', (r) => r),
      throwsA(isA<ApiException>()
          .having((e) => e.statusCode, 'statusCode', 409)
          .having((e) => e.message, 'message', 'duplicate')),
    );
  });

  test('maps transport failures to a network ApiException', () async {
    final mock = MockClient((req) async => throw Exception('boom'));
    expect(
      () => _build(mock).getRaw('/health'),
      throwsA(isA<ApiException>().having((e) => e.isNetworkError, 'isNetworkError', true)),
    );
  });

  test('injects the bearer token from the store', () async {
    String? seen;
    final mock = MockClient((req) async {
      seen = req.headers['authorization'];
      return http.Response(
        jsonEncode({
          'version': 'v1',
          'statusCode': 200,
          'success': true,
          'message': 'OK',
          'result': 1,
        }),
        200,
      );
    });
    final store = InMemoryTokenStore();
    await store.writeAccessToken('abc');
    await _build(mock, store).getEnveloped('/api/v1/x', (r) => r);
    expect(seen, 'Bearer abc');
  });

  test('refreshes once on 401 then retries with the new token', () async {
    var calls = 0;
    final store = InMemoryTokenStore();
    await store.writeAccessToken('old');
    final mock = MockClient((req) async {
      calls++;
      if (req.headers['authorization'] == 'Bearer new') {
        return http.Response(
          jsonEncode({
            'version': 'v1',
            'statusCode': 200,
            'success': true,
            'message': 'OK',
            'result': {'ok': true},
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({
          'version': 'v1',
          'statusCode': 401,
          'success': false,
          'message': 'expired',
          'result': null,
        }),
        401,
      );
    });
    final client = ApiClient(baseUrl: 'http://test', client: mock, tokenStore: store)
      ..tokenRefresher = () async {
        await store.writeAccessToken('new');
        return true;
      };
    final ok = await client.getEnveloped<bool>('/api/v1/x', (r) => (r as Map)['ok'] as bool);
    expect(ok, isTrue);
    expect(calls, 2); // original 401 + retry
  });

  test('propagates the 401 when refresh fails', () async {
    final store = InMemoryTokenStore();
    final mock = MockClient(
      (req) async => http.Response(
        jsonEncode({
          'version': 'v1',
          'statusCode': 401,
          'success': false,
          'message': 'no',
          'result': null,
        }),
        401,
      ),
    );
    final client = ApiClient(baseUrl: 'http://test', client: mock, tokenStore: store)
      ..tokenRefresher = () async => false;
    expect(
      () => client.getEnveloped('/api/v1/x', (r) => r),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401)),
    );
  });

  test('getRaw returns the non-enveloped /health JSON', () async {
    final mock = MockClient(
      (req) async => http.Response(
        jsonEncode({
          'status': 'healthy',
          'services': {'database': true, 'redis': true},
          'version': 'v1',
          'uptime': 3,
        }),
        200,
      ),
    );
    final raw = await _build(mock).getRaw('/health');
    expect((raw as Map)['status'], 'healthy');
  });
}
