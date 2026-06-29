import '../core/api/api_client.dart';
import '../models/task.dart';

class TaskService {
  final ApiClient _api;

  TaskService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  Future<List<Task>> listTasks(String householdId, {String? status}) {
    final query = status != null ? '?status=$status' : '';
    return _api.getEnveloped('${_base(householdId)}/tasks$query', (r) {
      final list = (r as Map)['tasks'] as List;
      return list.map((e) => Task.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<Task> getTask(String householdId, String taskId) {
    return _api.getEnveloped(
      '${_base(householdId)}/tasks/$taskId',
      (r) => Task.fromJson(((r as Map)['task'] as Map).cast<String, dynamic>()),
    );
  }

  Future<Task> createTask(String householdId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      '${_base(householdId)}/tasks',
      body,
      (r) => Task.fromJson(((r as Map)['task'] as Map).cast<String, dynamic>()),
    );
  }

  Future<Task> completeTask(String householdId, String taskId) {
    return _api.postEnveloped(
      '${_base(householdId)}/tasks/$taskId/complete',
      null,
      (r) => Task.fromJson(((r as Map)['task'] as Map).cast<String, dynamic>()),
    );
  }

  Future<Task> toggleStep(String householdId, String taskId, String stepId, bool isCompleted) {
    return _api.patchEnveloped(
      '${_base(householdId)}/tasks/$taskId/steps/$stepId',
      {'isCompleted': isCompleted},
      (r) => Task.fromJson(((r as Map)['task'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> createRecurringTask(String householdId, Map<String, dynamic> body) async {
    await _api.postEnveloped('${_base(householdId)}/recurring-tasks', body, (_) => null);
  }
}
