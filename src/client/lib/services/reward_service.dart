import '../core/api/api_client.dart';
import '../models/reward.dart';

/// Transport for the rewards API (EP-0027/0028). `me` endpoints resolve the caller's own
/// member server-side (the client holds only the user token).
class RewardService {
  final ApiClient _api;

  RewardService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId';

  RewardBalance _balance(dynamic r) =>
      RewardBalance.fromJson(((r as Map)['rewards'] as Map).cast<String, dynamic>());

  List<RewardTransaction> _txs(dynamic r) => ((r as Map)['transactions'] as List)
      .map((e) => RewardTransaction.fromJson((e as Map).cast<String, dynamic>()))
      .toList();

  Future<RewardBalance> myBalance(String householdId) =>
      _api.getEnveloped('${_base(householdId)}/rewards/me', _balance);

  Future<RewardBalance> memberBalance(String householdId, String memberId) =>
      _api.getEnveloped('${_base(householdId)}/rewards/$memberId', _balance);

  Future<List<RewardTransaction>> myTransactions(String householdId) =>
      _api.getEnveloped('${_base(householdId)}/rewards/me/transactions', _txs);

  Future<List<RewardTransaction>> memberTransactions(String householdId, String memberId) =>
      _api.getEnveloped('${_base(householdId)}/rewards/$memberId/transactions', _txs);

  Future<List<RewardStoreItem>> store(String householdId) {
    return _api.getEnveloped('${_base(householdId)}/reward-store', (r) {
      final list = (r as Map)['items'] as List;
      return list.map((e) => RewardStoreItem.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<RewardTransaction> redeem(String householdId, String itemId) {
    return _api.postEnveloped(
      '${_base(householdId)}/reward-store/$itemId/redeem',
      null,
      (r) => RewardTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
    );
  }

  Future<RewardTransaction> adjust(
    String householdId,
    String memberId, {
    required int amount,
    required String notes,
  }) {
    return _api.postEnveloped(
      '${_base(householdId)}/rewards/$memberId/adjust',
      {'amount': amount, 'notes': notes},
      (r) => RewardTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
    );
  }

  Future<RewardTransaction> decide(String householdId, String txId, String decision) {
    return _api.patchEnveloped(
      '${_base(householdId)}/reward-transactions/$txId',
      {'decision': decision},
      (r) => RewardTransaction.fromJson(((r as Map)['transaction'] as Map).cast<String, dynamic>()),
    );
  }
}
