import '../core/api/api_client.dart';
import '../models/household.dart';
import '../models/invite.dart';
import '../models/member.dart';

/// Per-domain household/member/invite API.
class HouseholdService {
  final ApiClient _api;

  HouseholdService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  Future<Household> getHousehold(String householdId) {
    return _api.getEnveloped(
      _base(householdId),
      (r) => Household.fromJson(((r as Map)['household'] as Map).cast<String, dynamic>()),
    );
  }

  Future<Household> updateHousehold(String householdId, Map<String, dynamic> patch) {
    return _api.patchEnveloped(
      _base(householdId),
      patch,
      (r) => Household.fromJson(((r as Map)['household'] as Map).cast<String, dynamic>()),
    );
  }

  Future<List<Member>> listMembers(String householdId) {
    return _api.getEnveloped('${_base(householdId)}/members', _parseMembers);
  }

  Future<Member> createManagedMember(
    String householdId, {
    required String displayName,
    String? dateOfBirth,
  }) {
    return _api.postEnveloped(
      '${_base(householdId)}/members',
      {'displayName': displayName, 'dateOfBirth': ?dateOfBirth},
      _parseMember,
    );
  }

  Future<Member> updateMember(String householdId, String memberId, Map<String, dynamic> patch) {
    return _api.patchEnveloped('${_base(householdId)}/members/$memberId', patch, _parseMember);
  }

  Future<void> deactivateMember(String householdId, String memberId) async {
    await _api.deleteEnveloped('${_base(householdId)}/members/$memberId', (_) => null);
  }

  Future<List<Invite>> listInvites(String householdId, {String? status}) {
    final query = status != null ? '?status=$status' : '';
    return _api.getEnveloped('${_base(householdId)}/invites$query', _parseInvites);
  }

  /// Create an invite; returns the (raw) token to share out-of-band.
  Future<String> createInvite(
    String householdId, {
    required String email,
    required String role,
    String? memberId,
  }) {
    return _api.postEnveloped(
      '${_base(householdId)}/invites',
      {'email': email, 'role': role, 'memberId': ?memberId},
      (r) => (r as Map)['token'] as String,
    );
  }

  Future<void> revokeInvite(String householdId, String inviteId) async {
    await _api.deleteEnveloped('${_base(householdId)}/invites/$inviteId', (_) => null);
  }

  List<Member> _parseMembers(dynamic r) {
    final list = (r as Map)['members'] as List;
    return list.map((e) => Member.fromJson((e as Map).cast<String, dynamic>())).toList();
  }

  Member _parseMember(dynamic r) =>
      Member.fromJson(((r as Map)['member'] as Map).cast<String, dynamic>());

  List<Invite> _parseInvites(dynamic r) {
    final list = (r as Map)['invites'] as List;
    return list.map((e) => Invite.fromJson((e as Map).cast<String, dynamic>())).toList();
  }
}
