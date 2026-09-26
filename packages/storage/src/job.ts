/** Cola del procesamiento de medios (ADR-006 §4): la API encola al confirmar; el worker genera las
 *  variantes. Separada de la de analítica para que una tanda de fotos no frene la ingesta. */
export const MEDIA_PROCESS_QUEUE = "media-process";

/** Videos (PP6, ADR-007): cola propia con concurrencia 1 — convertir video es CPU pesada y no debe
 *  demorar las fotos que se procesan en la otra cola. */
export const MEDIA_VIDEO_QUEUE = "media-video";

export interface MediaProcessJob {
  assetId: string;
}
