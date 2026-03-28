export default function ApiStats() {
  return (
    <div>
      <h1>Stats API</h1>
      <p className="text-lg text-gray-600 mt-2 mb-8">
        Retrieve statistics, streaks, top venues, category breakdowns, and activity heatmaps.
      </p>
      <p>Base path: <code>/api/v1/stats</code></p>
      <p>
        All endpoints require a <code>user_id</code> query parameter.
      </p>

      {/* ---- SUMMARY ---- */}
      <h2 id="summary">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/summary
      </h2>
      <p>High-level summary of a user's check-in activity.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>User ID</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{
  "total_checkins": 237,
  "unique_venues": 84,
  "total_photos": 52,
  "days_with_checkins": 143,
  "member_since": "2025-01-15T00:00:00.000Z"
}`}</code></pre>

      {/* ---- STREAKS ---- */}
      <h2 id="streaks">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/streaks
      </h2>
      <p>
        Current and longest check-in streaks. A streak is consecutive calendar days with at least one check-in.
        The current streak is only counted if the most recent check-in was today or yesterday.
      </p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>User ID</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`{
  "current_streak": 5,
  "longest_streak": 23,
  "last_checkin_date": "2026-03-27"
}`}</code></pre>

      {/* ---- TOP VENUES ---- */}
      <h2 id="top-venues">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/top-venues
      </h2>
      <p>Most visited venues ranked by check-in count.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>—</td><td><strong>Required.</strong> User ID</td></tr>
          <tr><td><code>limit</code></td><td>integer</td><td>10</td><td>Number of venues to return</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  {
    "id": "uuid",
    "name": "Central Perk",
    "address": "199 Lafayette St",
    "city": "New York",
    "state": "NY",
    "category_name": "Coffee Shop",
    "category_icon": "coffee",
    "checkin_count": 42,
    "last_checkin": "2026-03-27T14:30:00.000Z"
  },
  {
    "id": "uuid",
    "name": "Joe's Pizza",
    "address": "7 Carmine St",
    "city": "New York",
    "state": "NY",
    "category_name": "Food",
    "category_icon": "utensils",
    "checkin_count": 28,
    "last_checkin": "2026-03-25T12:00:00.000Z"
  }
]`}</code></pre>

      {/* ---- CATEGORY BREAKDOWN ---- */}
      <h2 id="category-breakdown">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/category-breakdown
      </h2>
      <p>Check-in counts grouped by venue category, sorted by count descending.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>User ID</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  { "category": "Coffee Shop", "category_icon": "coffee", "checkin_count": 65 },
  { "category": "Food", "category_icon": "utensils", "checkin_count": 48 },
  { "category": "Bar", "category_icon": "beer", "checkin_count": 31 },
  { "category": "Uncategorized", "category_icon": null, "checkin_count": 3 }
]`}</code></pre>
      <p>
        Venues without a category are grouped under <code>"Uncategorized"</code>.
      </p>

      {/* ---- HEATMAP ---- */}
      <h2 id="heatmap">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/heatmap
      </h2>
      <p>
        Daily check-in counts for an entire year. Designed for rendering a GitHub-style
        contribution/activity heatmap.
      </p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>User ID</td></tr>
          <tr><td><code>year</code></td><td>integer</td><td>Yes</td><td>Four-digit year (e.g. <code>2026</code>)</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  { "date": "2026-01-01", "count": 2 },
  { "date": "2026-01-02", "count": 0 },
  { "date": "2026-01-03", "count": 1 },
  ...
]`}</code></pre>
      <p>Only days with at least one check-in are included in the response.</p>

      {/* ---- MONTHLY ---- */}
      <h2 id="monthly">
        <code className="text-emerald-600 bg-emerald-50 !px-2 !py-1 rounded mr-2">GET</code>
        /api/v1/stats/monthly
      </h2>
      <p>Daily check-in counts for a specific month.</p>

      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>user_id</code></td><td>uuid</td><td>Yes</td><td>User ID</td></tr>
          <tr><td><code>year</code></td><td>integer</td><td>Yes</td><td>Four-digit year</td></tr>
          <tr><td><code>month</code></td><td>integer</td><td>Yes</td><td>Month number (1–12)</td></tr>
        </tbody>
      </table>

      <h3>Response <code>200 OK</code></h3>
      <pre><code>{`[
  { "date": "2026-03-01", "count": 3 },
  { "date": "2026-03-05", "count": 1 },
  { "date": "2026-03-12", "count": 2 }
]`}</code></pre>

      <h3>Error <code>400 Bad Request</code></h3>
      <pre><code>{`{ "error": "user_id, year, and month are required" }`}</code></pre>
    </div>
  );
}
