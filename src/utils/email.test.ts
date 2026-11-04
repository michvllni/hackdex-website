import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { sendTransactionalEmail } from "./email.ts";

function setEnv(t: TestContext, env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}

test("transactional email is sent through Resend with a sanitized subject", async (t) => {
  setEnv(t, { RESEND_API_KEY: "re_test_key", EMAIL_NOREPLY: "noreply@example.com" });
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(input, "https://api.resend.com/emails");
    bodies.push(JSON.parse(String(init.body)));
    return Response.json({ id: "test-email" });
  });

  await sendTransactionalEmail({ to: "user@example.com", replyTo: "reply@example.com", subject: "Hi\r\nBcc: x <b>there</b>", text: "Body" });
  await sendTransactionalEmail({ to: "user@example.com", subject: "Approved", html: "<p>Live</p>" });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].from, "Hackdex <noreply@example.com>");
  assert.equal(bodies[0].to, "user@example.com");
  assert.equal(bodies[0].reply_to, "reply@example.com");
  assert.equal(bodies[0].subject, "HiBcc: x there");
  assert.equal(bodies[0].text, "Body");
  assert.equal(bodies[0].html, undefined);
  assert.equal(bodies[1].html, "<p>Live</p>");
});

test("transactional email throws when Resend rejects it", async (t) => {
  setEnv(t, { RESEND_API_KEY: "re_test_key", EMAIL_NOREPLY: "noreply@example.com" });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ name: "validation_error", message: "Domain is not verified", statusCode: 403 }, { status: 403 }),
  );

  await assert.rejects(
    sendTransactionalEmail({ to: "user@example.com", subject: "Hi", text: "Body" }),
    /Domain is not verified/,
  );
});
