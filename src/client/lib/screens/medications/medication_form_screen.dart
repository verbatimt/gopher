import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';
import '../../providers/medication_provider.dart';

/// Create a medication schedule (supervisor-gated). Reuses the interval/frequency recurrence
/// editor (EP-0023) plus a dose-time picker, building the RRULE the server anchors at the
/// start date.
class MedicationFormScreen extends StatefulWidget {
  const MedicationFormScreen({super.key});

  @override
  State<MedicationFormScreen> createState() => _MedicationFormScreenState();
}

class _MedicationFormScreenState extends State<MedicationFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _dosageAmount = TextEditingController(text: '1');
  final _dosageUnit = TextEditingController(text: 'mg');
  final _stock = TextEditingController(text: '0');
  final _threshold = TextEditingController(text: '0');

  String? _memberId;
  String _frequency = 'daily';
  int _interval = 1;
  TimeOfDay _doseTime = const TimeOfDay(hour: 8, minute: 0);
  DateTime _startDate = DateTime.now();
  int _doseWindow = 120;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _dosageAmount.dispose();
    _dosageUnit.dispose();
    _stock.dispose();
    _threshold.dispose();
    super.dispose();
  }

  String _buildRrule() {
    final freq = _frequency.toUpperCase();
    return 'FREQ=$freq;INTERVAL=$_interval;BYHOUR=${_doseTime.hour};BYMINUTE=${_doseTime.minute};BYSECOND=0';
  }

  String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_memberId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pick the member this medication is for.')),
      );
      return;
    }
    setState(() => _busy = true);
    final provider = context.read<MedicationProvider>();
    final ok = await provider.createSchedule({
      'memberId': _memberId,
      'medicationName': _name.text.trim(),
      'dosageAmount': double.tryParse(_dosageAmount.text.trim()) ?? 0,
      'dosageUnit': _dosageUnit.text.trim(),
      'rrule': _buildRrule(),
      'startDate': _ymd(_startDate),
      'stockQuantity': double.tryParse(_stock.text.trim()) ?? 0,
      'refillThreshold': double.tryParse(_threshold.text.trim()) ?? 0,
      'doseWindowMinutes': _doseWindow,
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      context.pop();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(provider.error ?? 'Could not create the schedule')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isSupervisor) {
      return Scaffold(
        appBar: AppBar(title: const Text('New schedule')),
        body: const Center(child: Text('Only supervisors can manage medication schedules.')),
      );
    }
    final members = context.watch<HouseholdProvider>().members;

    return Scaffold(
      appBar: AppBar(title: const Text('New schedule')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(
                labelText: 'Medication name',
                border: OutlineInputBorder(),
              ),
              validator: (v) => validateRequired(v, 'Medication name'),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _memberId,
              decoration: const InputDecoration(labelText: 'For', border: OutlineInputBorder()),
              items: [
                for (final m in members)
                  DropdownMenuItem(value: m.id, child: Text(m.displayName)),
              ],
              onChanged: (v) => setState(() => _memberId = v),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _dosageAmount,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Dosage', border: OutlineInputBorder()),
                    validator: (v) => validateRequired(v, 'Dosage'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _dosageUnit,
                    decoration: const InputDecoration(labelText: 'Unit', border: OutlineInputBorder()),
                    validator: (v) => validateRequired(v, 'Unit'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Dosing schedule', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            Row(
              children: [
                const Text('Every'),
                const SizedBox(width: 8),
                SizedBox(
                  width: 64,
                  child: TextFormField(
                    initialValue: '1',
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    onChanged: (v) => _interval = int.tryParse(v) ?? 1,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _frequency,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 'daily', child: Text('Days')),
                      DropdownMenuItem(value: 'weekly', child: Text('Weeks')),
                      DropdownMenuItem(value: 'monthly', child: Text('Months')),
                    ],
                    onChanged: (v) => setState(() => _frequency = v ?? 'daily'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.schedule),
                    label: Text('Dose time: ${_doseTime.format(context)}'),
                    onPressed: () async {
                      final picked =
                          await showTimePicker(context: context, initialTime: _doseTime);
                      if (picked != null) setState(() => _doseTime = picked);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.event),
                    label: Text('Start: ${_ymd(_startDate)}'),
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _startDate,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2032),
                      );
                      if (picked != null) setState(() => _startDate = picked);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _stock,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Stock', border: OutlineInputBorder()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _threshold,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'Refill at',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Dose window: $_doseWindow min', style: Theme.of(context).textTheme.labelLarge),
            Slider(
              value: _doseWindow.toDouble(),
              min: 15,
              max: 360,
              divisions: 23,
              label: '$_doseWindow min',
              onChanged: (v) => setState(() => _doseWindow = v.round()),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Create'),
            ),
          ],
        ),
      ),
    );
  }
}
