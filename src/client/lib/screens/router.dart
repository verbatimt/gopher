import 'package:go_router/go_router.dart';

import '../models/auth_state.dart';
import '../models/biometric.dart';
import '../models/inventory.dart';
import '../models/recipe.dart';
import '../providers/auth_provider.dart';
import 'auth/accept_invite_screen.dart';
import 'auth/login_screen.dart';
import 'auth/register_screen.dart';
import 'calendar/calendar_screen.dart';
import 'dashboard/dashboard_screen.dart';
import 'finance/finance_screen.dart';
import 'finance/forecast_detail_screen.dart';
import 'finances/budgets_screen.dart';
import 'finances/expenses_screen.dart';
import 'health/health_overview_screen.dart';
import 'health/measurement_form_screen.dart';
import 'health/measurement_list_screen.dart';
import 'health/measurement_trends_screen.dart';
import 'inventory/inventory_detail_screen.dart';
import 'inventory/inventory_form_screen.dart';
import 'inventory/inventory_list_screen.dart';
import 'meals/grocery_screen.dart';
import 'meals/meal_planner_screen.dart';
import 'recipes/recipe_detail_screen.dart';
import 'recipes/recipe_form_screen.dart';
import 'recipes/recipe_list_screen.dart';
import 'medications/medication_detail_screen.dart';
import 'medications/medication_form_screen.dart';
import 'medications/medication_list_screen.dart';
import 'more_screen.dart';
import 'notifications/notifications_screen.dart';
import 'rewards/rewards_screen.dart';
import 'onboarding/onboarding_screen.dart';
import 'settings/audit_log_screen.dart';
import 'settings/members_screen.dart';
import 'settings/modules_screen.dart';
import 'settings/profile_screen.dart';
import 'shell/app_shell.dart';
import 'splash_screen.dart';
import 'tasks/task_detail_screen.dart';
import 'tasks/task_form_screen.dart';
import 'tasks/task_list_screen.dart';

const _authRoutes = {'/login', '/register', '/accept-invite'};

/// Declarative routing with the three-state auth gate:
/// unknown → splash; unauthenticated → login; authenticated-without-household →
/// onboarding; otherwise the dashboard shell.
GoRouter buildRouter(AuthProvider auth) {
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: auth,
    redirect: (context, state) {
      final loc = state.matchedLocation;
      if (auth.status == AuthStatus.unknown) {
        return loc == '/splash' ? null : '/splash';
      }
      if (!auth.isAuthenticated) {
        return _authRoutes.contains(loc) ? null : '/login';
      }
      if (!auth.hasHousehold) {
        return loc == '/onboarding' ? null : '/onboarding';
      }
      if (loc == '/splash' || _authRoutes.contains(loc)) {
        return '/dashboard';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/register', builder: (context, state) => const RegisterScreen()),
      GoRoute(path: '/accept-invite', builder: (context, state) => const AcceptInviteScreen()),
      GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
      GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
      GoRoute(path: '/members', builder: (context, state) => const MembersScreen()),
      GoRoute(path: '/audit-log', builder: (context, state) => const AuditLogScreen()),
      GoRoute(path: '/modules', builder: (context, state) => const ModulesScreen()),
      GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
      GoRoute(path: '/tasks/new', builder: (context, state) => const TaskFormScreen()),
      GoRoute(
        path: '/tasks/:taskId',
        builder: (context, state) => TaskDetailScreen(taskId: state.pathParameters['taskId']!),
      ),
      GoRoute(path: '/medications', builder: (context, state) => const MedicationListScreen()),
      GoRoute(path: '/medications/new', builder: (context, state) => const MedicationFormScreen()),
      GoRoute(
        path: '/medications/:schedId',
        builder: (context, state) =>
            MedicationDetailScreen(scheduleId: state.pathParameters['schedId']!),
      ),
      GoRoute(path: '/health', builder: (context, state) => const HealthOverviewScreen()),
      GoRoute(
        path: '/health/record',
        builder: (context, state) => MeasurementFormScreen(
          memberId: state.uri.queryParameters['memberId'] ?? '',
          existing: state.extra is Measurement ? state.extra as Measurement : null,
        ),
      ),
      GoRoute(
        path: '/health/history',
        builder: (context, state) =>
            MeasurementListScreen(memberId: state.uri.queryParameters['memberId'] ?? ''),
      ),
      GoRoute(
        path: '/health/trends',
        builder: (context, state) => MeasurementTrendsScreen(
          memberId: state.uri.queryParameters['memberId'] ?? '',
          typeKey: state.uri.queryParameters['typeKey'] ?? '',
        ),
      ),
      GoRoute(path: '/rewards', builder: (context, state) => const RewardsScreen()),
      GoRoute(path: '/meals', builder: (context, state) => const MealPlannerScreen()),
      GoRoute(path: '/grocery', builder: (context, state) => const GroceryScreen()),
      GoRoute(path: '/recipes', builder: (context, state) => const RecipeListScreen()),
      GoRoute(path: '/recipes/new', builder: (context, state) => const RecipeFormScreen()),
      GoRoute(
        path: '/recipes/:recipeId/edit',
        builder: (context, state) =>
            RecipeFormScreen(existing: state.extra is Recipe ? state.extra as Recipe : null),
      ),
      GoRoute(
        path: '/recipes/:recipeId',
        builder: (context, state) =>
            RecipeDetailScreen(recipeId: state.pathParameters['recipeId']!),
      ),
      GoRoute(path: '/inventory', builder: (context, state) => const InventoryListScreen()),
      GoRoute(path: '/inventory/new', builder: (context, state) => const InventoryFormScreen()),
      GoRoute(
        path: '/inventory/:itemId/edit',
        builder: (context, state) => InventoryFormScreen(
          existing: state.extra is InventoryItem ? state.extra as InventoryItem : null,
        ),
      ),
      GoRoute(
        path: '/inventory/:itemId',
        builder: (context, state) =>
            InventoryDetailScreen(itemId: state.pathParameters['itemId']!),
      ),
      GoRoute(path: '/finance', builder: (context, state) => const FinanceScreen()),
      GoRoute(
        path: '/finance/forecasts/:forecastId',
        builder: (context, state) =>
            ForecastDetailScreen(forecastId: state.pathParameters['forecastId']!),
      ),
      GoRoute(path: '/budgets', builder: (context, state) => const BudgetsScreen()),
      GoRoute(path: '/expenses', builder: (context, state) => const ExpensesScreen()),
      ShellRoute(
        builder: (context, state, child) => AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/dashboard', builder: (context, state) => const DashboardScreen()),
          GoRoute(path: '/calendar', builder: (context, state) => const CalendarScreen()),
          GoRoute(path: '/tasks', builder: (context, state) => const TaskListScreen()),
          GoRoute(path: '/more', builder: (context, state) => const MoreScreen()),
        ],
      ),
    ],
  );
}
