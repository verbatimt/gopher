import 'dart:async';

import '../models/task.dart';
import '../services/task_service.dart';
import 'base_provider.dart';

/// Task list + actions. Live-refreshes on the WS `task.updated` event.
class TaskProvider extends BaseProvider {
  final TaskService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  String? _householdId;
  String? _statusFilter;
  List<Task> _tasks = [];

  TaskProvider(this._service);

  List<Task> get tasks => List.unmodifiable(_tasks);
  String? get statusFilter => _statusFilter;

  Future<void> load(String householdId) async {
    _householdId = householdId;
    final result = await runGuarded(() => _service.listTasks(householdId, status: _statusFilter));
    if (result != null) {
      _tasks = result;
      notifyListeners();
    }
  }

  Future<void> setStatusFilter(String? status) async {
    _statusFilter = status;
    if (_householdId != null) await load(_householdId!);
  }

  Future<Task?> fetchTask(String taskId) async {
    if (_householdId == null) return null;
    return runGuarded(() => _service.getTask(_householdId!, taskId));
  }

  Future<bool> completeTask(String taskId) async {
    if (_householdId == null) return false;
    final task = await runGuarded(() => _service.completeTask(_householdId!, taskId));
    if (task == null) return false;
    _replace(task);
    return true;
  }

  Future<Task?> toggleStep(String taskId, String stepId, bool isCompleted) async {
    if (_householdId == null) return null;
    final task = await runGuarded(() => _service.toggleStep(_householdId!, taskId, stepId, isCompleted));
    if (task != null) _replace(task);
    return task;
  }

  Future<bool> createTask(Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final task = await runGuarded(() => _service.createTask(_householdId!, body));
    if (task == null) return false;
    await load(_householdId!);
    return true;
  }

  Future<bool> createRecurringTask(Map<String, dynamic> body) async {
    if (_householdId == null) return false;
    final ok = await runGuarded(() async {
      await _service.createRecurringTask(_householdId!, body);
      return true;
    });
    if (ok != true) return false;
    await load(_householdId!);
    return true;
  }

  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      if (event['type'] == 'task.updated' && _householdId != null) load(_householdId!);
    });
  }

  void _replace(Task task) {
    _tasks = _tasks.map((t) => t.id == task.id ? task : t).toList();
    notifyListeners();
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
