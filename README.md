# Veka Music

A browser music search and player powered by Audius. The page searches Audius directly and streams selected results in its built-in player; it no longer depends on VKM Bot or a custom `/api` backend.

Search results are shown 20 at a time with Previous/Next pagination. The client filters repeated Audius track IDs while loading later pages and caches pages already visited.

## Run it

Serve this folder with any static web server, for example:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`. Search results and playback require an internet connection. Some tracks may be unavailable or access-gated.

## Audius API

The site uses Audius read-only endpoints:

- Search: `GET https://api.audius.co/v1/tracks/search?query=...`
- Stream: `GET https://api.audius.co/v1/tracks/{track_id}/stream`

Read-only endpoints work without credentials; an API key can be obtained from the [Audius API Plans page](https://api.audius.co/plans) for higher rate limits. Audius currently lists a free plan with 10 requests per second and 500,000 requests per month. The catalog is independent/community music and does not guarantee mainstream catalog coverage.

Official references: [API docs](https://docs.audius.co/api/), [JavaScript SDK and free plan](https://docs.audius.co/sdk/).
