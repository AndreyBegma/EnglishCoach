// A stand-in for the `claude` CLI. Run as `bun fake-claude.ts <mode> <claude args…>`.
// It answers the way `claude -p --output-format json` does, according to <mode>:
//   echo      — result is JSON {argv, stdin} (lets a test see exactly what the provider sent)
//   repair    — invalid output first; valid output once stdin carries the repair prompt
//   invalid   — always invalid output
//   fail      — exits 3 with a message on stderr
//   is-error  — exits 0 but reports is_error: true
//   garbage   — prints something that is not JSON
//   hang      — never answers

export {};

const [mode = "echo", ...argv] = process.argv.slice(2);
const stdin = await new Response(Bun.stdin.stream()).text();

function reply(result: string, isError = false): void {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: isError ? "error" : "success",
      is_error: isError,
      result,
      usage: { input_tokens: 11, output_tokens: 22 },
    }),
  );
}

switch (mode) {
  case "echo":
    reply(JSON.stringify({ argv, stdin }));
    break;
  case "repair":
    reply(
      stdin.includes("failed validation") ? JSON.stringify({ argv: [], stdin: "fixed" }) : "{}",
    );
    break;
  case "invalid":
    reply("not json at all");
    break;
  case "fail":
    process.stderr.write("Error: not logged in\n");
    process.exit(3);
    break;
  case "is-error":
    reply("Credit balance is too low", true);
    break;
  case "garbage":
    process.stdout.write("Welcome to Claude Code!\n");
    break;
  case "hang":
    await new Promise(() => {});
    break;
}
