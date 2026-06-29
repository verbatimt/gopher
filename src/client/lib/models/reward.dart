// Reward domain models mirroring the EP-0027/0028 API. Points are integers throughout.

/// A member's reward balance + lifetime totals.
class RewardBalance {
  final String? memberId;
  final int balance;
  final int lifetimeEarned;
  final int lifetimeRedeemed;

  const RewardBalance({
    required this.memberId,
    required this.balance,
    required this.lifetimeEarned,
    required this.lifetimeRedeemed,
  });

  factory RewardBalance.fromJson(Map<String, dynamic> json) => RewardBalance(
        memberId: json['memberId'] as String?,
        balance: (json['balance'] as num?)?.toInt() ?? 0,
        lifetimeEarned: (json['lifetimeEarned'] as num?)?.toInt() ?? 0,
        lifetimeRedeemed: (json['lifetimeRedeemed'] as num?)?.toInt() ?? 0,
      );

  static const empty = RewardBalance(
    memberId: null,
    balance: 0,
    lifetimeEarned: 0,
    lifetimeRedeemed: 0,
  );
}

/// A redeemable catalog item.
class RewardStoreItem {
  final String id;
  final String name;
  final String? description;
  final int pointCost;
  final int? redemptionCap;
  final int redemptionCount;
  final int? cooldownMinutes;

  const RewardStoreItem({
    required this.id,
    required this.name,
    this.description,
    required this.pointCost,
    this.redemptionCap,
    required this.redemptionCount,
    this.cooldownMinutes,
  });

  bool get capReached => redemptionCap != null && redemptionCount >= redemptionCap!;

  /// Redeemable for a member with [balance] points (mirrors the server's gating).
  bool affordableFor(int balance) => balance >= pointCost && !capReached;

  factory RewardStoreItem.fromJson(Map<String, dynamic> json) => RewardStoreItem(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        description: json['description'] as String?,
        pointCost: (json['pointCost'] as num?)?.toInt() ?? 0,
        redemptionCap: (json['redemptionCap'] as num?)?.toInt(),
        redemptionCount: (json['redemptionCount'] as num?)?.toInt() ?? 0,
        cooldownMinutes: (json['cooldownMinutes'] as num?)?.toInt(),
      );
}

/// A ledger transaction (earn / redeem / adjustment) with an approval status.
class RewardTransaction {
  final String id;
  final String memberId;
  final String type;
  final int amount;
  final int balanceAfter;
  final String status;
  final String? notes;
  final DateTime? createdAt;

  const RewardTransaction({
    required this.id,
    required this.memberId,
    required this.type,
    required this.amount,
    required this.balanceAfter,
    required this.status,
    this.notes,
    this.createdAt,
  });

  bool get isPending => status == 'pending';
  bool get isPendingRedeem => isPending && type == 'redeem';

  factory RewardTransaction.fromJson(Map<String, dynamic> json) => RewardTransaction(
        id: json['id'] as String,
        memberId: json['memberId'] as String? ?? '',
        type: json['type'] as String? ?? 'adjustment',
        amount: (json['amount'] as num?)?.toInt() ?? 0,
        balanceAfter: (json['balanceAfter'] as num?)?.toInt() ?? 0,
        status: json['status'] as String? ?? 'approved',
        notes: json['notes'] as String?,
        createdAt: (json['createdAt'] as String?) != null
            ? DateTime.tryParse(json['createdAt'] as String)
            : null,
      );
}
