// CLI placeholder. Standalone reports require persistence (Phase C); until
// SQLite is wired in, `sim:backtest` prints its own end-of-run summary and
// this stub just explains that.

console.log(
  [
    'sim:report is not yet implemented.',
    '',
    'Position state lives only in memory inside `sim:backtest` for now;',
    'reporting separately requires SQLite persistence (Phase C of the plan',
    'at /root/.claude/plans/here-is-a-draft-streamed-pearl.md).',
    '',
    'Use `npm run sim:backtest -- --pool <addr>` for an end-of-run summary.',
  ].join('\n'),
);
