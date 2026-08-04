# Creator Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the theme store's anonymous device token into a creator account — a unique renameable nickname that signs every config, plus a backup/restore path so a reflash no longer orphans someone's published work.

**Architecture:** The hub's existing `devices` row *is* the creator profile (internal id stays the foreign key, a new unique nickname is the display handle). One new endpoint, `POST /api/v1/me`, returns the profile together with everything that device published, which demotes the router's local `hub_shares` file from authority to disposable cache. The backup artifact collapses to the 64-hex `device.key` itself.

**Tech Stack:** Cloudflare Workers + D1 + vitest (`openwrt-cloud/hub`); POSIX shell rpcd + LuCI client JS + `node --test` (`luci-app-aurora-config`).

**Spec:** `docs/specs/2026-08-04-creator-identity.md`

## Global Constraints

- **No compatibility logic.** `configs.author` and every read/write path for it is deleted, not deprecated. Live rows are disposable.
- **Nickname normalization is `cleanText()` → `trim()` → `toLowerCase()`.** `cleanText` (`src/validate.js:112`) strips control characters and NFC-normalizes but does **not** trim; skipping the trim lets `"Eamon "` claim a second slot past the unique index.
- **Nickname length: 1–40 characters** after normalization (matches the old `author` ceiling).
- **`POST /api/v1/me` answers 200 for every authenticated, well-formed request.** Conflicts ride in the body (`error: "nickname_taken" | "invalid_nickname"`). A 4xx is invisible to the only caller: `wget`/`uclient-fetch` exit non-zero with empty output on any HTTP error (`luci.aurora:336-345`), so `409` would reach the UI as "hub unreachable". A malformed `device_token` stays 400 — that is a bug, not a user-facing outcome.
- **`hub_export_key` is a `write` ACL method.** Handing out the key hands out account control.
- **Untrusted text stays untrusted.** Nicknames render through `document.createTextNode` only — see the header comment at `gallery.js:16-26`.
- **Never write a regex literal directly after an arrow** (`docs/DEVELOPMENT.md` §11). Bind it to a `const` first; `tests/jsmin-safety.test.mjs` enforces it.
- **User-facing copy describes results, not mechanism** — no "token", "schema", "409" in any string a user can see (`gallery.js:22-28`).

## File Structure

**Phase A — `/Users/eamon/Developer/github/openwrt-cloud/hub`**

| File | Responsibility |
| --- | --- |
| `migrations/0002_creator_identity.sql` | *new* — add `nickname`/`nickname_lc` + partial unique index |
| `migrations/0003_drop_config_author.sql` | *new* — drop `configs.author` |
| `src/validate.js` | add `validateNickname`; strip `author` out of `validateMeta` |
| `src/me.js` | *new* — the whole `/api/v1/me` handler |
| `src/configs.js` | export `extractPalette`; JOIN devices for display; stop writing `author` |
| `src/worker.js` | route `POST /api/v1/me` |
| `test/unit/validate.test.js` | nickname normalization cases |
| `test/integration/api.me.test.js` | *new* — profile read, own-configs list, rename, conflicts |

**Phase B — `/Users/eamon/Developer/github/luci-theme/luci-app-aurora-config`**

| File | Responsibility |
| --- | --- |
| `root/usr/libexec/rpcd/luci.aurora` | `hub_me`, `hub_set_nickname`, `hub_export_key`, `hub_import_key`; delete `hub_my_shares`; drop `author` from share/update |
| `root/usr/share/rpcd/acl.d/luci-app-aurora.json` | new methods by read/write |
| `htdocs/luci-static/resources/utils/hub-api.js` | rpc declares follow the rpcd surface |
| `htdocs/luci-static/resources/view/aurora/gallery.js` | identity in the publish panel; backup/import UI; three notices |
| `po/templates/aurora-config.pot` + `po/*/aurora-config.po` | new strings |
| `tests/rpcd-hub.test.mjs`, `tests/hub-api-module.test.mjs`, `tests/gallery-view.test.mjs` | assertions for the above |

**A note on the two test styles.** Phase A tests are real integration tests against a Miniflare D1 — write them first and watch them fail. Phase B's suite is source-grep assertions over the shell script and the view (see `tests/rpcd-hub.test.mjs`); they pin *shape*, not behaviour, so they catch regressions and typos but prove nothing about runtime. That is the established convention here — follow it, and treat Task B6's on-device pass as the real verification.

---

## Phase A — hub

### Task A1: Nickname validation + profile columns

**Files:**
- Create: `migrations/0002_creator_identity.sql`
- Modify: `src/validate.js` (append after `validateMeta`, currently ending at `:325`)
- Test: `test/unit/validate.test.js`

