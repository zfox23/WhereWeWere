export default function ApiCheckins() {
  return (
    <div>
      <h1>Check-ins API</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        Create, read, update, and delete check-ins. Manage photos attached to check-ins.
      </p>
      <p>Base path: <code>/api/v1/checkins</code></p>

      {/* ---- LIST ---- */}
      <h2 id="list-checkins">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/checkins
      </h2>
      <p>List check-ins, newest first, with joined venue information and photo count.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>—</td><td>Filter by user</td></tr>
          <tr><td><code>venue_id</code></td><td>uuid</td><td>—</td><td>Filter by venue</td></tr>
          <tr><td><code>from</code></td><td>ISO 8601 date</td><td>—</td><td>Start of date range (inclusive)</td></tr>
          <tr><td><code>to</code></td><td>ISO 8601 date</td><td>—</td><td>End of date range (inclusive)</td></tr>
          <tr><td><code>limit</code></td><td>integer</td><td>50</td><td>Max results (1–100)</td></tr>
          <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  {
    "id": "uuid",
    "user_id": "uuid",
    "venue_id": "uuid",
    "venue_name": "Central Perk",
    "venue_category": "Coffee Shop",
    "notes": "Great latte today",
    "rating": 4,
    "checked_in_at": "2026-03-27T14:30:00.000Z",
    "photo_count": 2,
    "created_at": "2026-03-27T14:30:00.000Z",
    "updated_at": "2026-03-27T14:30:00.000Z"
  }
]`}</code></pre>

      {/* ---- GET ONE ---- */}
      <h2 id="get-checkin">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/checkins/:id
      </h2>
      <p>Get a single check-in with full venue details and an array of attached photos.</p>

      <h3>Path Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td>uuid</td><td>Check-in ID</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{
  "id": "uuid",
  "user_id": "uuid",
  "venue_id": "uuid",
  "venue_name": "Central Perk",
  "venue_category": "Coffee Shop",
  "venue_category_icon": "coffee",
  "venue_address": "199 Lafayette St",
  "venue_city": "New York",
  "venue_state": "NY",
  "venue_country": "US",
  "venue_latitude": 40.7223,
  "venue_longitude": -73.9987,
  "notes": "Great latte today",
  "rating": 4,
  "checked_in_at": "2026-03-27T14:30:00.000Z",
  "photos": [
    {
      "id": "uuid",
      "file_path": "a1b2c3d4.jpg",
      "original_filename": "latte.jpg",
      "mime_type": "image/jpeg",
      "caption": null,
      "created_at": "2026-03-27T14:30:05.000Z"
    }
  ],
  "created_at": "2026-03-27T14:30:00.000Z",
  "updated_at": "2026-03-27T14:30:00.000Z"
}`}</code></pre>

      <h3>Error <code>404 Not Found</code></h3>
      <pre><code>{`{ "error": "Check-in not found" }`}</code></pre>

      {/* ---- CREATE ---- */}
      <h2 id="create-checkin">
        <code className="text-blue-600 bg-blue-50 !px-2 !py-1 rounded mr-2">POST</code>
        /api/v1/checkins
      </h2>
      <p>Create a new check-in at a venue.</p>

      <h3>Request Body <span className="text-gray-400 font-normal">application/json</span></h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>ID of the user checking in</td></tr>
          <tr><td><code>venue_id</code></td><td>uuid</td><td>Yes</td><td>ID of the venue</td></tr>
          <tr><td><code>notes</code></td><td>string</td><td>No</td><td>Free-text notes</td></tr>
          <tr><td><code>rating</code></td><td>integer</td><td>No</td><td>Star rating, 1–5</td></tr>
          <tr><td><code>checked_in_at</code></td><td>ISO 8601</td><td>No</td><td>Defaults to current time</td></tr>
        </tbody>
      </table>

      <h3>Example Request</h3>
      <pre><code>{`curl -X POST http://localhost:3001/api/v1/checkins \\
  -H "Content-Type: application/json" \\
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "venue_id": "a1b2c3d4-...",
    "notes": "First visit!",
    "rating": 5
  }'`}</code></pre>

      <h3>Response <code>201 Created</code></h3>
      <pre><code>{`{
  "id": "uuid",
  "user_id": "uuid",
  "venue_id": "uuid",
  "notes": "First visit!",
  "rating": 5,
  "checked_in_at": "2026-03-27T14:30:00.000Z",
  "created_at": "2026-03-27T14:30:00.000Z",
  "updated_at": "2026-03-27T14:30:00.000Z"
}`}</code></pre>

      <h3>Error <code>400 Bad Request</code></h3>
      <pre><code>{`{ "error": "user_id and venue_id are required" }
{ "error": "Rating must be between 1 and 5" }`}</code></pre>

      {/* ---- UPDATE ---- */}
      <h2 id="update-checkin">
        <code className="text-amber-600 bg-amber-50 !px-2 !py-1 rounded mr-2">PUT</code>
        /api/v1/checkins/:id
      </h2>
      <p>Update the notes or rating on an existing check-in.</p>

      <h3>Request Body <span className="text-gray-400 font-normal">application/json</span></h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>notes</code></td><td>string</td><td>No</td><td>Updated notes</td></tr>
          <tr><td><code>rating</code></td><td>integer</td><td>No</td><td>Updated star rating, 1–5</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <p>Returns the full updated check-in object.</p>

      <h3>Error <code>404 Not Found</code></h3>
      <pre><code>{`{ "error": "Check-in not found" }`}</code></pre>

      {/* ---- DELETE ---- */}
      <h2 id="delete-checkin">
        <code className="text-red-600 bg-red-50 !px-2 !py-1 rounded mr-2">DELETE</code>
        /api/v1/checkins/:id
      </h2>
      <p>Delete a check-in. All associated photos are removed from disk and database (cascade).</p>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{ "message": "Check-in deleted", "id": "uuid" }`}</code></pre>

      {/* ---- UPLOAD PHOTOS ---- */}
      <h2 id="upload-photos">
        <code className="text-blue-600 bg-blue-50 !px-2 !py-1 rounded mr-2">POST</code>
        /api/v1/checkins/:id/photos
      </h2>
      <p>Upload up to 4 photos for a check-in.</p>

      <h3>Request <span className="text-gray-400 font-normal">multipart/form-data</span></h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>photos</code></td><td>file[]</td><td>1–4 image files (max 10 MB each, <code>image/*</code> only)</td></tr>
        </tbody>
      </table>

      <h3>Example Request</h3>
      <pre><code>{`curl -X POST http://localhost:3001/api/v1/checkins/:id/photos \\
  -F "photos=@latte.jpg" \\
  -F "photos=@storefront.png"`}</code></pre>

      <h3>Response <code>201 Created</code></h3>
      <pre><code>{`[
  {
    "id": "uuid",
    "checkin_id": "uuid",
    "file_path": "a1b2c3d4-5678-...",
    "original_filename": "latte.jpg",
    "mime_type": "image/jpeg",
    "caption": null,
    "created_at": "2026-03-27T14:30:05.000Z"
  }
]`}</code></pre>
      <p>
        Photos are served at <code>/api/v1/photos/file/:file_path</code>.
      </p>

      {/* ---- DELETE PHOTO ---- */}
      <h2 id="delete-photo">
        <code className="text-red-600 bg-red-50 !px-2 !py-1 rounded mr-2">DELETE</code>
        /api/v1/checkins/:id/photos/:photoId
      </h2>
      <p>Delete a single photo. The file is removed from disk.</p>

      <h3>Path Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td>uuid</td><td>Check-in ID</td></tr>
          <tr><td><code>photoId</code></td><td>uuid</td><td>Photo ID</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{ "message": "Photo deleted", "id": "uuid" }`}</code></pre>
    </div>
  );
}
