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
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  currentUserResponse,
  loginResponse,
  registerResponse,
  sessionResponse,
  twoFactorSetupResponse,
} from "@impulza/contracts";
import type { Request, Response } from "express";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiRateLimited,
  ApiSessionScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
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

@ApiTags("auth")
@Controller("auth")
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSeconds: 60, keyPrefix: "auth-register" })
  @UsePipes(new ZodValidationPipe(registerSchema))
  @ApiOperation({
    summary: "Registrar una cuenta",
    description:
      "Crea la cuenta y envía el correo de verificación. No abre sesión: hay que verificar el correo y después iniciar sesión.",
  })
  @ApiZodBody(registerSchema)
  @ApiZodResponse(201, registerResponse, "Cuenta creada. El correo de verificación va en camino.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({
    status: 409,
    description: "Ya existe una cuenta con ese correo.",
  })
  @ApiRateLimited(5, 60)
  async register(@Body() body: RegisterDto): Promise<{ userId: string }> {
    return this.authService.register(body.email, body.password);
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-verify-email" })
  @UsePipes(new ZodValidationPipe(verifyEmailSchema))
  @ApiOperation({
    summary: "Verificar el correo con el token del enlace",
    description: "El token es de un solo uso y caduca a las 24 horas.",
  })
  @ApiZodBody(verifyEmailSchema)
  @ApiResponse({ status: 204, description: "Correo verificado." })
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 401, description: "El enlace es inválido, ya se usó o expiró." })
  @ApiRateLimited(10, 60)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.authService.verifyEmail(body.token);
  }

  @Post("login")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-login" })
  @UsePipes(new ZodValidationPipe(loginSchema))
  @ApiOperation({
    summary: "Iniciar sesión",
    description:
      "Emite la cookie de sesión `HttpOnly`. La sesión **no** viaja en el cuerpo: por eso la respuesta solo trae la identidad del usuario.",
  })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(201, loginResponse, "Sesión abierta; la cookie va en `Set-Cookie`.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({
    status: 401,
    description:
      "Credenciales incorrectas. El mensaje es el mismo exista o no la cuenta, para no habilitar enumeración de usuarios.",
  })
  @ApiResponse({
    status: 403,
    description: "Cuenta bloqueada temporalmente por intentos fallidos, o falta la cabecera anti-CSRF.",
  })
  @ApiRateLimited(10, 60)
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
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Cerrar la sesión actual",
    description: "Elimina la sesión del servidor y limpia la cookie. Las demás sesiones siguen vivas.",
  })
  @ApiResponse({ status: 204, description: "Sesión cerrada." })
  @ApiSessionScopedErrors()
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
  @ApiOperation({
    summary: "Pedir el enlace de recuperación de contraseña",
    description:
      "Responde 204 exista o no la cuenta: distinguir los dos casos convertiría este endpoint en un detector de correos registrados.",
  })
  @ApiZodBody(forgotPasswordSchema)
  @ApiResponse({ status: 204, description: "Si la cuenta existe, el correo va en camino." })
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiRateLimited(5, 60)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(body.email);
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "auth-reset-password" })
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  @ApiOperation({
    summary: "Fijar una contraseña nueva con el token del enlace",
    description: "El token es de un solo uso. Cierra todas las sesiones abiertas de la cuenta.",
  })
  @ApiZodBody(resetPasswordSchema)
  @ApiResponse({ status: 204, description: "Contraseña cambiada." })
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 401, description: "El enlace es inválido, ya se usó o expiró." })
  @ApiRateLimited(10, 60)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(body.token, body.password);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Usuario de la sesión actual",
    description: "Nunca devuelve hash, secreto 2FA ni token: lo que no aparece es parte del contrato.",
  })
  @ApiZodResponse(200, currentUserResponse, "Identidad del usuario autenticado.")
  @ApiSessionScopedErrors()
  me(@CurrentUser() user: User): { id: string; email: string; emailVerifiedAt: Date | null } {
    return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt };
  }

  @Get("sessions")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Listar las sesiones abiertas de la cuenta",
    description:
      "De la más reciente a la más antigua. `current` marca la sesión desde la que se hizo esta petición, para que el panel no la cierre por error.",
  })
  @ApiZodArrayResponse(200, sessionResponse, "Sesiones activas del usuario.")
  @ApiSessionScopedErrors()
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
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Cerrar una sesión concreta",
    description:
      "Se puede cerrar la propia sesión en curso. Una sesión de otra cuenta responde 401 y no 404: no se confirma que exista.",
  })
  @ApiUuidParam("id", "Sesión a cerrar, de las que devuelve `GET /auth/sessions`.")
  @ApiResponse({ status: 204, description: "Sesión cerrada." })
  @ApiSessionScopedErrors()
  async revokeSession(@CurrentUser() user: User, @Param("id") sessionId: string): Promise<void> {
    await this.authService.revokeSession(user.id, sessionId);
  }

  @Post("2fa/setup")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Generar el secreto para el segundo factor",
    description:
      "Único momento en que el secreto sale del servidor en claro — el usuario tiene que poder cargarlo en su aplicación de autenticación. Después queda cifrado y no vuelve a exponerse. **No** activa el 2FA: eso lo hace `POST /auth/2fa/enable` con un código válido.",
  })
  @ApiZodResponse(201, twoFactorSetupResponse, "Secreto y URL `otpauth://` para el código QR.")
  @ApiSessionScopedErrors()
  async setupTwoFactor(@CurrentUser() user: User) {
    return this.authService.setupTwoFactor(user);
  }

  @Post("2fa/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Activar el segundo factor",
    description: "Exige un código válido del secreto generado en `POST /auth/2fa/setup`.",
  })
  @ApiZodBody(twoFactorCodeSchema)
  @ApiResponse({ status: 204, description: "Segundo factor activado." })
  @ApiResponse({
    status: 401,
    description: "Código incorrecto, o la cuenta no pasó antes por `/auth/2fa/setup`.",
  })
  @ApiSessionScopedErrors()
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
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Desactivar el segundo factor",
    description: "Exige un código válido: desactivarlo es una acción sensible, no un simple toggle.",
  })
  @ApiZodBody(twoFactorCodeSchema)
  @ApiResponse({ status: 204, description: "Segundo factor desactivado y secreto borrado." })
  @ApiResponse({ status: 401, description: "Código incorrecto, o 2FA no estaba configurado." })
  @ApiSessionScopedErrors()
  async disableTwoFactor(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeDto,
  ): Promise<void> {
    await this.authService.disableTwoFactor(user, body.code);
  }
}
