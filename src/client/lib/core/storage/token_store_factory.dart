// Conditional token-store seam (mirrors `core/api/http_client_factory.dart`): the native
// implementation uses flutter_secure_storage (Keychain/Keystore/DPAPI); the web implementation
// uses localStorage, because the plain-HTTP `http://gopher.local` origin is not a browser
// "secure context" and flutter_secure_storage's Web Crypto (`crypto.subtle`) backend therefore
// throws on every read/write. Web is selected when `dart.library.js_interop` exists.
export 'token_store_factory_io.dart'
    if (dart.library.js_interop) 'token_store_factory_web.dart';
