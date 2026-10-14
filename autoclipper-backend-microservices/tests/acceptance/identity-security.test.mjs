import { test } from "node:test";
import assert from "node:assert/strict";
import { TOTP } from "otpauth";
import { account, password } from "../helpers/accounts.mjs";

test(
  "profile privacy requests and real TOTP recovery lifecycle",
  { timeout: 90000 },
  async (t) => {
    const user = await account(),
      other = await account();
    const c = user.c;
    await t.test(
      "profile preferences persist with concurrency checks and cannot change privileges",
      async () => {
        const current = await c.request("/auth/profile");
        assert.equal(current.status, 200);
        assert.equal(current.value.preferences.timezone, "America/Lima");
        assert.equal(
          (
            await c.request("/auth/profile", "PATCH", {
              version: current.value.version,
              name: "Updated identity",
              preferences: { locale: "en", timezone: "UTC", theme: "dark" },
            })
          ).status,
          200,
        );
        const read = await c.request("/auth/profile");
        assert.equal(read.value.name, "Updated identity");
        assert.equal(read.value.preferences.timezone, "UTC");
        assert.equal(
          (
            await c.request("/auth/profile", "PATCH", {
              version: current.value.version,
              name: "Lost update",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await c.request("/auth/profile", "PATCH", {
              version: read.value.version,
              role: "admin",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await c.request("/auth/profile", "PATCH", {
              version: read.value.version,
              preferences: { timezone: "invented/timezone" },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "privacy requests are authenticated, isolated and remain explicitly unfulfilled",
      async () => {
        assert.equal(
          (
            await c.request("/auth/privacy-requests", "POST", {
              kind: "export",
              password: "incorrect",
            })
          ).status,
          401,
        );
        const first = await c.request("/auth/privacy-requests", "POST", {
          kind: "export",
          password,
        });
        assert.equal(first.status, 202);
        assert.equal(first.value.state, "requested");
        assert.equal(first.value.fulfillment, "pending");
        assert.equal(
          (
            await c.request("/auth/privacy-requests", "POST", {
              kind: "export",
              password,
            })
          ).value.id,
          first.value.id,
        );
        assert.equal(
          (
            await c.request("/auth/privacy-requests", "POST", {
              kind: "deletion",
              password,
            })
          ).status,
          202,
        );
        assert.equal(
          (await c.request("/auth/privacy-requests")).value.items.length,
          2,
        );
        assert.equal(
          (await other.c.request("/auth/privacy-requests")).value.items.length,
          0,
        );
      },
    );
    let recovery, oldAccess, usedTotp;
    await t.test(
      "enrollment requires password and confirmation; enabling revokes prior sessions",
      async () => {
        assert.equal((await c.request("/auth/2fa")).value.enabled, false);
        assert.equal(
          (
            await c.request("/auth/2fa/setup", "POST", {
              password: "incorrect",
            })
          ).status,
          401,
        );
        const setup = await c.request("/auth/2fa/setup", "POST", { password });
        assert.equal(setup.status, 200);
        const uri = new URL(setup.value.otpauthUri);
        const secret = uri.searchParams.get("secret");
        assert.ok(secret);
        usedTotp = new TOTP({
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          secret,
        }).generate();
        oldAccess = c.jar.get("autoclipper_access");
        const enabled = await c.request("/auth/2fa/enable", "POST", {
          password,
          code: usedTotp,
        });
        assert.equal(enabled.status, 200);
        assert.equal(enabled.value.recoveryCodes.length, 10);
        recovery = enabled.value.recoveryCodes;
        assert.equal((await c.request("/auth/me")).status, 401);
        c.jar.set("autoclipper_access", oldAccess);
        assert.equal((await c.request("/auth/me")).status, 401);
      },
    );
    await t.test(
      "login requires the second factor and rejects replay of TOTP and recovery codes",
      async () => {
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
              factor: usedTotp,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
              factor: recovery[0],
            })
          ).status,
          200,
        );
        assert.equal(
          (await c.request("/auth/2fa")).value.recoveryCodesRemaining,
          9,
        );
        assert.equal(
          (
            await c.request("/auth/privacy-requests", "POST", {
              kind: "export",
              password,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
              factor: recovery[0],
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "recovery rotation invalidates old codes and disabling requires reauthentication",
      async () => {
        const rotated = await c.request("/auth/2fa/recovery/rotate", "POST", {
          password,
          factor: recovery[1],
        });
        assert.equal(rotated.status, 200);
        assert.equal(rotated.value.recoveryCodes.length, 10);
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
              factor: recovery[2],
            })
          ).status,
          401,
        );
        assert.equal(
          (await c.request("/auth/2fa/disable", "POST", { password })).status,
          401,
        );
        const beforeDisable = c.jar.get("autoclipper_access");
        assert.equal(
          (
            await c.request("/auth/2fa/disable", "POST", {
              password,
              factor: rotated.value.recoveryCodes[0],
            })
          ).status,
          200,
        );
        assert.equal((await c.request("/auth/me")).status, 401);
        c.jar.set("autoclipper_access", beforeDisable);
        assert.equal((await c.request("/auth/me")).status, 401);
        assert.equal(
          (
            await c.request("/auth/login", "POST", {
              email: user.email,
              password,
            })
          ).status,
          200,
        );
        assert.equal((await c.request("/auth/2fa")).value.enabled, false);
        const events = await c.request("/auth/security-events");
        assert.equal(events.status, 200);
        for (const action of [
          "mfa.setup",
          "mfa.enabled",
          "mfa.recovery_rotated",
          "mfa.disabled",
        ])
          assert.ok(
            events.value.items.some((event) => event.action === action),
          );
        assert.equal(
          (await other.c.request("/auth/security-events")).value.items.some(
            (event) => event.action.startsWith("mfa."),
          ),
          false,
        );
        for (const code of recovery)
          assert.equal(JSON.stringify(events.value).includes(code), false);
      },
    );
  },
);
