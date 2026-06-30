import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'core/api/api_client.dart';
import 'core/constants.dart';
import 'core/storage/token_store.dart';
import 'core/storage/token_store_factory.dart';
import 'core/theme/app_theme.dart';
import 'providers/audit_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/biometric_provider.dart';
import 'providers/budget_provider.dart';
import 'providers/calendar_provider.dart';
import 'providers/dashboard_provider.dart';
import 'providers/finance_provider.dart';
import 'providers/health_provider.dart';
import 'providers/inventory_provider.dart';
import 'providers/household_provider.dart';
import 'providers/meal_provider.dart';
import 'providers/medication_provider.dart';
import 'providers/module_provider.dart';
import 'providers/notification_provider.dart';
import 'providers/recipe_provider.dart';
import 'providers/reward_provider.dart';
import 'providers/task_provider.dart';
import 'providers/ws_provider.dart';
import 'services/audit_service.dart';
import 'services/auth_service.dart';
import 'services/biometric_service.dart';
import 'services/budget_service.dart';
import 'services/calendar_service.dart';
import 'services/dashboard_service.dart';
import 'services/finance_service.dart';
import 'services/health_service.dart';
import 'services/household_service.dart';
import 'services/inventory_service.dart';
import 'services/meal_service.dart';
import 'services/medication_service.dart';
import 'services/notification_service.dart';
import 'services/recipe_service.dart';
import 'services/reward_service.dart';
import 'services/task_service.dart';
import 'services/ws_service.dart';
import 'screens/router.dart';

void main() {
  runApp(const GopherApp());
}

class GopherApp extends StatefulWidget {
  const GopherApp({super.key});

  @override
  State<GopherApp> createState() => _GopherAppState();
}

class _GopherAppState extends State<GopherApp> {
  late final TokenStore _tokenStore;
  late final ApiClient _apiClient;
  late final AuthProvider _auth;
  late final HouseholdProvider _household;
  late final HealthProvider _health;
  late final ModuleProvider _modules;
  late final WsProvider _ws;
  late final NotificationProvider _notifications;
  late final TaskProvider _tasks;
  late final CalendarProvider _calendar;
  late final MedicationProvider _medications;
  late final BiometricProvider _biometrics;
  late final RewardProvider _rewards;
  late final MealProvider _meals;
  late final RecipeProvider _recipes;
  late final InventoryProvider _inventory;
  late final AuditProvider _audit;
  late final FinanceProvider _finance;
  late final BudgetProvider _budgets;
  late final DashboardProvider _dashboard;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _tokenStore = createTokenStore();
    _apiClient = ApiClient(tokenStore: _tokenStore);
    _auth = AuthProvider(tokenStore: _tokenStore, authService: AuthService(_apiClient));
    // Wire silent 401-refresh-and-retry into the transport.
    _apiClient.tokenRefresher = _auth.refreshToken;
    _household = HouseholdProvider(HouseholdService(_apiClient));
    _health = HealthProvider(HealthService(_apiClient));
    _modules = ModuleProvider();
    _ws = WsProvider(WsService());
    _notifications = NotificationProvider(NotificationService(_apiClient))..bindEvents(_ws.events);
    _tasks = TaskProvider(TaskService(_apiClient))..bindEvents(_ws.events);
    _calendar = CalendarProvider(CalendarService(_apiClient))..bindEvents(_ws.events);
    _medications = MedicationProvider(MedicationService(_apiClient))..bindEvents(_ws.events);
    _biometrics = BiometricProvider(BiometricService(_apiClient));
    _rewards = RewardProvider(RewardService(_apiClient))..bindEvents(_ws.events);
    _meals = MealProvider(MealService(_apiClient));
    _recipes = RecipeProvider(RecipeService(_apiClient));
    _inventory = InventoryProvider(InventoryService(_apiClient));
    _audit = AuditProvider(AuditService(_apiClient));
    _finance = FinanceProvider(FinanceService(_apiClient));
    _budgets = BudgetProvider(BudgetService(_apiClient));
    _dashboard = DashboardProvider(DashboardService(_apiClient))..bindEvents(_ws.events);
    _router = buildRouter(_auth);

    _auth.addListener(_onAuthChanged);
    _auth.init();
  }

  void _onAuthChanged() {
    if (_auth.isAuthenticated && _auth.hasHousehold) {
      _tokenStore.readAccessToken().then((token) {
        if (token != null && !_ws.isConnected) _ws.connect(token);
      });
      if (_household.household == null) {
        _household.load(_auth.householdId).then((_) {
          final h = _household.household;
          if (h != null) {
            // Dashboard is always-on; feature modules come from the household.
            _modules.setActive([...h.activeModules, AppModules.dashboard]);
          }
        });
        _notifications.load();
      }
    } else if (_auth.isResolved && !_auth.isAuthenticated) {
      _ws.disconnect();
      _household.clear();
      _notifications.reset();
      _modules.setActive(AppModules.all);
    }
  }

  @override
  void dispose() {
    _auth.removeListener(_onAuthChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _apiClient),
        ChangeNotifierProvider<AuthProvider>.value(value: _auth),
        ChangeNotifierProvider<HouseholdProvider>.value(value: _household),
        ChangeNotifierProvider<HealthProvider>.value(value: _health),
        ChangeNotifierProvider<ModuleProvider>.value(value: _modules),
        ChangeNotifierProvider<WsProvider>.value(value: _ws),
        ChangeNotifierProvider<NotificationProvider>.value(value: _notifications),
        ChangeNotifierProvider<TaskProvider>.value(value: _tasks),
        ChangeNotifierProvider<CalendarProvider>.value(value: _calendar),
        ChangeNotifierProvider<MedicationProvider>.value(value: _medications),
        ChangeNotifierProvider<BiometricProvider>.value(value: _biometrics),
        ChangeNotifierProvider<RewardProvider>.value(value: _rewards),
        ChangeNotifierProvider<MealProvider>.value(value: _meals),
        ChangeNotifierProvider<RecipeProvider>.value(value: _recipes),
        ChangeNotifierProvider<InventoryProvider>.value(value: _inventory),
        ChangeNotifierProvider<AuditProvider>.value(value: _audit),
        ChangeNotifierProvider<FinanceProvider>.value(value: _finance),
        ChangeNotifierProvider<BudgetProvider>.value(value: _budgets),
        ChangeNotifierProvider<DashboardProvider>.value(value: _dashboard),
      ],
      child: MaterialApp.router(
        title: AppConstants.appName,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        themeMode: ThemeMode.system,
        routerConfig: _router,
        debugShowCheckedModeBanner: false,
      ),
    );
  }
}
