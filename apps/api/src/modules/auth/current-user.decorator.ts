import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { RequestWithUser } from "../../common/request-with-user.js";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  return request.user;
});