**Interfaces:**
- Consumes: `cleanText(value, makeError)` and `HttpError` from `src/auth.js`
- Produces: `validateNickname(value) -> {nickname: string, nickname_lc: string}`, throws `HttpError(400, "invalid_nickname")`. Columns `devices.nickname`, `devices.nickname_lc`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/validate.test.js`, and add `validateNickname` to the existing import list at the top of the file:

```js
describe("validateNickname", () => {
  it("trims before folding, so a padded name cannot claim a second slot", () => {
    expect(validateNickname("  Eamon  ")).toEqual({ nickname: "Eamon", nickname_lc: "eamon" });
  });

  it("keeps display casing but folds the uniqueness key", () => {
    expect(validateNickname("EaMoN")).toEqual({ nickname: "EaMoN", nickname_lc: "eamon" });
  });

  it("strips control characters", () => {
    expect(validateNickname("Eamon").nickname).toBe("Eamon");
  });

  it("rejects an all-whitespace nickname", () => {
    expectHttpError(() => validateNickname("   "), 400, "invalid_nickname");
  });

  it("rejects more than 40 characters", () => {
    expectHttpError(() => validateNickname("a".repeat(41)), 400, "invalid_nickname");
  });

  it("accepts exactly 40 characters", () => {
    expect(validateNickname("a".repeat(40)).nickname.length).toBe(40);
  });

  it("rejects non-strings", () => {
    expectHttpError(() => validateNickname(42), 400, "invalid_nickname");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- test/unit/validate.test.js`
Expected: FAIL — `validateNickname is not a function`.

- [ ] **Step 3: Implement**

Append to `src/validate.js`:

```js
export const NICKNAME_MAX = 40;

// The trim is load-bearing: cleanText only strips control characters and
// NFC-normalizes, so without it "Eamon " and "Eamon" fold to different
// nickname_lc values and both could be claimed past idx_devices_nick.
export function validateNickname(value) {
  const badNickname = () =>
    new HttpError(400, "invalid_nickname", `nickname must be 1-${NICKNAME_MAX} characters.`);

  if (typeof value !== "string") throw badNickname();
  const nickname = cleanText(value, badNickname).trim();
  if (nickname.length < 1 || nickname.length > NICKNAME_MAX) throw badNickname();

  return { nickname, nickname_lc: nickname.toLowerCase() };
}
```

- [ ] **Step 4: Add the migration**

Create `migrations/0002_creator_identity.sql`:

```sql
-- The devices row IS the creator profile: devices.id stays the immutable
-- internal key every config points at, while nickname is the renameable
-- display handle. nickname_lc holds the normalized form (trimmed +
-- lowercased) the unique index is built on, so "Eamon" and "eamon " cannot
-- both be claimed. The index is partial: any number of devices may have no
-- nickname at all.
ALTER TABLE devices ADD COLUMN nickname TEXT;
ALTER TABLE devices ADD COLUMN nickname_lc TEXT;

CREATE UNIQUE INDEX idx_devices_nick
  ON devices(nickname_lc) WHERE nickname_lc IS NOT NULL;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green (the migration is picked up automatically by `readD1Migrations` in `vitest.config.js`).

- [ ] **Step 6: Commit**

```bash
git add migrations/0002_creator_identity.sql src/validate.js test/unit/validate.test.js
git commit -m "feat(identity): claim the devices row as the creator profile"
```

---

### Task A2: `POST /api/v1/me` — read profile and own configs

**Files:**
- Create: `src/me.js`
- Modify: `src/configs.js:150` (export `extractPalette`), `src/worker.js` (import + route)
- Test: `test/integration/api.me.test.js` *(new)*

**Interfaces:**
- Consumes: `validateNickname` (A1, wired in A3), `deviceFromToken(db, token, {register})` from `src/auth.js`, `extractPalette(payload)` from `src/configs.js`
- Produces: `handleMe(request, env)`; response `{id, nickname, configs: [{id, name, downloads, assets_status, status, created_at, palette}]}`

- [ ] **Step 1: Write the failing test**

Create `test/integration/api.me.test.js`:

```js
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { makePayload, makeToken } from "../helpers.js";

const ME_URL = "https://example.com/api/v1/me";
const CONFIGS_URL = "https://example.com/api/v1/themes/aurora/configs";

function postMe(body) {
  return SELF.fetch(ME_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Each share needs a distinct content hash or idx_configs_dedup collapses
// the second one into a duplicate of the first.
async function share(token, name, tint) {
  const res = await SELF.fetch(CONFIGS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_token: token,
      name,
      payload: makePayload({ colors: { light_bg: tint } }),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

describe("POST /api/v1/me", () => {
  it("answers 200 with an empty profile for a key that never published", async () => {
    const res = await postMe({ device_token: makeToken() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: null, nickname: null, configs: [] });
  });

  it("rejects a malformed token with 400", async () => {
    const res = await postMe({ device_token: "nope" });
    expect(res.status).toBe(400);
  });

  it("lists everything this device published, newest first", async () => {
    const token = makeToken();
    await share(token, "First", "#111111");
    const second = await share(token, "Second", "#222222");

    const res = await postMe({ device_token: token });
    const body = await res.json();

    expect(body.id).toBeTruthy();
    expect(body.nickname).toBe(null);
    expect(body.configs.map((c) => c.name)).toEqual(["Second", "First"]);
    expect(body.configs[0].id).toBe(second);
    expect(body.configs[0].palette.light.bg).toBe("#222222");
  });

  it("does not leak another device's configs", async () => {
    const mine = makeToken();
    const theirs = makeToken();
    await share(mine, "Mine", "#333333");
    await share(theirs, "Theirs", "#444444");

    const body = await (await postMe({ device_token: mine })).json();
    expect(body.configs.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("still lists a config the author removed, marked removed", async () => {
    const token = makeToken();
    const id = await share(token, "Gone", "#555555");

    const del = await SELF.fetch(`${CONFIGS_URL}/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_token: token }),
    });
    expect(del.status).toBe(200);

    const body = await (await postMe({ device_token: token })).json();
    expect(body.configs).toHaveLength(1);
    expect(body.configs[0].status).toBe("removed");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- test/integration/api.me.test.js`
Expected: FAIL — every case 404s, the route does not exist.

- [ ] **Step 3: Export the palette helper**

In `src/configs.js`, change the declaration at `:150`:

```js
export function extractPalette(payload) {
```

- [ ] **Step 4: Implement the handler**

Create `src/me.js`:

```js
// POST /api/v1/me — the creator profile endpoint.
//
// Deliberately not REST-pure about conflicts: every authenticated,
// well-formed request answers 200 and reports trouble in the body. The only
// caller is the router's rpcd, which reaches the hub through
// wget/uclient-fetch -- those exit non-zero with empty output on any 4xx, so
// by the time a 409 reached the LuCI page it would be indistinguishable from
// "the hub is down". A malformed token still fails loudly: that is a bug in
// the caller, not an outcome a user can act on.

import { HttpError, deviceFromToken } from "./auth.js";
import { extractPalette } from "./configs.js";
import { jsonResponse, errorResponse, readJsonBounded } from "./http.js";

const SMALL_BODY_BYTES = 4096;

// No status filter: an author must be able to see that their own config was
// taken down, which the public browse endpoints deliberately hide.
async function listOwnConfigs(db, deviceId) {
  const { results } = await db
    .prepare(
      `SELECT id, name, downloads, assets_status, status, created_at, payload
         FROM configs
        WHERE device_id = ?
        ORDER BY created_at DESC, id ASC`
    )
    .bind(deviceId)
    .all();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    downloads: row.downloads,
    assets_status: row.assets_status,
    status: row.status,
    created_at: row.created_at,
    palette: extractPalette(JSON.parse(row.payload)),
  }));
}

async function me(request, env) {
  const body = await readJsonBounded(request, SMALL_BODY_BYTES);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "bad_json", "Request body must be a JSON object.");
  }

  const device = await deviceFromToken(env.DB, body.device_token, { register: false });

  // An imported backup whose account never published looks exactly like this.
  // It is a legitimate state, not a failure.
  if (!device) {
    return jsonResponse({ id: null, nickname: null, configs: [] });
  }
  if (device.banned) {
    throw new HttpError(403, "device_banned", "This device has been banned.");
  }

  return jsonResponse({
    id: device.id,
    nickname: device.nickname ?? null,
    configs: await listOwnConfigs(env.DB, device.id),
  });
}

export async function handleMe(request, env) {
  try {
    return await me(request, env);
  } catch (err) {
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.code, err.message);
    }
    console.error(err);
    return errorResponse(500, "internal_error", "Something went wrong.");
  }
}
```

- [ ] **Step 5: Route it**

In `src/worker.js`, add the import next to the others and the route after the `/api/v1/ping` line:

```js
import { handleMe } from "./me.js";
```

```js
// Body is just {device_token, nickname?}; handleMe applies its own small cap.
router.add("POST", "/api/v1/me", (request, env) => handleMe(request, env));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 7: Commit**

```bash
git add src/me.js src/configs.js src/worker.js test/integration/api.me.test.js
git commit -m "feat(identity): add POST /api/v1/me returning profile and own configs"
```

---

### Task A3: Setting and renaming the nickname

**Files:**
- Modify: `src/me.js`
- Test: `test/integration/api.me.test.js`

**Interfaces:**
- Consumes: `validateNickname` (A1), `handleMe` (A2)
- Produces: same response shape plus an optional `error` field: `"nickname_taken" | "invalid_nickname"`. A request carrying `nickname` registers the device if the token is new.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/api.me.test.js` (inside the same `describe`):

```js
  it("sets a nickname on a key that has never been seen", async () => {
    const body = await (await postMe({ device_token: makeToken(), nickname: "Eamon" })).json();
    expect(body.nickname).toBe("Eamon");
    expect(body.id).toBeTruthy();
  });

  it("keeps the nickname on later reads", async () => {
    const token = makeToken();
    await postMe({ device_token: token, nickname: "Persisted" });
    const body = await (await postMe({ device_token: token })).json();
    expect(body.nickname).toBe("Persisted");
  });

  it("refuses a nickname another device already holds, case-insensitively", async () => {
    await postMe({ device_token: makeToken(), nickname: "Taken" });

    const res = await postMe({ device_token: makeToken(), nickname: "  tAkEn  " });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBe("nickname_taken");
    expect(body.nickname).toBe(null);
  });

  it("lets a device re-assert the nickname it already holds", async () => {
    const token = makeToken();
    await postMe({ device_token: token, nickname: "Stable" });
    const body = await (await postMe({ device_token: token, nickname: "Stable" })).json();
    expect(body.error).toBeUndefined();
    expect(body.nickname).toBe("Stable");
  });

  it("renames, and every existing config signs with the new name", async () => {
    const token = makeToken();
    await postMe({ device_token: token, nickname: "Before" });
    const id = await share(token, "Signed", "#666666");

    const renamed = await (await postMe({ device_token: token, nickname: "After" })).json();
    expect(renamed.nickname).toBe("After");

    // Display name is joined at read time, so history follows the rename.
    const detail = await (await SELF.fetch(`${CONFIGS_URL}/${id}`)).json();
    expect(detail.author).toBe("After");
  });

  it("frees the old name after a rename", async () => {
    const first = makeToken();
    await postMe({ device_token: first, nickname: "Released" });
    await postMe({ device_token: first, nickname: "Moved" });

    const body = await (await postMe({ device_token: makeToken(), nickname: "Released" })).json();
    expect(body.error).toBeUndefined();
    expect(body.nickname).toBe("Released");
  });

  it("reports an invalid nickname in the body, not as a 4xx", async () => {
    const res = await postMe({ device_token: makeToken(), nickname: "   " });
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe("invalid_nickname");
  });
