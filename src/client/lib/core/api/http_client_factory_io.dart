import 'package:http/http.dart' as http;

/// Native (Windows/Android/desktop) HTTP client. A plain `http.Client` is appropriate on
/// the trusted LAN over plain HTTP.
http.Client createHttpClient() => http.Client();
