import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/app_notification.dart';
import '../../providers/notification_provider.dart';
import '../../widgets/empty_state.dart';

/// Notification center: history with read/unread styling, mark-all-read, and live appends
/// (the provider listens to the WS `notification.new` event).
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NotificationProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<NotificationProvider>();
    final items = provider.items;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (provider.unreadCount > 0)
            TextButton(
              onPressed: () => context.read<NotificationProvider>().markAllRead(),
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: items.isEmpty
          ? const EmptyState(
              icon: Icons.notifications_none_outlined,
              title: 'No notifications',
              message: 'You are all caught up.',
            )
          : RefreshIndicator(
              onRefresh: () => context.read<NotificationProvider>().load(),
              child: ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) => _NotificationTile(notification: items[index]),
              ),
            ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final AppNotification notification;

  const _NotificationTile({required this.notification});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unread = !notification.isRead;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: unread ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerHighest,
        child: Icon(
          unread ? Icons.notifications_active_outlined : Icons.notifications_none_outlined,
          color: unread ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
          size: 20,
        ),
      ),
      title: Text(
        notification.title,
        style: TextStyle(fontWeight: unread ? FontWeight.w600 : FontWeight.w400),
      ),
      subtitle: notification.body != null ? Text(notification.body!) : null,
      onTap: () => _onTap(context),
    );
  }

  /// Mark read (if unread) and deep-link to the source entity when the notification is
  /// routable; otherwise just mark it read.
  void _onTap(BuildContext context) {
    if (!notification.isRead) {
      context.read<NotificationProvider>().markRead([notification.id]);
    }
    final route = notification.targetRoute;
    if (route != null) context.push(route);
  }
}
