// Trial-type classifier: the browser (research.js) and the backend (policy.py) must agree with tests/classify_cases.json.
// Run: node town-trial/tests/classify_check.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify } from "../web/js/research.js";
const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "classify_cases.json"), "utf8"));
const py = JSON.parse(execFileSync("python", ["-c",
  "import json,sys; sys.path.insert(0, sys.argv[1]); from policy import classify; print(json.dumps([classify(p) for p, _ in json.load(open(sys.argv[2], encoding='utf-8'))]))",
  join(here, "..", "backend"), join(here, "classify_cases.json")]).toString());
let bad = 0;
cases.forEach(([p, want], i) => {
  const js = classify(p), ok = js === want && py[i] === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${want.padEnd(10)} js=${js} py=${py[i]}  ${p}`);
});
console.log(bad ? `${bad} FAILED` : `all ${cases.length} passed`);
process.exit(bad ? 1 : 0);
