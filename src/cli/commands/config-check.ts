import { ConfigError, loadAllConfig } from '../../core/config/load.js';

/**
 * `config:check` — validate the config files and preferences.md without
 * running anything else (FR-1). Prints OK on success; on failure prints each
 * file, path and message and exits 1.
 */
export function configCheck(): void {
  try {
    const config = loadAllConfig();
    const boards = config.companies.companies.length;
    const active = config.companies.companies.filter((c) => c.active).length;
    const { gates, weights, budget } = config.criteria;
    const words = config.preferences.split(/\s+/).filter(Boolean).length;
    console.log('config OK');
    console.log(
      `  criteria:    age gate ${gates.max_age_days > 0 ? `${gates.max_age_days} days` : 'off'}, ${gates.company_blocklist.length} blocklisted, prescore ordering only, cap ${budget.max_new_scores_per_run}/run`,
    );
    console.log(
      `  weights:     role ${weights.role_fit} · tech ${weights.tech_fit} · domain ${weights.domain_interest} · seniority ${weights.seniority_fit} · logistics ${weights.logistics_fit} · comp ${weights.comp_fit}`,
    );
    console.log(`  preferences: ${words} words`);
    console.log(
      `  profile:     ${config.profile.experience.length} role(s), ${Object.keys(config.profile.skills).length} skill group(s)`,
    );
    console.log(`  companies:   ${boards} board(s), ${active} active`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('config check FAILED\n');
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
