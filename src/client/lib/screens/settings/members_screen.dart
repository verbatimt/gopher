import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/validators.dart';
import '../../models/auth_state.dart';
import '../../models/member.dart';
import '../../providers/auth_provider.dart';
import '../../providers/household_provider.dart';
import '../../widgets/member_avatar.dart';
import '../../widgets/status_badge.dart';

/// Household roster: members (Linked / No Account) and pending invites (Invite Pending).
/// Supervisor-only actions (add managed profile, invite, change role, deactivate) are
/// hidden for non-supervisors.
class MembersScreen extends StatefulWidget {
  const MembersScreen({super.key});

  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      final household = context.read<HouseholdProvider>();
      if (auth.householdId.isNotEmpty) household.load(auth.householdId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final household = context.watch<HouseholdProvider>();
    final isSupervisor = auth.isSupervisor;

    return Scaffold(
      appBar: AppBar(title: const Text('Members')),
      floatingActionButton: isSupervisor
          ? FloatingActionButton.extended(
              onPressed: () => _showAddMenu(context),
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Add'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => household.refresh(),
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            for (final member in household.members)
              _MemberTile(member: member, isSupervisor: isSupervisor),
            if (household.pendingInvites.isNotEmpty) ...[
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Text('Pending invitations'),
              ),
              for (final invite in household.pendingInvites)
                ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.mail_outline)),
                  title: Text(invite.email),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const StatusBadge('Invite Pending', tone: StatusTone.warning),
                      if (isSupervisor)
                        IconButton(
                          tooltip: 'Revoke',
                          icon: const Icon(Icons.close),
                          onPressed: () => household.revokeInvite(invite.id),
                        ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  void _showAddMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.child_care),
              title: const Text('Add managed profile'),
              subtitle: const Text('A dependent with no login (e.g. a child)'),
              onTap: () {
                Navigator.pop(sheetContext);
                _showAddManagedDialog(context);
              },
            ),
            ListTile(
              leading: const Icon(Icons.mail_outline),
              title: const Text('Invite a member'),
              subtitle: const Text('Send an invitation token to share'),
              onTap: () {
                Navigator.pop(sheetContext);
                _showInviteDialog(context);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showAddManagedDialog(BuildContext context) async {
    final controller = TextEditingController();
    final household = context.read<HouseholdProvider>();
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Add managed profile'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Display name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Add')),
        ],
      ),
    );
    if (created == true && controller.text.trim().isNotEmpty) {
      await household.createManagedMember(displayName: controller.text.trim());
    }
    controller.dispose();
  }

  Future<void> _showInviteDialog(BuildContext context) async {
    final emailController = TextEditingController();
    String role = RoleNames.unsupervised;
    final household = context.read<HouseholdProvider>();
    final formKey = GlobalKey<FormState>();

    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Invite a member'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: emailController,
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: validateEmail,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: [
                    DropdownMenuItem(
                      value: RoleNames.unsupervised,
                      child: Text(RoleNames.label(RoleNames.unsupervised)),
                    ),
                    DropdownMenuItem(
                      value: RoleNames.supervising,
                      child: Text(RoleNames.label(RoleNames.supervising)),
                    ),
                    DropdownMenuItem(
                      value: RoleNames.supervised,
                      child: Text(RoleNames.label(RoleNames.supervised)),
                    ),
                  ],
                  onChanged: (v) => setLocal(() => role = v ?? RoleNames.unsupervised),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                if (formKey.currentState!.validate()) Navigator.pop(dialogContext, true);
              },
              child: const Text('Create invite'),
            ),
          ],
        ),
      ),
    );

    if (submitted == true) {
      final token = await household.createInvite(emailController.text.trim(), role);
      if (token != null && context.mounted) {
        await _showTokenDialog(context, token);
      }
    }
    emailController.dispose();
  }

  Future<void> _showTokenDialog(BuildContext context, String token) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Invitation created'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Share this token with the invitee (it is single-use):'),
            const SizedBox(height: 8),
            SelectableText(token, style: Theme.of(dialogContext).textTheme.bodySmall),
          ],
        ),
        actions: [
          FilledButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Done')),
        ],
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  final Member member;
  final bool isSupervisor;

  const _MemberTile({required this.member, required this.isSupervisor});

  @override
  Widget build(BuildContext context) {
    final household = context.read<HouseholdProvider>();
    final (label, tone) = member.state == MemberState.linked
        ? ('Linked', StatusTone.success)
        : (member.claimable ? 'Claimable' : 'No Account', StatusTone.neutral);

    return ListTile(
      leading: MemberAvatar(name: member.displayName),
      title: Text(member.displayName),
      subtitle: Text(
        member.isOwner
            ? 'Owner · ${RoleNames.label(member.role)}'
            : RoleNames.label(member.role),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          StatusBadge(label, tone: tone),
          if (isSupervisor && !member.isOwner)
            PopupMenuButton<String>(
              key: ValueKey('member-menu-${member.id}'),
              tooltip: 'Manage member',
              onSelected: (action) {
                if (action == 'role') {
                  _changeRole(context, household);
                } else if (action == 'claim') {
                  _sendClaimInvite(context, household);
                } else if (action == 'deactivate') {
                  _deactivate(context, household);
                }
              },
              itemBuilder: (menuContext) => [
                const PopupMenuItem(
                  value: 'role',
                  key: ValueKey('change-role'),
                  child: Text('Change role…'),
                ),
                if (member.claimable)
                  const PopupMenuItem(value: 'claim', child: Text('Send claim invite')),
                const PopupMenuItem(value: 'deactivate', child: Text('Deactivate')),
              ],
            ),
        ],
      ),
    );
  }

  /// EP-0050: send a claim invite so an existing managed member can be claimed with a login.
  Future<void> _sendClaimInvite(BuildContext context, HouseholdProvider household) async {
    final emailController = TextEditingController();
    var role = member.role;
    final formKey = GlobalKey<FormState>();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('Claim invite for ${member.displayName}'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: emailController,
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: validateEmail,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: [
                    DropdownMenuItem(
                      value: RoleNames.unsupervised,
                      child: Text(RoleNames.label(RoleNames.unsupervised)),
                    ),
                    DropdownMenuItem(
                      value: RoleNames.supervising,
                      child: Text(RoleNames.label(RoleNames.supervising)),
                    ),
                    DropdownMenuItem(
                      value: RoleNames.supervised,
                      child: Text(RoleNames.label(RoleNames.supervised)),
                    ),
                  ],
                  onChanged: (v) => setLocal(() => role = v ?? member.role),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState!.validate()) Navigator.pop(dialogContext, true);
              },
              child: const Text('Send'),
            ),
          ],
        ),
      ),
    );
    if (submitted != true || !context.mounted) return;
    final token = await household.createInvite(
      emailController.text.trim(),
      role,
      memberId: member.id,
    );
    if (token == null || !context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Claim invite created'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Share this single-use token with the person claiming this profile:'),
            const SizedBox(height: 8),
            SelectableText(token, style: Theme.of(dialogContext).textTheme.bodySmall),
          ],
        ),
        actions: [
          FilledButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Done')),
        ],
      ),
    );
  }

  /// Explicit "Change role" affordance: shows the current role, lets a supervisor pick a new
  /// one, and surfaces success/failure (e.g. the last-supervisor invariant) via a SnackBar.
  Future<void> _changeRole(BuildContext context, HouseholdProvider household) async {
    final messenger = ScaffoldMessenger.of(context);
    var selected = member.role;
    final chosen = await showDialog<String>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('Change role — ${member.displayName}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Current role: ${RoleNames.label(member.role)}'),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: const ValueKey('change-role-dropdown'),
                initialValue: selected,
                decoration: const InputDecoration(labelText: 'New role'),
                items: [
                  DropdownMenuItem(
                    value: RoleNames.unsupervised,
                    child: Text(RoleNames.label(RoleNames.unsupervised)),
                  ),
                  DropdownMenuItem(
                    value: RoleNames.supervising,
                    child: Text(RoleNames.label(RoleNames.supervising)),
                  ),
                  DropdownMenuItem(
                    value: RoleNames.supervised,
                    child: Text(RoleNames.label(RoleNames.supervised)),
                  ),
                ],
                onChanged: (v) => setLocal(() => selected = v ?? member.role),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, selected),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (chosen == null || chosen == member.role) return;
    final ok = await household.changeMemberRole(member.id, chosen);
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? '${member.displayName} is now ${RoleNames.label(chosen)}'
              : (household.error ?? "Couldn't change role"),
        ),
      ),
    );
  }

  /// Confirm and deactivate a member; surfaces the server's reason (e.g. owner cannot be
  /// removed) when it fails.
  Future<void> _deactivate(BuildContext context, HouseholdProvider household) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Deactivate member'),
        content: Text('Remove ${member.displayName} from this household?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Deactivate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final ok = await household.deactivateMember(member.id);
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok ? '${member.displayName} deactivated' : (household.error ?? "Couldn't deactivate"),
        ),
      ),
    );
  }
}