```

Note: the rename test asserts `detail.author`, which only starts working in **Task A4**. Expect it to stay red until then — that is the intended sequence, and A4's step 6 re-runs it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- test/integration/api.me.test.js`
Expected: FAIL — nickname is ignored, every `body.nickname` is `null`.

- [ ] **Step 3: Implement**

In `src/me.js`, add the import:

```js
import { validateNickname } from "./validate.js";
```

Replace the body of `me()` from the `deviceFromToken` call onward:

```js
  // Registration only happens on a write: a plain profile read must never
  // create a devices row, or every reflashed router would litter the table.
  const wantsRename = body.nickname !== undefined;
  const device = await deviceFromToken(env.DB, body.device_token, { register: wantsRename });

  // An imported backup whose account never published looks exactly like this.
  // It is a legitimate state, not a failure.
  if (!device) {
    return jsonResponse({ id: null, nickname: null, configs: [] });
  }
  if (device.banned) {
    throw new HttpError(403, "device_banned", "This device has been banned.");
  }

  let profile = device;

  if (wantsRename) {
    let normalized;
    try {
      normalized = validateNickname(body.nickname);
    } catch {
      // Reported in-body for the same reason as nickname_taken; see the file
      // header. The client already length-checks, so this is the belt.
      return jsonResponse({
        id: device.id,
        nickname: device.nickname ?? null,
        configs: [],
        error: "invalid_nickname",
      });
    }

    // Re-asserting the name you already hold is a no-op, not a conflict.
    if (normalized.nickname_lc !== device.nickname_lc) {
      const conflict = {
        id: device.id,
        nickname: device.nickname ?? null,
        configs: [],
        error: "nickname_taken",
      };

      const taken = await env.DB.prepare("SELECT id FROM devices WHERE nickname_lc = ?")
        .bind(normalized.nickname_lc)
        .first();
      if (taken) return jsonResponse(conflict);

      try {
        await env.DB.prepare("UPDATE devices SET nickname = ?, nickname_lc = ? WHERE id = ?")
          .bind(normalized.nickname, normalized.nickname_lc, device.id)
          .run();
      } catch {
        // Race: another device claimed it between the SELECT and the UPDATE.
        // idx_devices_nick is the actual arbiter; the SELECT is only a
        // cheaper first pass.
        return jsonResponse(conflict);
      }

      profile = { ...device, nickname: normalized.nickname, nickname_lc: normalized.nickname_lc };
    }
  }

  return jsonResponse({
    id: profile.id,
    nickname: profile.nickname ?? null,
    configs: await listOwnConfigs(env.DB, profile.id),
  });
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- test/integration/api.me.test.js`
Expected: every case PASSes except `"renames, and every existing config signs with the new name"`, which fails on `detail.author` — A4 delivers that.

- [ ] **Step 5: Commit**

```bash
git add src/me.js test/integration/api.me.test.js
git commit -m "feat(identity): claim and rename creator nicknames"
```

---

### Task A4: Signing comes from the profile, not the request

**Files:**
- Create: `migrations/0003_drop_config_author.sql`
- Modify: `src/validate.js` (`validateMeta`, `:309-325`), `src/configs.js` (list `:161-195`, detail `:201-238`, share `:240-329`, update `:421-529`)
- Test: `test/integration/api.share.test.js`, `test/integration/api.browse.test.js`, `test/integration/api.manage.test.js`, `test/unit/validate.test.js`

**Interfaces:**
- Consumes: `devices.nickname` (A1)
- Produces: list and detail responses keep the `author` **field name** (now the joined nickname, `""` when unset) and gain `author_id`. `validateMeta({name, description}) -> {name, description}` — no `author`.

- [ ] **Step 1: Write the failing test**

Append to `test/integration/api.share.test.js`:

```js
it("signs a config with the creator profile and ignores any author in the body", async () => {
  const token = makeToken();
  await SELF.fetch("https://example.com/api/v1/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_token: token, nickname: "Signed By Profile" }),
  });

  const res = await SELF.fetch(CONFIGS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_token: token,
      name: "Attributed",
      author: "Someone Else",
      payload: makePayload({ colors: { light_bg: "#0a0a0a" } }),
    }),
  });
  expect(res.status).toBe(201);
  const { id } = await res.json();

  const detail = await (await SELF.fetch(`${CONFIGS_URL}/${id}`)).json();
  expect(detail.author).toBe("Signed By Profile");
  expect(detail.author_id).toBeTruthy();
});

it("signs an anonymous device with an empty author", async () => {
  const res = await SELF.fetch(CONFIGS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_token: makeToken(),
      name: "Unsigned",
      payload: makePayload({ colors: { light_bg: "#0b0b0b" } }),
    }),
  });
  const { id } = await res.json();

  const detail = await (await SELF.fetch(`${CONFIGS_URL}/${id}`)).json();
  expect(detail.author).toBe("");
});
```

In `test/unit/validate.test.js`, replace every `validateMeta` case that asserts on `author` with:

```js
it("no longer accepts an author -- signing comes from the profile", () => {
  expect(validateMeta({ name: "Fine", author: "ignored", description: "" })).toEqual({
    name: "Fine",
    description: "",
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `detail.author` is `"Someone Else"`, `author_id` is undefined, and the `validateMeta` case still returns an `author` key.

- [ ] **Step 3: Drop author from validation**

In `src/validate.js`, rewrite `validateMeta` (`:309`):

```js
// Signing is an account property, resolved by JOIN at read time -- it is not
// a publish parameter, so no author is accepted here.
export function validateMeta({ name, description } = {}) {
  if (typeof name !== "string") throw badMeta("name is required.");
  const cleanedName = cleanText(name, badMeta);
  if (cleanedName.length < 1 || cleanedName.length > 60) throw badMeta("name must be 1-60 characters.");

  const rawDescription = description ?? "";
  if (typeof rawDescription !== "string") throw badMeta("description must be a string.");
  const cleanedDescription = cleanText(rawDescription, badMeta);
  if (cleanedDescription.length > 500) throw badMeta("description must be at most 500 characters.");

  return { name: cleanedName, description: cleanedDescription };
}
```

- [ ] **Step 4: Join the profile in on read**

In `src/configs.js`, `listConfigs` (`:169-192`) — note the `ORDER BY` columns need the `c.` prefix now:

```js
  const orderBy = sort === "new" ? "c.created_at DESC, c.id ASC" : "c.downloads DESC, c.id ASC";

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.downloads, c.assets_status, c.created_at, c.payload, c.name,
            d.id AS author_id, d.nickname AS author
       FROM configs c
       JOIN devices d ON d.id = c.device_id
      WHERE c.theme = ? AND c.status = 'active'
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`
  )
    .bind(theme, PAGE_SIZE + 1, offset)
    .all();

  const has_more = results.length > PAGE_SIZE;
  const items = results.slice(0, PAGE_SIZE).map((row) => ({
    id: row.id,
    name: row.name,
    author: row.author ?? "",
    author_id: row.author_id,
    downloads: row.downloads,
    assets_status: row.assets_status,
    created_at: row.created_at,
    palette: extractPalette(JSON.parse(row.payload)),
  }));
```

