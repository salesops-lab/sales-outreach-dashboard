/**
 * Slack file delivery via a Bot Token (Incoming Webhooks can't upload files, which is required
 * for posting the rendered report image). ONE shared `SLACK_BOT_TOKEN` env var authenticates
 * every send — resolved at send time only, never stored in code, a database, or returned by any
 * API route. Errors name the channel id, never the token.
 *
 * Uses Slack's file-upload-v2 REST flow directly via `fetch` (no Slack SDK dependency, consistent
 * with how the rest of this module avoids adding runtime deps):
 *   1. files.getUploadURLExternal — reserve an upload slot for the file.
 *   2. POST the raw bytes to the returned upload_url.
 *   3. files.completeUploadExternal — finalize the upload and share it into the target channel.
 * The image IS the report — `opts.caption` is only the short "📊 CALL BLITZ REPORT / date · team"
 * intro line (Slack's initial_comment on the upload), never a re-rendering of the table as text.
 */
const SLACK_API = "https://slack.com/api";

function botToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error(`SLACK_BOT_TOKEN is not set — cannot deliver Slack reports.`);
  return token;
}

async function slackApi<T>(token: string, method: string, body: URLSearchParams | string, contentType: string): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!res.ok || !json.ok) {
    throw new Error(`Slack API ${method} failed: ${json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

export async function sendSlackImage(channelId: string, png: Buffer, opts: { title: string; caption?: string; test?: boolean }): Promise<void> {
  const token = botToken();
  const filename = `call-blitz-${Date.now()}.png`;

  let uploadUrl: string, fileId: string;
  try {
    const reserved = await slackApi<{ upload_url: string; file_id: string }>(
      token, "files.getUploadURLExternal",
      new URLSearchParams({ filename, length: String(png.length) }),
      "application/x-www-form-urlencoded",
    );
    uploadUrl = reserved.upload_url;
    fileId = reserved.file_id;
  } catch (e) {
    throw new Error(`Slack upload-slot request for channel ${channelId} failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  const uploadRes = await fetch(uploadUrl, { method: "POST", body: png as unknown as BodyInit });
  if (!uploadRes.ok) {
    throw new Error(`Slack file upload to channel ${channelId} failed: HTTP ${uploadRes.status}`);
  }

  const caption = opts.test ? `🧪 TEST REPORT\n${opts.caption ?? ""}`.trim() : opts.caption;
  try {
    await slackApi(
      token, "files.completeUploadExternal",
      JSON.stringify({
        files: [{ id: fileId, title: opts.test ? `🧪 TEST — ${opts.title}` : opts.title }],
        channel_id: channelId,
        ...(caption ? { initial_comment: caption } : {}),
      }),
      "application/json; charset=utf-8",
    );
  } catch (e) {
    throw new Error(`Slack upload finalize for channel ${channelId} failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
