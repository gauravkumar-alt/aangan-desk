import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import type { ZodType } from "zod";
import { PricingRules, QualifiedRules, ServicesRules, type RuleFileState, type Ruleset } from "./schema";

const CASE_DIR = path.join(process.cwd(), "case");
const BLOCK = /```json aangan-rules\s*\n([\s\S]*?)\n```/;

async function loadOne<T>(name: RuleFileState<T>["name"], schema: ZodType<T>): Promise<RuleFileState<T>> {
  let md: string;
  try {
    md = await readFile(path.join(CASE_DIR, name), "utf8");
  } catch {
    return { name, state: "missing", status: null, rules: null, problem: `case/${name} not found.`, prose: "" };
  }
  const m = md.match(BLOCK);
  const prose = md.replace(BLOCK, "").trim();
  if (!m) {
    return {
      name,
      state: "no_rules_block",
      status: null,
      rules: null,
      prose,
      problem: `case/${name} has no \`\`\`json aangan-rules block — the prose is there but the system can't act on it until it is mapped.`,
    };
  }
  try {
    const parsed = schema.safeParse(JSON.parse(m[1]));
    if (!parsed.success) {
      return { name, state: "invalid", status: null, rules: null, prose, problem: `Rules block in case/${name} is invalid: ${parsed.error.issues[0]?.message}` };
    }
    const rules = parsed.data as T & { status: string };
    return { name, state: "loaded", status: rules.status, rules, problem: null, prose };
  } catch (e) {
    return { name, state: "invalid", status: null, rules: null, prose, problem: `Rules block in case/${name} is not valid JSON (${(e as Error).message}).` };
  }
}

// Re-read on every call: the files are tiny and editing them should change behaviour immediately.
export async function loadRuleset(): Promise<Ruleset> {
  const [services, qualified, pricing] = await Promise.all([
    loadOne("services.md", ServicesRules),
    loadOne("qualified.md", QualifiedRules),
    loadOne("pricing.md", PricingRules),
  ]);
  return { services, qualified, pricing, loadedAt: new Date().toISOString() };
}