And `getConfigDetail` (`:202-237`):

```js
  const row = await env.DB.prepare(
    `SELECT c.*, d.id AS author_id, d.nickname AS author
       FROM configs c
       JOIN devices d ON d.id = c.device_id
      WHERE c.theme = ? AND c.id = ? AND c.status = 'active'`
  )
    .bind(theme, id)
    .first();
```

…and in the `jsonResponse` at the end of that function, replace `author: row.author,` with:

```js
    author: row.author ?? "",
    author_id: row.author_id,
```

`c.*` is only unambiguous once `configs.author` is gone — that is Step 6, and both land in the same commit.

- [ ] **Step 5: Stop writing author**

In `src/configs.js`, `shareConfig`: change the `validateMeta` call (`:256`) to

```js
  const meta = validateMeta({ name: body.name, description: body.description });
```

then drop `author` from the INSERT (`:287-301`) — the column list becomes
`(id, theme, device_id, name, description, payload, content_hash, schema, assets_status)`,
the placeholder list loses one `?`, and `meta.author,` comes out of the `.bind(...)`.

In `updateConfig`: the same one-line `validateMeta` change at `:427`, then in the UPDATE at `:490-494` drop `author = ?` from the SET clause and `meta.author` from the `.bind(...)`.

- [ ] **Step 6: Drop the column**

Create `migrations/0003_drop_config_author.sql`:

```sql
-- Signing moved to devices.nickname, joined at read time. Nothing reads or
-- writes configs.author any more, and no index references it.
ALTER TABLE configs DROP COLUMN author;
```

- [ ] **Step 7: Fix the remaining fixtures**

Run: `npm test`

Any leftover failures are call sites still passing or asserting `author` in `test/integration/api.share.test.js`, `api.browse.test.js`, `api.manage.test.js` and `src/admin.js:60,76`. For `src/admin.js`, the pending-list query selects `c.author` — join the profile there too:

```js
    `SELECT c.id AS config_id, c.name, d.nickname AS author, c.created_at,
```

…with `JOIN devices d ON d.id = c.device_id` added to its FROM clause, and `author: row.author ?? ""` in the mapping at `:76`.

Expected after fixing: whole suite green, including A3's rename test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(identity): sign configs from the creator profile, drop configs.author"
```

---

## Deployment gate

Phase B talks to a deployed hub. Do not start it until:

- [ ] `npm test` is green in `openwrt-cloud/hub`
- [ ] `npx wrangler deploy` has run, and the migrations were applied to the production D1 (`npx wrangler d1 migrations apply <db> --remote`)
- [ ] A live smoke test answers:

```bash
curl -s -X POST https://themes.eamonxg.fun/api/v1/me \
  -H 'content-type: application/json' \
  -d '{"device_token":"'"$(head -c32 /dev/urandom | hexdump -v -e '/1 "%02x"')"'"}'
# expect: {"id":null,"nickname":null,"configs":[]}
```

Old routers keep publishing while this rolls out: they still send `author`, and `validateMeta` now simply ignores unknown fields. No compatibility code is involved.

---

## Phase B — config app

### Task B1: `hub_me` replaces `hub_my_shares`

**Files:**
- Modify: `root/usr/libexec/rpcd/luci.aurora` (list block `:1840`, handler `:2427-2462`), `root/usr/share/rpcd/acl.d/luci-app-aurora.json`, `htdocs/luci-static/resources/utils/hub-api.js:124-127`, `htdocs/luci-static/resources/view/aurora/gallery.js:990,998-1000,1424-1427,2100-2102`
- Test: `tests/rpcd-hub.test.mjs`, `tests/hub-api-module.test.mjs`, `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: `POST /api/v1/me` (A2)
- Produces: rpcd method `hub_me` → `{result:0, data:{id, nickname, configs:[…]}}`; `hubApi.callHubMe()`; `gallery.js` state `profile = {id, nickname}` and `myShares = data.configs`

- [ ] **Step 1: Write the failing test**

In `tests/rpcd-hub.test.mjs`, append:

```js
test("rpcd script: hub_me replaces hub_my_shares", () => {
  assert.ok(rpcd.includes('json_add_object "hub_me"'), "hub_me not registered");
  assert.ok(!rpcd.includes("hub_my_shares"), "hub_my_shares must be gone");
  assert.match(rpcd, /hub_http_post "\/api\/v1\/me"/);
  // The local id list is no longer authoritative -- the hub is.
  assert.ok(!rpcd.includes("$DEVICE_DIR/hub_shares"), "hub_shares must no longer be read");
});

test("acl: hub_me is readable, and no write method leaked into read", () => {
  const parsed = JSON.parse(acl);
  const read = parsed["luci-app-aurora"].read.ubus["luci.aurora"];
  assert.ok(read.includes("hub_me"), "hub_me missing from read");
  assert.ok(!read.includes("hub_my_shares"), "stale hub_my_shares in acl");
});
```

In `tests/hub-api-module.test.mjs`:

```js
test("hub-api exposes callHubMe and drops callHubMyShares", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubMe"), "missing callHubMe");
  assert.ok(!src.includes("callHubMyShares"), "callHubMyShares must be gone");
  assert.match(src, /method:\s*"hub_me"/);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `hub_me not registered`.

- [ ] **Step 3: Add the rpcd handler**

In `root/usr/libexec/rpcd/luci.aurora`, replace the `json_add_object "hub_my_shares"; json_close_object` line (`:1840`) with:

```sh
	json_add_object "hub_me"; json_close_object
```

Replace the whole `"hub_my_shares")` case (`:2427-2462`, including its long comment) with:

```sh
	"hub_me")
		# The creator profile plus everything this key published. The hub is
		# the authority: $DEVICE_DIR/hub_shares is not consulted at all, which
		# is what makes a reflash survivable -- restore device.key and the
		# list comes back on its own.
		ensure_device_identity

		me_body_tmp=$(mktemp)
		printf '{"device_token":"%s"}' "$DEVICE_TOKEN" > "$me_body_tmp"

		if me_body=$(hub_http_post "/api/v1/me" "$me_body_tmp"); then
			printf '{ "result": 0, "data": %s }\n' "$me_body"
		else
			echo '{ "result": 1, "error": "hub_unreachable" }'
		fi
		rm -f "$me_body_tmp"
		;;
```

Then delete the two `hub_shares` writes that are now pointless: the `printf '%s\n' "$share_id" >> "$DEVICE_DIR/hub_shares"` block in `hub_share` (`:2412-2413`, keep the surrounding `json_init`/`json_add_*` response) and the `grep -v -x` block in `hub_delete` (`:2547-2550`).

- [ ] **Step 4: Move the ACL entry**

In `root/usr/share/rpcd/acl.d/luci-app-aurora.json`, in `read.ubus["luci.aurora"]`, replace `"hub_my_shares"` with `"hub_me"`.

- [ ] **Step 5: Update the client declare**

In `htdocs/luci-static/resources/utils/hub-api.js`, replace the `callHubMyShares` declare (`:124-127`) with:

```js
  callHubMe: rpc.declare({
    object: "luci.aurora",
    method: "hub_me",
  }),
```

- [ ] **Step 6: Wire the view**

In `gallery.js`, `load()` (`:990`): `hubApi.callHubMyShares()` → `hubApi.callHubMe()`, and rename the destructured `mySharesRes` → `meRes` in the `.then` (`:998-1000`).

Add the profile state next to `let myShares = [];` (`:1543`):

```js
    // Whoever this router publishes as. null nickname = never named.
    let profile = { id: null, nickname: null };
```

`refreshMyShares` (`:1424-1427`) becomes:

```js
    const refreshMyShares = () =>
      L.resolveDefault(hubApi.callHubMe(), null).then((res) => {
        const data = (res && res.result === 0 && res.data) || null;
        profile = { id: (data && data.id) || null, nickname: (data && data.nickname) || null };
        renderMyShares((data && data.configs) || []);
      });
```

And the boot call (`:2100-2102`):

```js
    const meData =
      loadData.meRes && loadData.meRes.result === 0 ? loadData.meRes.data : null;
    profile = { id: (meData && meData.id) || null, nickname: (meData && meData.nickname) || null };
    renderMyShares((meData && meData.configs) || []);
```

- [ ] **Step 7: Verify**

```bash
sh -n root/usr/libexec/rpcd/luci.aurora
node --check htdocs/luci-static/resources/view/aurora/gallery.js
npm test
```
Expected: all clean, suite green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(store): read my shares from the hub profile, not a local id list"
```

---

### Task B2: Export and import the creator key

**Files:**
- Modify: `root/usr/libexec/rpcd/luci.aurora`, `root/usr/share/rpcd/acl.d/luci-app-aurora.json`, `htdocs/luci-static/resources/utils/hub-api.js`
- Test: `tests/rpcd-hub.test.mjs`, `tests/hub-api-module.test.mjs`

**Interfaces:**
- Produces: `hub_export_key` → `{result:0, key:"<64 hex>"}`; `hub_import_key {key}` → `{result:0}` or `{result:1, error:"invalid_key"}`; `hubApi.callHubExportKey()`, `hubApi.callHubImportKey(key)`

- [ ] **Step 1: Write the failing test**

In `tests/rpcd-hub.test.mjs`:

```js
test("rpcd script: key export/import exist and validate the shape", () => {
  assert.ok(rpcd.includes('"hub_export_key")'), "hub_export_key handler missing");
  assert.ok(rpcd.includes('"hub_import_key")'), "hub_import_key handler missing");
  // Same rule as the hub's TOKEN_PATTERN: exactly 64 lowercase hex.
  assert.match(rpcd, /\[ "\$\{#key\}" -eq 64 \]/);
  assert.match(rpcd, /\*\[!a-f0-9\]\*\)/);
  assert.match(rpcd, /chmod 600 "\$DEVICE_DIR\/device\.key\.tmp"/);
  // The previous identity's cached id list must not survive an import.
  assert.match(rpcd, /rm -f "\$DEVICE_DIR\/hub_shares"/);
  // Both "the key is somewhere else now" paths persist the flag in rpcd --
  // gallery.js is a browse-only view with no uci write path.
  assert.ok(
    rpcd.split("hub_key_saved").length - 1 >= 2,
    "both export and import must record hub_key_saved",
  );
});

