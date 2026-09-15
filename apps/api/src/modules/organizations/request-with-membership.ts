import type { Membership, Role } from "@impulza/database";
import type { RequestWithUser } from "../../common/request-with-user.js";

export type MembershipWithRole = Membership & { role: Role };

export interface RequestWithMembership extends RequestWithUser {
  membership: MembershipWithRole;
}
