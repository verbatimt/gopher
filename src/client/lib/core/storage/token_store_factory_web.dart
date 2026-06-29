import 'token_store.dart';
import 'web_token_store.dart';

/// Web token store: `localStorage` via shared_preferences. Used because the plain-HTTP
/// `http://gopher.local` origin is not a secure context, so flutter_secure_storage's
/// `crypto.subtle` backend is unavailable. See [WebTokenStore].
TokenStore createTokenStore() => WebTokenStore();
