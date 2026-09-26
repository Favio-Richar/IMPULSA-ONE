/**
 * User-agents reales de los navegadores internos de las apps desde donde llega la mayoría de las
 * visitas a una página de enlaces (PP7): se abren al tocar el enlace de la biografía. Sirven para
 * probar que el sitio público se ve y que esas visitas **cuentan** (no son bots). Formato tomado de
 * las versiones de 2026 de cada app; cada una se identifica con su propio token.
 */
export const IN_APP_USER_AGENTS = {
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.28.83 (iPhone15,2; iOS 18_5; es_CL; es-CL; scale=3.00; 1179x2556; 758317364; IABMV/1)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.143 Mobile Safari/537.36 Instagram 389.0.0.48.87 Android (35/15; 480dpi; 1080x2340; samsung; SM-S928B; e3q; qcom; es_CL; 758317364)",
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_40.8.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/es Region/CL isDarkMode/0 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; 23117RA68G Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.143 Mobile Safari/537.36 trill_400805 JsSdk/1.0 NetType/4G Channel/googleplay AppName/trill app_version/40.8.5 ByteLocale/es-CL Region/CL AppId/1180 BytedanceWebview/d8a21c6",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/523.0.0.36.107;FBBV/742393918;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/es_LA;FBOP/5;FBRV/745286102]",
  pinterestAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.143 Mobile Safari/537.36 [Pinterest/Android]",
} as const;
