import { createApp } from './app.js';
import { runWeeklyErrorRollup } from './lib/rollup.js';
import { ErrorEventsRepo } from './db/errorEvents.js';

export { RateLimiter } from './do/rateLimiter.js';

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  // Cron Trigger (see [triggers] in wrangler.toml). Replaces both Node-side
  // background jobs:
  //   * `npm run rollup:errors` — now reads D1 and writes markdown to R2.
  //   * the nightly .backup()/VACUUM setInterval — deleted outright, because
  //     D1 has built-in point-in-time recovery (30 days). See docs/PROGRESS.md.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await runWeeklyErrorRollup(env, { now: controller.scheduledTime || Date.now() });
        } catch (error) {
          await new ErrorEventsRepo(env.DB).record({ component: 'rollup', error });
        }
      })()
    );
  },
};
