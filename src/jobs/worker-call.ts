import { createHash, timingSafeEqual } from "node:crypto";

// True when a request's Authorization header carries the job worker secret. Compared in
// constant time, over hashes so that the lengths always match.
export function isWorkerCall(authorization: string | null, secret: string | undefined) {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization.slice("Bearer ".length)), hash(secret));
}
