import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { eventually } from "@autoclipper/testing";

const api = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:19025";
const origin = "http://localhost:4200";
const password = "AutoClipper-test-password-2026!";
function client() {
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
async function emailToken(address, purpose) {
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
async function account() {
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

test(
  "authorized account, project, signed uploads and actual inspection",
  { timeout: 180000 },
  async (t) => {
    const alice = await account(),
      bob = await account();
    let workspace, project;
    await t.test(
      "CSRF and Origin are enforced through the gateway",
      async () => {
        assert.equal(
          (
            await alice.c.request(
              "/workspaces",
              "POST",
              { name: "Rejected" },
              { "x-csrf-token": "wrong", "idempotency-key": randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await alice.c.request(
              "/workspaces",
              "POST",
              { name: "Rejected" },
              {
                origin: "https://attacker.example",
                "idempotency-key": randomUUID(),
              },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "workspace/project creation is idempotent and isolated",
      async () => {
        const key = randomUUID();
        const created = await alice.c.request(
          "/workspaces",
          "POST",
          { name: "Personal acceptance", kind: "personal" },
          { "idempotency-key": key },
        );
        assert.equal(created.status, 201);
        workspace = created.value.id;
        assert.equal(
          (
            await alice.c.request(
              "/workspaces",
              "POST",
              { name: "Personal acceptance", kind: "personal" },
              { "idempotency-key": key },
            )
          ).value.id,
          workspace,
        );
        assert.equal(
          (
            await bob.c.request(
              "/projects",
              "POST",
              { workspaceId: workspace, name: "Forbidden" },
              { "idempotency-key": randomUUID() },
            )
          ).status,
          403,
        );
        const pkey = randomUUID();
        const p = await alice.c.request(
          "/projects",
          "POST",
          { workspaceId: workspace, name: "Authorized video" },
          { "idempotency-key": pkey },
        );
        assert.equal(p.status, 201);
        project = p.value.id;
        assert.equal(
          (
            await alice.c.request(
              "/projects",
              "POST",
              { workspaceId: workspace, name: "Authorized video" },
              { "idempotency-key": pkey },
            )
          ).value.id,
          project,
        );
        assert.equal(
          (
            await alice.c.request(
              "/projects",
              "POST",
              { workspaceId: workspace, name: "Changed request" },
              { "idempotency-key": pkey },
            )
          ).status,
          409,
        );
        assert.equal((await bob.c.request(`/projects/${project}`)).status, 403);
        assert.equal(
          (await bob.c.request(`/projects?workspaceId=${workspace}`)).status,
          403,
        );
      },
    );
    await t.test("optimistic concurrency and owner protection", async () => {
      assert.equal(
        (
          await alice.c.request(`/projects/${project}`, "PATCH", {
            name: "Updated",
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await alice.c.request(`/projects/${project}`, "PATCH", {
            name: "Lost update",
            version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await alice.c.request(
            `/workspaces/${workspace}/members/${alice.id}`,
            "DELETE",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await alice.c.request(
            `/workspaces/${workspace}/members/${alice.id}`,
            "PATCH",
            { role: "reader" },
          )
        ).status,
        403,
      );
    });
    const root = process.env.TEST_TEMP_DIR ?? ".local";
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "business-"));
    let uploads = [];
    try {
      const path = join(directory, "authorized.mp4");
      await promisify(execFile)(
        process.env.FFMPEG_PATH ?? "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=green:s=320x240:d=2",
          "-c:v",
          "libx264",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-y",
          path,
        ],
        { timeout: 15000, windowsHide: true },
      );
      const video = await readFile(path);
      const sha256 = createHash("sha256").update(video).digest("hex");
      const baseVideo = video;
      const freeBox = Buffer.alloc(9 * 1024 * 1024);
      freeBox.writeUInt32BE(freeBox.length);
      freeBox.write("free", 4, "ascii");
      const multipartVideo = Buffer.concat([baseVideo, freeBox]);
      for (const mode of ["put", "multipart"])
        await t.test(
          `${mode} upload confirms real storage and produces authorized metadata`,
          async () => {
            const video = mode === "multipart" ? multipartVideo : baseVideo;
            const sha256 = createHash("sha256").update(video).digest("hex");
            const intent = await alice.c.request(
              `/projects/${project}/uploads`,
              "POST",
              { bytes: video.length, sha256, contentType: "video/mp4", mode },
              { "idempotency-key": randomUUID() },
            );
            assert.equal(intent.status, 201);
            const id = intent.value.id;
            uploads.push(id);
            assert.equal((await bob.c.request(`/uploads/${id}`)).status, 403);
            assert.equal(
              (await bob.c.request(`/uploads/${id}/confirm`, "POST", {}))
                .status,
              403,
            );
            assert.notEqual(
              (await alice.c.request(`/uploads/${id}/confirm`, "POST", {}))
                .status,
              200,
            );
            if (mode === "put") {
              assert.equal(
                new URL(intent.value.url).searchParams
                  .get("X-Amz-SignedHeaders")
                  .includes("content-length"),
                true,
              );
              const put = await fetch(intent.value.url, {
                method: "PUT",
                headers: intent.value.headers,
                body: video,
              });
              assert.equal(put.status, 200);
            } else {
              for (let number = 1; number <= intent.value.parts; number++) {
                const chunk = video.subarray(
                  (number - 1) * intent.value.partBytes,
                  Math.min(number * intent.value.partBytes, video.length),
                );
                const part = await alice.c.request(
                  `/uploads/${id}/parts`,
                  "POST",
                  {
                    partNumber: number,
                    sha256: createHash("sha256").update(chunk).digest("hex"),
                  },
                );
                assert.equal(part.status, 200);
                assert.equal(
                  (
                    await fetch(part.value.url, {
                      method: "PUT",
                      headers: part.value.headers,
                      body: chunk,
                    })
                  ).status,
                  200,
                );
                const resumed = await alice.c.request(`/uploads/${id}/parts`);
                assert.equal(resumed.status, 200);
                assert.equal(resumed.value.items.length, number);
                assert.equal(resumed.value.items.at(-1).bytes, chunk.length);
              }
            }
            assert.equal(
              (await alice.c.request(`/uploads/${id}/confirm`, "POST", {}))
                .status,
              200,
            );
            assert.equal(
              (await alice.c.request(`/uploads/${id}/confirm`, "POST", {}))
                .status,
              200,
            );
            let result;
            await eventually(async () => {
              result = await alice.c.request(`/uploads/${id}`);
              return (
                result.value.inspection?.status === "succeeded" ||
                result.value.inspection?.status === "failed"
              );
            }, 30000);
            assert.equal(result.status, 200);
            assert.equal(
              result.value.inspection.status,
              "succeeded",
              JSON.stringify(result.value),
            );
            assert.equal(result.value.inspection.result.width, 320);
            assert.equal(result.value.inspection.attempts, 1);
            assert.equal((await bob.c.request(`/uploads/${id}`)).status, 403);
          },
        );
      await t.test(
        "invalid declared size and unsupported content type are rejected",
        async () => {
          assert.equal(
            (
              await alice.c.request(
                `/projects/${project}/uploads`,
                "POST",
                { bytes: 104857601, sha256, contentType: "video/mp4" },
                { "idempotency-key": randomUUID() },
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await alice.c.request(
                `/projects/${project}/uploads`,
                "POST",
                { bytes: video.length, sha256, contentType: "text/html" },
                { "idempotency-key": randomUUID() },
              )
            ).status,
            400,
          );
          const intent = await alice.c.request(
            `/projects/${project}/uploads`,
            "POST",
            { bytes: video.length - 1, sha256, contentType: "video/mp4" },
            { "idempotency-key": randomUUID() },
          );
          assert.equal(intent.status, 201);
          uploads.push(intent.value.id);
          const response = await fetch(intent.value.url, {
            method: "PUT",
            headers: intent.value.headers,
            body: video,
          });
          assert.notEqual(response.status, 200);
          assert.equal(
            (await alice.c.request(`/uploads/${intent.value.id}`, "DELETE"))
              .status,
            200,
          );
        },
      );
      await t.test(
        "full-file SHA-256 is checked independently of provider metadata",
        async () => {
          const intent = await alice.c.request(
            `/projects/${project}/uploads`,
            "POST",
            {
              bytes: video.length,
              sha256: "0".repeat(64),
              contentType: "video/mp4",
              mode: "multipart",
            },
            { "idempotency-key": randomUUID() },
          );
          assert.equal(intent.status, 201);
          const id = intent.value.id;
          const part = await alice.c.request(`/uploads/${id}/parts`, "POST", {
            partNumber: 1,
            sha256,
          });
          assert.equal(part.status, 200);
          assert.equal(
            (
              await fetch(part.value.url, {
                method: "PUT",
                headers: part.value.headers,
                body: video,
              })
            ).status,
            200,
          );
          assert.equal(
            (await alice.c.request(`/uploads/${id}/confirm`, "POST", {}))
              .status,
            200,
          );
          let result;
          await eventually(async () => {
            result = await alice.c.request(`/uploads/${id}`);
            return result.value.inspection?.status === "failed";
          }, 30000);
          assert.equal(result.value.inspection.errorCode, "CHECKSUM_MISMATCH");
          assert.equal(result.value.inspection.attempts, 1);
        },
      );
      await t.test(
        "concurrent storage reservations respect the limit and idempotent replay does not double-charge",
        async () => {
          const before = await alice.c.request(
            `/projects/storage?workspaceId=${workspace}`,
          );
          assert.equal(before.status, 200);
          const data = {
            bytes: 104857600,
            sha256,
            contentType: "video/mp4",
            mode: "put",
          };
          const keys = Array.from({ length: 11 }, () => randomUUID());
          const results = await Promise.all(
            keys.map((key) =>
              alice.c.request(`/projects/${project}/uploads`, "POST", data, {
                "idempotency-key": key,
              }),
            ),
          );
          const admitted = results.filter((r) => r.status === 201);
          assert.equal(admitted.length, 10);
          assert.equal(results.filter((r) => r.status === 409).length, 1);
          const current = await alice.c.request(
            `/projects/storage?workspaceId=${workspace}`,
          );
          assert.equal(current.status, 200);
          assert.equal(
            current.value.reservedBytes,
            before.value.reservedBytes + 10 * data.bytes,
          );
          assert.ok(
            current.value.usedBytes + current.value.reservedBytes <=
              current.value.limitBytes,
          );
          const index = results.findIndex((r) => r.status === 201);
          assert.equal(
            (
              await alice.c.request(
                `/projects/${project}/uploads`,
                "POST",
                data,
                { "idempotency-key": keys[index] },
              )
            ).value.id,
            results[index].value.id,
          );
          assert.equal(
            (
              await alice.c.request(
                `/projects/storage?workspaceId=${workspace}`,
              )
            ).value.reservedBytes,
            current.value.reservedBytes,
          );
          for (const row of admitted)
            assert.equal(
              (await alice.c.request(`/uploads/${row.value.id}`, "DELETE"))
                .status,
              200,
            );
          assert.equal(
            (await bob.c.request(`/projects/storage?workspaceId=${workspace}`))
              .status,
            403,
          );
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await t.test(
      "team invitation is email-bound, roles restrict writing and ownership transfers safely",
      async () => {
        const team = await alice.c.request(
          "/workspaces",
          "POST",
          { name: "Team acceptance", kind: "team" },
          { "idempotency-key": randomUUID() },
        );
        assert.equal(team.status, 201);
        const teamId = team.value.id;
        const invite = await alice.c.request(
          `/workspaces/${teamId}/invitations`,
          "POST",
          { email: bob.email, role: "reader" },
          { "idempotency-key": randomUUID() },
        );
        assert.equal(invite.status, 201);
        const raw = await emailToken(bob.email, "invitation");
        assert.equal(
          (
            await alice.c.request("/workspaces/invitations/accept", "POST", {
              token: raw,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await bob.c.request("/workspaces/invitations/accept", "POST", {
              token: raw,
            })
          ).status,
          200,
        );
        assert.equal(
          (await bob.c.request(`/workspaces/${teamId}/members`)).status,
          200,
        );
        assert.equal(
          (
            await bob.c.request(
              "/projects",
              "POST",
              { workspaceId: teamId, name: "Reader forbidden" },
              { "idempotency-key": randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await alice.c.request(
              `/workspaces/${teamId}/members/${bob.id}`,
              "PATCH",
              { role: "editor" },
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await bob.c.request(
              "/projects",
              "POST",
              { workspaceId: teamId, name: "Editor allowed" },
              { "idempotency-key": randomUUID() },
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await bob.c.request(
              `/workspaces/${teamId}/members/${alice.id}`,
              "DELETE",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await alice.c.request(`/workspaces/${teamId}/ownership`, "POST", {
              userId: bob.id,
            })
          ).status,
          200,
        );
        const roster = await bob.c.request(`/workspaces/${teamId}/members`);
        assert.equal(
          roster.value.items.filter((m) => m.role === "owner").length,
          1,
        );
        assert.equal(
          roster.value.items.find((m) => m.userId === bob.id).role,
          "owner",
        );
        assert.equal(
          (
            await bob.c.request(
              `/workspaces/${teamId}/members/${bob.id}`,
              "DELETE",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await bob.c.request(
              `/workspaces/${teamId}/members/${alice.id}`,
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal(
          (await alice.c.request(`/workspaces/${teamId}/members`)).status,
          403,
        );
      },
    );
    await t.test(
      "refresh rotates and reuse revokes the complete session family",
      async () => {
        const stolen = alice.c.jar.get("autoclipper_refresh");
        const oldAccess = alice.c.jar.get("autoclipper_access");
        assert.equal(
          (await alice.c.request("/auth/refresh", "POST", {})).status,
          200,
        );
        assert.notEqual(alice.c.jar.get("autoclipper_refresh"), stolen);
        const validNewRefresh = alice.c.jar.get("autoclipper_refresh");
        alice.c.jar.set("autoclipper_refresh", stolen);
        assert.equal(
          (await alice.c.request("/auth/refresh", "POST", {})).status,
          401,
        );
        alice.c.jar.set("autoclipper_access", oldAccess);
        alice.c.jar.set("autoclipper_refresh", validNewRefresh);
        assert.equal((await alice.c.request("/auth/me")).status, 401);
        assert.equal(
          (await alice.c.request("/auth/refresh", "POST", {})).status,
          401,
        );
      },
    );
    await t.test(
      "password recovery revokes sessions and reset token is one-use",
      async () => {
        assert.equal(
          (
            await bob.c.request("/auth/password/forgot", "POST", {
              email: bob.email,
            })
          ).status,
          202,
        );
        const token = await emailToken(bob.email, "reset");
        assert.equal(
          (
            await bob.c.request("/auth/password/reset", "POST", {
              token,
              password: "New-test-password-2026!",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await bob.c.request("/auth/password/reset", "POST", {
              token,
              password: "New-test-password-2026!",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await bob.c.request("/auth/login", "POST", {
              email: bob.email,
              password,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await bob.c.request("/auth/login", "POST", {
              email: bob.email,
              password: "New-test-password-2026!",
            })
          ).status,
          200,
        );
        assert.equal(
          (await bob.c.request("/auth/logout", "POST", {})).status,
          200,
        );
        assert.equal((await bob.c.request("/auth/me")).status, 401);
      },
    );
    void uploads;
  },
);
