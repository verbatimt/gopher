import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/ws_service.dart';

/// Exposes the real-time connection state and the event stream other providers (e.g.
/// notifications, EP-0017) consume. Connects after auth and disconnects on sign-out.
class WsProvider extends ChangeNotifier {
  final WsService _service;
  StreamSubscription<bool>? _stateSub;

  WsProvider(this._service) {
    _stateSub = _service.connectionState.listen((_) => notifyListeners());
  }

  bool get isConnected => _service.isConnected;
  Stream<Map<String, dynamic>> get events => _service.events;

  void connect(String token) => _service.connect(token);
  void disconnect() => _service.disconnect();

  @override
  void dispose() {
    _stateSub?.cancel();
    _service.dispose();
    super.dispose();
  }
}
