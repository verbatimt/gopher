import 'dart:async';

import '../models/reward.dart';
import '../services/reward_service.dart';
import 'base_provider.dart';

/// Rewards state: the caller's own balance (for store affordability), a "viewed" member
/// (own by default; supervisors can switch to manage others), the store catalog, and the
/// viewed member's transaction history. Live-refreshes on `reward.updated` /
/// `reward.redemption_status` WS events (EP-0029).
class RewardProvider extends BaseProvider {
  final RewardService _service;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  String? _householdId;
  RewardBalance _own = RewardBalance.empty;
  String? _viewedMemberId; // null ⇒ viewing own
  RewardBalance _viewed = RewardBalance.empty;
  List<RewardStoreItem> _store = [];
  List<RewardTransaction> _transactions = [];

  RewardProvider(this._service);

  RewardBalance get ownBalance => _own;
  RewardBalance get viewedBalance => _viewed;
  bool get viewingOwn => _viewedMemberId == null || _viewedMemberId == _own.memberId;
  List<RewardStoreItem> get store => List.unmodifiable(_store);
  List<RewardTransaction> get transactions => List.unmodifiable(_transactions);
  List<RewardTransaction> get pendingRedemptions =>
      _transactions.where((t) => t.isPendingRedeem).toList();

  Future<void> load(String householdId) async {
    _householdId = householdId;
    await runGuarded(() async {
      _own = await _service.myBalance(householdId);
      _viewed = _own;
      _viewedMemberId = _own.memberId;
      _store = await _service.store(householdId);
      _transactions = await _service.myTransactions(householdId);
    });
    notifyListeners();
  }

  /// Supervisor: view (and manage) another member's rewards.
  Future<void> viewMember(String memberId) async {
    final h = _householdId;
    if (h == null) return;
    _viewedMemberId = memberId;
    await runGuarded(() async {
      if (memberId == _own.memberId) {
        _viewed = await _service.myBalance(h);
        _transactions = await _service.myTransactions(h);
      } else {
        _viewed = await _service.memberBalance(h, memberId);
        _transactions = await _service.memberTransactions(h, memberId);
      }
    });
    notifyListeners();
  }

  Future<bool> redeem(String itemId) async {
    final h = _householdId;
    if (h == null) return false;
    final tx = await runGuarded(() => _service.redeem(h, itemId));
    if (tx == null) return false;
    await _reload();
    return true;
  }

  /// Supervisor (rewards:manage): create a catalog item, then refresh the store.
  Future<bool> createStoreItem(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.createStoreItem(h, body);
      _store = await _service.store(h);
      return true;
    });
    notifyListeners();
    return ok ?? false;
  }

  /// Supervisor (rewards:manage): update a catalog item, then refresh the store.
  Future<bool> updateStoreItem(String itemId, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.updateStoreItem(h, itemId, body);
      _store = await _service.store(h);
      return true;
    });
    notifyListeners();
    return ok ?? false;
  }

  /// Supervisor (rewards:manage): soft-deactivate a catalog item, then refresh the store.
  Future<bool> deactivateStoreItem(String itemId) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deactivateStoreItem(h, itemId);
      _store = await _service.store(h);
      return true;
    });
    notifyListeners();
    return ok ?? false;
  }

  Future<bool> adjust(String memberId, int amount, String notes) async {
    final h = _householdId;
    if (h == null) return false;
    final tx = await runGuarded(() => _service.adjust(h, memberId, amount: amount, notes: notes));
    if (tx == null) return false;
    await _reload();
    return true;
  }

  Future<bool> decide(String txId, String decision) async {
    final h = _householdId;
    if (h == null) return false;
    final tx = await runGuarded(() => _service.decide(h, txId, decision));
    if (tx == null) return false;
    await _reload();
    return true;
  }

  Future<void> _reload() async {
    final h = _householdId;
    if (h == null) return;
    _own = await _service.myBalance(h);
    if (viewingOwn) {
      _viewed = _own;
      _transactions = await _service.myTransactions(h);
    } else {
      _viewed = await _service.memberBalance(h, _viewedMemberId!);
      _transactions = await _service.memberTransactions(h, _viewedMemberId!);
    }
    notifyListeners();
  }

  void bindEvents(Stream<Map<String, dynamic>> events) {
    _wsSub?.cancel();
    _wsSub = events.listen((event) {
      final type = event['type'];
      if (type == 'reward.updated' || type == 'reward.redemption_status') {
        if (_householdId != null) _reload();
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }
}
