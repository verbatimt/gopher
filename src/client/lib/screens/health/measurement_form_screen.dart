import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../models/biometric.dart';
import '../../providers/auth_provider.dart';
import '../../providers/biometric_provider.dart';

/// Record (or edit) a measurement (EP-0044). Type-driven dynamic fields: `dual` types show a
/// second value (systolic/diastolic); the unit is prefilled from the type. `measured_at` uses
/// an MD3 date+time picker (never free-text).
class MeasurementFormScreen extends StatefulWidget {
  final String memberId;
  final Measurement? existing;

  const MeasurementFormScreen({super.key, required this.memberId, this.existing});

  @override
  State<MeasurementFormScreen> createState() => _MeasurementFormScreenState();
}

class _MeasurementFormScreenState extends State<MeasurementFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _value = TextEditingController();
  final _secondary = TextEditingController();
  final _unit = TextEditingController();
  final _notes = TextEditingController();

  String? _typeKey;
  DateTime _measuredAt = DateTime.now();
  bool _busy = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (existing != null) {
      _typeKey = existing.typeKey;
      _value.text = _trim(existing.value);
      if (existing.valueSecondary != null) _secondary.text = _trim(existing.valueSecondary!);
      _unit.text = existing.unit;
      _measuredAt = existing.measuredAt.toLocal();
    }
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final auth = context.read<AuthProvider>();
      final provider = context.read<BiometricProvider>();
      if (provider.types.isEmpty && auth.householdId.isNotEmpty) {
        await provider.loadTypes(auth.householdId);
      }
      if (_typeKey == null && provider.types.isNotEmpty) {
        _selectType(provider.types.first.key);
      }
    });
  }

  static String _trim(double n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

  void _selectType(String key) {
    final type = context.read<BiometricProvider>().typeByKey(key);
    setState(() {
      _typeKey = key;
      if (_unit.text.isEmpty && type != null) _unit.text = type.unitDefault;
    });
  }

  @override
  void dispose() {
    _value.dispose();
    _secondary.dispose();
    _unit.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDateTime() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _measuredAt,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_measuredAt),
    );
    if (time == null) return;
    setState(() {
      _measuredAt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _submit() async {
    final provider = context.read<BiometricProvider>();
    final type = _typeKey == null ? null : provider.typeByKey(_typeKey!);
    if (type == null) return;
    if (!_formKey.currentState!.validate()) return;
    // Mirror server validation: dual types require both components.
    if (type.isDual && _secondary.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This measurement needs both values.')),
      );
      return;
    }

    setState(() => _busy = true);
    final body = <String, dynamic>{
      'typeKey': type.key,
      'valueNumeric': double.tryParse(_value.text.trim()) ?? 0,
      if (type.isDual) 'valueSecondary': double.tryParse(_secondary.text.trim()),
      'unit': _unit.text.trim().isEmpty ? type.unitDefault : _unit.text.trim(),
      'measuredAt': _measuredAt.toUtc().toIso8601String(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
    };

    final ok = _isEdit
        ? await provider.updateMeasurement(widget.memberId, widget.existing!.id, body)
        : await provider.record(widget.memberId, body);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      context.pop(true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not save the reading.')),
      );
    }
  }

  String _ymdhm(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} '
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<BiometricProvider>();
    final type = _typeKey == null ? null : provider.typeByKey(_typeKey!);
    final dual = type?.isDual ?? false;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit reading' : 'Record reading')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField<String>(
              initialValue: _typeKey,
              decoration: const InputDecoration(labelText: 'Type', border: OutlineInputBorder()),
              items: [
                for (final t in provider.types)
                  DropdownMenuItem(value: t.key, child: Text(t.displayName)),
              ],
              onChanged: _isEdit ? null : (v) => v != null ? _selectType(v) : null,
            ),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _value,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText: dual ? (type?.key == 'blood_pressure' ? 'Systolic' : 'Value 1') : 'Value',
                      border: const OutlineInputBorder(),
                    ),
                    validator: (v) => validateRequired(v, 'Value'),
                  ),
                ),
                if (dual) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      controller: _secondary,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: type?.key == 'blood_pressure' ? 'Diastolic' : 'Value 2',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _unit,
              decoration: const InputDecoration(labelText: 'Unit', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              icon: const Icon(Icons.schedule),
              label: Text('Measured: ${_ymdhm(_measuredAt)}'),
              onPressed: _pickDateTime,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_isEdit ? 'Save' : 'Record'),
            ),
          ],
        ),
      ),
    );
  }
}
