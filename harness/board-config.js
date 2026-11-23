// The shared leaderboard (src/core/board.js sharedBoard): the project's
// Supabase table, set up as in docs/leaderboard.md. Set BOARD to null to keep
// the leaderboard on each computer instead.
//
// The key is the project's publishable (anon) key, which is meant to be public:
// it is in every visitor's browser, and what it may do is limited by the
// table's row-level security. Never put the secret (service_role) key here.
export const BOARD = {
  url: 'https://gkltomqhzgnfjuxdzsuw.supabase.co',
  key: 'sb_publishable_PeVzTPao73-IIdYfZgGzlg_xY3eiqFa',
};
