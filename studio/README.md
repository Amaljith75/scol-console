# Scol Console

A small web app for the team: upload a textbook PDF, let any AI turn each chapter into Scol levels,
then review, edit, preview and approve them before they go into `content/`. (The folder is still called `studio/`.)

```
python -m venv studio/.venv
studio/.venv/Scripts/pip install -r studio/requirements.txt     # Windows (bin/ on Mac/Linux)
studio/.venv/Scripts/python studio/server.py                    # open http://localhost:8765
studio/.venv/Scripts/python studio/test_studio.py               # tests
```

## How it works

1. **AI Providers**: add any AI by URL and key, for lessons (text) or for pictures. Kind and model are typed freely:
   `gemini` and `anthropic` use their own APIs; any other kind (`openai`, `openrouter`, `groq`, `ollama`, `gpu`, ...)
   is treated as an OpenAI-compatible URL. Presets cover Gemini, Claude, OpenAI, OpenRouter, Groq, DeepSeek,
   Ollama and **rented GPUs** (a vLLM/Ollama/LM Studio server on RunPod, Vast.ai, etc.; stop the pod when done).
2. **Textbooks**: upload a PDF with board, class (1-10), subject and language. Pick a Text AI and, for English, EVS
   and other story subjects, a Picture AI.
3. **Find chapters** and **Convert**: these run as background jobs on the server, so you can move between pages.
   The header shows progress; **History** lists every conversion with status, time per chapter, tokens per step and
   which AI was used, and lets you delete old records. **Overview** totals tokens by provider and model.
4. Each chapter's prompt holds only that chapter's pages, the format from `content/README.md` and two real Class 3
   maths lessons as examples. Every lesson is checked by `tools/build_content.py` (the app's own checker) and every
   `a + b = c` is recomputed, so lessons come out in the same shape whichever AI writes them. Files with problems get
   one automatic repair round. Scanned pages go to Gemini or Claude as PDF.
5. **Pictures**: for subjects other than maths the AI may write `visual: image name.png`; the Picture AI then draws it
   from that block's sentence in one fixed picture-book style. In the editor you can upload pictures, draw new ones
   from a description, or upload a short clip (MP4/WebM/MOV becomes an 8-second animated WebP, which the app plays;
   needs ffmpeg). GIF and animated WebP also work.
6. **Review**: edit blocks or raw text, delete or reorder blocks, delete lessons or chapters, or ask the AI to change
   one lesson. Every save re-runs the checks. Only lessons with no problems can be approved; an edit removes approval.
7. **Preview**: a port of the app's classroom (`classroom.dart`, `tutor.dart`, `visuals.dart`, `avatar.dart`): the
   five tutor creatures, board card, bubble colours, chunky buttons, number pad, abacus, sliding scale, stick building,
   hint, explain, "another way", re-asking, stars and XP. Pick the tutor above the phone.
8. **Push to Scol (staging)**: fully approved chapters are copied to `studio/data/push/content/` and built with the
   app's builder into `studio/data/push/bundle.json`. **Scol's real `content/` is not touched yet.**
   To connect later, point `PUSH_ROOT` in `convert.py` at `content/`.

## Notes

- Everything lives in `studio/data/` (git-ignored): PDFs, projects, pictures, provider keys, jobs and the AI log.
  The repository is public, so textbook PDFs and keys must stay there.
- The server listens on localhost only and has no login. Do not expose it to the internet.
- The preview is a web copy of the classroom, not the Flutter app. When the app's screens change, update `web/visuals.js` and `web/app.js`.
- A server restart stops running conversions; History marks them "interrupted" and you can start them again.
- AI-written lessons start with `"verified": false`. A teacher and a fluent Malayalam reader should still check them.
