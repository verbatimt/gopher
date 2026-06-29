import 'package:flutter/foundation.dart';

import '../core/constants.dart';

/// Holds the household's active feature modules. [ModuleGuard] reads this to show or hide
/// module content. Defaults to all-on for the foundation; EP-0014/0015 populate it from
/// the household's `active_modules`.
class ModuleProvider extends ChangeNotifier {
  Set<String> _active = AppModules.all.toSet();

  Set<String> get active => Set.unmodifiable(_active);

  bool isActive(String moduleId) => _active.contains(moduleId);

  void setActive(Iterable<String> moduleIds) {
    _active = moduleIds.toSet();
    notifyListeners();
  }
}
