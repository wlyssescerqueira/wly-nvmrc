import * as path from "path";

export type ScriptCandidate = { dir: string; script: string; command: string };

function normalize(value: string): string {
  const result = value.replace(/file:\/\/\/?/g, "").replace(/\\/g, "/");
  return process.platform === "win32" ? result.toLowerCase() : result;
}

function tokens(value: string): string[] {
  return (value.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map((token) =>
    normalize(token.replace(/^["']|["']$/g, "")),
  );
}

/** Require project-path evidence and a unique command/script match; shared ports alone prove nothing. */
export function identifyProcessScript(
  commandLines: string[],
  candidates: ScriptCandidate[],
): ScriptCandidate | undefined {
  const scoped = candidates.filter((candidate) =>
    commandLines.some((line) =>
      normalize(line).includes(
        `${normalize(candidate.dir).replace(/\/$/, "")}/`,
      ),
    ),
  );
  for (const line of commandLines) {
    const actual = tokens(line);
    const npm = actual.findIndex((token) =>
      /(?:^|\/)(?:npm(?:\.cmd|\.exe)?|npm-cli\.js)$/.test(token),
    );
    if (npm >= 0) {
      const args = actual.slice(npm + 1);
      const name =
        args[0] === "run" || args[0] === "run-script"
          ? args[1]
          : args[0] === "start"
            ? "start"
            : undefined;
      const matches = scoped.filter(
        (candidate) => normalize(candidate.script) === name,
      );
      if (matches.length === 1) {
        return matches[0];
      }
    }
  }
  const matches = scoped.filter((candidate) => {
    // Compound commands, aliases and environment assignments are deliberately left uncertain.
    if (/[;&|=]/.test(candidate.command)) {
      return false;
    }
    const expected = tokens(candidate.command);
    if (expected.length < 2 || /^(npm|pnpm|yarn|bun)$/.test(expected[0])) {
      return false;
    }
    return commandLines.some((line) => {
      const actual = tokens(line);
      return actual.some(
        (token, offset) =>
          path.posix.basename(token).replace(/\.exe$/, "") === expected[0] &&
          expected.slice(1).every((argument, index) => {
            const value = actual[offset + index + 1];
            return (
              value === argument ||
              (!argument.startsWith("-") &&
                value?.endsWith(`/${argument.replace(/^\.\//, "")}`))
            );
          }),
      );
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}
