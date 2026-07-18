import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Tests must always run against the bundled rules/signatures, never a
      // developer's ~/.appship/data-cache from `appship rules update`.
      APPSHIP_DATA_CACHE_DIR: '/nonexistent/appship-test-no-cache',
    },
  },
});
