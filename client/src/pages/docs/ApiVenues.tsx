export default function ApiVenues() {
  return (
    <div>
      <h1>Venues API</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        Manage venues, search nearby locations, import from OpenStreetMap, and browse categories.
      </p>
      <p>Base path: <code>/api/v1/venues</code></p>

      {/* ---- LIST ---- */}
      <h2 id="list-venues">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/venues
      </h2>
      <p>List venues with optional full-text search and category filtering.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>search</code></td><td>string</td><td>—</td><td>Full-text search query (searches name, address, city)</td></tr>
          <tr><td><code>category</code></td><td>string</td><td>—</td><td>Filter by category name</td></tr>
          <tr><td><code>limit</code></td><td>integer</td><td>50</td><td>Max results</td></tr>
          <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  {
    "id": "uuid",
    "name": "Central Perk",
    "category_id": "uuid",
    "category_name": "Coffee Shop",
    "category_icon": "coffee",
    "address": "199 Lafayette St",
    "city": "New York",
    "state": "NY",
    "country": "US",
    "postal_code": "10012",
    "latitude": 40.7223,
    "longitude": -73.9987,
    "osm_id": "node/12345678",
    "rank": 0.075,
    "created_at": "2026-03-20T10:00:00.000Z",
    "updated_at": "2026-03-20T10:00:00.000Z"
  }
]`}</code></pre>
      <p>The <code>rank</code> field is only present when using the <code>search</code> parameter (PostgreSQL <code>ts_rank</code> score).</p>

      {/* ---- NEARBY ---- */}
      <h2 id="nearby-venues">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/venues/nearby
      </h2>
      <p>
        Search nearby venues using your coordinates. Queries your local database first (using Haversine distance),
        then augments results with OpenStreetMap data via the Overpass API. Local matches appear first.
      </p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>lat</code></td><td>number</td><td>—</td><td><strong>Required.</strong> Latitude</td></tr>
          <tr><td><code>lon</code></td><td>number</td><td>—</td><td><strong>Required.</strong> Longitude</td></tr>
          <tr><td><code>radius</code></td><td>number</td><td>500</td><td>Search radius in meters</td></tr>
          <tr><td><code>search</code></td><td>string</td><td>—</td><td>Filter by name</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  {
    "id": "uuid",
    "name": "Joe's Pizza",
    "category_name": "Food",
    "latitude": 40.7308,
    "longitude": -73.9973,
    "address": "7 Carmine St",
    "distance": 142.5,
    "source": "local",
    "osm_id": null
  },
  {
    "name": "Village Vanguard",
    "category": "Bar",
    "latitude": 40.7339,
    "longitude": -74.0003,
    "address": "178 7th Ave S",
    "osm_id": "node/98765432",
    "source": "osm"
  }
]`}</code></pre>
      <p>
        Results with <code>source: "local"</code> include an <code>id</code> and <code>distance</code> (meters).
        Results with <code>source: "osm"</code> come from OpenStreetMap and must be imported before checking in.
      </p>

      <h3>Error <code>400 Bad Request</code></h3>
      <pre><code>{`{ "error": "lat and lon are required" }`}</code></pre>

      {/* ---- CATEGORIES ---- */}
      <h2 id="categories">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/venues/categories
      </h2>
      <p>List all venue categories.</p>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  { "id": "uuid", "name": "Food", "icon": "utensils", "parent_id": null, "created_at": "..." },
  { "id": "uuid", "name": "Coffee Shop", "icon": "coffee", "parent_id": null, "created_at": "..." },
  { "id": "uuid", "name": "Bar", "icon": "beer", "parent_id": null, "created_at": "..." }
]`}</code></pre>

      {/* ---- GET ONE ---- */}
      <h2 id="get-venue">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/venues/:id
      </h2>
      <p>Get a single venue with its total check-in count.</p>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{
  "id": "uuid",
  "name": "Central Perk",
  "category_name": "Coffee Shop",
  "category_icon": "coffee",
  "address": "199 Lafayette St",
  "city": "New York",
  "state": "NY",
  "country": "US",
  "postal_code": "10012",
  "latitude": 40.7223,
  "longitude": -73.9987,
  "osm_id": "node/12345678",
  "checkin_count": 42,
  "created_at": "...",
  "updated_at": "..."
}`}</code></pre>

      {/* ---- CREATE ---- */}
      <h2 id="create-venue">
        <code className="text-blue-600 bg-blue-50 !px-2 !py-1 rounded mr-2">POST</code>
        /api/v1/venues
      </h2>
      <p>Create a new venue manually.</p>

      <h3>Request Body <span className="text-gray-400 font-normal">application/json</span></h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>string</td><td>Yes</td><td>Venue name</td></tr>
          <tr><td><code>latitude</code></td><td>number</td><td>Yes</td><td>Latitude (decimal degrees)</td></tr>
          <tr><td><code>longitude</code></td><td>number</td><td>Yes</td><td>Longitude (decimal degrees)</td></tr>
          <tr><td><code>category_id</code></td><td>uuid</td><td>No</td><td>Venue category ID</td></tr>
          <tr><td><code>address</code></td><td>string</td><td>No</td><td>Street address</td></tr>
          <tr><td><code>city</code></td><td>string</td><td>No</td><td>City</td></tr>
          <tr><td><code>state</code></td><td>string</td><td>No</td><td>State / province</td></tr>
          <tr><td><code>country</code></td><td>string</td><td>No</td><td>Country</td></tr>
          <tr><td><code>postal_code</code></td><td>string</td><td>No</td><td>ZIP / postal code</td></tr>
          <tr><td><code>osm_id</code></td><td>string</td><td>No</td><td>OpenStreetMap ID (e.g. <code>node/12345678</code>)</td></tr>
        </tbody>
      </table>

      <h3>Example Request</h3>
      <pre><code>{`curl -X POST http://localhost:3001/api/v1/venues \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Favorite Café",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "city": "New York",
    "country": "US"
  }'`}</code></pre>

      <h3>Response <code>201 Created</code></h3>
      <p>Returns the created venue object with all fields.</p>

      <h3>Error <code>400 Bad Request</code></h3>
      <pre><code>{`{ "error": "name, latitude, and longitude are required" }`}</code></pre>

      {/* ---- UPDATE ---- */}
      <h2 id="update-venue">
        <code className="text-amber-600 bg-amber-50 !px-2 !py-1 rounded mr-2">PUT</code>
        /api/v1/venues/:id
      </h2>
      <p>Update a venue. Only fields you include in the body are changed (uses <code>COALESCE</code>).</p>

      <h3>Request Body <span className="text-gray-400 font-normal">application/json</span></h3>
      <p>Same fields as <code>POST /venues</code>, all optional.</p>

      <h3>Response <code>200 OK</code></h3>
      <p>Returns the full updated venue object.</p>

      {/* ---- IMPORT OSM ---- */}
      <h2 id="import-osm">
        <code className="text-blue-600 bg-blue-50 !px-2 !py-1 rounded mr-2">POST</code>
        /api/v1/venues/import-osm
      </h2>
      <p>
        Import a venue from an OpenStreetMap search result. If a venue with the same <code>osm_id</code>
        already exists, the existing venue is returned (upsert behavior).
      </p>

      <h3>Request Body <span className="text-gray-400 font-normal">application/json</span></h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>string</td><td>Yes</td><td>Venue name from OSM</td></tr>
          <tr><td><code>osm_id</code></td><td>string</td><td>Yes</td><td>OSM identifier (e.g. <code>node/12345678</code>)</td></tr>
          <tr><td><code>latitude</code></td><td>number</td><td>No</td><td>Latitude</td></tr>
          <tr><td><code>longitude</code></td><td>number</td><td>No</td><td>Longitude</td></tr>
          <tr><td><code>category</code></td><td>string</td><td>No</td><td>Category name (matched against existing categories)</td></tr>
          <tr><td><code>address</code></td><td>string</td><td>No</td><td>Full address string (parsed into components)</td></tr>
        </tbody>
      </table>

      <h3>Response <code>201 Created</code> / <code>200 OK</code></h3>
      <p>
        Returns the venue object. Status is <code>201</code> if newly created,
        <code>200</code> if the <code>osm_id</code> already existed.
      </p>
    </div>
  );
}
