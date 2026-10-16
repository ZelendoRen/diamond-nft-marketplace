import { existsSync, readFileSync } from "fs";

// Fails when the figures in coverage.json (written by `hardhat coverage`) are below a threshold.
// Usage: ts-node scripts/check-coverage.ts [minPercent]

interface FileCoverage {
  statementMap: Record<string, { start: { line: number } }>;
  s: Record<string, number>;
  b: Record<string, number[]>;
  f: Record<string, number>;
}

const threshold = Number(process.argv[2] ?? 90);
const path = "coverage.json";
if (!existsSync(path)) {
  console.error(`${path} not found, run \`npm run coverage\` first`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(path, "utf8")) as Record<string, FileCoverage>;

const totals = {
  statements: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  lines: { covered: 0, total: 0 },
};

for (const file of Object.values(report)) {
  const hits = Object.values(file.s);
  totals.statements.total += hits.length;
  totals.statements.covered += hits.filter((n) => n > 0).length;

  for (const branch of Object.values(file.b)) {
    totals.branches.total += branch.length;
    totals.branches.covered += branch.filter((n) => n > 0).length;
  }

  const fnHits = Object.values(file.f);
  totals.functions.total += fnHits.length;
  totals.functions.covered += fnHits.filter((n) => n > 0).length;

  // a line counts as covered when any statement starting on it ran
  const lines = new Map<number, boolean>();
  for (const [id, statement] of Object.entries(file.statementMap)) {
    const line = statement.start.line;
    lines.set(line, (lines.get(line) ?? false) || file.s[id] > 0);
  }
  totals.lines.total += lines.size;
  totals.lines.covered += [...lines.values()].filter(Boolean).length;
}

let failed = false;
for (const [name, { covered, total }] of Object.entries(totals)) {
  const percent = total === 0 ? 100 : (covered / total) * 100;
  const ok = percent >= threshold;
  failed = failed || !ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name.padEnd(10)} ${percent.toFixed(2).padStart(6)}%  (${covered}/${total})`,
  );
}

if (failed) {
  console.error(`\nCoverage is below ${threshold}%`);
  process.exit(1);
}
