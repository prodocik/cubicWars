# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**Cubic** is a separate browser multiplayer sandbox derived from the mechanics in `../game`.

Current gameplay baseline:

- click-to-move and WASD movement
- tree chopping and rock mining
- inventory, hotbar and skill progression
- WebSocket multiplayer with authoritative server
- simple ranged combat

The long-term direction is Minecraft-like: blocky world, clearer survival loop, cubic visuals and building systems layered on top of the inherited prototype.

## Tech Stack

- Excalibur.js
- TypeScript with strict mode
- Vite for the client
- Node.js + `ws` for multiplayer
- SQLite via `better-sqlite3` for persistence

## Architecture

`src/main.ts` is the main gameplay entry.

Relevant areas:

- `src/world.ts` generates the procedural map
- `src/player.ts` handles local and remote player actors
- `src/network.ts` owns the client WebSocket protocol
- `src/inventory.ts` renders the inventory and hotbar UI
- `src/skills.ts` handles XP, levels and resource yields
- `server/index.ts` is the authoritative game server

## Commands

```bash
npm install
npm run dev
npm run server
npm run build
```

Run both the Vite client and the WebSocket server during development.

## Working Rules

- keep mechanics compatible with the current save/network model unless intentionally migrated
- prefer extending the existing systems over rewriting them
- move the game toward a cubic/block aesthetic, but do not break the inherited gameplay loop
- keep code/comments in English and project-facing docs in Russian where useful
