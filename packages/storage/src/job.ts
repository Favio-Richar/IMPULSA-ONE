/** Cola del procesamiento de medios (ADR-006 §4): la API encola al confirmar; el worker genera las
 *  variantes. Separada de la de analítica para que una tanda de fotos no frene la ingesta. */
export const MEDIA_PROCESS_QUEUE = "media-process";

export interface MediaProcessJob {
  assetId: string;
}
