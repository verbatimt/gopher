import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../core/constants.dart';
import '../models/auth_state.dart';
import '../providers/auth_provider.dart';

/// "More" hub: profile, members, and sign-out, plus secondary destinations added by later
/// EPs (rewards, medications, meals, finance).
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.cottage_rounded),
            title: const Text(AppConstants.appName),
            subtitle: Text(auth.user?.displayName ?? 'Household operating system',
                style: theme.textTheme.bodySmall),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Profile & preferences'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile'),
          ),
          ListTile(
            leading: const Icon(Icons.group_outlined),
            title: const Text('Members'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/members'),
          ),
          // Activity log is supervisor-only (the server also enforces audit:read).
          if (auth.roles.contains(RoleNames.supervising))
            ListTile(
              leading: const Icon(Icons.fact_check_outlined),
              title: const Text('Activity log'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/audit-log'),
            ),
          // Module management is supervisor-only (the server also enforces household:write).
          if (auth.roles.contains(RoleNames.supervising))
            ListTile(
              leading: const Icon(Icons.extension_outlined),
              title: const Text('Modules'),
              subtitle: Text('Enable or disable household features',
                  style: theme.textTheme.bodySmall),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/modules'),
            ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.medication_outlined),
            title: const Text('Medications'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/medications'),
          ),
          ListTile(
            leading: const Icon(Icons.monitor_heart_outlined),
            title: const Text('Health & vitals'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/health'),
          ),
          ListTile(
            leading: const Icon(Icons.card_giftcard_outlined),
            title: const Text('Rewards'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/rewards'),
          ),
          ListTile(
            leading: const Icon(Icons.restaurant_outlined),
            title: const Text('Meals'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/meals'),
          ),
          ListTile(
            leading: const Icon(Icons.menu_book_outlined),
            title: const Text('Recipes'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/recipes'),
          ),
          ListTile(
            leading: const Icon(Icons.inventory_2_outlined),
            title: const Text('Inventory'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/inventory'),
          ),
          // Finance is hidden from supervised members (server denies them too).
          if (auth.roles.any((r) => r == RoleNames.supervising || r == RoleNames.unsupervised)) ...[
            ListTile(
              leading: const Icon(Icons.account_balance_wallet_outlined),
              title: const Text('Finance (forecasting)'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/finance'),
            ),
          ],
          const Divider(),
          ListTile(
            leading: Icon(Icons.logout, color: theme.colorScheme.error),
            title: Text('Sign out', style: TextStyle(color: theme.colorScheme.error)),
            onTap: () async {
              await context.read<AuthProvider>().signOut();
              if (context.mounted) context.go('/login');
            },
          ),
        ],
      ),
    );
  }
}
