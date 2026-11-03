/**
 * ARRIVE DASHBOARD CONFIG
 * ------------------------------------------------------------------
 * One file per dashboard deployment. Everything environment-specific
 * lives here so the dashboard HTML and the shared data service
 * (arrive-data-service.js) never need to be touched when you move
 * between dev/staging/prod, or when you spin up a new ARRIVE
 * dashboard (Inventory, Fleet, Control Tower, ...).
 * ------------------------------------------------------------------
 */
window.ARRIVE_CONFIG = {
  // Paste the Apps Script Web App URL for THIS dashboard's sheet.
  // See SETUP_GUIDE.md for how to generate it.
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxc2tsanxMs3kCuzla6FH6lmMcqbdvJrzXsvRs__iOVsZoAROvDsvQbOQSLh1wupD4tTA/exec',

  // Auto-refresh interval in minutes. Set to 0 to disable.
  AUTO_REFRESH_MINUTES: 5,

  // How long to wait for the Apps Script response before treating it
  // as failed and retrying.
  REQUEST_TIMEOUT_MS: 60000,

  // How many times to retry a failed fetch before giving up (first
  // load only shows the full error screen; background refreshes
  // show a small banner instead and keep the last good data on screen).
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 1500,

  // 'en' or 'ar' — language shown on first load, before the user
  // touches the language toggle.
  DEFAULT_LANG: 'ar',

  // Free-text identifier, only used in console warnings so it's
  // obvious which dashboard logged them when several are open.
  DASHBOARD_ID: 'management'
};
