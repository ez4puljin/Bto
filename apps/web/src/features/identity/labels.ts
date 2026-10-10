import mn from '@tugeel/shared/i18n/mn.json';

export type AuditAction = keyof (typeof mn)['audit']['actions'];
export type AuditEntity = keyof (typeof mn)['audit']['entities'];

export const AUDIT_ENTITIES = Object.keys(mn.audit.entities) as AuditEntity[];

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(mn.audit.actions, value);
}

export function isAuditEntity(value: string): value is AuditEntity {
  return Object.hasOwn(mn.audit.entities, value);
}
