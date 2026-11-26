# Brief RSS / Broadcast Sources Configuration

This directory contains `server/sources.json`, which configures open-source news, broadcast, and podcast RSS/Atom feeds for the **Brief** tab in LinguaForge ILR.

## Feed Schema

Each entry in `sources.json` has the following format:

```json
{
  "id": "unique-slug",
  "name": "Publisher Name",
  "url": "https://domain.com/feed.rss",
  "language": "es" | "pt",
  "dialectId": "neutral_latam" | "rioplatense" | "caribbean" | "colombian_andean" | "br_standard" | "br_bahian" | "br_southern" | "eu_portuguese",
  "mediaType": "text" | "audio"
}
```

## How It Works

1. **Background Ingest & Caching**:
   - The server ingests feeds on startup and every few hours.
   - Each item is hashed by its unique URL or GUID (`sha256`) so it is processed **once** by Gemini and cached in memory across all users.
   - For audio longer than ~2.5 minutes, only the first segment is indexed or offered. Text is capped at ~500 words.

2. **Legal & Copyright Compliance**:
   - The application **never** stores or serves full article text or audio to the client.
   - The client UI displays only the headline, DLPT-style orientation line, short 2-sentence summary, unboxed metadata, and direct link to the publisher's site.
   - Audio is streamed directly from the publisher's public enclosure URL in the browser.
   - Full transcripts and text excerpts remain strictly server-side for question generation and are shown only as a brief excerpt after a drill or during study lookup.

3. **Placeholders**:
   - Entries with URLs starting with `https://example.com/placeholder-rss-...` are clearly marked placeholders. You can replace them with real RSS or podcast feeds from your preferred regional stations at any time.
   - Built-in authentic fallback seed stories ensure that the feed remains populated and responsive even if external network access or DNS resolution is offline.
