import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gopher/core/api/api_client.dart';
import 'package:gopher/core/constants.dart';
import 'package:gopher/core/storage/in_memory_token_store.dart';
import 'package:gopher/models/recipe.dart';
import 'package:gopher/providers/auth_provider.dart';
import 'package:gopher/providers/module_provider.dart';
import 'package:gopher/providers/recipe_provider.dart';
import 'package:gopher/screens/recipes/recipe_detail_screen.dart';
import 'package:gopher/screens/recipes/recipe_form_screen.dart';
import 'package:gopher/screens/recipes/recipe_list_screen.dart';
import 'package:gopher/services/auth_service.dart';
import 'package:gopher/services/recipe_service.dart';
import 'package:gopher/widgets/remote_image.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

String _env(Object? result) => jsonEncode({
      'version': 'v1',
      'statusCode': 200,
      'success': true,
      'message': 'OK',
      'result': result,
    });

ApiClient _client(MockClient mock) =>
    ApiClient(baseUrl: 'http://t', client: mock, tokenStore: InMemoryTokenStore());

String _jwt(Map<String, dynamic> claims) {
  String seg(Map<String, dynamic> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${seg({'alg': 'none'})}.${seg(claims)}.sig';
}

Map<String, dynamic> _recipe(String id, String name, {List<String> tags = const []}) => {
      'id': id,
      'name': name,
      'servings': 4,
      'tags': tags,
      'isActive': true,
    };

void main() {
  group('RecipeProvider', () {
    test('load populates recipes', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes') {
          return http.Response(_env({'recipes': [_recipe('1', 'Pancakes'), _recipe('2', 'Soup')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = RecipeProvider(RecipeService(_client(mock)));
      await provider.load('h');
      expect(provider.recipes.length, 2);
      expect(provider.recipes.first.name, 'Pancakes');
    });

    test('create posts metadata + inline ingredients/steps and opens it', () async {
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes' && req.method == 'POST') {
          return http.Response(
            _env({
              'recipe': _recipe('9', 'Stew'),
              'ingredients': [
                {'id': 'i1', 'name': 'beef', 'quantity': '500', 'unit': 'g', 'sortOrder': 1},
              ],
              'steps': [
                {'id': 's1', 'stepNumber': 1, 'instruction': 'Brown the beef'},
              ],
            }),
            201,
          );
        }
        if (req.url.path == '/api/v1/households/h/recipes') {
          return http.Response(_env({'recipes': [_recipe('9', 'Stew')]}), 200);
        }
        return http.Response('{}', 404);
      });
      final provider = RecipeProvider(RecipeService(_client(mock)));
      await provider.load('h');
      final created = await provider.create({
        'name': 'Stew',
        'ingredients': [{'name': 'beef', 'quantity': 500, 'unit': 'g'}],
        'steps': [{'instruction': 'Brown the beef'}],
      });
      expect(created, isNotNull);
      expect(created!.ingredients.length, 1);
      expect(created.steps.first.instruction, 'Brown the beef');
    });
  });

  group('recipe screens', () {
    Future<AuthProvider> authWith(String role) async {
      final store = InMemoryTokenStore();
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/auth/login') {
          return http.Response(
            _env({
              'accessToken': _jwt({'householdId': 'h', 'roles': role}),
              'user': {'id': 'u', 'email': 'a@b.c', 'displayName': 'Owner'},
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      final auth = AuthProvider(
        tokenStore: store,
        authService: AuthService(ApiClient(baseUrl: 'http://t', client: mock, tokenStore: store)),
      );
      await auth.login('a@b.c', 'pw');
      return auth;
    }

    Widget wrap(Widget child, AuthProvider auth, MockClient mock) {
      final modules = ModuleProvider()..setActive(const [AppModules.meals]);
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModuleProvider>.value(value: modules),
          ChangeNotifierProvider<RecipeProvider>.value(
            value: RecipeProvider(RecipeService(_client(mock))),
          ),
        ],
        child: MaterialApp(home: child),
      );
    }

    testWidgets('list renders recipes and shows the author FAB for a supervisor', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes') {
          return http.Response(_env({'recipes': [_recipe('1', 'Pancakes')]}), 200);
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const RecipeListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Pancakes'), findsOneWidget);
      expect(find.widgetWithText(FloatingActionButton, 'New recipe'), findsOneWidget);
    });

    testWidgets('a supervised user sees no author FAB', (tester) async {
      final auth = await authWith('supervised_user');
      final mock = MockClient((req) async => http.Response(_env({'recipes': const []}), 200));
      await tester.pumpWidget(wrap(const RecipeListScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(FloatingActionButton, 'New recipe'), findsNothing);
    });

    testWidgets('create form shows ingredient and step editors', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async => http.Response('{}', 404));
      await tester.pumpWidget(wrap(const RecipeFormScreen(), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Ingredients'), findsOneWidget);
      expect(find.text('Steps'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Name'), findsOneWidget);
    });

    testWidgets('edit form shows nutrition fields prefilled', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async => http.Response('{}', 404));
      // Edit mode hides the ingredient/step editors, so the form is short and the nutrition
      // section is on-screen; it also exercises prefill from the existing recipe.
      final existing = Recipe.fromJson({..._recipe('5', 'EditMe'), 'calories': 520, 'proteinGrams': '30'});
      await tester.pumpWidget(wrap(RecipeFormScreen(existing: existing), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Nutrition (optional)'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Calories (kcal)'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Protein (g)'), findsOneWidget);
      expect(find.text('520'), findsOneWidget); // calories prefilled
      expect(find.text('30'), findsOneWidget); // protein prefilled
    });

    testWidgets('edit form shows the image URL field prefilled', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async => http.Response('{}', 404));
      final existing = Recipe.fromJson({..._recipe('6', 'WithImage'), 'imagePath': 'http://lan/p.jpg'});
      await tester.pumpWidget(wrap(RecipeFormScreen(existing: existing), auth, mock));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextFormField, 'Image URL'), findsOneWidget);
      expect(find.text('http://lan/p.jpg'), findsOneWidget);
    });

    testWidgets('detail renders the recipe image when set', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes/7') {
          return http.Response(
            _env({
              'recipe': {..._recipe('7', 'Photo'), 'imagePath': 'http://lan/x.jpg'},
              'ingredients': const [],
              'steps': const [],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const RecipeDetailScreen(recipeId: '7'), auth, mock));
      await tester.pumpAndSettle();
      expect(find.byType(RemoteImage), findsOneWidget);
    });

    testWidgets('detail shows nutrition macros when present', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes/9') {
          return http.Response(
            _env({
              'recipe': {
                ..._recipe('9', 'Stew'),
                'calories': 520,
                'proteinGrams': '30.00',
                'carbsGrams': '45.50',
                'fatGrams': '12.00',
              },
              'ingredients': const [],
              'steps': const [],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const RecipeDetailScreen(recipeId: '9'), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Nutrition'), findsOneWidget);
      expect(find.text('520 kcal'), findsOneWidget);
      expect(find.text('30 g protein'), findsOneWidget);
      expect(find.text('45.5 g carbs'), findsOneWidget);
    });

    testWidgets('detail renders ingredients and ordered steps', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes/9') {
          return http.Response(
            _env({
              'recipe': _recipe('9', 'Stew'),
              'ingredients': [
                {'id': 'i1', 'name': 'beef', 'quantity': '500', 'unit': 'g', 'sortOrder': 1},
              ],
              'steps': [
                {'id': 's1', 'stepNumber': 1, 'instruction': 'Brown the beef'},
              ],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(const RecipeDetailScreen(recipeId: '9'), auth, mock));
      await tester.pumpAndSettle();
      expect(find.text('Stew'), findsWidgets);
      expect(find.text('500 g beef'), findsOneWidget);
      expect(find.text('Brown the beef'), findsOneWidget);
    });

    testWidgets('wide window opens the recipe in a side-by-side detail pane', (tester) async {
      final auth = await authWith('supervising_user');
      final mock = MockClient((req) async {
        if (req.url.path == '/api/v1/households/h/recipes') {
          return http.Response(_env({'recipes': [_recipe('1', 'Pancakes')]}), 200);
        }
        if (req.url.path == '/api/v1/households/h/recipes/1') {
          return http.Response(
            _env({
              'recipe': _recipe('1', 'Pancakes'),
              'ingredients': [
                {'id': 'i1', 'name': 'flour', 'quantity': '200', 'unit': 'g', 'sortOrder': 1},
              ],
              'steps': [
                {'id': 's1', 'stepNumber': 1, 'instruction': 'Mix it'},
              ],
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });
      await tester.pumpWidget(wrap(
        const MediaQuery(
          data: MediaQueryData(size: Size(1000, 800)),
          child: RecipeListScreen(),
        ),
        auth,
        mock,
      ));
      await tester.pumpAndSettle();
      // Before selection the detail pane shows the empty-state placeholder.
      expect(find.text('Nothing selected'), findsOneWidget);
      // Selecting a recipe fills the detail pane in place (no full-screen push).
      await tester.tap(find.text('Pancakes'));
      await tester.pumpAndSettle();
      expect(find.text('200 g flour'), findsOneWidget);
      expect(find.text('Mix it'), findsOneWidget);
      // The list pane is still present, so the name shows in both list and pane header.
      expect(find.text('Pancakes'), findsWidgets);
    });
  });
}
