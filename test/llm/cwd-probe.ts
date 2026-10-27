// A stand-in for the `claude` CLI that answers with the directory it was started in.
// Used by claude-code.test.ts; not a test file itself.
process.stdout.write(
  JSON.stringify({ type: "result", result: JSON.stringify({ cwd: process.cwd() }) }),
);
