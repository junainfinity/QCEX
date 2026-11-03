import fs from "node:fs";
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "services/market-data/core.test.mjs", "tests/indicators.test.ts"], { encoding: "utf8" });
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/market-unit.tap", result.stdout + result.stderr);
const count = label => Number(result.stdout.match(new RegExp(`# ${label} (\\d+)`))?.[1] || 0);
const record = { date: new Date().toISOString(), tests: count("tests"), passed: count("pass"), failed: count("fail"), skipped: count("skipped"), status: result.status === 0 && count("tests") > 0 && count("pass") === count("tests") ? "PASS" : "FAIL" };
fs.writeFileSync("artifacts/market-unit.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record)); if (record.status !== "PASS") { console.error(result.stdout + result.stderr); process.exitCode = 1; }
