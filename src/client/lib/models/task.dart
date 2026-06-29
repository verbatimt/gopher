/// A workflow step within a task (routine checklist item).
class WorkflowStep {
  final String id;
  final int stepOrder;
  final String description;
  final bool isCompleted;
  final bool passive;

  const WorkflowStep({
    required this.id,
    required this.stepOrder,
    required this.description,
    required this.isCompleted,
    required this.passive,
  });

  factory WorkflowStep.fromJson(Map<String, dynamic> json) => WorkflowStep(
        id: json['id'] as String,
        stepOrder: (json['stepOrder'] as num?)?.toInt() ?? 0,
        description: json['description'] as String? ?? '',
        isCompleted: json['isCompleted'] as bool? ?? false,
        passive: json['passive'] as bool? ?? false,
      );
}

/// A task (or chore) from the Task Replacement Model.
class Task {
  final String id;
  final String title;
  final String? description;
  final String status;
  final String? assignedTo;
  final DateTime? dueDate;
  final bool unskippable;
  final List<WorkflowStep> steps;

  const Task({
    required this.id,
    required this.title,
    this.description,
    required this.status,
    this.assignedTo,
    this.dueDate,
    required this.unskippable,
    this.steps = const [],
  });

  bool get isCompleted => status == 'completed';

  factory Task.fromJson(Map<String, dynamic> json) {
    final due = json['dueDate'] as String?;
    final steps = (json['steps'] as List?)
            ?.map((e) => WorkflowStep.fromJson((e as Map).cast<String, dynamic>()))
            .toList() ??
        const [];
    return Task(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      status: json['status'] as String? ?? 'pending',
      assignedTo: json['assignedTo'] as String?,
      dueDate: due != null ? DateTime.tryParse(due) : null,
      unskippable: json['unskippable'] as bool? ?? false,
      steps: steps,
    );
  }
}
