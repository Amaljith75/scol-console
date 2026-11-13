"""studio/.venv/Scripts/python studio/test_studio.py"""
import json
import shutil
import unittest
from pathlib import Path

import ai
import convert as cv

MATHS = cv.ROOT / "content" / "kerala-scert" / "class-3" / "maths"


def tiny_pdf(pages):
    """A real PDF with one line of text per page (no PDF library can write text pages without extras)."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 40 700 Td ({text}) Tj ET"
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents {len(objs)} 0 R "
                    "/Resources << /Font << /F1 3 0 R >> >> >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offs).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF".encode()
    return out


GOOD = """=== FILE: 01-equal-groups.md ===
# Equal groups
concept: equal-groups

## say
en: 3 plates with 2 idlis each. 2 + 2 + 2 = 6.
visual: groups 3 2 🍚

## ask
form: choice
en: How many idlis?
options: 5 | 6
answer: 6

## story
en: Amma counts plate by plate.

## picture
visual: array 3 2 🍚
en: 3 rows of 2.
"""
BROKEN = """=== FILE: 02-times.md ===
# Times
concept: times

## say
en: 3 × 4 = 13

## ask
form: choice
en: 2 groups of 5?
options: 7 | 10
answer: 11
"""
FIXED = """# Times
concept: times

## say
en: 3 × 4 = 12

