/** Slack Incoming Webhook delivery. The URL comes from the report's DB row (reports added from the
 *  page) or from `process.env[envVarKey]` (the two original reports), resolved at send time ONLY —
 *  never returned by any API route, never logged. Errors name the channel label (and the env var
 *  KEY NAME), never the URL. */
import { SlackDestination } from "./types";

export async function sendSlackMessage(destination: SlackDestination, text: string): Promise<void> {
  const url = destination.webhookUrl || (destination.envVarKey ? process.env[destination.envVarKey] : undefined);
  if (!url) {
    throw new Error(destination.envVarKey
      ? `Slack webhook env var "${destination.envVarKey}" is not set — cannot send to ${destination.channelLabel}.`
      : `No Slack webhook saved for ${destination.channelLabel}.`);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    throw new Error(`Slack delivery to ${destination.channelLabel} failed: ${e instanceof Error ? e.message : "network error"}.`);
  }
  if (!res.ok) {
    throw new Error(`Slack webhook for ${destination.channelLabel} returned HTTP ${res.status}.`);
  }
}
