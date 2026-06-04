/**
 * Asserts the TypeScript port (src/lib/sequentialTest.ts) reproduces the
 * authoritative Python trajectory in scripts/sim_parity_fixture.json.
 *
 * Run (Node ≥ 22.18, type-stripping on by default):
 *   python scripts/sim_parity.py && node scripts/sim_parity_check.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulate, type Direction } from '../src/lib/sequentialTest.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'sim_parity_fixture.json'), 'utf8'));

const TOL = 1e-9;
let failures = 0;

function approxEq(a: number | null, b: number | null): boolean {
  if (a == null || !Number.isFinite(a)) return b == null || !Number.isFinite(b);
  if (b == null || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= TOL + TOL * Math.abs(b);
}

for (const [scenario, rate] of Object.entries(fx.scenarios as Record<string, number[]>)) {
  for (const direction of ['increase', 'decrease'] as Direction[]) {
    const exp = fx.expected[scenario][direction];
    const res = simulate({ dates: fx.dates, rate }, fx.startDate, {
      alpha: fx.params.alpha,
      beta: fx.params.beta,
      bonferroni: fx.params.bonferroni,
      direction,
    });

    const tag = `${scenario}/${direction}`;

    if (Math.abs(res.threshold - fx.threshold) > TOL) {
      console.error(`✗ ${tag}: threshold ${res.threshold} != ${fx.threshold}`);
      failures++;
    }
    if (res.logWealth.length !== exp.logWealth.length) {
      console.error(
        `✗ ${tag}: length ${res.logWealth.length} != ${exp.logWealth.length}`,
      );
      failures++;
      continue;
    }
    let worst = 0;
    for (let i = 0; i < exp.logWealth.length; i++) {
      const a = res.logWealth[i];
      const b = exp.logWealth[i];
      if (!approxEq(Number.isFinite(a) ? a : null, b)) {
        console.error(`✗ ${tag}: logWealth[${i}] ${a} != ${b}`);
        failures++;
      } else if (Number.isFinite(a) && b != null) {
        worst = Math.max(worst, Math.abs(a - b));
      }
    }
    const expIdx = exp.rejectionIndex ?? null;
    if (res.rejectionIndex !== expIdx) {
      console.error(`✗ ${tag}: rejectionIndex ${res.rejectionIndex} != ${expIdx}`);
      failures++;
    } else {
      console.log(
        `✓ ${tag}: ${exp.logWealth.length} steps, max|Δ|=${worst.toExponential(2)}, ` +
          `rejection=${expIdx}`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\nPARITY FAILED: ${failures} mismatch(es)`);
  process.exit(1);
}
console.log('\nPARITY OK — TS port matches Python authority');
