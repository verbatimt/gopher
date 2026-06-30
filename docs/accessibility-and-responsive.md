# Accessibility & Responsiveness (EP-0039)

A dedicated quality pass over the Flutter client for responsive layouts, accessibility, and
cross-platform parity (Windows / Android / Web), per `context.md` §6.

## Responsive layout

The app uses the **EP-0006 adaptive shell** (`screens/shell/app_shell.dart`) at MD3 breakpoints
(`core/constants.dart`):

| Width | Navigation |
|---|---|
| `< 600` (compact) | bottom `NavigationBar` |
| `600–999` (medium) | `NavigationRail` (collapsed, icon + label) |
| `≥ 1000` (expanded) | `NavigationRail` **extended** (icon + text + app title) |

So **Windows/Web** (typically ≥ 600 wide) get the rail/sidebar; **Android** gets the bottom
bar. Feature screens use scrollable `ListView`s and `SingleChildScrollView` dialogs so content
reflows without overflow as width/DPI change; finance grids render as list rows (not fixed-width
`DataTable`s) to stay usable at compact width and 150% DPI.

The list/detail features (recipes, inventory, vitals, tasks) additionally adopt the MD3
**list-detail** canonical layout (`widgets/list_detail_layout.dart`): single-pane with
full-screen detail routes below `expandedMinWidth` (840), and two side-by-side panes at/above
it. Breakpoints are named in `core/constants.dart` per the MD3 window size classes.

Covered by tests: `test/app_shell_test.dart` (compact vs expanded), `test/accessibility_test.dart`
(rail extended only at expanded width; large text scale), `test/list_detail_layout_test.dart`
(pane switch at the breakpoint), and per-feature `*_test.dart` wide-window two-pane cases.

## Accessibility

- **Semantic labels:** MD3 components (`NavigationBar`/`Rail`, `ListTile`, form fields,
  `Switch`, `Checkbox`) carry built-in semantics. Icon-only buttons have **`tooltip:`** labels
  (which double as screen-reader labels) — delete actions, week navigation, etc. The custom
  net-worth `CustomPaint` chart is wrapped in **`Semantics`** describing the trend and range
  (otherwise it would be invisible to screen readers).
- **Contrast:** colors come from the MD3 `ColorScheme.fromSeed` container/on-container token
  pairs (`core/theme/app_theme.dart`), which are designed to meet WCAG-AA for text and key
  controls in both light and dark themes.
- **Text scaling:** screens use `MediaQuery`-driven text scaling; scrollable bodies/dialogs
  absorb growth without breaking layout (verified at 2.5× in tests).
- **Keyboard (desktop/web):** Flutter's default focus traversal applies to the MD3 form
  fields/buttons/dialogs; dialogs respond to Enter (default action) / Escape (dismiss). The
  finance create/edit dialogs (EP-0035) are fully keyboard-operable.
- **Touch targets:** MD3 buttons/list tiles meet the 48dp minimum by default.

## Cross-platform parity

Feature behavior is identical across targets (one Flutter codebase, same providers/services).
Platform-specific affordances:

- **Web:** same-origin LAN proxy; the httpOnly refresh cookie is first-party (EP-0011/0041).
- **Android/Windows (native):** `flutter_secure_storage` for the access token.
- **Windows/Web desktop:** the rail/sidebar + keyboard navigation; standard window chrome.

## Per-screen checklist (applied)

For each primary screen — auth, dashboard, calendar, tasks, medications, rewards, meals,
inventory, vitals, finance (forecasting) — verify: adapts at compact/medium/expanded; no
overflow at 150% DPI; icon controls labeled; contrast from MD3 tokens; readable at large text
scale; reachable by keyboard on desktop/web.

## Known gaps / manual verification

- **Live screen-reader runs** (TalkBack on Android, NVDA on Windows, VoiceOver on Web) and
  **Windows DPI 100%/150%** are manual checks performed on-device; the automated suite covers
  semantics labels, breakpoint adaptation, and text-scale resilience as regression guards.
- **Golden image tests** are intentionally omitted (brittle across platforms/render backends);
  breakpoint + semantics widget tests serve as the CI regression guard instead.
