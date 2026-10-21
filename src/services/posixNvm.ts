import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { quotePosix } from "../utils/shell";

export function nvmScript(): string | undefined {
  const dirs = [
    process.env.NVM_DIR,
    path.join(os.homedir(), ".nvm"),
    process.env.XDG_CONFIG_HOME &&
      path.join(process.env.XDG_CONFIG_HOME, "nvm"),
    "/opt/homebrew/opt/nvm",
    "/usr/local/opt/nvm",
  ];
  return dirs
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.join(dir, "nvm.sh"))
    .find((file) => fs.existsSync(file));
}

export function nvmCommand(args: string[]): string {
  const file = nvmScript();
  if (!file) {
    throw new Error(
      "nvm.sh was not found. Configure NVM_DIR or install nvm-sh.",
    );
  }
  return `. ${quotePosix(file)} --no-use && nvm ${args.map(quotePosix).join(" ")}`;
}

/** nvm-sh changes a shell's PATH, so carry the chosen version into future tasks. */
export function activateNode(binary: string): void {
  const executable = binary.trim();
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw new Error("nvm did not return an installed Node executable.");
  }
  const bin = path.dirname(executable);
  process.env.PATH = [
    bin,
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter((entry) => entry !== bin),
  ].join(path.delimiter);
}
