import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import { forgotPasswordSchema, type ForgotPasswordDto } from "./dto/forgot-password.dto.js";
import { loginSchema, type LoginDto } from "./dto/login.dto.js";
import { registerSchema, type RegisterDto } from "./dto/register.dto.js";
import { resetPasswordSchema, type ResetPasswordDto } from "./dto/reset-password.dto.js";
import { twoFactorCodeSchema, type TwoFactorCodeDto } from "./dto/two-factor-code.dto.js";
import { verifyEmailSchema, type VerifyEmailDto } from "./dto/verify-email.dto.js";
import { SessionAuthGuard } from "./guards/session-auth.guard.js";
import { clearSessionCookie, setSessionCookie } from "./session-cookie.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import type { User } from "@impulza/database";

@Controller("auth")
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSeconds: 60, keyPrefix: "auth-register" })
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(@Body() body: RegisterDto): Promise<{ userId: string }> {
    return this.authService.register(body.email, body.password);
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-verify-email" })
  @UsePipes(new ZodValidationPipe(verifyEmailSchema))
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.authService.verifyEmail(body.token);
  }

  @Post("login")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-login" })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { id: string; email: string } }> {
    const { session, user } = await this.authService.login(body.email, body.password, {
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });

    setSessionCookie(res, session.id);

    return { user: { id: user.id, email: user.email } };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req.session.id);
    clearSessionCookie(res);
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSeconds: 60, keyPrefix: "auth-forgot-password" })
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(body.email);
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-reset-password" })
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(body.token, body.password);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: User): { id: string; email: string; emailVerifiedAt: Date | null } {
    return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt };
  }

  @Get("sessions")
  @UseGuards(SessionAuthGuard)
  async listSessions(@CurrentUser() user: User, @Req() req: RequestWithUser) {
    const sessions = await this.authService.listSessions(user.id);
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
      current: session.id === req.session.id,
    }));
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async revokeSession(@CurrentUser() user: User, @Param("id") sessionId: string): Promise<void> {
    await this.authService.revokeSession(user.id, sessionId);
  }

  @Post("2fa/setup")
  @UseGuards(SessionAuthGuard)
  async setupTwoFactor(@CurrentUser() user: User) {
    return this.authService.setupTwoFactor(user);
  }

  @Post("2fa/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async enableTwoFactor(
    @CurrentUser() user: User,
    // Pipe a nivel de parámetro, no de método: un @UsePipes de método se aplica a TODOS los
    // parámetros decorados del handler, incluido @CurrentUser() — validarlo contra el schema
    // del body lo rompería (el user no tiene un campo "code").
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeDto,
  ): Promise<void> {
    await this.authService.enableTwoFactor(user, body.code);
  }

  @Post("2fa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async disableTwoFactor(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeDto,
  ): Promise<void> {
    await this.authService.disableTwoFactor(user, body.code);
  }
}
