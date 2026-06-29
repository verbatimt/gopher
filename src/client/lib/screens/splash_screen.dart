import 'package:flutter/material.dart';

/// Shown while the auth state resolves on startup (prevents routing flicker).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
