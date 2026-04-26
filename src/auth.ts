import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, NextFunction, Request, Response } from "express";

import { prisma } from "@/lib/prisma";
import { HttpError } from "@/backend/errors";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_PROVIDER = "google";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_CACHE_MAX_AGE_MS = 30 * 1000;
const OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 10;
const SESSION_HANDOFF_MAX_AGE_MS = 60 * 1000;

export const SESSION_COOKIE_NAME = "qaryz_session";
const OAUTH_STATE_COOKIE_NAME = "qaryz_oauth_state";
const OAUTH_VERIFIER_COOKIE_NAME = "qaryz_oauth_verifier";
const OAUTH_RETURN_TO_COOKIE_NAME = "qaryz_oauth_return_to";

export type AuthenticatedUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

type CachedSessionUser = {
  user: AuthenticatedUser;
  sessionExpires: Date;
  cachedUntil: number;
};

type SessionHandoff = {
  sessionToken: string;
  sessionExpires: Date;
  expiresAt: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
};

const sessionUserCache = new Map<string, CachedSessionUser>();
const sessionHandoffCache = new Map<string, SessionHandoff>();

function parseCookieHeader(header: string | undefined) {
  const cookies = new Map<string, string>();

  for (const part of header?.split(";") ?? []) {
    const [rawName, ...rawValue] = part.trim().split("=");

    if (!rawName || !rawValue.length) {
      continue;
    }

    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

function getCookie(request: Request, name: string) {
  const cookies = parseCookieHeader(request.headers.cookie);
  return cookies.get(name) ?? null;
}

function getSessionToken(request: Request) {
  return getCookie(request, SESSION_COOKIE_NAME);
}

function getCachedSessionUser(sessionToken: string) {
  const cached = sessionUserCache.get(sessionToken);

  if (!cached) {
    return null;
  }

  const now = Date.now();

  if (cached.cachedUntil <= now || cached.sessionExpires.getTime() <= now) {
    sessionUserCache.delete(sessionToken);
    return null;
  }

  return cached.user;
}

function cacheSessionUser(sessionToken: string, user: AuthenticatedUser, sessionExpires: Date) {
  sessionUserCache.set(sessionToken, {
    user,
    sessionExpires,
    cachedUntil: Math.min(Date.now() + SESSION_CACHE_MAX_AGE_MS, sessionExpires.getTime())
  });
}

function getCookieDomain() {
  return process.env.COOKIE_DOMAIN || undefined;
}

function shouldUseSecureCookies() {
  if (process.env.COOKIE_SECURE === "true") {
    return true;
  }

  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function getBaseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    domain: getCookieDomain()
  };
}

function setTemporaryCookie(response: Response, name: string, value: string) {
  response.cookie(name, value, {
    ...getBaseCookieOptions(),
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS * 1000
  });
}

function clearAuthCookie(response: Response, name: string) {
  response.clearCookie(name, getBaseCookieOptions());
}

function clearOAuthCookies(response: Response) {
  clearAuthCookie(response, OAUTH_STATE_COOKIE_NAME);
  clearAuthCookie(response, OAUTH_VERIFIER_COOKIE_NAME);
  clearAuthCookie(response, OAUTH_RETURN_TO_COOKIE_NAME);
}

function setSessionCookie(response: Response, sessionToken: string, expires: Date) {
  response.cookie(SESSION_COOKIE_NAME, sessionToken, {
    ...getBaseCookieOptions(),
    expires,
    maxAge: SESSION_MAX_AGE_SECONDS * 1000
  });
}

function clearSessionCookie(response: Response) {
  clearAuthCookie(response, SESSION_COOKIE_NAME);
}

function base64Url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function createRandomToken(byteLength = 32) {
  return base64Url(randomBytes(byteLength));
}

function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function cleanupExpiredSessionHandoffs() {
  const now = Date.now();

  for (const [code, handoff] of sessionHandoffCache) {
    if (handoff.expiresAt <= now) {
      sessionHandoffCache.delete(code);
    }
  }
}

function createSessionHandoff(sessionToken: string, sessionExpires: Date) {
  cleanupExpiredSessionHandoffs();

  const code = createRandomToken();
  sessionHandoffCache.set(code, {
    sessionToken,
    sessionExpires,
    expiresAt: Date.now() + SESSION_HANDOFF_MAX_AGE_MS
  });

  return code;
}

function consumeSessionHandoff(code: string) {
  const handoff = sessionHandoffCache.get(code);
  sessionHandoffCache.delete(code);

  if (!handoff || handoff.expiresAt <= Date.now()) {
    return null;
  }

  return handoff;
}

function getFirstFrontendOrigin() {
  return (process.env.FRONTEND_ORIGIN ?? "https://qaryz-fe.vercel.app")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
}

function getBackendPublicOrigin(request: Request) {
  const configured =
    process.env.BACKEND_PUBLIC_ORIGIN ?? process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? process.env.BACKEND_URL;

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const forwardedProto = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = request.get("host") ?? `localhost:${process.env.PORT ?? process.env.BACKEND_PORT ?? 4000}`;

  return `${protocol}://${host}`;
}

function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    throw new HttpError(500, "Google OAuth не настроен на сервере");
  }

  return { clientId, clientSecret };
}

