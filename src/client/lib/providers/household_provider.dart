import '../models/household.dart';
import '../models/invite.dart';
import '../models/member.dart';
import '../services/household_service.dart';
import 'base_provider.dart';

/// Current household, members, and pending invites, plus member-management actions.
class HouseholdProvider extends BaseProvider {
  final HouseholdService _service;

  Household? _household;
  List<Member> _members = [];
  List<Invite> _invites = [];
  String? _householdId;

  HouseholdProvider(this._service);

  Household? get household => _household;
  List<Member> get members => List.unmodifiable(_members);
  List<Invite> get pendingInvites =>
      List.unmodifiable(_invites.where((i) => i.isPending));

  Future<void> load(String householdId) async {
    _householdId = householdId;
    await runGuarded(() async {
      _household = await _service.getHousehold(householdId);
      _members = await _service.listMembers(householdId);
      _invites = await _service.listInvites(householdId, status: 'pending');
    });
    notifyListeners();
  }

  Future<bool> refresh() async {
    final id = _householdId;
    if (id == null) return false;
    await load(id);
    return !hasError;
  }

  Future<bool> updateSettings(Map<String, dynamic> patch) async {
    final id = _householdId;
    if (id == null) return false;
    final updated = await runGuarded(() => _service.updateHousehold(id, patch));
    if (updated == null) return false;
    _household = updated;
    notifyListeners();
    return true;
  }

  Future<bool> createManagedMember({required String displayName, String? dateOfBirth}) async {
    final id = _householdId;
    if (id == null) return false;
    final member = await runGuarded(
      () => _service.createManagedMember(id, displayName: displayName, dateOfBirth: dateOfBirth),
    );
    if (member == null) return false;
    _members = [..._members, member];
    notifyListeners();
    return true;
  }

  Future<bool> changeMemberRole(String memberId, String role) async {
    final id = _householdId;
    if (id == null) return false;
    final member = await runGuarded(() => _service.updateMember(id, memberId, {'role': role}));
    if (member == null) return false;
    _members = _members.map((m) => m.id == memberId ? member : m).toList();
    notifyListeners();
    return true;
  }

  Future<bool> deactivateMember(String memberId) async {
    final id = _householdId;
    if (id == null) return false;
    final ok = await runGuarded(() async {
      await _service.deactivateMember(id, memberId);
      return true;
    });
    if (ok != true) return false;
    _members = _members.where((m) => m.id != memberId).toList();
    notifyListeners();
    return true;
  }

  /// Create an invite; returns the raw token to share (or null on failure). Pass [memberId] to
  /// send a claim invite for an existing managed member (EP-0050).
  Future<String?> createInvite(String email, String role, {String? memberId}) async {
    final id = _householdId;
    if (id == null) return null;
    final token = await runGuarded(
      () => _service.createInvite(id, email: email, role: role, memberId: memberId),
    );
    if (token == null) return null;
    await refresh();
    return token;
  }

  Future<bool> revokeInvite(String inviteId) async {
    final id = _householdId;
    if (id == null) return false;
    final ok = await runGuarded(() async {
      await _service.revokeInvite(id, inviteId);
      return true;
    });
    if (ok != true) return false;
    _invites = _invites.where((i) => i.id != inviteId).toList();
    notifyListeners();
    return true;
  }

  void clear() {
    _household = null;
    _members = [];
    _invites = [];
    _householdId = null;
    notifyListeners();
  }
}
