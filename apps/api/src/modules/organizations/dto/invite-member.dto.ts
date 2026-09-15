import { z } from "zod";
import { ASSIGNABLE_ROLES } from "../assignable-roles.js";

export const inviteMemberSchema = z.object({
  email: z.email(),
  role: z.enum(ASSIGNABLE_ROLES),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
