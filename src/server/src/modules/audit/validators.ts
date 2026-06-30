// TypeBox request schemas for the audit read API (EP-0051). All filters are optional; results
// are always paginated + newest-first.

import { t } from 'elysia';

export const auditLogQuery = t.Object({
  actor: t.Optional(t.String({ maxLength: 80 })),
  action: t.Optional(t.String({ maxLength: 80 })),
  entityType: t.Optional(t.String({ maxLength: 80 })),
  entityId: t.Optional(t.String({ maxLength: 80 })),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  page: t.Optional(t.String({ maxLength: 8 })),
});

export const valueChangeQuery = t.Object({
  entityType: t.Optional(t.String({ maxLength: 80 })),
  entityId: t.Optional(t.String({ maxLength: 80 })),
  field: t.Optional(t.String({ maxLength: 80 })),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  page: t.Optional(t.String({ maxLength: 8 })),
});

export const systemLogQuery = t.Object({
  action: t.Optional(t.String({ maxLength: 80 })),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  page: t.Optional(t.String({ maxLength: 8 })),
});
