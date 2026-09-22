import { describe, expect, it } from "vitest";
import { browserTabUserAgent } from "./browser-user-agent";

const EMBEDDED_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Paseo/0.9.0-beta.2 Chrome/152.0.7977.76 Electron/44.2.0 Safari/537.36";
const CHROME_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

describe("browser tab user agent", () => {
  it("reports plain Chrome instead of the embedded application", () => {
    expect(browserTabUserAgent(EMBEDDED_USER_AGENT)).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });

  it("leaves an already plain Chrome user agent untouched", () => {
    expect(browserTabUserAgent(CHROME_USER_AGENT)).toBe(CHROME_USER_AGENT);
  });
});
