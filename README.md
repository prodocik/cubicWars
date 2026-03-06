# Cubic

Cubic is a separate project based on the mechanics from `../game`, but aimed at a Minecraft-like block sandbox vibe.

## Current State

- movement and multiplayer sync are inherited from the source project
- harvesting wood and stone are preserved
- inventory, hotbar, chat, skills and combat are preserved
- the project is still rendered as an isometric 2D prototype, but all further content should move toward a cubic/block aesthetic

## Stack

- TypeScript
- Vite
- Excalibur.js
- WebSocket server on Node.js
- SQLite persistence for characters

## Project Goal

Build a browser sandbox where the player:

- spawns in a procedural block world
- gathers wood and stone
- uses tools from the hotbar
- fights other players
- gradually moves from the inherited prototype toward a full Minecraft-inspired identity

## Run

```bash
npm install
npm run dev
npm run server
```

Client default URL: `http://localhost:5173`  
Server default URL: `ws://localhost:3002`
