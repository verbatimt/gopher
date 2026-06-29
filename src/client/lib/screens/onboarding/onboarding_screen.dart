import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';

/// First-run onboarding: confirm/rename the auto-created household, then continue.
/// (Registration already bootstrapped the household + owner; this customizes it.)
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _name = TextEditingController();
  bool _busy = false;
  bool _prefilled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final auth = context.read<AuthProvider>();
      final household = context.read<HouseholdProvider>();
      if (household.household == null && auth.householdId.isNotEmpty) {
        await household.load(auth.householdId);
      }
      if (mounted && !_prefilled && household.household != null) {
        setState(() {
          _name.text = household.household!.name;
          _prefilled = true;
        });
      }
    });
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    final household = context.read<HouseholdProvider>();
    final name = _name.text.trim();
    setState(() => _busy = true);
    if (name.isNotEmpty && name != household.household?.name) {
      await household.updateSettings({'name': name});
    }
    if (!mounted) return;
    setState(() => _busy = false);
    context.go('/dashboard');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Set up your household')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.cottage_rounded, size: 56, color: theme.colorScheme.primary),
                const SizedBox(height: 12),
                Text('Name your household', style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(
                  'You can invite members and add managed profiles later from the members screen.',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Household name', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _continue,
                  child: _busy
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Continue to dashboard'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
