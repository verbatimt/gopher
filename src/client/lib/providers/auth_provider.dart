import '../core/storage/token_store.dart';
import '../models/auth_state.dart';
import '../models/user.dart';
import '../services/auth_service.dart';
import 'base_provider.dart';

/// Authentication state for the auth-gated app (EP-0015). Holds the session, persists the
/// access token to secure storage, and provides the token refresher the ApiClient calls on
/// a 401. The refresh cookie (httpOnly) rotates the refresh token server-side.
class AuthProvider extends BaseProvider {
  final TokenStore _tokenStore;
  final AuthService _authService;

  AuthStatus _status = AuthStatus.unknown;
  User? _user;
  String _householdId = '';
  List<String> _roles = const [];

  AuthProvider({required TokenStore tokenStore, required AuthService authService})
      // Named params cannot be private initializing formals, so assign explicitly.
      // ignore: prefer_initializing_formals
      : _tokenStore = tokenStore,
        // ignore: prefer_initializing_formals
        _authService = authService;

  AuthStatus get status => _status;
  User? get user => _user;
  String get householdId => _householdId;
  List<String> get roles => List.unmodifiable(_roles);
  bool get isSupervisor => _roles.contains(RoleNames.supervising);
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  bool get isResolved => _status != AuthStatus.unknown;
  bool get hasHousehold => _householdId.isNotEmpty;

  /// The signed-in user's own `household_members` id (from `/auth/me`), or null if unknown.
  String? get currentMemberId => _user?.memberId;

  /// Ensure [currentMemberId] is populated. After login/register the session user has no
  /// member id (it is not in the token); this lazily fetches `/auth/me` to fill it. Returns
  /// the member id, or null on failure.
  Future<String?> ensureMemberId() async {
    if (_user?.memberId != null) return _user!.memberId;
    final me = await runGuarded(() => _authService.fetchMe());
    if (me != null) {
      _user = me;
      notifyListeners();
    }
    return _user?.memberId;
  }

  /// Restore the session on startup. Validates the stored token (refreshing if needed).
  Future<void> init() async {
    final token = await _tokenStore.readAccessToken();
    if (token == null || token.isEmpty) {
      _setStatus(AuthStatus.unauthenticated);
      return;
    }
    _householdId = householdIdFromToken(token);
    try {
      _user = await _authService.fetchMe();
      final current = await _tokenStore.readAccessToken();
      if (current != null) {
        _householdId = householdIdFromToken(current);
        _roles = rolesFromToken(current);
      }
      _setStatus(AuthStatus.authenticated);
    } catch (_) {
      await _tokenStore.clear();
      _setStatus(AuthStatus.unauthenticated);
    }
  }

  Future<bool> login(String email, String password) async {
    final result = await runGuarded(() => _authService.login(email: email, password: password));
    if (result == null) return false;
    await _applySession(result);
    return true;
  }

  Future<bool> register({
    required String email,
    required String password,
    required String displayName,
    String? timezone,
  }) async {
    final result = await runGuarded(
      () => _authService.register(
        email: email,
        password: password,
        displayName: displayName,
        timezone: timezone,
      ),
    );
    if (result == null) return false;
    await _applySession(result);
    return true;
  }

  Future<bool> acceptInvite(String token, {String? password, String? displayName}) async {
    final result = await runGuarded(
      () => _authService.acceptInvite(token: token, password: password, displayName: displayName),
    );
    if (result == null) return false;
    await _applySession(result);
    return true;
  }

  /// Token refresher wired into the ApiClient. On failure, flips to unauthenticated so the
  /// router redirects to login.
  Future<bool> refreshToken() async {
    try {
      final token = await _authService.refresh();
      await _tokenStore.writeAccessToken(token);
      _householdId = householdIdFromToken(token);
      _roles = rolesFromToken(token);
      return true;
    } catch (_) {
      await _tokenStore.clear();
      _user = null;
      _householdId = '';
      _setStatus(AuthStatus.unauthenticated);
      return false;
    }
  }

  Future<void> signOut() async {
    try {
      await _authService.logout();
    } catch (_) {
      // Best-effort; clear local state regardless.
    }
    await _tokenStore.clear();
    _user = null;
    _householdId = '';
    _roles = const [];
    _setStatus(AuthStatus.unauthenticated);
  }

  /// Update the signed-in user's profile (display name / timezone / currency).
  Future<bool> updateProfile(Map<String, dynamic> patch) async {
    final updated = await runGuarded(() => _authService.updateProfile(patch));
    if (updated == null) return false;
    _user = updated;
    notifyListeners();
    return true;
  }

  void setUser(User user) {
    _user = user;
    notifyListeners();
  }

  Future<void> _applySession(AuthResult result) async {
    await _tokenStore.writeAccessToken(result.accessToken);
    _user = result.user;
    _householdId = result.householdId;
    _roles = rolesFromToken(result.accessToken);
    _setStatus(AuthStatus.authenticated);
  }

  void _setStatus(AuthStatus status) {
    _status = status;
    notifyListeners();
  }
}
