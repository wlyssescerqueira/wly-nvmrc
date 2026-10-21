/** Quote one literal argument for a POSIX shell (including spaces and metacharacters). */
export function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
