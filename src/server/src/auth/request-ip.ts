// Resolve the client IP for audit + rate limiting. Behind the EP-0041 same-origin proxy
// the real IP is in X-Forwarded-For; otherwise use the socket address.

export interface IpServer {
  requestIP?: (request: Request) => { address: string } | null;
}

export function clientIp(request: Request, server: IpServer | null): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return server?.requestIP?.(request)?.address ?? null;
}
