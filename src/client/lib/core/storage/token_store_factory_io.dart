import 'secure_token_store.dart';
import 'token_store.dart';

/// Native (dart:io) token store: flutter_secure_storage (Keychain / Keystore / DPAPI), which
/// has no browser "secure context" requirement. Selected on Android/Windows/desktop.
TokenStore createTokenStore() => SecureTokenStore();
