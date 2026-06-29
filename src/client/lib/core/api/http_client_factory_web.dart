import 'package:http/http.dart' as http;

/// Web HTTP client. The browser's fetch-backed client; same-origin in production behind
/// the gopher.local proxy, so cookies/credentials flow without extra configuration.
http.Client createHttpClient() => http.Client();
