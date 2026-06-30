import '../core/api/api_client.dart';
import '../models/inventory.dart';

/// Transport for the inventory API (EP-0048). Mirrors the server routes under
/// `/api/v1/households/:id/inventory`.
class InventoryService {
  final ApiClient _api;

  InventoryService(this._api);

  String _base(String householdId) => '/api/v1/households/$householdId/inventory';

  Future<List<InventoryItem>> listItems(
    String householdId, {
    String? category,
    String? location,
    bool? lowStock,
    String? search,
  }) {
    final params = <String>[];
    if (category != null && category.isNotEmpty) params.add('category=${Uri.encodeQueryComponent(category)}');
    if (location != null && location.isNotEmpty) params.add('location=${Uri.encodeQueryComponent(location)}');
    if (lowStock == true) params.add('lowStock=true');
    if (search != null && search.isNotEmpty) params.add('search=${Uri.encodeQueryComponent(search)}');
    final query = params.isEmpty ? '' : '?${params.join('&')}';
    return _api.getEnveloped('${_base(householdId)}$query', (r) {
      final list = (r as Map)['items'] as List;
      return list.map((e) => InventoryItem.fromJson((e as Map).cast<String, dynamic>())).toList();
    });
  }

  Future<InventoryItem> getItem(String householdId, String itemId) {
    return _api.getEnveloped(
      '${_base(householdId)}/$itemId',
      (r) => InventoryItem.fromJson(((r as Map)['item'] as Map).cast<String, dynamic>()),
    );
  }

  Future<InventoryItem> createItem(String householdId, Map<String, dynamic> body) {
    return _api.postEnveloped(
      _base(householdId),
      body,
      (r) => InventoryItem.fromJson(((r as Map)['item'] as Map).cast<String, dynamic>()),
    );
  }

  Future<InventoryItem> updateItem(String householdId, String itemId, Map<String, dynamic> body) {
    return _api.patchEnveloped(
      '${_base(householdId)}/$itemId',
      body,
      (r) => InventoryItem.fromJson(((r as Map)['item'] as Map).cast<String, dynamic>()),
    );
  }

  Future<void> deleteItem(String householdId, String itemId) {
    return _api.deleteEnveloped('${_base(householdId)}/$itemId', (_) {});
  }

  /// Apply a signed delta; returns the updated item, the adjustment, and whether a grocery line
  /// was auto-added.
  Future<({InventoryItem item, bool groceryAdded})> adjust(
    String householdId,
    String itemId,
    Map<String, dynamic> body,
  ) {
    return _api.postEnveloped('${_base(householdId)}/$itemId/adjust', body, (r) {
      final map = (r as Map).cast<String, dynamic>();
      return (
        item: InventoryItem.fromJson((map['item'] as Map).cast<String, dynamic>()),
        groceryAdded: map['groceryAdded'] as bool? ?? false,
      );
    });
  }

  Future<List<InventoryAdjustment>> adjustments(String householdId, String itemId) {
    return _api.getEnveloped('${_base(householdId)}/$itemId/adjustments', (r) {
      final list = (r as Map)['adjustments'] as List;
      return list
          .map((e) => InventoryAdjustment.fromJson((e as Map).cast<String, dynamic>()))
          .toList();
    });
  }

  Future<bool> addToGrocery(String householdId, String itemId) {
    return _api.postEnveloped(
      '${_base(householdId)}/$itemId/add-to-grocery',
      const {},
      (r) => (r as Map)['added'] as bool? ?? false,
    );
  }
}
