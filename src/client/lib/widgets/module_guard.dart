import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/module_provider.dart';
import 'empty_state.dart';

/// Shows [child] only when the household has [module] active; otherwise a friendly empty
/// state. Keyed off [ModuleProvider] (the household's `active_modules`).
class ModuleGuard extends StatelessWidget {
  final String module;
  final Widget child;

  const ModuleGuard({super.key, required this.module, required this.child});

  @override
  Widget build(BuildContext context) {
    final isActive = context.watch<ModuleProvider>().isActive(module);
    if (isActive) return child;
    return EmptyState(
      icon: Icons.extension_off_outlined,
      title: 'Module not enabled',
      message: 'The "$module" module is not active for this household.',
    );
  }
}
