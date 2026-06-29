import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../core/constants.dart';

/// Derive the WebSocket URL from the HTTP API base URL (`http→ws`, `https→wss`, `/ws`).
String wsUrlFromApiBase(String apiBaseUrl) {
  final uri = Uri.parse(apiBaseUrl);
  final scheme = uri.scheme == 'https' ? 'wss' : 'ws';
  return uri.replace(scheme: scheme, path: '/ws').toString();
}

/// WebSocket transport: connects, performs the auth handshake, exposes incoming events as a
/// broadcast stream, and auto-reconnects (with capped backoff), re-authenticating on each
/// reconnect (the server auto-resubscribes on auth).
class WsService {
  final String _wsUrl;
  final WebSocketChannel Function(Uri url) _connector;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  String? _token;
  bool _disposed = false;
  int _attempt = 0;

  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _connection = StreamController<bool>.broadcast();
  bool _connected = false;

  WsService({String? wsUrl, WebSocketChannel Function(Uri url)? connector})
      : _wsUrl = wsUrl ?? wsUrlFromApiBase(AppConstants.apiBaseUrl),
        _connector = connector ?? WebSocketChannel.connect;

  /// Events received after a successful handshake.
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// Emits true on `auth_ok`, false on disconnect.
  Stream<bool> get connectionState => _connection.stream;

  bool get isConnected => _connected;

  void connect(String token) {
    _token = token;
    _disposed = false;
    _open();
  }

  void _open() {
    _reconnectTimer?.cancel();
    try {
      final channel = _connector(Uri.parse(_wsUrl));
      _channel = channel;
      _sub = channel.stream.listen(
        _onData,
        onDone: _onDisconnected,
        onError: (_) => _onDisconnected(),
        cancelOnError: true,
      );
      channel.sink.add(jsonEncode({'type': 'auth', 'token': _token}));
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onData(dynamic data) {
    Map<String, dynamic>? msg;
    try {
      msg = jsonDecode(data as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    if (msg['type'] == 'auth_ok') {
      _attempt = 0;
      _setConnected(true);
    }
    _events.add(msg);
  }

  void _onDisconnected() {
    _setConnected(false);
    _sub?.cancel();
    _sub = null;
    _channel = null;
    if (!_disposed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || _token == null) return;
    _attempt = (_attempt + 1).clamp(1, 6);
    final delayMs = (500 * (1 << (_attempt - 1))).clamp(500, 15000);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      if (!_disposed && _token != null) _open();
    });
  }

  void send(Map<String, dynamic> message) => _channel?.sink.add(jsonEncode(message));

  void _setConnected(bool value) {
    if (_connected == value) return;
    _connected = value;
    _connection.add(value);
  }

  void disconnect() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _setConnected(false);
    _sub?.cancel();
    _channel?.sink.close();
    _channel = null;
    _token = null;
  }

  void dispose() {
    disconnect();
    _events.close();
    _connection.close();
  }
}
