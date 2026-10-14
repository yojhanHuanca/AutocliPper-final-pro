import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eventually } from "@autoclipper/testing";
const api = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:19025";
const origin = "http://localhost:4200";
export const password = "AutoClipper-test-password-2026!";
export function client() {
  const jar = new Map();
  let csrf;
  return {
    jar,
    async request(path, method = "GET", input, extra = {}) {
      const headers = {
        origin,
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join(";"),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...extra,
      };
      const response = await fetch(`${api}/v1${path}`, {
        method,
        headers,
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(25000),
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0];
        const separator = pair.indexOf("=");
        jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      const value = await response.json();
      if (path === "/auth/csrf" && response.ok) csrf = value.csrfToken;
      return { status: response.status, value, headers: response.headers };
    },
  };
}
export async function emailToken(address, purpose) {
  let text;
  await eventually(async () => {
    const list = await (await fetch(`${mailpit}/api/v1/messages`)).json();
    const messages = list.messages ?? [];
    for (const item of messages) {
      if (item.To?.some((to) => to.Address === address)) {
        const message = await (
          await fetch(`${mailpit}/api/v1/message/${item.ID}`)
        ).json();
        if (message.Text?.includes(`/auth/${purpose}?token=`)) {
          text = message.Text;
          return true;
        }
      }
    }
    return false;
  }, 30000);
  return new URL(text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
}
export async function account() {
  const c = client();
  const email = `acceptance-${randomUUID()}@example.test`;
  assert.equal((await c.request("/auth/csrf")).status, 200);
  assert.equal(
    (
      await c.request("/auth/register", "POST", {
        email,
        password,
        name: "Authorized test account",
      })
    ).status,
    202,
  );
  assert.equal(
    (await c.request("/auth/login", "POST", { email, password })).status,
    401,
  );
  const token = await emailToken(email, "verify");
  assert.equal(
    (await c.request("/auth/verify", "POST", { token })).status,
    200,
  );
  assert.equal(
    (await c.request("/auth/verify", "POST", { token })).status,
    401,
  );
  const login = await c.request("/auth/login", "POST", { email, password });
  assert.equal(login.status, 200);
  assert.ok(c.jar.get("autoclipper_access"));
  assert.ok(c.jar.get("autoclipper_refresh"));
  assert.equal(
    JSON.stringify(login.value).includes(c.jar.get("autoclipper_access")),
    false,
  );
  return { c, email, id: login.value.user.id };
}