test("acl: exporting the key is a write capability", () => {
  const parsed = JSON.parse(acl);
  const { read, write } = parsed["luci-app-aurora"];
  const readable = read.ubus["luci.aurora"];
  const writable = write.ubus["luci.aurora"];
  // Handing out the key hands out account control -- read access must not.
  assert.ok(!readable.includes("hub_export_key"), "hub_export_key must not be readable");
  assert.ok(writable.includes("hub_export_key"), "hub_export_key missing from write");
  assert.ok(writable.includes("hub_import_key"), "hub_import_key missing from write");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `hub_export_key handler missing`.

- [ ] **Step 3: Register both methods**

In the `"list")` block, after the `hub_me` line:

```sh
	json_add_object "hub_export_key"; json_close_object
	json_add_object "hub_import_key"
		json_add_string "key" "key"
	json_close_object
```

- [ ] **Step 4: Implement the handlers**

Add after the `"hub_me")` case:

```sh
	"hub_export_key")
		# device.key IS the account password: whoever holds it can publish as
		# this creator and delete their work. That is why this sits behind the
		# write ACL rather than read.
		ensure_device_identity

		# Handing the key out once is enough to stop nagging: it has been
		# rendered into a browser by now, downloaded or copied. The flag only
		# collapses the reminder bar -- it is not a claim that the user
		# actually stored it safely, and nothing depends on it being true.
		uci -q set aurora.theme.hub_key_saved='1'
		uci -q commit aurora

		json_init
		json_add_int "result" 0
		json_add_string "key" "$DEVICE_TOKEN"
		json_dump; json_cleanup
		;;

	"hub_import_key")
		read -r input; json_load "$input" 2>/dev/null
		json_get_var key "key"
		json_cleanup

		# Same rule as the hub's TOKEN_PATTERN. Length first, then a
		# character-class sweep, so nothing but 64 hex ever reaches the
		# credential file.
		[ "${#key}" -eq 64 ] || {
			echo '{ "result": 1, "error": "invalid_key" }'; exit 0; }
		case "$key" in *[!a-f0-9]*)
			echo '{ "result": 1, "error": "invalid_key" }'; exit 0 ;;
		esac

		mkdir -p "$DEVICE_DIR"
		# write-tmp-then-mv: a concurrent hub_share must never read a
		# half-written key and authenticate as nobody.
		printf '%s' "$key" > "$DEVICE_DIR/device.key.tmp"
		chmod 600 "$DEVICE_DIR/device.key.tmp"
		mv "$DEVICE_DIR/device.key.tmp" "$DEVICE_DIR/device.key"

		# Any cached list belongs to the identity being replaced.
		rm -f "$DEVICE_DIR/hub_shares"

		# An imported key is by definition stored somewhere else already, so
		# the backup nag has nothing left to ask for.
		uci -q set aurora.theme.hub_key_saved='1'
		uci -q commit aurora

		echo '{ "result": 0 }'
		;;
```

- [ ] **Step 5: ACL**

In `write.ubus["luci.aurora"]`, add `"hub_export_key"` and `"hub_import_key"`.

- [ ] **Step 6: Client declares**

In `hub-api.js`:

```js
  callHubExportKey: rpc.declare({
    object: "luci.aurora",
    method: "hub_export_key",
  }),

  callHubImportKey: rpc.declare({
    object: "luci.aurora",
    method: "hub_import_key",
    params: ["key"],
  }),
```

- [ ] **Step 7: Verify**

```bash
sh -n root/usr/libexec/rpcd/luci.aurora
python3 -c "import json;json.load(open('root/usr/share/rpcd/acl.d/luci-app-aurora.json'))"
npm test
```
Expected: clean, green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(store): export and import the creator key"
```

---

### Task B3: Nickname becomes an account property

**Files:**
- Modify: `root/usr/libexec/rpcd/luci.aurora` (list block, `hub_share` `:2359-2425`, `hub_update` `:2464-2530`), `root/usr/share/rpcd/acl.d/luci-app-aurora.json`, `htdocs/luci-static/resources/utils/hub-api.js:118-133`
- Test: `tests/rpcd-hub.test.mjs`, `tests/hub-api-module.test.mjs`

**Interfaces:**
- Consumes: `POST /api/v1/me` with `nickname` (A3)
- Produces: `hub_set_nickname {nickname}` → `{result:0, data:{id, nickname, error?}}`; `hub_share` and `hub_update` lose their `author` parameter

- [ ] **Step 1: Write the failing test**

In `tests/rpcd-hub.test.mjs`:

```js
test("rpcd script: nickname is set through its own write method", () => {
  assert.ok(rpcd.includes('"hub_set_nickname")'), "hub_set_nickname handler missing");
  assert.match(rpcd, /json_add_string "nickname" "nickname"/);
});

test("rpcd script: publishing no longer carries an author", () => {
  // Signing is an account property now; the share/update bodies must not
  // even mention it, or a client could still try to sign as someone else.
  assert.ok(!rpcd.includes('json_get_var author "author"'), "author still read from the call");
  assert.ok(!rpcd.includes("invalid_author"), "stale author validation");
  assert.ok(!rpcd.includes('"author":"%s"'), "author still sent to the hub");
});
```

In `tests/hub-api-module.test.mjs`:

```js
test("hub-api: share/update drop the author parameter", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /method:\s*"hub_share"[\s\S]{0,120}params:\s*\["name", "description"\]/);
  assert.match(src, /method:\s*"hub_update"[\s\S]{0,120}params:\s*\["id", "name", "description"\]/);
  assert.ok(src.includes("callHubSetNickname"), "missing callHubSetNickname");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `hub_set_nickname handler missing`.

- [ ] **Step 3: Register and implement**

In the `"list")` block, replace the `hub_share` and `hub_update` objects with their author-free versions and add the new method:

```sh
	json_add_object "hub_share"
		json_add_string "name" "name"
		json_add_string "description" "description"
	json_close_object
	json_add_object "hub_set_nickname"
		json_add_string "nickname" "nickname"
	json_close_object
	json_add_object "hub_update"
		json_add_string "id" "id"
		json_add_string "name" "name"
		json_add_string "description" "description"
	json_close_object
```

Add the handler next to `hub_me`:

```sh
	"hub_set_nickname")
		read -r input; json_load "$input" 2>/dev/null
		json_get_var nickname "nickname"
		json_cleanup

		has_control_char "$nickname" && {
			echo '{ "result": 1, "error": "invalid_nickname" }'; exit 0; }
		nickname_len=${#nickname}
		[ "$nickname_len" -ge 1 ] && [ "$nickname_len" -le 40 ] || {
			echo '{ "result": 1, "error": "invalid_nickname" }'; exit 0; }

		ensure_device_identity

		nickname_esc=$(json_escape_string "$nickname")
		nick_body_tmp=$(mktemp)
		printf '{"device_token":"%s","nickname":"%s"}' "$DEVICE_TOKEN" "$nickname_esc" \
			> "$nick_body_tmp"

		# The hub answers 200 even for "that name is taken" -- wget collapses
		# every 4xx into the same failure as an unreachable host, so the
		# conflict rides in the body. Pass it straight through; gallery.js
		# turns data.error into the user-facing sentence.
		if nick_body=$(hub_http_post "/api/v1/me" "$nick_body_tmp"); then
			printf '{ "result": 0, "data": %s }\n' "$nick_body"
		else
			echo '{ "result": 1, "error": "hub_unreachable" }'
		fi
		rm -f "$nick_body_tmp"
		;;
```

- [ ] **Step 4: Strip author from share/update**

In the `"hub_share")` case: delete `json_get_var author "author"`, delete the two-block author validation (`has_control_char "$author"` and the length check), delete `author_esc=$(json_escape_string "$author")`, and change the request body `printf` to:

```sh
		printf '{"device_token":"%s","name":"%s","description":"%s","payload":%s,"assets":%s}' \
			"$DEVICE_TOKEN" "$name_esc" "$description_esc" \
			"$share_payload_json" "$share_assets_json" \
			> "$share_body_tmp"
```

Make the same four deletions in `"hub_update")`, with the body `printf` becoming:

```sh
		printf '{"device_token":"%s","name":"%s","description":"%s","payload":%s,"assets":%s}' \
			"$DEVICE_TOKEN" "$name_esc" "$description_esc" \
			"$update_payload_json" "$update_assets_json" \
			> "$update_body_tmp"
```

- [ ] **Step 5: ACL + client declares**

Add `"hub_set_nickname"` to `write.ubus["luci.aurora"]`.

In `hub-api.js`, update the two declares and add the new one:

```js
  callHubShare: rpc.declare({
    object: "luci.aurora",
    method: "hub_share",
    params: ["name", "description"],
  }),

  callHubSetNickname: rpc.declare({
    object: "luci.aurora",
    method: "hub_set_nickname",
    params: ["nickname"],
  }),

  callHubUpdate: rpc.declare({
    object: "luci.aurora",
    method: "hub_update",
    params: ["id", "name", "description"],
  }),
```

- [ ] **Step 6: Fix the now-broken callers**

`gallery.js` still calls both with an author argument (`:1453-1458`, `:1739`). Drop the argument from each:

```js
            hubApi.callHubUpdate(item.id, item.name, item.description || ""),
```

```js
      L.resolveDefault(hubApi.callHubShare(name, description), null).then(
```

- [ ] **Step 7: Verify**

```bash
sh -n root/usr/libexec/rpcd/luci.aurora
node --check htdocs/luci-static/resources/view/aurora/gallery.js
npm test
```
Expected: clean, green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(store): make the creator nickname an account property"
```

---

### Task B4: Identity in the publish panel

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js` (`:31` `HUB_NICK_KEY`, `:1706-1712` the nickname input, `:1729-1763` `doSubmit`, `:1819-1824` the field list, `:782` the error map)
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: `profile` and `hubApi.callHubSetNickname` (B1, B3)
- Produces: publish panel shows the nickname field only when `profile.nickname` is null; otherwise a "publishing as X · #id" line with a rename control

- [ ] **Step 1: Write the failing test**

In `tests/gallery-view.test.mjs`:

```js
test("gallery view: the nickname is account state, not a publish field", async () => {
  const src = await readFile(SRC, "utf8");
  // The hub owns the nickname now; a localStorage copy would go stale the
  // moment the user renames from another browser.
  assert.ok(!src.includes("HUB_NICK_KEY"), "stale localStorage nickname cache");
  assert.ok(!src.includes("aurora.hub.nick"), "stale localStorage key");
  assert.ok(src.includes("callHubSetNickname"), "nickname must be set through its own call");
  // Identity is shown, not re-typed, once it exists.
  assert.ok(src.includes("profile.nickname"), "publish panel must read the profile");
});

test("gallery view: a taken nickname reads as a result, not a code", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /nickname_taken:\s*_\(/);
  assert.ok(!/_\("nickname_taken"\)/.test(src), "raw error code must not surface");
  assert.ok(!src.includes("invalid_author"), "author copy outlived the author field");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `stale localStorage nickname cache`.

- [ ] **Step 3: Delete the localStorage cache**

Remove `const HUB_NICK_KEY = "aurora.hub.nick";` (`:31`), the `value:` line from `authorInput` (`:1711`), and the `localStorage.setItem(HUB_NICK_KEY, author)` line in `doSubmit` (`:1742`).

- [ ] **Step 4: Add the copy**

In `SHARE_ERROR_COPY` (`:789-796`), drop the now-dead `invalid_author` entry and add:

```js
  nickname_taken: _("That name is already taken. Try another."),
  invalid_nickname: _("Pick a name between 1 and 40 characters."),
```

Add a resolver next to `shareErrorMessage` (`:798`):

```js
const nicknameErrorMessage = (code) =>
  SHARE_ERROR_COPY[code] || _("Couldn't save that name. Try again.");
```

- [ ] **Step 5: Rework the field**

Rename `authorInput` to `nicknameInput` throughout, then replace the `field(_("Nickname"), authorInput)` entry (`:1822`) with a builder:

```js
    // Identity is asked for once. After that it is shown, not re-typed --
    // re-offering a filled-in box every publish invites people to think the
    // signature is per-config, which is exactly what this change removes.
    const buildIdentityField = () => {
      if (!profile.nickname) return field(_("Publish as"), nicknameInput);

      const renameBtn = E(
        "button",
        { type: "button", class: "cbi-button", click: () => promptRename() },
        _("Change"),
      );

      return E("div", { class: "aurora-store-field" }, [
        E("label", {}, _("Publish as")),
        E("div", {}, [
          E("strong", {}, [document.createTextNode(profile.nickname)]),
          E(
            "span",
            { style: "color:var(--text-muted);margin-left:0.5em;" },
            [document.createTextNode("#" + (profile.id || ""))],
          ),
          " ",
          renameBtn,
        ]),
      ]);
    };
```

- [ ] **Step 6: Add the rename modal**

```js
    const promptRename = () => {
      const input = E("input", {
        type: "text",
        class: "cbi-input-text",
        maxlength: 40,
        value: profile.nickname || "",
      });
      const err = E("p", {
        style: "color:var(--danger);font-weight:600;display:none;margin:0.6em 0 0;",
      });

      ui.showModal(_("Change your name"), [
        E("p", {}, _("This name signs everything you have published, including what is already in the store.")),
        input,
        err,
        buildConfirmActions(() => {
          const next = input.value.trim();
          if (!next) {
            err.textContent = _("Pick a name between 1 and 40 characters.");
            err.style.display = "block";
            return;
          }
          L.resolveDefault(hubApi.callHubSetNickname(next), null).then((res) => {
            const data = (res && res.result === 0 && res.data) || null;
            if (data && !data.error) {
              ui.hideModal();
              refreshMyShares().then(renderContent);
              return;
            }
            err.textContent = data
              ? nicknameErrorMessage(data.error)
              : shareErrorMessage(res && res.error);
            err.style.display = "block";
          });
        }, _("Save")),
      ]);
    };
```

`promptRename` is referenced by `buildIdentityField` before its own `const` runs at module-eval time — but both are only *called* from inside `renderContent`, well after evaluation, so declaration order does not matter here. Keep them adjacent anyway.

- [ ] **Step 7: Name-first publish**

In `doSubmit`, when the account has no nickname yet, claim it before publishing:

```js
    const doSubmit = () => {
      const name = nameInput.value.trim();
      if (!name) {
        showError(_("Please enter a name."));
        return;
      }

      const description = descInput.value.trim();
      const wantedNickname = profile.nickname ? "" : nicknameInput.value.trim();
      if (!profile.nickname && !wantedNickname) {
        showError(_("Choose the name to publish under."));
        return;
      }

      errEl.style.display = "none";
      submitBtn.disabled = true;

      // Two calls on purpose: the signature is account state, so it is
      // claimed first and the publish carries no author at all. If the name
      // is taken, nothing has been published yet and the user just picks
      // another.
      const claim = wantedNickname
        ? L.resolveDefault(hubApi.callHubSetNickname(wantedNickname), null).then((res) => {
            const data = (res && res.result === 0 && res.data) || null;
            if (data && !data.error) {
              profile = { id: data.id, nickname: data.nickname };
              return true;
            }
            showError(data ? nicknameErrorMessage(data.error) : shareErrorMessage(res && res.error));
            return false;
          })
        : Promise.resolve(true);

      claim.then((ok) => {
        if (!ok) {
          submitBtn.disabled = false;
          return;
        }
        L.resolveDefault(hubApi.callHubShare(name, description), null).then((res) => {
          if (res && res.result === 0) {
            ui.addNotification(null, E("p", {}, _("Published.")), "info");
            shareOpen = false;
            refreshMyShares().then(() => {
              nameInput.value = "";
              descInput.value = "";
              submitBtn.disabled = false;
              renderContent();
            });
          } else {
            submitBtn.disabled = false;
            showError(shareErrorMessage(res && res.error));
          }
        });
      });
    };
```

- [ ] **Step 8: Verify and commit**

```bash
node --check htdocs/luci-static/resources/view/aurora/gallery.js
npm test
git add -A
git commit -m "feat(store): show the creator identity in the publish panel"
```

---

### Task B5: Backup, import, and the three notices

**Files:**
- Modify: `htdocs/luci-static/resources/view/aurora/gallery.js` (`:1547-1573` `renderMyShares`, `:2049` the my-shares section, `load()` at `:986-1006`)
- Test: `tests/gallery-view.test.mjs`

**Interfaces:**
- Consumes: `hubApi.callHubExportKey`, `hubApi.callHubImportKey` (B2), `profile` (B1)
- Produces: a backup bar above "My Shares", an import dialog, and the extended empty state

- [ ] **Step 1: Write the failing test**

```js
test("gallery view: the key backup path exists and warns before overwriting", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("callHubExportKey"), "missing export call");
  assert.ok(src.includes("callHubImportKey"), "missing import call");
  // Importing over an account that still owns work is unrecoverable -- the
  // old key is gone unless it was saved elsewhere.
  assert.ok(src.includes("myShares.length"), "import must consider existing work");
  assert.match(src, /aurora-creator-key\.txt/);
  // The key must never be painted into markup as a bare string child.
  assert.ok(!src.includes(".innerHTML"), "no innerHTML");
});

