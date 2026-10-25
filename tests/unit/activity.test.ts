import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { activityDetails, activityNames } from "@/src/lib/activity";

// The event schema (PLAN.md 8.9): every write to activity_log in the app's code, read with
// TypeScript itself, names an action listed in src/lib/activity.ts and only its details.
// The database's own writes are checked in tests/db/security.test.ts.
type Write = { at: string; actions: string[]; details: string[] };
// Database functions that log the details the app hands them: which argument, and as what.
const GIVEN: Record<string, { details: string; actions: string[] }> = {
  decide_form: { details: "reason", actions: ["form.approved", "form.rejected"] },
  reserve_form: { details: "choice", actions: ["form.started"] },
};

function writes(): Write[] {
  const files = execFileSync("git", ["grep", "-l", "-E", "activity_log|saveDraft\\(", "--", "app", "src", "worker"], { encoding: "utf8" })
    .split("\n").filter((file) => /\.(ts|tsx|mts)$/.test(file) && file !== "src/db/types.ts");
  const config = ts.getParsedCommandLineOfConfigFile("tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const program = ts.createProgram(files, { ...config.options, incremental: false, noEmit: true });
  const checker = program.getTypeChecker();
  // The words an action can be: a literal, either side of a choice, or a variable typed as literals.
  const words = (node: ts.Expression): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...words(node.whenTrue), ...words(node.whenFalse)];
    if (ts.isParenthesizedExpression(node)) return words(node.expression);
    const type = checker.getTypeAtLocation(node);
    return (type.isUnion() ? type.types : [type]).map((part) => (part.isStringLiteral() ? part.value : `(not a fixed word: ${node.getText()})`));
  };
  const keys = (node: ts.Expression) => checker.getNonNullableType(checker.getTypeAtLocation(node)).getProperties().map((property) => property.name);
  const found = (node: ts.Node, name: string, list: ts.Expression[] = []) => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === name) list.push(node.initializer);
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) list.push(node.name);
    ts.forEachChild(node, (child) => void found(child, name, list));
    return list;
  };
  const out: Write[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const at = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const callee = node.expression;
        // .from("activity_log").insert(row or rows)
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "insert" && ts.isCallExpression(callee.expression)
          && ts.isPropertyAccessExpression(callee.expression.expression) && callee.expression.expression.name.text === "from"
          && callee.expression.arguments[0]?.getText() === '"activity_log"')
          out.push({ at, actions: found(node.arguments[0], "action").flatMap(words), details: found(node.arguments[0], "details").flatMap(keys) });
        // saveDraft(row, data, person, action, details): the database writes these for it.
        if (ts.isIdentifier(callee) && callee.text === "saveDraft" && node.arguments.length >= 5)
          out.push({ at, actions: words(node.arguments[3]), details: keys(node.arguments[4]) });
        // A database function that writes the details it is given, as they are.
        const given = ts.isPropertyAccessExpression(callee) && callee.name.text === "rpc" && ts.isStringLiteral(node.arguments[0]) ? GIVEN[node.arguments[0].text] : undefined;
        if (given && node.arguments[1]) out.push({ at, actions: given.actions, details: found(node.arguments[1], given.details).flatMap(keys) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

// Detail names that would mean an identifier or content is kept (PLAN.md 8.0, 8.9).
const forbidden = /^(email|address|pan|gstin|aadhaar|phone|mobile|subject|body|text|html|content|snippet|password|secret|token|otp)$/i;

describe("the activity log's event schema", () => {
  const all = writes();

  it("finds every write in the app's code", () => {
    expect(all.length).toBeGreaterThan(45);
    expect(all.filter((write) => !write.actions.length).map((write) => write.at)).toEqual([]);
  });

  it("writes only listed actions, each with only its listed details", () => {
    const problems = all.flatMap(({ at, actions, details }) => [
      ...actions.filter((action) => !(action in activityDetails)).map((action) => `${at}: ${action} is not in src/lib/activity.ts`),
      ...details.filter((key) => !actions.some((action) => activityDetails[action]?.includes(key))).map((key) => `${at}: the detail ${key} is not listed for ${actions.join(" or ")}`),
    ]);
    expect(problems).toEqual([]);
  });

  it("names on screen only actions that are written, and lists no detail that is an identifier or content", () => {
    expect(Object.keys(activityNames).filter((action) => !(action in activityDetails))).toEqual([]);
    expect(Object.entries(activityDetails).flatMap(([action, keys]) => keys.filter((key) => forbidden.test(key)).map((key) => `${action}: ${key}`))).toEqual([]);
  });
});
