import type { Request } from "express";
import type { Session, User } from "@impulza/database";

export interface RequestWithUser extends Request {
  user: User;
  session: Session;
}
