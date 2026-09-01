import "dotenv/config";
import { runScheduler } from "../lib/slackReports/scheduler";

runScheduler()
  .then((r) => { console.log("[slack-reports] run complete:", r); process.exit(0); })
  .catch((e) => { console.error("[slack-reports] run failed:", e); process.exit(1); });
