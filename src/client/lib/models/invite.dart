/// A household invitation and its derived status (from `/households/:id/invites`).
class Invite {
  final String id;
  final String email;
  final String status; // pending | accepted | revoked | expired
  final DateTime? expiresAt;

  const Invite({
    required this.id,
    required this.email,
    required this.status,
    this.expiresAt,
  });

  bool get isPending => status == 'pending';

  factory Invite.fromJson(Map<String, dynamic> json) {
    final expires = json['expiresAt'] as String?;
    return Invite(
      id: json['id'] as String,
      email: json['email'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      expiresAt: expires != null ? DateTime.tryParse(expires) : null,
    );
  }
}
