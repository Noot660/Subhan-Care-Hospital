// Stale-listener fixture for test/publish_regression.sh.
//
// Pretends to be the OLD pre-fix server: binds port 3000 and answers EVERY
// request with a JSON marker, so the regression test can prove that
// publish.sh replaces the existing listener and that a stale responder is
// never accepted as success. publish.sh's port handover kills it with SIGTERM.
Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",
  fetch: () =>
    new Response(JSON.stringify({ stale: true }), {
      headers: { "Content-Type": "application/json" },
    }),
});
console.log("stale listener up on :3000");
