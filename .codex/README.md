# Project Codex configuration

This directory contains repository-scoped Codex configuration that is shared by
the CLI, IDE extension, and trusted Codex desktop projects.

## What is committed

- `config.toml` keeps the default sandbox to the workspace, requests approval
  for broader operations, uses cached web search, and excludes common secret
  environment variables from spawned commands.

Do not add API keys, tokens, personal settings, session logs, or machine-specific
paths here. Keep durable coding conventions in the repository-root `AGENTS.md`.

## Local workflow

1. Open this repository as a trusted project in Codex.
2. Use `/status` to confirm the project configuration is active.
3. Use `/review` before committing: choose uncommitted changes or compare the
   branch with `master`.

## CI review

The local setup is intentionally independent from CI. A GitHub PR review can be
added after the maintainer explicitly approves sending pull-request code to the
OpenAI Codex service and creates a repository `OPENAI_API_KEY` secret.
