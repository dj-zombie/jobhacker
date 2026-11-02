/** Thrown when a config file is missing, unparseable or fails validation. */
export class ConfigError extends Error {
  constructor(
    /** The file this error is about, e.g. `config/criteria.yaml`. */
    readonly file: string,
    /** Human-readable issues, one per line, each with its dotted path. */
    readonly issues: string[],
  ) {
    super(`Invalid config in ${file}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}
