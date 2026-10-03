import { HttpException, HttpStatus } from "@nestjs/common";
import type { PlanLimitKey } from "@impulza/validation";

export const PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED";

const LIMIT_MESSAGES: Record<PlanLimitKey, string> = {
  sites: "Llegaste al máximo de sitios de tu plan.",
  pagesPerSite: "Llegaste al máximo de páginas por sitio de tu plan.",
  forms: "Llegaste al máximo de formularios de tu plan.",
  contacts: "Llegaste al máximo de contactos de tu plan.",
  shortLinks: "Llegaste al máximo de enlaces cortos de tu plan.",
  qrCodes: "Llegaste al máximo de códigos QR de tu plan.",
  members: "Llegaste al máximo de miembros de tu plan.",
  analyticsHistoryDays: "Tu plan no incluye ese período de historial.",
  storageMb: "Llegaste al máximo de almacenamiento de tu plan.",
  emailsPerHour: "Llegaste al máximo de correos por hora de tu plan.",
  aiRequestsPerMonth: "Llegaste al máximo de solicitudes al asistente de IA de este mes en tu plan.",
  abTestsRunning: "Llegaste al máximo de pruebas A/B en curso de tu plan. Termina una para empezar otra.",
  clients: "Llegaste al máximo de clientes de tu plan de agencia. Suelta o archiva uno, o sube de plan, para sumar otro.",
};

/**
 * Límite de plan alcanzado (F4.2). **402 Payment Required** y no 403: el usuario *tiene* permiso
 * para crear el recurso, lo que falta es capacidad en su plan — el panel lo distingue para
 * ofrecer subir de plan en vez de decir "no tienes permiso". `code` es estable para que el cliente
 * decida sin interpretar el mensaje.
 */
export class PlanLimitExceededException extends HttpException {
  constructor(key: PlanLimitKey, max: number, used: number, plan: { code: string; name: string }) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: "Payment Required",
        code: PLAN_LIMIT_REACHED,
        message: LIMIT_MESSAGES[key],
        limit: { key, max, used },
        plan,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
