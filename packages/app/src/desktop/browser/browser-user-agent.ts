// Google and other sign-in providers refuse to serve their sign-in flow to a
// browser that announces itself as an embedded application, and Electron's
// default user agent does exactly that: it carries the app's name and version
// plus `Electron/<version>`. Browser tabs therefore report the plain Chromium
// identity — the app and Electron tokens are dropped, and the Chrome version is
// reduced to the `major.0.0.0` form Chrome itself sends.
const APP_TOKEN_BEFORE_CHROME = /\s+[^\s/]+\/[^\s]+(?=\s+Chrome\/)/u;
const ELECTRON_TOKEN = /\s+Electron\/[\d.]+/u;
const CHROME_VERSION = /Chrome\/(\d+)[\d.]*/u;

export function browserTabUserAgent(runtimeUserAgent: string): string {
  const withoutEmbeddedTokens = runtimeUserAgent
    .replace(ELECTRON_TOKEN, "")
    .replace(APP_TOKEN_BEFORE_CHROME, "");
  return withoutEmbeddedTokens.replace(
    CHROME_VERSION,
    (_match, majorVersion: string) => `Chrome/${majorVersion}.0.0.0`,
  );
}

export const PASEO_BROWSER_TAB_USER_AGENT = browserTabUserAgent(
  typeof navigator === "undefined" ? "" : navigator.userAgent,
);
