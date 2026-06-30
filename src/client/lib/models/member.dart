/// Household member. A member is either Linked (has a login) or No Account (managed/
/// dependent profile). Pending invitations are represented separately by [Invite].
enum MemberState { linked, noAccount }

class Member {
  final String id;
  final String displayName;
  final String? avatarUrl;
  final String? dateOfBirth;
  final bool isManaged;
  final bool isOwner;
  final bool hasLogin;
  /// EP-0050: a managed, login-less member can be claimed via an invite.
  final bool claimable;
  final String role;

  const Member({
    required this.id,
    required this.displayName,
    this.avatarUrl,
    this.dateOfBirth,
    required this.isManaged,
    required this.isOwner,
    required this.hasLogin,
    this.claimable = false,
    required this.role,
  });

  MemberState get state => hasLogin ? MemberState.linked : MemberState.noAccount;

  factory Member.fromJson(Map<String, dynamic> json) {
    return Member(
      id: json['id'] as String,
      displayName: json['displayName'] as String? ?? '',
      avatarUrl: json['avatarUrl'] as String?,
      dateOfBirth: json['dateOfBirth'] as String?,
      isManaged: json['isManaged'] as bool? ?? false,
      isOwner: json['isOwner'] as bool? ?? false,
      hasLogin: json['hasLogin'] as bool? ?? false,
      claimable: json['claimable'] as bool? ?? false,
      role: json['role'] as String? ?? 'supervised_user',
    );
  }
}
