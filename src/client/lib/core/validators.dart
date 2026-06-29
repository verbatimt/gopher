/// Shared form validators mirroring the server's input rules.
final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

String? validateEmail(String? value) {
  final v = value?.trim() ?? '';
  if (v.isEmpty) return 'Email is required';
  return _emailPattern.hasMatch(v) ? null : 'Enter a valid email address';
}

String? validateRequired(String? value, [String field = 'This field']) {
  return (value == null || value.trim().isEmpty) ? '$field is required' : null;
}

String? validatePassword(String? value) {
  return (value == null || value.length < 8) ? 'Password must be at least 8 characters' : null;
}
