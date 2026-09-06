import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";
export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

const CANONICAL_APP_ORIGIN = (
  import.meta.env.VITE_CANONICAL_APP_URL || "https://sports101mailring.vercel.app"
).replace(/\/$/, "");

export const CANONICAL_OAUTH_CALLBACK = `${CANONICAL_APP_ORIGIN}/api/oauth/callback`;

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// Preview deployments are deliberately moved to the canonical Production app
// before OAuth starts. This ensures the state cookie is created on the same
// host that receives the callback, while the authorization request always uses
// the redirect URI registered in Manus.
export const startLogin = () => {
  const canonicalOrigin = CANONICAL_APP_ORIGIN;

  if (window.location.origin !== canonicalOrigin) {
    window.location.assign(`${canonicalOrigin}/?oauth=1`);
    return;
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const nonce = crypto.randomUUID();

  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({
    redirectUri: CANONICAL_OAUTH_CALLBACK,
    nonce,
  });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", CANONICAL_OAUTH_CALLBACK);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.assign(url.toString());
};
