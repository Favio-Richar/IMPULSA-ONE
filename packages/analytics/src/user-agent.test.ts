import { describe, expect, it } from "vitest";
import { detectDeviceType, isBotUserAgent } from "./user-agent.js";

const CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const SAFARI_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("isBotUserAgent", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36",
    "curl/8.9.1",
    "python-requests/2.32.3",
    "Go-http-client/2.0",
    "",
  ])("descarta %s", (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(true);
  });

  it("descarta un user-agent ausente", () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
  });

  it.each([CHROME_DESKTOP, SAFARI_IPHONE, CHROME_ANDROID, SAFARI_IPAD])("acepta un navegador real: %s", (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(false);
  });
});

describe("detectDeviceType", () => {
  it("clasifica por categoría gruesa", () => {
    expect(detectDeviceType(CHROME_DESKTOP)).toBe("desktop");
    expect(detectDeviceType(SAFARI_IPHONE)).toBe("mobile");
    expect(detectDeviceType(CHROME_ANDROID)).toBe("mobile");
    expect(detectDeviceType(SAFARI_IPAD)).toBe("tablet");
    expect(detectDeviceType(ANDROID_TABLET)).toBe("tablet");
  });
});
