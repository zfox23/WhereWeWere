export default function GettingStarted() {
  return (
    <div>
      <h1>Getting Started</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        Run WhereWeWere locally for development or deploy it with Docker Compose.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li><strong>Node.js 20+</strong> and <strong>npm 10+</strong></li>
        <li><strong>PostgreSQL 16</strong> (or use the provided Docker container)</li>
        <li><strong>Docker &amp; Docker Compose</strong> (for containerized deployment)</li>
      </ul>

      <h2 id="quick-start-docker">Quick Start with Docker Compose</h2>
      <p>The fastest way to get everything running:</p>
      <pre><code>{`# Clone and enter the repo
git clone <your-repo-url> && cd WhereWeWere

# Copy the example config
cp .env.example .env

# Start all services
docker compose up -d`}</code></pre>
      <p>This starts three containers:</p>
      <table>
        <thead>
          <tr><th>Service</th><th>Port</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>db</code></td><td>5432</td><td>PostgreSQL 16 with PostGIS</td></tr>
          <tr><td><code>server</code></td><td>3001</td><td>Express API server</td></tr>
          <tr><td><code>client</code></td><td>5173</td><td>Nginx serving the React app</td></tr>
        </tbody>
      </table>
      <p>
        Open <strong>http://localhost:5173</strong> in your browser.
        The database schema is applied automatically on first startup.
      </p>

      <h2 id="local-development">Local Development</h2>
      <p>For a faster dev loop with hot reload on both server and client:</p>

      <h3>1. Start the database</h3>
      <pre><code>{`# Use Docker for just the database
docker compose up db -d`}</code></pre>

      <h3>2. Configure environment</h3>
      <pre><code>{`cp .env.example .env`}</code></pre>
      <p>
        The defaults connect to the Docker Postgres instance. Edit <code>.env</code> if
        your database is elsewhere.
      </p>

      <h3>3. Install dependencies</h3>
      <pre><code>{`npm install`}</code></pre>
      <p>
        This is an npm workspaces monorepo — one <code>npm install</code> at the root
        installs both <code>server/</code> and <code>client/</code> dependencies.
      </p>

      <h3>4. Start the dev servers</h3>
      <pre><code>{`npm run dev`}</code></pre>
      <p>This starts both concurrently:</p>
      <ul>
        <li><strong>API server</strong> at <code>http://localhost:3001</code> (with file-watch restart via tsx)</li>
        <li><strong>Vite dev server</strong> at <code>http://localhost:5173</code> (with HMR, proxies <code>/api</code> to :3001)</li>
      </ul>
      <p>The database migrations run automatically when the server starts.</p>

      <h3>5. Run migrations manually (optional)</h3>
      <pre><code>{`npm run migrate --workspace=server`}</code></pre>

      <h2 id="configuration">Configuration</h2>
      <p>All configuration is via environment variables (or <code>.env</code> file):</p>
      <table>
        <thead>
          <tr><th>Variable</th><th>Default</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>DATABASE_URL</code></td>
            <td><code>postgres://wherewewere:wherewewere@localhost:5432/wherewewere</code></td>
            <td>PostgreSQL connection string</td>
          </tr>
          <tr>
            <td><code>PORT</code></td>
            <td><code>3001</code></td>
            <td>API server port</td>
          </tr>
          <tr>
            <td><code>NODE_ENV</code></td>
            <td><code>development</code></td>
            <td>Set to <code>production</code> to serve client build from server</td>
          </tr>
          <tr>
            <td><code>SESSION_SECRET</code></td>
            <td><code>dev-secret</code></td>
            <td>Secret for session signing. <strong>Change in production.</strong></td>
          </tr>
        </tbody>
      </table>

      <h2 id="database">Database</h2>
      <p>
        The app uses PostgreSQL with the PostGIS extension. The schema includes
        full-text search via <code>tsvector</code> columns with GIN indexes on venues
        and check-ins, plus triggers that keep the search vectors up to date automatically.
      </p>
      <p>
        Migrations live in <code>server/src/db/migrations/</code> as numbered SQL files
        and are tracked in a <code>schema_migrations</code> table. They run automatically
        on server startup, or manually via:
      </p>
      <pre><code>{`npm run migrate --workspace=server`}</code></pre>

      <h3>Seed data</h3>
      <p>
        The initial migration seeds 15 default venue categories: Food, Coffee Shop,
        Bar, Park, Gym, Office, Home, Shop, Museum, Theater, Hotel, Airport,
        Train Station, Beach, and Library.
      </p>

      <h2 id="openstreetmap">OpenStreetMap Integration</h2>
      <p>
        The <strong>Nearby Venues</strong> search queries the
        {' '}<a href="https://overpass-api.de/" target="_blank" rel="noopener noreferrer">Overpass API</a>{' '}
        to find places from OpenStreetMap around your current location.
        No API key is required — it is a free, public service.
      </p>
      <p>
        When you select an OSM venue, it is automatically imported into your local
        database so future check-ins reference a stable local record.
        OSM amenity/shop/tourism/leisure tags are mapped to the built-in venue categories.
      </p>

      <h2 id="building">Building for Production</h2>
      <pre><code>{`# Build both client and server
npm run build

# The client builds to client/dist/ (static files)
# The server compiles to server/dist/ (Node.js)

# Start the production server (serves both API and client)
NODE_ENV=production npm start`}</code></pre>
      <p>
        When <code>NODE_ENV=production</code>, the Express server serves
        the compiled client from <code>client/dist/</code> with SPA fallback,
        so you only need a single process.
      </p>
    </div>
  );
}
