export default function ApiSearch() {
  return (
    <div>
      <h1>Search API</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        Full-text search across venues and check-in notes, powered by PostgreSQL <code>tsvector</code>.
      </p>
      <p>Base path: <code>/api/v1/search</code></p>

      {/* ---- SEARCH ---- */}
      <h2 id="search">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/search
      </h2>
      <p>
        Unified search endpoint. Searches venue names, addresses, and cities, as well as check-in
        notes. Results are ranked by PostgreSQL's <code>ts_rank</code> relevance score.
      </p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>q</code></td><td>string</td><td>—</td><td><strong>Required.</strong> Search query (natural language)</td></tr>
          <tr>
            <td><code>type</code></td>
            <td>string</td>
            <td><code>all</code></td>
            <td>
              What to search: <code>all</code>, <code>venues</code>, or <code>checkins</code>
            </td>
          </tr>
          <tr><td><code>limit</code></td><td>integer</td><td>20</td><td>Max results per type</td></tr>
          <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset</td></tr>
        </tbody>
      </table>

      <h3>Example Requests</h3>
      <pre><code>{`# Search everything
curl "http://localhost:3001/api/v1/search?q=coffee"

# Search only venues
curl "http://localhost:3001/api/v1/search?q=pizza&type=venues"

# Search only check-in notes
curl "http://localhost:3001/api/v1/search?q=birthday&type=checkins&limit=5"`}</code></pre>

      <h3>Response <code>200 OK</code> — <code>type=all</code> (default)</h3>
      <p>Returns an object with both venue and check-in results:</p>
      <pre><code>{`{
  "venues": [
    {
      "id": "uuid",
      "name": "Blue Bottle Coffee",
      "category_name": "Coffee Shop",
      "address": "450 W 15th St",
      "city": "New York",
      "state": "NY",
      "latitude": 40.7423,
      "longitude": -74.0055,
      "rank": 0.0991
    }
  ],
  "checkins": [
    {
      "id": "uuid",
      "venue_id": "uuid",
      "venue_name": "Stumptown Coffee",
      "venue_category": "Coffee Shop",
      "notes": "Tried their new cold brew - amazing coffee",
      "rating": 5,
      "checked_in_at": "2026-03-15T09:00:00.000Z",
      "rank": 0.0607
    }
  ]
}`}</code></pre>

      <h3>Response <code>200 OK</code> — <code>type=venues</code></h3>
      <p>Returns a flat array of matching venues:</p>
      <pre><code>{`[
  {
    "id": "uuid",
    "name": "Blue Bottle Coffee",
    "category_name": "Coffee Shop",
    "address": "450 W 15th St",
    "city": "New York",
    "rank": 0.0991
  }
]`}</code></pre>

      <h3>Response <code>200 OK</code> — <code>type=checkins</code></h3>
      <p>Returns a flat array of matching check-ins:</p>
      <pre><code>{`[
  {
    "id": "uuid",
    "venue_name": "Stumptown Coffee",
    "venue_category": "Coffee Shop",
    "notes": "Tried their new cold brew - amazing coffee",
    "rating": 5,
    "checked_in_at": "2026-03-15T09:00:00.000Z",
    "rank": 0.0607
  }
]`}</code></pre>

      <h3>Error <code>400 Bad Request</code></h3>
      <pre><code>{`{ "error": "Search query (q) is required" }
{ "error": "Invalid type. Must be 'all', 'venues', or 'checkins'" }`}</code></pre>

      <h2 id="how-search-works">How Search Works</h2>
      <p>
        Search is powered by PostgreSQL's built-in full-text search engine. Under the hood:
      </p>
      <ol>
        <li>
          Each venue has a <code>search_vector</code> column (type <code>tsvector</code>) that combines
          the venue's name, address, city, state, and country, weighted by relevance (name is weighted highest).
        </li>
        <li>
          Each check-in has a <code>search_vector</code> column built from the notes field.
        </li>
        <li>
          Database triggers automatically keep these vectors up to date when rows are inserted or updated.
        </li>
        <li>
          GIN indexes on both columns enable fast lookups even with large datasets.
        </li>
        <li>
          Your query is converted via <code>plainto_tsquery('english', ...)</code>, which handles
          stemming (e.g., "running" matches "run") and stop-word removal.
        </li>
        <li>
          Results are ranked by <code>ts_rank</code>, which considers term frequency and field weights.
        </li>
      </ol>
    </div>
  );
}
