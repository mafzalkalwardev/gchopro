export function hostnameOf(hostHeader: string | null): string | null {
  if (hostHeader === null) return null;
  const host = hostHeader.trim().toLowerCase();
  if (host.length === 0) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end <= 1) return null;
    return host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0 && /^\d+$/u.test(host.slice(colon + 1))) return host.slice(0, colon);
  return host;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function expandIpv6(ip: string): bigint | null {
  if (ip.includes(".")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] && halves[0].length > 0 ? halves[0].split(":") : [];
  const right =
    halves.length === 2 && halves[1] && halves[1].length > 0 ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 1) return null;
  if (missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    result = (result << 16n) + BigInt(Number.parseInt(group, 16));
  }
  return result;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf("/");
  if (slash <= 0) return false;
  const base = cidr.slice(0, slash).toLowerCase();
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix)) return false;
  if (ip.includes(":")) {
    if (prefix < 0 || prefix > 128) return false;
    const address = expandIpv6(ip.toLowerCase());
    const network = expandIpv6(base);
    if (address === null || network === null) return false;
    if (prefix === 0) return true;
    const hostBits = BigInt(128 - prefix);
    const mask = ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n);
    return (address & mask) === (network & mask);
  }
  if (prefix < 0 || prefix > 32) return false;
  const address = ipv4ToInt(ip);
  const network = ipv4ToInt(base);
  if (address === null || network === null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

function parseForwarded(header: string | null): string[] {
  if (header === null || header.trim().length === 0) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The rightmost forwarding hop is trusted only when it sits in TRUSTED_PROXY_CIDRS.
 * A client-supplied X-Forwarded-For with no trusted hop is ignored.
 * Development and test, with no forwarding header, use the loopback address.
 */
export function clientIp(input: {
  forwardedFor: string | null;
  appEnv: "development" | "test" | "staging" | "production";
  trustedProxyCidrs: readonly string[];
}): string | null {
  const hops = parseForwarded(input.forwardedFor);
  if (hops.length === 0) {
    return input.appEnv === "development" || input.appEnv === "test" ? "127.0.0.1" : null;
  }
  const peer = hops[hops.length - 1];
  if (peer === undefined) return null;
  const trustedPeer = input.trustedProxyCidrs.some((cidr) => ipInCidr(peer, cidr));
  if (!trustedPeer) return null;
  const earlier = hops.slice(0, -1);
  earlier.reverse();
  for (const hop of earlier) {
    const trusted = input.trustedProxyCidrs.some((cidr) => ipInCidr(hop, cidr));
    if (!trusted) return hop;
  }
  return peer;
}

export function adminAllowed(client: string | null, allowlist: readonly string[]): boolean {
  if (client === null) return false;
  return allowlist.some((cidr) => ipInCidr(client, cidr));
}

export function ipAllowedByUser(
  client: string | null,
  allowlist: readonly string[] | null,
): boolean {
  if (allowlist === null || allowlist.length === 0) return true;
  if (client === null) return false;
  return allowlist.some((cidr) => ipInCidr(client, cidr));
}
