import { z } from "zod";
import { ASSIGNABLE_ROLES } from "../assignable-roles.js";

// Un rol del sistema (`role`) o uno personalizado de la organización (`customRoleId`, F9.6a): exactamente uno de los dos.
export const changeRoleSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    customRoleId: z.uuid().optional(),
  })
  .refine((value) => (value.role === undefined) !== (value.customRoleId === undefined), "Indica un rol del sistema o un rol personalizado, no ambos.");

export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;
