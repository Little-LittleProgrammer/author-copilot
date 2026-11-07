# author-copilot

An AI copilot for authors to capture ideas, build story worlds, plan chapters, draft manuscripts, and refine writing.

## Overview

author-copilot is an AI-powered workstation for authors, novelists, screenwriters, and long-form content creators. It helps turn scattered inspiration into structured creative work by bringing ideation, outlining, drafting, editing, and writing knowledge management into one place.

Whether you are building a novel, planning a serialized story, shaping character arcs, or polishing final drafts, author-copilot is designed to support the full writing workflow.

## Vision

Writing is more than text generation. Serious authors need a system for managing ideas, characters, worldbuilding, plot structure, chapter progress, revisions, and style consistency.

author-copilot aims to become a creative operating system for authors:
- Capture inspiration before it disappears
- Organize story knowledge in a structured workspace
- Develop characters, settings, and plotlines with AI assistance
- Plan chapters and long-form story arcs
- Draft faster while keeping creative control
- Revise, refine, and polish manuscripts with context-aware support

## Current Features

- Novel and screenplay projects, multiple work tabs, chapters and scenes
- Markdown folder and TXT/DOC/DOCX import with preview and automatic chapter splitting
- Local manuscript editing, atomic saves, conflict protection, undo/redo and find/replace
- Daily manual writing counts, estimated typing rate, seven-day history and daily goals
- Outlines, ideas and notes, including AI drafts with editing, diff review and explicit save
- Ask and Agent conversations with selected notes, documents and retrieved manuscript context
- Agent file review, task-level keep/undo and crash recovery
- Bundled Git, version history, diffs and local branch switching
- Anthropic BYOK, custom Anthropic-compatible providers and a managed relay
- Platform accounts, balance and usage history; online payments are not available
- Whole-work or chapter export to TXT, Markdown and Word (DOCX)
- Chinese/English, light/dark themes, custom colors and backgrounds

Character relationships, worldbuilding, timelines and style management remain future product directions.

## Target Users

author-copilot is built for:
- Novelists
- Web fiction writers
- Screenwriters
- Storytellers
- Writing teams
- Long-form content creators

## Use Cases

- Turn a rough idea into a structured story concept
- Build and maintain a story bible for long projects
- Design characters, motivations, and relationships
- Plan a multi-chapter novel or serialized fiction project
- Draft scenes and chapters with AI assistance
- Revise manuscripts for clarity, pacing, tone, and style
- Keep writing projects organized from first idea to final draft

## Product Principles

- AI should assist authors, not replace them
- Long-form writing needs structure, memory, and continuity
- Creative workflows should be flexible, not rigid
- Authors should stay in control of voice, style, and direction
- Good tools reduce friction without reducing originality

## Roadmap

- [x] Local projects, import, writing and version management
- [x] Manuscript indexing, contextual chat and controlled Agent editing
- [x] Creative note management, references, AI generation and explicit save
- [x] Writing statistics, daily goals, chapter management and common exports
- [x] Custom Anthropic-compatible providers and platform account/relay foundations
- [ ] Real-model validation and full release qualification, signing and notarization for the latest four-architecture build
- [ ] Chapter summaries, editable facts, long-term memory and character/worldbuilding management
- [ ] Timelines, foreshadowing and consistency checks
- [ ] Per-change AI acceptance, advanced structure editing and style presets
- [ ] Payments, billing reconciliation and operations tools
- [ ] Cloud sync, collaboration and professional publishing formats

See the [roadmap](docs/roadmap.md) for current scope, limitations and priorities.

## Tech Stack

- TypeScript and pnpm / Turborepo
- Electron, React, Vite and Tailwind CSS
- Anthropic TypeScript SDK and Claude Agent SDK
- Local Markdown, bundled Git and SQLite FTS5
- NestJS, MongoDB, Redis and Docker Compose
- Vitest and Playwright

## Project Status

Active development. The main local writing and AI editing workflows are implemented. Development packages and automated validation exist; full production release qualification of the latest version is still pending. Platform accounts and usage billing are implemented, while online payments remain unavailable.

See [development setup](docs/development.md) and the [AI creative note delivery record](docs/reports/2026-11-05-ai-creative-notes.md).

## Contributing

Contributions, ideas, and feedback are welcome.

You can contribute by:
- Opening issues for feature ideas or bugs
- Proposing workflow improvements for authors
- Sharing writing-related use cases
- Submitting pull requests

## License

TBD