import 'package:go_router/go_router.dart';

import '../models/auth_state.dart';
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
import 'meals/grocery_screen.dart';
import 'meals/meal_planner_screen.dart';
import 'medications/medication_detail_screen.dart';
import 'medications/medication_form_screen.dart';
import 'medications/medication_list_screen.dart';
import 'more_screen.dart';
import 'notifications/notifications_screen.dart';
import 'rewards/rewards_screen.dart';
import 'onboarding/onboarding_screen.dart';
import 'settings/members_screen.dart';
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
      GoRoute(path: '/rewards', builder: (context, state) => const RewardsScreen()),
      GoRoute(path: '/meals', builder: (context, state) => const MealPlannerScreen()),
      GoRoute(path: '/grocery', builder: (context, state) => const GroceryScreen()),
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
