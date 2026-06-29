import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../providers/auth_provider.dart';

/// Profile & preferences: display name, timezone, currency, and sign-out.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _timezone;
  late final TextEditingController _currency;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthProvider>().user;
    _name = TextEditingController(text: user?.displayName ?? '');
    _timezone = TextEditingController(text: user?.timezone ?? 'UTC');
    _currency = TextEditingController(text: user?.currency ?? 'USD');
  }

  @override
  void dispose() {
    _name.dispose();
    _timezone.dispose();
    _currency.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final auth = context.read<AuthProvider>();
    final ok = await auth.updateProfile({
      'displayName': _name.text.trim(),
      'timezone': _timezone.text.trim(),
      'currency': _currency.text.trim(),
    });
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(ok ? 'Profile updated' : (auth.error ?? 'Update failed'))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            leading: const Icon(Icons.email_outlined),
            title: Text(auth.user?.email ?? '—'),
            subtitle: const Text('Email'),
          ),
          const Divider(),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Display name', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _timezone,
            decoration: const InputDecoration(labelText: 'Timezone', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _currency,
            decoration: const InputDecoration(labelText: 'Currency', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save changes'),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            icon: Icon(Icons.logout, color: theme.colorScheme.error),
            label: Text('Sign out', style: TextStyle(color: theme.colorScheme.error)),
            onPressed: () async {
              await context.read<AuthProvider>().signOut();
              if (context.mounted) context.go('/login');
            },
          ),
        ],
      ),
    );
  }
}
