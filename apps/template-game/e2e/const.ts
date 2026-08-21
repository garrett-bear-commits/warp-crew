// Constants shared by the acceptance API (e2e/server.ts) and the specs. Lab-only credentials for
// a throwaway database; nothing here is a real secret.
export const E2E_ADMIN_SECRET = 'e2e-admin-secret-0123456789';
export const E2E_OPS_SECRET = 'e2e-ops-secret-0123456789';
export const E2E_API_PORT = 8090;
export const E2E_HOST_PORT = 4174;
export const E2E_GAME_PORT = 4173;
// Local-only Vite origin used by the official-shape Jest SDK fixture. This is not a Jest host.
export const E2E_JEST_GAME_PORT = 4175;