function getGoogleRedirectUri(request: Request) {
  return new URL("/auth/google/callback", getBackendPublicOrigin(request)).toString();
}

function redirectToFrontend(response: Response, path = "/") {
  response.redirect(new URL(path, getFirstFrontendOrigin()).toString());
}

function normalizeReturnTo(value: string | null | undefined) {
  if (!value) {
    return "/";
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 2048 || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  try {
    const frontendOrigin = getFirstFrontendOrigin();
    const url = new URL(trimmed, frontendOrigin);

    if (url.origin !== frontendOrigin) {
      return "/";
    }

    const path = `${url.pathname}${url.search}${url.hash}`;

    return path.startsWith("/login") || path.startsWith("/auth/complete") ? "/" : path;
  } catch {
    return "/";
  }
}

function getAuthCompletePath(code: string, returnTo: string) {
  const url = new URL("/auth/complete", getFirstFrontendOrigin());
  url.searchParams.set("code", code);

  if (returnTo !== "/") {
    url.searchParams.set("returnTo", returnTo);
  }

  return `${url.pathname}${url.search}`;
}

function redirectToLogin(response: Response, error: string, returnTo = "/") {
  const url = new URL("/login", getFirstFrontendOrigin());
  url.searchParams.set("error", error);

  if (returnTo !== "/") {
    url.searchParams.set("returnTo", returnTo);
  }

  response.redirect(url.toString());
}

function getQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

async function exchangeGoogleCode(
  request: Request,
  code: string,
  verifier: string
): Promise<GoogleTokenResponse & { access_token: string }> {
  const { clientId, clientSecret } = getGoogleCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGoogleRedirectUri(request),
    grant_type: "authorization_code",
    code_verifier: verifier
  });

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokens.access_token) {
    throw new HttpError(401, tokens.error_description ?? tokens.error ?? "Google OAuth token exchange failed");
  }

  return {
    ...tokens,
    access_token: tokens.access_token
  };
}

async function fetchGoogleUserInfo(accessToken: string) {
  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const profile = (await userInfoResponse.json()) as GoogleUserInfo;

  if (!userInfoResponse.ok || !profile.sub || !profile.email) {
    throw new HttpError(401, "Не удалось получить профиль Google");
  }

  return profile;
}

function getAccountTokenData(tokens: GoogleTokenResponse) {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + Number(tokens.expires_in) : undefined,
    token_type: tokens.token_type,
    scope: tokens.scope,
    id_token: tokens.id_token
  };
}

async function findOrCreateGoogleUser(profile: GoogleUserInfo, tokens: GoogleTokenResponse) {
  const providerAccountId = profile.sub;
  const email = profile.email?.toLowerCase();

  if (!providerAccountId || !email) {
    throw new HttpError(401, "Google не вернул обязательные данные профиля");
  }

  const accountWhere = {
    provider_providerAccountId: {
      provider: GOOGLE_PROVIDER,
      providerAccountId
    }
  };
  const existingAccount = await prisma.account.findUnique({
    where: accountWhere,
    include: {
      user: true
    }
  });

  if (existingAccount) {
    await prisma.account.update({
      where: accountWhere,
      data: getAccountTokenData(tokens)
    });

    return prisma.user.update({
      where: {
        id: existingAccount.userId
      },
      data: {
        name: profile.name ?? existingAccount.user.name,
        email,
        emailVerified: profile.email_verified ? new Date() : existingAccount.user.emailVerified,
        image: profile.picture ?? existingAccount.user.image
      }
    });
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email
    }
  });
  const user =
    existingUser ??
    (await prisma.user.create({
      data: {
        name: profile.name ?? null,
        email,
        emailVerified: profile.email_verified ? new Date() : null,
        image: profile.picture ?? null
      }
    }));

  if (existingUser) {
    await prisma.user.update({
      where: {
        id: existingUser.id
      },
      data: {
        name: profile.name ?? existingUser.name,
        emailVerified: profile.email_verified ? new Date() : existingUser.emailVerified,
        image: profile.picture ?? existingUser.image
      }
    });
  }

  await prisma.account.create({
    data: {
      userId: user.id,
      type: "oauth",
      provider: GOOGLE_PROVIDER,
      providerAccountId,
      ...getAccountTokenData(tokens)
    }
  });

  return user;
}

