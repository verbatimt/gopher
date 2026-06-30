import '../models/inventory.dart';
import '../services/inventory_service.dart';
import 'base_provider.dart';

/// Inventory state (EP-0049): the filterable item list plus per-item detail/adjustment fetches.
/// Adjustments reconcile to the server's `resulting_quantity`.
class InventoryProvider extends BaseProvider {
  final InventoryService _service;

  String? _householdId;
  List<InventoryItem> _items = [];

  InventoryProvider(this._service);

  List<InventoryItem> get items => List.unmodifiable(_items);

  Future<void> load(
    String householdId, {
    String? category,
    String? location,
    bool? lowStock,
    String? search,
  }) async {
    _householdId = householdId;
    final result = await runGuarded(
      () => _service.listItems(
        householdId,
        category: category,
        location: location,
        lowStock: lowStock,
        search: search,
      ),
    );
    if (result != null) {
      _items = result;
      notifyListeners();
    }
  }

  Future<InventoryItem?> getItem(String itemId) async {
    final h = _householdId;
    if (h == null) return null;
    return runGuarded(() => _service.getItem(h, itemId));
  }

  Future<List<InventoryAdjustment>> adjustments(String itemId) async {
    final h = _householdId;
    if (h == null) return const [];
    return await runGuarded(() => _service.adjustments(h, itemId)) ?? const [];
  }

  Future<bool> createItem(Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final created = await runGuarded(() => _service.createItem(h, body));
    if (created == null) return false;
    await load(h);
    return true;
  }

  Future<bool> updateItem(String itemId, Map<String, dynamic> body) async {
    final h = _householdId;
    if (h == null) return false;
    final updated = await runGuarded(() => _service.updateItem(h, itemId, body));
    if (updated == null) return false;
    _items = _items.map((i) => i.id == itemId ? updated : i).toList();
    notifyListeners();
    return true;
  }

  Future<bool> deleteItem(String itemId) async {
    final h = _householdId;
    if (h == null) return false;
    final ok = await runGuarded(() async {
      await _service.deleteItem(h, itemId);
      return true;
    });
    if (ok != true) return false;
    _items = _items.where((i) => i.id != itemId).toList();
    notifyListeners();
    return true;
  }

  /// Apply a delta; reconciles the list to the server's resulting quantity. Returns whether a
  /// grocery line was auto-added, or null on failure.
  Future<bool?> adjust(String itemId, double delta, String reason, {String? note}) async {
    final h = _householdId;
    if (h == null) return null;
    final result = await runGuarded(
      () => _service.adjust(h, itemId, {'delta': delta, 'reason': reason, 'note': ?note}),
    );
    if (result == null) return null;
    _items = _items.map((i) => i.id == itemId ? result.item : i).toList();
    notifyListeners();
    return result.groceryAdded;
  }

  Future<bool> addToGrocery(String itemId) async {
    final h = _householdId;
    if (h == null) return false;
    return await runGuarded(() => _service.addToGrocery(h, itemId)) ?? false;
  }
}
