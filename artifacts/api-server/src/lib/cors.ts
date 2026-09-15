const fixedOrigins = [
  "https://xn--d1ax3b.fun",
  "http://xn--d1ax3b.fun",
  "https://рэд.fun",
  "http://рэд.fun",
  "https://red-l-1-zar-links-rusapi.replit.app",
  "http://red-l-1-zar-links-rusapi.replit.app",
  "https://red-l-1-zar-links.replit.app",
  "http://red-l-1-zar-links.replit.app",
  "http://localhost",
  "http://localhost:80",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8787",
];

export function getAllowedCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const origins = new Set(fixedOrigins);
  for (const domain of [
    ...(env.REPLIT_DOMAINS?.split(",") ?? []),
    env.REPLIT_DEV_DOMAIN,
  ]) {
    if (!domain?.trim()) continue;
    const value = domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    origins.add(`https://${value}`);
    origins.add(`http://${value}`);
  }
  return origins;
}

export function isAllowedCorsOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getAllowedCorsOrigins(env).has(origin);
}