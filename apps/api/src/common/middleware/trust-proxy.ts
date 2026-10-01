/**
 * Express `trust proxy` setting: which peers may tell us the client's address through
 * X-Forwarded-For. req.ip (the anonymous rate-limit key) is derived from it.
 *
 * Production chain:  client → Railway edge → Caddy (web service) → API (private network)
 *
 * - Railway's edge terminates TLS and sets/appends the client's address to X-Forwarded-For.
 *   It reaches the web container from Railway's internal range 100.64.0.0/10 (shared address
 *   space, RFC 6598: never routed on the public internet, so no client connects from it).
 * - Caddy trusts the edge (global `trusted_proxies` in apps/web/Caddyfile) and so forwards the
 *   incoming X-Forwarded-For with the edge's address appended. Without that setting Caddy
 *   replaces the header with the edge's address, and every client shares the edge's bucket.
 * - Caddy reaches the API over Railway's private network (IPv6 fd12::/16, or private IPv4).
 *
 * So the API sees  X-Forwarded-For: [anything the client sent…], <client>, <edge>  from a socket
 * whose peer is Caddy. Express walks that list right to left and stops at the first address
 * that is NOT trusted: trusting exactly the infrastructure ranges below (loopback, private and
 * unique-local ranges, Railway's 100.64.0.0/10) makes that the address the edge saw, i.e. the
 * real client. Whatever a client prepends sits to the left of it and is never read, even if it
 * spoofs private addresses, because the edge always adds the true peer after them.
 *
 * Why ranges rather than `trust proxy = true` or a hop count:
 * - `true` takes the LEFTMOST entry, which the client controls: anyone could pick a fresh
 *   rate-limit bucket per request.
 * - A hop count (2) is only right while every request takes exactly this path; a request that
 *   reaches the API through one proxy fewer (e.g. a Railway public domain on the API service)
 *   would make the client-supplied entry count as the client.
 * - The ranges fail safe: if Railway ever connects from an address outside them, req.ip becomes
 *   that proxy's address (one shared bucket, as before) instead of something spoofable.
 *
 * Tests use the same policy: the test client connects over loopback, so a test may still choose
 * its own anonymous bucket with X-Forwarded-For (J8 rate-limit test), exactly like the edge does.
 */
export const TRUSTED_PROXIES = ['loopback', 'uniquelocal', '100.64.0.0/10'];
