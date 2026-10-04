import { z } from "zod";
import { ASSIGNABLE_ROLES } from "../assignable-roles.js";

export const inviteMemberSchema = z
  .object({
    email: z.email(),
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    customRoleId: z.uuid().optional(),
  })
  .refine((value) => (value.role === undefined) !== (value.customRoleId === undefined), "Indica un rol del sistema o un rol personalizado, no ambos.");

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
