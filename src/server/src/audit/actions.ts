// Action-string catalog. Every audit call site references a constant from here — never a
// string literal — so action names stay consistent and greppable. Modules append their
// own sections in their EPs.

export const AuditActions = {
  auth: {
    register: 'auth.register',
    login: 'auth.login',
    logout: 'auth.logout',
    tokenRefresh: 'auth.token_refresh',
    passwordReset: 'auth.password_reset',
  },
  household: {
    created: 'household.created',
    settingsUpdated: 'household.settings_updated',
    memberAdded: 'household.member_added',
    memberRoleChanged: 'household.member_role_changed',
    memberDeactivated: 'household.member_deactivated',
    inviteCreated: 'household.invite_created',
    inviteAccepted: 'household.invite_accepted',
    inviteRevoked: 'household.invite_revoked',
  },
} as const;

/** Union of every defined action string (for typing call sites if desired). */
export type AuditAction =
  (typeof AuditActions)[keyof typeof AuditActions][keyof (typeof AuditActions)[keyof typeof AuditActions]];
