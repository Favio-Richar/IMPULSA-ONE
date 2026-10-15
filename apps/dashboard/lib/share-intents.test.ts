import { describe, expect, it } from "vitest";
import { shareIntents } from "./share-intents";

describe("shareIntents", () => {
  const url = "https://impulza.one/cafe-aroma?ref=panel&x=1";
  const text = "Te comparto mi página: Café & Aroma";
  const intents = shareIntents(url, text);

  it("ofrece WhatsApp, Facebook, X, Threads, Pinterest, LinkedIn y correo, en ese orden", () => {
    expect(intents.map((intent) => intent.id)).toEqual(["whatsapp", "facebook", "x", "threads", "pinterest", "linkedin", "email"]);
  });

  it("usa los intents públicos de cada red, siempre por https (salvo el correo)", () => {
    const byId = Object.fromEntries(intents.map((intent) => [intent.id, new URL(intent.href)]));
    expect(byId.whatsapp!.origin).toBe("https://wa.me");
    expect(byId.facebook!.href.startsWith("https://www.facebook.com/sharer/sharer.php?")).toBe(true);
    expect(byId.x!.href.startsWith("https://twitter.com/intent/tweet?")).toBe(true);
    expect(byId.threads!.href.startsWith("https://www.threads.net/intent/post?")).toBe(true);
    expect(byId.pinterest!.href.startsWith("https://pinterest.com/pin/create/button/?")).toBe(true);
    expect(byId.linkedin!.href.startsWith("https://www.linkedin.com/sharing/share-offsite/?")).toBe(true);
    expect(byId.email!.protocol).toBe("mailto:");
  });

  it("codifica la URL y el texto: los & y ? de la página no rompen los parámetros de la red", () => {
    const byId = Object.fromEntries(intents.map((intent) => [intent.id, new URL(intent.href)]));
    expect(byId.facebook!.searchParams.get("u")).toBe(url);
    expect(byId.x!.searchParams.get("url")).toBe(url);
    expect(byId.x!.searchParams.get("text")).toBe(text);
    expect(byId.whatsapp!.searchParams.get("text")).toBe(`${text} ${url}`);
    expect(byId.pinterest!.searchParams.get("url")).toBe(url);
    expect(byId.linkedin!.searchParams.get("url")).toBe(url);
  });
});
