import { describe, expect, it } from "vitest";
import { brandfetchLogos, hasBrandDomain } from "./brandfetch";

/*
  The real-logo wiring, with no network: the hook builds the app's own Brandfetch Logo CDN URLs
  (src/core/brand/logo-url.ts) for mapped companies, and null for the rest. No ID, no hook.
*/
describe("brandfetchLogos", () => {
  it("returns no hook without a client id, so the stand-ins stay", () => {
    expect(brandfetchLogos("")).toBeUndefined();
  });

  it("builds the icon URL for a mapped company at the tile size", () => {
    const logos = brandfetchLogos("CID");
    expect(logos?.tile("Discord")).toBe(
      "https://cdn.brandfetch.io/domain/discord.com/w/128/h/128/fallback/404/type/icon?c=CID",
    );
    expect(logos?.cover("Discord")).toBe(
      "https://cdn.brandfetch.io/domain/discord.com/w/256/h/256/fallback/404/type/icon?c=CID",
    );
  });

  it("maps the symbol and wordmark themes: white logo is light, black is dark", () => {
    const logos = brandfetchLogos("CID");
    expect(logos?.symbol("Canva", "white")).toBe(
      "https://cdn.brandfetch.io/domain/canva.com/w/512/h/512/theme/light/fallback/404/type/symbol?c=CID",
    );
    expect(logos?.wordmark("Canva", "black")).toBe(
      "https://cdn.brandfetch.io/domain/canva.com/h/72/theme/dark/fallback/404/type/logo?c=CID",
    );
  });

  it("has no URL for an unmapped company, so it falls back to a monogram", () => {
    const logos = brandfetchLogos("CID");
    expect(logos?.tile("Phoenix")).toBeNull();
    expect(logos?.symbol("Axion", "white")).toBeNull();
  });

  it("escapes the client id into the query string", () => {
    expect(brandfetchLogos("a b&c")?.tile("Spotify")).toBe(
      "https://cdn.brandfetch.io/domain/spotify.com/w/128/h/128/fallback/404/type/icon?c=a%20b%26c",
    );
  });
});

describe("hasBrandDomain", () => {
  it("is true for a company with a demo domain", () => {
    expect(hasBrandDomain("Canva")).toBe(true);
    expect(hasBrandDomain("Linear")).toBe(true);
  });

  it("is false for the deliberately unmapped companies", () => {
    expect(hasBrandDomain("Axion")).toBe(false);
    expect(hasBrandDomain("Phoenix")).toBe(false);
    expect(hasBrandDomain("Thermal Works")).toBe(false);
  });
});
