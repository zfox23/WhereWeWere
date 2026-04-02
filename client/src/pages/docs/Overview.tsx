import { Link } from 'react-router-dom';

export default function Overview() {
  return (
    <div>
      <h1>WhereWeWere Documentation</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        A self-hosted location check-in application — your personal replacement for Foursquare Swarm.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 not-prose mb-10">
        <Link to="/docs/getting-started" className="card p-5 hover:shadow-md transition-shadow">
          <h3 className="font-semibold text-gray-900 mb-1">Getting Started</h3>
          <p className="text-sm text-gray-500">
            Run the app locally, configure Docker, and understand the project structure.
          </p>
        </Link>
        <Link to="/docs/api/checkins" className="card p-5 hover:shadow-md transition-shadow">
          <h3 className="font-semibold text-gray-900 mb-1">API Reference</h3>
          <p className="text-sm text-gray-500">
            Full REST API documentation for check-ins, venues, stats, and search.
          </p>
        </Link>
      </div>

      <h2>Features</h2>
      <ul>
        <li><strong>Check-ins</strong> — Record visits to venues with timestamps, notes, star ratings, and photo uploads.</li>
        <li><strong>Venue database</strong> — Maintain your own venue directory with names, categories, addresses, and coordinates. Import from OpenStreetMap.</li>
        <li><strong>Timeline</strong> — Browse your personal check-in history with date filtering and infinite scroll.</li>
        <li><strong>Statistics</strong> — Track most-visited venues, category breakdowns, and a GitHub-style activity heatmap.</li>
        <li><strong>Search</strong> — Full-text search across both venues and your check-in notes.</li>
        <li><strong>Maps</strong> — Interactive Leaflet maps showing check-in locations and nearby venues.</li>
        <li><strong>Self-hosted</strong> — Run everything on your own hardware via Docker Compose. Your data stays yours.</li>
      </ul>

      <h2>Tech Stack</h2>
      <table>
        <thead>
          <tr><th>Layer</th><th>Technology</th></tr>
        </thead>
        <tbody>
          <tr><td>Frontend</td><td>React 19, TypeScript, Vite, TailwindCSS, Leaflet, Lucide icons</td></tr>
          <tr><td>Backend</td><td>Express, TypeScript, Node.js 20+</td></tr>
          <tr><td>Database</td><td>PostgreSQL 16 with PostGIS</td></tr>
          <tr><td>External APIs</td><td>OpenStreetMap Overpass API (venue discovery)</td></tr>
          <tr><td>Deployment</td><td>Docker Compose (Postgres + Node server + Nginx)</td></tr>
        </tbody>
      </table>

      <h2>Project Structure</h2>
      <pre><code>{`WhereWeWere/
├── docker-compose.yml        # Full-stack Docker setup
├── .env.example              # Configuration template
├── server/                   # Express API server
│   └── src/
│       ├── index.ts          # App entry + auto-migration
│       ├── routes/           # REST API route handlers
│       ├── services/         # Overpass API integration
│       └── db/migrations/    # SQL schema migrations
└── client/                   # React single-page app
    └── src/
        ├── components/       # Reusable UI components
        ├── pages/            # Route-level pages
        ├── api/client.ts     # Typed API client
        └── types/index.ts    # Shared TypeScript interfaces`}</code></pre>
    </div>
  );
}
