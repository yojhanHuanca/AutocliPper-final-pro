export const roleWeight = { reader: 0, editor: 1, admin: 2, owner: 3 } as const;
export type Role = keyof typeof roleWeight;
export function permits(role: Role, minimum: Role) {
  return roleWeight[role] >= roleWeight[minimum];
}