## ask
form: choice
en: 2 groups of 5?
options: 7 | 10
answer: 10
"""


class Studio(unittest.TestCase):
    def setUp(self):
        self.old = cv.DATA, cv.PROJECTS, cv.PUSH_ROOT, cv.JOBS
        cv.DATA = cv.ROOT / "studio" / "data" / "_test"
        cv.PROJECTS, cv.PUSH_ROOT, cv.JOBS = cv.DATA / "projects", cv.DATA / "push" / "content", cv.DATA / "jobs"
        cv.PROJECTS.mkdir(parents=True)
        cv.save_providers([{"id": "fake", "name": "Fake", "kind": "openai", "model": "m", "base_url": "", "api_key": ""}])
        self.calls = []
        self.real_ask, self.real_image = ai.ask, ai.image

    def tearDown(self):
        ai.ask, ai.image = self.real_ask, self.real_image
        shutil.rmtree(cv.DATA)
        cv.DATA, cv.PROJECTS, cv.PUSH_ROOT, cv.JOBS = self.old

    def test_existing_maths_lessons_pass_studio_checks(self):
        files = sorted(MATHS.glob("*/*.md"))
        self.assertGreaterEqual(len(files), 24)
        for f in files:
            lesson, problems = cv.check(f, "kerala-scert/class-3/maths")
            self.assertEqual(problems, [], f.name)  # also: no false alarms from the sum check
            self.assertTrue(lesson["steps"])

    def test_sum_check(self):
        self.assertEqual(cv.math_problems("4 + 4 + 4 = 12 and 3 × 4 = 12 / 30 + 40 = 70"), [])
        self.assertEqual(len(cv.math_problems("3 x 4 = 13")), 1)
        self.assertEqual(cv.math_problems("visual: steps 200 + 100 = 300 / 30 + 40 = 70"), [])

    def test_pdf_to_pushed_bundle(self):
        toc = ('```json\n{"chapters":[{"title":"Equal groups","title_ml":"","start_page":2,"end_page":3,'
               '"objectives":["Count equal groups"]}]}\n```')
        replies = iter([
            toc, toc,
            GOOD + "\n" + BROKEN,
            FIXED,
        ])

        def fake(p, system, user, pdf=None, temperature=0.4):
            self.calls.append(user)
            return next(replies), {"in": 1, "out": 1, "seconds": 0}
        ai.ask = fake

        meta = cv.create({"title": "Test book", "board": "kerala-scert", "class": "3", "subject": "maths",
                          "lang": "en", "provider": "fake"},
                         pdf_bytes=tiny_pdf(["Contents", "Unit 1 Equal groups: three plates of two", "More groups"]))
        self.assertEqual(meta["pages"], 3)
        self.assertEqual(cv.find_chapters(meta["id"]), ["01-equal-groups"])
        self.assertEqual(cv.find_chapters(meta["id"]), [])  # never overwrites an existing chapter

        report = cv.generate_chapter(meta["id"], "01-equal-groups")
        self.assertIn("three plates of two", self.calls[2])  # chapter pages were sent
        self.assertNotIn("Contents", self.calls[2].split("CHAPTER TEXT")[1])
        self.assertEqual(report, {"01-equal-groups.md": [], "02-times.md": []})  # broken file was repaired
        self.assertIn("wrong sum", self.calls[3])  # the repair request carried the checker's problems

        pid = meta["id"]
        r = cv.push(pid)
        self.assertEqual(r["pushed"], [])  # nothing pushes before approval
        m = cv.load(pid)
        m["review"] = {"01-equal-groups/01-equal-groups.md": "approved", "01-equal-groups/02-times.md": "approved"}
        cv.save(m)
        r = cv.push(pid)
        self.assertEqual((r["pushed"], r["problems"]), (["01-equal-groups"], []))
        bundle = json.loads((cv.PUSH_ROOT.parent / "bundle.json").read_text(encoding="utf-8"))
        ch = bundle["boards"][0]["classes"][0]["subjects"][0]["chapters"][0]
        self.assertEqual([l["id"].split("/")[-1] for l in ch["lessons"]], ["01-equal-groups", "02-times"])
        self.assertFalse((cv.ROOT / "content" / "kerala-scert" / "class-3" / "maths" / "01-equal-groups").exists())

    def test_background_job_records_steps_and_tokens(self):
        replies = iter([GOOD, "not a lesson"])
        ai.ask = lambda *a, **k: (next(replies), {"in": 100, "out": 20, "seconds": 1})
        meta = cv.create({"title": "B", "board": "cbse", "class": "7", "subject": "maths", "lang": "en", "provider": "fake"},
                         pdf_bytes=tiny_pdf(["Unit one has some text in it", "Unit two has some text in it"]))
        for i, title in enumerate(["One", "Two"], 1):
            d = cv.PROJECTS / meta["id"] / "chapters" / f"0{i}-{title.lower()}"
            d.mkdir()
            (d / "chapter.json").write_text(json.dumps({"title": {"en": title}, "pages": [i, i]}), encoding="utf-8")
        job = cv.start_job(meta["id"], "generate", ["01-one", "02-two"])
        for _ in range(100):
            j = cv.jobs()[0]
            if j["status"] != "running":
                break
            import time
            time.sleep(0.05)
        self.assertEqual(j["id"], job["id"])
        self.assertEqual(j["status"], "partly done")  # chapter two failed, chapter one still converted
        self.assertEqual([s["status"] for s in j["steps"]], ["done", "failed"])
        self.assertEqual((j["steps"][0]["tokens_in"], j["tokens_in"]), (100, 200))
        self.assertIn("Fake · m (text)", j["steps"][0]["calls"])
        cv.delete_job(j["id"])
        self.assertEqual(cv.jobs(), [])

    def test_pictures_for_story_subjects(self):
        cv.save_providers([{"id": "fake", "name": "Fake", "kind": "openai", "model": "m"},
                           {"id": "pic", "name": "Pic", "kind": "gemini", "model": "img", "use": "image"}])
        drawn = []
        ai.image = lambda p, prompt: (drawn.append(prompt) or b"\x89PNG fake", {"in": 5, "out": 1, "seconds": 0})
        story = ("=== FILE: 01-tree.md ===\n# The tree\nconcept: trees\n\n## say\nen: Ammu waters a coconut tree.\n"
                 "visual: image ammu-tree.png\n\n## ask\nform: choice\nen: What does Ammu water?\n"
                 "options: a tree | a cat\nanswer: a tree\n")
        seen = []
        ai.ask = lambda p, system, user, **k: (seen.append(system) or story, {"in": 1, "out": 1, "seconds": 0})
        meta = cv.create({"title": "E", "board": "kerala-scert", "class": "2", "subject": "evs", "lang": "en",
                          "provider": "fake", "image_provider": "pic"}, pdf_bytes=tiny_pdf(["Plants need water to grow tall"]))
        d = cv.PROJECTS / meta["id"] / "chapters" / "01-plants"
        d.mkdir()
        (d / "chapter.json").write_text(json.dumps({"title": {"en": "Plants"}, "pages": [1, 1]}), encoding="utf-8")
        self.assertEqual(cv.generate_chapter(meta["id"], "01-plants"), {"01-tree.md": []})
        self.assertIn("PICTURES", seen[0])  # non-maths subjects are asked for pictures
        self.assertTrue((d / "images" / "ammu-tree.png").exists())
        self.assertTrue(drawn[0].startswith(cv.STYLE) and drawn[0].endswith("Ammu waters a coconut tree."))

    def test_image_upload_checks(self):
        meta = cv.create({"title": "I", "board": "cbse", "class": "1", "subject": "english", "lang": "en"},
                         pdf_bytes=tiny_pdf(["page"]))
        (cv.PROJECTS / meta["id"] / "chapters" / "01-a").mkdir()
        (cv.PROJECTS / meta["id"] / "chapters" / "01-a" / "chapter.json").write_text('{"title":{"en":"A"}}')
        self.assertEqual(cv.save_image(meta["id"], "01-a", "My Cat.GIF", b"GIF89a..."), "my-cat.gif")
        with self.assertRaises(ValueError):
            cv.save_image(meta["id"], "01-a", "evil.png", b"<script>")  # name says png, bytes do not
        with self.assertRaises(ValueError):
            cv.save_image(meta["id"], "01-a", "x.svg", b"<svg/>")

    def test_any_typed_kind_uses_a_known_wire_format(self):
        self.assertEqual([ai.wire(k) for k in ("gemini", "Claude", "openrouter", "gpu", "")],
                         ["gemini", "anthropic", "openai", "openai", "openai"])
        with self.assertRaises(ai.AIError):  # a custom kind must say where it lives
            ai.ask({"name": "x", "kind": "gpu", "model": "m", "base_url": ""}, "s", "u")

    def test_split_files_strips_fences(self):
        files = cv.split_files("=== FILE: 01-A b.md ===\n```markdown\n# A\n```\n=== FILE: 02-c.md ===\n# C")
        self.assertEqual(files, {"01-a-b.md": "# A\n", "02-c.md": "# C\n"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
