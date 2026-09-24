// Cabeceras con que `apps/web` le pasa a `apps/api` los datos del visitante real (F3.6). Sin esto,
// para la API todo el tráfico público venía de una sola IP y un solo user-agent (los del servidor
// de `apps/web`): el rate limit por IP era un único balde compartido por toda la plataforma, el
// visitante anonimizado era el mismo para todos y la exclusión de bots no podía funcionar.
//
// La API solo les cree si viene también `secret` con el secreto compartido (`INTERNAL_PROXY_SECRET`).
// Si no, cualquiera podría mandarse una IP falsa para saltarse el rate limit.

export const VISITOR_PROXY_HEADERS = {
  secret: "x-impulza-proxy-secret",
  ip: "x-impulza-visitor-ip",
  userAgent: "x-impulza-visitor-ua",
  country: "x-impulza-visitor-country",
  city: "x-impulza-visitor-city",
} as const;
