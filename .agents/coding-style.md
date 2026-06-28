# Coding Style

- Prefer modern JavaScript and Deno features when they make code shorter or clearer: `using`, async iteration, static
  JSON imports with `with { type: 'json' }`, static binary imports, `Uint8Array.prototype.toHex()`,
  `Uint8Array.fromHex()`, and similar current APIs.
- Keep things simple. Do not add options, configuration, environment variables, modularity, or abstraction until asked.
- Hardcode values when that is enough for the current task.
- Conciseness is key. Less code is better.
- Avoid single-use functions unless they make the code shorter or easier to follow.
- Clean-code ceremony is not the goal. Large functions are fine when they keep the flow direct.
- Keep code untangled and straight-line where practical.
- A little copy-paste is better than a bad abstraction.
- Use bare `Error(message)` instead of `new Error(message)`.
