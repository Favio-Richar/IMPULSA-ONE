import { z } from "zod";
import { ASSIGNABLE_ROLES } from "../assignable-roles.js";

export const changeRoleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
});

export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;
