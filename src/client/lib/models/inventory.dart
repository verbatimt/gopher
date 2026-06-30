// Inventory domain models mirroring the EP-0048 API. numeric fields (quantity, threshold,
// delta) arrive as strings (Postgres numeric); parsed to doubles for display/logic.

double _numOf(dynamic v) => v == null ? 0 : double.tryParse(v.toString()) ?? 0;
double? _numOrNull(dynamic v) => v == null ? null : double.tryParse(v.toString());

String trimNum(double n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

class InventoryItem {
  final String id;
  final String name;
  final String? category;
  final String? unit;
  final double quantity;
  final String? location;
  final double? lowThreshold;
  final String? expiresAt;
  final String? barcode;
  final bool autoAddToGrocery;
  final String? notes;
  final String? imagePath;
  final bool isActive;
  final bool isLowStock;

  const InventoryItem({
    required this.id,
    required this.name,
    this.category,
    this.unit,
    required this.quantity,
    this.location,
    this.lowThreshold,
    this.expiresAt,
    this.barcode,
    required this.autoAddToGrocery,
    this.notes,
    this.imagePath,
    this.isActive = true,
    this.isLowStock = false,
  });

  /// Expiring soon (within 7 days) or already expired, when an expiry is set.
  bool get isExpiringSoon {
    if (expiresAt == null) return false;
    final d = DateTime.tryParse(expiresAt!);
    if (d == null) return false;
    return d.difference(DateTime.now()).inDays <= 7;
  }

  String get quantityLabel => unit == null ? trimNum(quantity) : '${trimNum(quantity)} $unit';

  factory InventoryItem.fromJson(Map<String, dynamic> json) => InventoryItem(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        category: json['category'] as String?,
        unit: json['unit'] as String?,
        quantity: _numOf(json['quantity']),
        location: json['location'] as String?,
        lowThreshold: _numOrNull(json['lowThreshold']),
        expiresAt: json['expiresAt'] as String?,
        barcode: json['barcode'] as String?,
        autoAddToGrocery: json['autoAddToGrocery'] as bool? ?? true,
        notes: json['notes'] as String?,
        imagePath: json['imagePath'] as String?,
        isActive: json['isActive'] as bool? ?? true,
        isLowStock: json['isLowStock'] as bool? ?? false,
      );
}

class InventoryAdjustment {
  final String id;
  final String itemId;
  final double delta;
  final String reason;
  final double resultingQuantity;
  final String? note;
  final DateTime createdAt;

  const InventoryAdjustment({
    required this.id,
    required this.itemId,
    required this.delta,
    required this.reason,
    required this.resultingQuantity,
    this.note,
    required this.createdAt,
  });

  factory InventoryAdjustment.fromJson(Map<String, dynamic> json) => InventoryAdjustment(
        id: json['id'] as String,
        itemId: json['itemId'] as String? ?? '',
        delta: _numOf(json['delta']),
        reason: json['reason'] as String? ?? 'correction',
        resultingQuantity: _numOf(json['resultingQuantity']),
        note: json['note'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}
