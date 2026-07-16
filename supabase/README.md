# XHS image recognition backend

The extension uses the Supabase project configured in the repository `.env` and calls the protected `recognize-xhs-images` Edge Function.

Before deploying:

1. Enable **Authentication → Providers → Anonymous Sign-Ins** in the Supabase dashboard.
2. Link the CLI to project `znqhrajiolikuzcqsabg`.
3. Apply the migration with `supabase db push`.
4. Store the Gemini credential only in Supabase: `supabase secrets set GEMINI_API_KEY=...`.
5. Deploy with `supabase functions deploy recognize-xhs-images`.

`GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash`. Images and OCR output are processed transiently; only daily quota counters are stored.