test("gallery view: the empty state offers recovery, not just publishing", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /_\("Nothing shared yet[^"]*"\)/);
  assert.ok(src.includes("importKeyPrompt"), "empty state must reach the import flow");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test`
Expected: FAIL — `missing export call`.

- [ ] **Step 3: Load the backup flag**

In `load()`, add to the returned object: `keySaved: uci.get("aurora", "theme", "hub_key_saved") === "1",` and in `render(loadData)` keep it in a mutable local: `let keySaved = loadData.keySaved;`

- [ ] **Step 4: Export**

```js
    // A Blob + object URL, not a data: URI: the key never becomes part of a
    // URL that could land in history or a referrer.
    const downloadKey = (key) => {
      const blob = new Blob([key + "\n"], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = E("a", { href: url, download: "aurora-creator-key.txt" });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // rpcd already persisted the flag inside hub_export_key -- this view is
    // browse-only (handleSave: null) and has no uci write path of its own,
    // so it just mirrors the new state locally.
    const markKeySaved = () => {
      keySaved = true;
    };

    const backupKeyPrompt = () => {
      L.resolveDefault(hubApi.callHubExportKey(), null).then((res) => {
        if (!res || res.result !== 0 || !res.key) {
          ui.addNotification(null, E("p", {}, _("Couldn't read the key. Try again.")), "warning");
          return;
        }

        const reveal = E("code", {
          style: "word-break:break-all;display:none;margin:0.6em 0;",
        }, [document.createTextNode(res.key)]);

        ui.showModal(_("Back up your creator key"), [
          E("p", {}, _("This key is your account. Anyone who has it can publish under your name and delete your work.")),
          E("p", {}, _("It only exists on this router. Reflashing without keeping settings erases it.")),
          reveal,
          E("div", { class: "right", style: "margin-top:1em;" }, [
            E("button", {
              type: "button",
              class: "cbi-button",
              click: () => { reveal.style.display = reveal.style.display === "none" ? "block" : "none"; },
            }, _("Show key")),
            " ",
            E("button", {
              type: "button",
              class: "btn cbi-button-action important",
              click: () => { downloadKey(res.key); markKeySaved(); ui.hideModal(); renderContent(); },
            }, _("Download")),
            " ",
            E("button", { type: "button", class: "cbi-button", click: () => ui.hideModal() }, _("Close")),
          ]),
        ]);
      });
    };
```

- [ ] **Step 5: Import**

```js
    const KEY_RE = /^[a-f0-9]{64}$/;

    const importKeyPrompt = () => {
      const input = E("textarea", { class: "cbi-input-textarea", rows: 2 });
      const err = E("p", {
        style: "color:var(--danger);font-weight:600;display:none;margin:0.6em 0 0;",
      });
      const picker = E("input", { type: "file", accept: ".txt,text/plain" });

      // One parse path: the file button only fills the box.
      picker.addEventListener("change", () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        file.text().then((text) => { input.value = text.trim(); });
      });

      const commit = () => {
        const key = input.value.trim().toLowerCase();
        if (!KEY_RE.test(key)) {
          err.textContent = _("That doesn't look like a creator key.");
          err.style.display = "block";
          return;
        }
        L.resolveDefault(hubApi.callHubImportKey(key), null).then((res) => {
          if (!res || res.result !== 0) {
            err.textContent = _("Couldn't use that key. Check it and try again.");
            err.style.display = "block";
            return;
          }
          ui.hideModal();
          refreshMyShares().then(() => {
            keySaved = true;
            ui.addNotification(
              null,
              E("p", {}, profile.nickname
                ? _("Restored. Your published work is back under this account.")
                : _("Restored.")),
              "info",
            );
            renderContent();
          });
        });
      };

      const body = [
        E("p", {}, _("Paste the creator key you backed up, or pick the file you downloaded.")),
        input,
        E("div", { style: "margin-top:0.6em;" }, [picker]),
        err,
      ];

      // Overwriting a key that still owns published work is unrecoverable,
      // so the current key gets one last chance to be saved first.
      if (myShares.length) {
        body.splice(1, 0, E("p", { style: "color:var(--danger);" },
          _("This router already publishes work of its own. Importing a different key gives that work up for good — back the current key up first if you still want it.")));
        body.push(E("div", { style: "margin-top:0.8em;" }, [
          E("button", { type: "button", class: "cbi-button", click: () => backupKeyPrompt() },
            _("Back up the current key first")),
        ]));
      }

      body.push(buildConfirmActions(commit, _("Import")));
      ui.showModal(_("Import a creator key"), body);
    };
```

- [ ] **Step 6: The three notices**

Extend the empty state in `renderMyShares` (`:1552-1560`):

```js
      if (!myShares.length) {
        mySharesEl.appendChild(
          E("p", { style: "color:var(--text-muted);padding:1.5em 0;" }, [
            document.createTextNode(
              _("Nothing shared yet — publish your current configuration, or import a creator key to bring back work from before."),
            ),
          ]),
        );
        mySharesEl.appendChild(
          E("div", {}, [
            E("button", { type: "button", class: "cbi-button", click: () => importKeyPrompt() },
              _("Import a creator key")),
          ]),
        );
        return;
      }
```

Add the standing bar, pushed just above `mySharesEl` at `:2049`:

```js
    // Only nags while there is something to lose and nowhere it is saved.
    const buildKeyBar = () => {
      if (!profile.id) return null;

      const label = profile.nickname
        ? profile.nickname + " · #" + profile.id
        : _("Not named yet") + " · #" + profile.id;

      const actions = [
        E("button", { type: "button", class: "cbi-button", click: () => importKeyPrompt() },
          _("Import a key")),
      ];
      if (!keySaved) {
        actions.unshift(
          E("button", { type: "button", class: "btn cbi-button-action", click: () => backupKeyPrompt() },
            _("Back up key")),
          " ",
        );
      }

      return E("div", { class: "aurora-store-keybar" }, [
        E("div", {}, [
          E("strong", {}, [document.createTextNode(label)]),
          E("div", { style: "color:var(--text-muted);font-size:0.85em;" }, [
            document.createTextNode(
              keySaved
                ? _("This account lives on this router.")
                : _("This account only exists on this router — reflashing without keeping settings erases it."),
            ),
          ]),
        ]),
        E("div", {}, actions),
      ]);
    };
```

…and in the my-shares branch of `renderContent`, before `push(mySharesEl)`:

```js
        const keyBar = buildKeyBar();
        if (keyBar) push(keyBar);
```

Finally, in `doSubmit`'s success path, replace the bare notification when the key has never been saved:

```js
            ui.addNotification(null, E("p", {}, keySaved
              ? _("Published.")
              : _("Published. Your creator account lives only on this router — back up the key so a reflash can't take it.")), "info");
```

Add the bar's styling to `STORE_CSS` next to the other `.aurora-store-*` rules:

```css
.aurora-store-keybar{display:flex;justify-content:space-between;align-items:center;gap:1em;flex-wrap:wrap;padding:0.8em 1em;margin:0.8em 0;border:1px solid var(--hairline);border-radius:var(--radius-base,6px);}
```

- [ ] **Step 7: Verify and commit**

```bash
node --check htdocs/luci-static/resources/view/aurora/gallery.js
npm test
git add -A
git commit -m "feat(store): back up, import, and explain the creator key"
```

---

### Task B6: Translations and on-device verification

**Files:**
- Modify: `po/templates/aurora-config.pot`, `po/zh_Hans/aurora-config.po` and the other 13 locales
- Test: the router at `192.168.8.1`

- [ ] **Step 1: Regenerate the template**

```bash
node scripts/gen-pot.mjs
git diff --stat po/templates/aurora-config.pot
```
Expected: the new strings from B4/B5 appear; the removed author strings disappear.

- [ ] **Step 2: Translate**

Use the `po-translate` skill (it knows this repo's merge flow and the `.lmo` build). At minimum `zh_Hans` must be complete — that is the device's language.

- [ ] **Step 3: Deploy to the router**

`scp` is unavailable on OpenWrt (no `sftp-server`); pipe through `ssh` instead:

```bash
for f in gallery.js theme.js; do
  ssh root@192.168.8.1 "cat > /www/luci-static/resources/view/aurora/$f" \
    < htdocs/luci-static/resources/view/aurora/$f
done
ssh root@192.168.8.1 "cat > /usr/libexec/rpcd/luci.aurora" < root/usr/libexec/rpcd/luci.aurora
ssh root@192.168.8.1 "cat > /usr/share/rpcd/acl.d/luci-app-aurora.json" \
  < root/usr/share/rpcd/acl.d/luci-app-aurora.json
ssh root@192.168.8.1 "chmod +x /usr/libexec/rpcd/luci.aurora && /etc/init.d/rpcd restart"
```

Hard-reload the browser (`?v=` does not change when files are pushed this way).

- [ ] **Step 4: Walk the acceptance list**

From the spec, on the device:

- [ ] First publish asks for a creator name; a taken name says so; a free one publishes
- [ ] Second publish shows "Publish as X · #id" instead of an input
- [ ] Renaming updates the signature on **already published** configs
- [ ] Detail drawer shows `name · #id`; cards show the name only
- [ ] Downloaded `aurora-creator-key.txt` matches `/etc/aurora/device.key` byte for byte
- [ ] `rm -rf /etc/aurora && /etc/init.d/rpcd restart` → My Shares empty with an import offer; importing the backup restores the list and the name, and update/delete still work on a restored config
- [ ] Importing another key while owning work warns and offers a backup first
- [ ] Importing a valid but never-published key switches identity without an error
- [ ] Importing garbage is refused and `/etc/aurora/device.key` is untouched
- [ ] Opening the store fires **one** `hub_me` (check with `logread -f` or the network panel), not N serial requests
- [ ] Chinese UI has no untranslated strings

- [ ] **Step 5: Commit**

```bash
git add po
git commit -m "i18n: translate the creator identity strings"
```

---

## Self-review notes

Checked against the spec:

- §1 identity model → A1 (columns, normalization), A4 (JOIN, drop author)
- §2 hub API → A2 (read), A3 (write), A4 (author removal); the 200-with-body-error contract is a Global Constraint
- §3 rpcd → B1 (`hub_me`), B2 (export/import), B3 (`hub_set_nickname`, author removal)
- §4 frontend → B4 (publish panel), B5 (backup/import/notices)
- §5 security → B2 (write ACL, 64-hex gate, `chmod 600`), B5 (Blob not data-URI, no `innerHTML`), Global Constraints (createTextNode)
- Deployment order → the gate between phases

**Known gap, deliberate:** the `Aurora` nickname for the built-in seed account (spec §1) is an operational step, not code — after deploying, run `POST /api/v1/me` once with the seed device's key and `{"nickname":"Aurora"}`, otherwise `gallery.js:139`'s official-seed badge stops matching. Do it before announcing the release, since the name is first-come.
