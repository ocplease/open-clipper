# XHS image recognition backend

The extension uses the Supabase project configured in the repository `.env` and calls the protected `recognize-xhs-images` Edge Function.

Before deploying:

1. Enable **Authentication → Providers → Anonymous Sign-Ins** in the Supabase dashboard.
2. Link the CLI to project `znqhrajiolikuzcqsabg`.
3. Apply the migration with `supabase db push`.
4. Store the Gemini credential only in Supabase: `supabase secrets set GEMINI_API_KEY=...`.
5. Deploy with `supabase functions deploy recognize-xhs-images`.

Image recognition first uses `gemini-3.1-flash-lite`. If the model API reports quota exhaustion, it falls back to `gemma-4-31b-it`, then `gemma-4-26b-a4b-it`. Images and OCR output are processed transiently; only daily quota counters are stored.
