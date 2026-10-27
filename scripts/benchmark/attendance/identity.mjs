import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Fingerprint the fixture and request model separately from the application being compared. */
export function harnessIdentity() {
  const hash=createHash('sha256');
  for(const name of ['core.mjs','fixture.mjs','http.mjs','traffic-policy.mjs','workload.mjs','traffic.py']) {
    hash.update(name).update('\0').update(readFileSync(new URL(name,import.meta.url)));
  }
  return hash.digest('hex');
}
