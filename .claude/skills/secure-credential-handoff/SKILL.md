---
name: secure-credential-handoff
description: Pattern for getting a secret (password, API token, key) into a shell command Claude runs, without the plaintext ever entering the conversation transcript or Claude's own context. Use whenever a task needs Claude to authenticate against something — log into a dev server, call an API, touch a database — and the user would rather not paste the credential directly into chat. Not project-specific; applies wherever Claude runs shell commands.
---

Project-agnostic technique for keeping secrets out of the conversation transcript.

## The problem with "just export it in `.bashrc`"

It looks like it should work and quietly doesn't.
Claude's Bash tool spawns a fresh **non-interactive, non-login** shell per command (in practice `bash -c "<command>"`).
`~/.bashrc` only auto-loads for *interactive* shells;
`~/.bash_profile`/`~/.profile` only for *login* shells — neither condition holds here, so an `export` sitting in either file is invisible to every command Claude runs, guard clauses or not.
(Most distro `.bashrc` files also short-circuit non-interactive shells explicitly near the top — `case $- in *i*) ;; *) return;; esac` — which looks like the cause if you go looking, but isn't the real one: the file often isn't even being read at all.)

Confirm this on your own setup before trusting either explanation:

```bash
# Does a value from ~/.bashrc reach a plain Bash-tool-style invocation at all?
bash -c 'printf "%s" "$SOME_VAR"' | wc -c   # 0 even after `export SOME_VAR=x` in .bashrc
bash -ic 'printf "%s" "$SOME_VAR"' | wc -c  # forcing interactive mode picks it up —
                                             # proves the value's fine, the sourcing isn't
```

## The pattern: a dedicated file, sourced explicitly, every time

Skip shell startup files entirely.
Use one small, permission-locked file and `source` it inline as part of the same command that needs it — never as a separate step, since shell state doesn't persist between Claude's tool calls anyway.

**Setup — the user runs this themselves**, not Claude, so the plaintext never passes through anything Claude reads or writes:

```bash
umask 077
echo 'export MY_SECRET="the-actual-value"' > ~/.some-task.env
chmod 600 ~/.some-task.env
```

**Usage — Claude sources it inline, every command that needs it:**

```bash
source ~/.some-task.env && curl -u "user:$MY_SECRET" https://example.local/api/...
```

## Verifying presence without ever reading the value

Prove the mechanism works before relying on it for anything real — length or exit-code checks only, never a plain `cat`/`grep` of the file or a bare `echo $VAR`:

```bash
len=$(bash -c 'source ~/.some-task.env && printf "%s" "$MY_SECRET"' | wc -c)
echo "length: $len"   # nonzero and plausible — never the value itself

grep -q '^export MY_SECRET=' ~/.some-task.env && echo "line present" || echo "line missing"
```

**The one command shape that defeats this entirely**: a bare `grep 'PATTERN' file` (no `-q`, no `-c`) prints whichever line matches — including its content.
If that happens, treat the value as burned immediately and rotate it — there's no un-printing a transcript line, and no amount of care afterward changes that it already happened.

## What this does and doesn't buy you

This keeps a secret out of the conversation transcript and out of anything Claude displays, which is a real, worthwhile property on its own.
It is **not** a security boundary against Claude itself: anything reachable via `$VAR` in a command Claude writes is a value Claude could choose to print, the same way any other command it runs executes on its own judgment as the only backstop.
Treat it as hygiene and convenience — reducing accidental exposure and keeping secrets out of durable logs — not as isolation from a misbehaving or compromised agent.

If the actual requirement is a hard boundary (Claude must never be *able* to use the raw credential, only a narrower capability), this pattern is the wrong tool — hand over a short-lived, scoped token instead of a durable credential, or have a separate process perform the privileged action and hand back only its result.
That's real infrastructure, not a config file, so reach for it only when the stakes actually call for it.
