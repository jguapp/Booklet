/**
 * Google/GitHub "Sign in with..." -- the authorization-code flow, server
 * side only (the client never sees a provider token, only ever our own
 * session -- see routes/auth.ts's oauth routes). Each provider is a plain
 * object of the three things routes/auth.ts needs: where to send the
 * browser, how to redeem a code, and how to normalize whatever comes back
 * into one shape.
 */

type OAuthProviderId = "google" | "github";

interface OAuthProfile {
  providerAccountId: string;
  email: string;
  /** Whether the provider itself has verified this address -- if so, safe to trust without our own verification email. */
  emailVerified: boolean;
  name: string | null;
}

interface OAuthProvider {
  configured: boolean;
  scope: string;
  authorizeUrl(params: { redirectUri: string; state: string }): string;
  exchangeCode(params: { code: string; redirectUri: string }): Promise<OAuthProfile>;
}

class OAuthExchangeError extends Error {}

function requireFields<T extends Record<string, unknown>>(obj: T, fields: (keyof T)[], context: string): void {
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new OAuthExchangeError(`${context} response missing "${String(field)}"`);
    }
  }
}

function googleProvider(): OAuthProvider {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return {
    configured: !!clientId && !!clientSecret,
    scope: "openid email profile",
    authorizeUrl({ redirectUri, state }) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId!);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      return url.toString();
    },
    async exchangeCode({ code, redirectUri }) {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new OAuthExchangeError(`Google token exchange failed (${tokenRes.status})`);
      const tokenBody = (await tokenRes.json()) as { access_token?: string };
      requireFields(tokenBody, ["access_token"], "Google token");

      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { authorization: `Bearer ${tokenBody.access_token}` },
      });
      if (!userRes.ok) throw new OAuthExchangeError(`Google userinfo failed (${userRes.status})`);
      const user = (await userRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
      requireFields(user, ["sub", "email"], "Google userinfo");

      return {
        providerAccountId: user.sub!,
        email: user.email!,
        emailVerified: user.email_verified ?? false,
        name: user.name?.trim() || null,
      };
    },
  };
}

function githubProvider(): OAuthProvider {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  return {
    configured: !!clientId && !!clientSecret,
    scope: "read:user user:email",
    authorizeUrl({ redirectUri, state }) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", clientId!);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "read:user user:email");
      url.searchParams.set("state", state);
      return url.toString();
    },
    async exchangeCode({ code, redirectUri }) {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new OAuthExchangeError(`GitHub token exchange failed (${tokenRes.status})`);
      const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (tokenBody.error || !tokenBody.access_token) {
        throw new OAuthExchangeError(`GitHub token exchange failed: ${tokenBody.error ?? "no access_token"}`);
      }

      const headers = { authorization: `Bearer ${tokenBody.access_token}`, accept: "application/vnd.github+json" };
      const userRes = await fetch("https://api.github.com/user", { headers });
      if (!userRes.ok) throw new OAuthExchangeError(`GitHub user failed (${userRes.status})`);
      const user = (await userRes.json()) as { id?: number; name?: string; email?: string | null };
      requireFields(user, ["id"], "GitHub user");

      // GitHub only includes `email` on /user when the user has made one
      // public -- the verified primary address (what we actually want) is a
      // separate call regardless.
      let email = user.email ?? null;
      let emailVerified = false;
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
        const primary = emails.find((e) => e.primary) ?? emails.find((e) => e.verified);
        if (primary) {
          email = primary.email;
          emailVerified = primary.verified;
        }
      }
      if (!email) throw new OAuthExchangeError("GitHub account has no accessible email address");

      return {
        providerAccountId: String(user.id),
        email,
        emailVerified,
        name: user.name?.trim() || null,
      };
    },
  };
}

const PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: googleProvider(),
  github: githubProvider(),
};

export function getOAuthProvider(id: string): OAuthProvider | null {
  if (id !== "google" && id !== "github") return null;
  return PROVIDERS[id];
}
