// Conditional transport seam: the same ApiClient works on web and native by selecting the
// platform-appropriate http.Client at compile time. The native (dart:io) implementation is
// the default; web is selected when dart.library.js_interop exists.
export 'http_client_factory_io.dart'
    if (dart.library.js_interop) 'http_client_factory_web.dart';
