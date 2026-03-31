---
name: WhereWeWere project overview
description: Self-hosted Foursquare Swarm replacement - tech stack, architecture, and design decisions
type: project
---

WhereWeWere is a self-hosted Foursquare Swarm replacement for single-user/small-group use.

**Why:** User wants to own their check-in data and not depend on Foursquare/Swarm.

**Tech stack:**
- Frontend: React 19 + TypeScript + Vite + TailwindCSS v3 + Leaflet maps + Lucide icons
- Backend: Express + TypeScript + PostgreSQL (via node-pg)
- Monorepo with npm workspaces (server/ and client/)
- RESTful API versioned at /api/v1/
- OpenStreetMap Overpass API for venue discovery
- Docker Compose for self-hosting (postgis, server, client/nginx)

**How to apply:** All new features should follow the existing patterns — Express routers, TypeScript types in client/src/types, API client in client/src/api/client.ts. Auth is not yet implemented (hardcoded user_id placeholder). The app uses a hardcoded default user ID "00000000-0000-0000-0000-000000000001".