async function createSession(userId: string) {
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await prisma.session.create({
    data: {
      sessionToken: createRandomToken(),
      userId,
      expires
    }
  });

  await prisma.session.deleteMany({
    where: {
      userId,
      expires: {
        lt: new Date()
      }
    }
  });

  return session;
}

export async function redirectToGoogle(request: Request, response: Response) {
  const { clientId } = getGoogleCredentials();
  const state = createRandomToken();
  const verifier = createRandomToken(64);
  const returnTo = normalizeReturnTo(getQueryValue(request.query.returnTo));
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", getGoogleRedirectUri(request));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", createCodeChallenge(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  setTemporaryCookie(response, OAUTH_STATE_COOKIE_NAME, state);
  setTemporaryCookie(response, OAUTH_VERIFIER_COOKIE_NAME, verifier);
  setTemporaryCookie(response, OAUTH_RETURN_TO_COOKIE_NAME, returnTo);

  response.redirect(authorizationUrl.toString());
}

export async function handleGoogleCallback(request: Request, response: Response) {
  const returnTo = normalizeReturnTo(getCookie(request, OAUTH_RETURN_TO_COOKIE_NAME));

  if (getQueryValue(request.query.error)) {
    clearOAuthCookies(response);
    redirectToLogin(response, "google", returnTo);
    return;
  }

  const code = getQueryValue(request.query.code);
  const state = getQueryValue(request.query.state);
  const expectedState = getCookie(request, OAUTH_STATE_COOKIE_NAME);
  const verifier = getCookie(request, OAUTH_VERIFIER_COOKIE_NAME);

  clearOAuthCookies(response);

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    redirectToLogin(response, "state", returnTo);
    return;
  }

  const tokens = await exchangeGoogleCode(request, code, verifier);
  const profile = await fetchGoogleUserInfo(tokens.access_token);
  const user = await findOrCreateGoogleUser(profile, tokens);
  const session = await createSession(user.id);

  cacheSessionUser(session.sessionToken, user, session.expires);
  setSessionCookie(response, session.sessionToken, session.expires);
  redirectToFrontend(response, getAuthCompletePath(createSessionHandoff(session.sessionToken, session.expires), returnTo));
}

export async function handleSessionExchange(request: Request, response: Response) {
  const body = request.body as { code?: unknown } | undefined;
  const code = typeof body?.code === "string" ? body.code : "";
  const handoff = consumeSessionHandoff(code);

  if (!handoff) {
    throw new HttpError(401, "Сессия входа истекла. Попробуйте войти снова.");
  }

  response.json({
    sessionToken: handoff.sessionToken,
    expires: handoff.sessionExpires.toISOString(),
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function getCurrentUser(request: Request, response: Response) {
  const user = getAuthenticatedUser(request);
  response.json(user);
}

export async function logout(request: Request, response: Response) {
  const sessionToken = getSessionToken(request);

  if (sessionToken) {
    await prisma.session.deleteMany({
      where: {
        sessionToken
      }
    });
    sessionUserCache.delete(sessionToken);
  }

  clearSessionCookie(response);

  response.json({
    ok: true
  });
}

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const sessionToken = getSessionToken(request);

    if (!sessionToken) {
      throw new HttpError(401, "Требуется вход в аккаунт");
    }

    const cachedUser = getCachedSessionUser(sessionToken);

    if (cachedUser) {
      (request as AuthenticatedRequest).user = cachedUser;
      next();
      return;
    }

    const session = await prisma.session.findUnique({
      where: {
        sessionToken
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true
          }
        }
      }
    });

    if (!session || session.expires <= new Date()) {
      if (sessionToken) {
        await prisma.session.deleteMany({
          where: {
            sessionToken
          }
        });
        sessionUserCache.delete(sessionToken);
      }

      throw new HttpError(401, "Сессия истекла");
    }

    cacheSessionUser(sessionToken, session.user, session.expires);
    (request as AuthenticatedRequest).user = session.user;
    next();
  } catch (error) {
    next(error);
  }
}

export function getAuthenticatedUser(request: Request) {
  const user = (request as Partial<AuthenticatedRequest>).user;

  if (!user) {
    throw new HttpError(401, "Требуется вход в аккаунт");
  }

  return user;
}
