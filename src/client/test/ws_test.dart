import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/services/ws_service.dart';

void main() {
  test('derives the ws URL from the http API base', () {
    expect(wsUrlFromApiBase('http://gopher-api.local'), 'ws://gopher-api.local/ws');
    expect(wsUrlFromApiBase('http://localhost:3000'), 'ws://localhost:3000/ws');
    expect(wsUrlFromApiBase('https://example.com:8080'), 'wss://example.com:8080/ws');
  });
}
