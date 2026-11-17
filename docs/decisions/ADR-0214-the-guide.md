# ADR-0214: A guide inside the system, written by whoever builds the feature

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Системд Гарын авлага гэсэн цэс нэм. Түүн дотор эдгээр мэдээллийг Ангилж оруулдаг бол.»), Claude |

## Context

When a feature is built, the session that builds it writes the owner a how-to: which buttons to press, what to expect, what to do when it fails. Until now that text lived in the chat and was lost. The owner asked for it to be kept inside the system, sorted by subject, where the people who do the work already are.

## Decision

1. **A menu entry «Систем → Гарын авлага»**, first in the group, for every signed-in person: no right is needed. It opens `/guide`, a list of articles by category with a search box, and `/guide/:category/:article`, one article with the others of its category under it.
2. **Articles are Markdown files in the web's code**, `apps/web/src/features/guide/content/<category>/<NN>-<slug>.md`: the folder is the category, `NN` the order, the file name the address, the first `# ` line the title and the first paragraph the summary. The session that builds a feature writes its article, so the article ships with the feature and reaches the real system with the next update. The categories and their order are a list in code (`GUIDE_CATEGORIES`); each has a name `guide.categories.<folder>` in `mn.json`.
3. **A small renderer of our own for a fixed subset**: `##`, `###`, paragraphs, bullet and numbered lists (a numbered list goes on across a code block), `>` notes, fenced code with a «Хуулах» button, tables, bold, inline code and links (`/…` in-app, `http(s)://` in a new tab). No dependency, no raw HTML, no `dangerouslySetInnerHTML`; unknown syntax is drawn as plain text.
4. **Search runs in the browser**, over the title and text of every article, as the person types.
5. **A feature adds its article**: CLAUDE.md's «Before finishing» says so, and Mongolian text in `content/**/*.md` is allowed beside `mn.json`. An article is written for the person doing the work: plain steps, then what they see when it fails and what to do.
6. **The first seven articles**: delivery notes read by the model (`inventory/receipt-notes`), scanning a note (`inventory/scan-note`), a product from photos on the web (`catalog/product-ai`) and in the staff app (`catalog/product-app`), the AI key (`setup/ai-key`), the product picture settings (`setup/product-picture`) and the scan bridge (`setup/scan-bridge`).
7. **Tests guard the content**: every article has a title and a summary, sits in a named category, and every `/guide/<category>/<slug>` link points to an article that exists.

## Alternatives considered

- **Articles in the database, edited on a screen.** A right, a migration, an editor and a version history, and still nobody to write them: the writer is the session that builds the feature, and it writes files.
- **A wiki or PDF outside the system.** Not where the people work, and it goes stale because no change of a screen touches it.
- **A Markdown library.** A dependency (and its HTML and security surface) for six constructs.

## Consequences

- Positive: a feature's how-to is kept, found by category or search, and ships with the feature; no migration, no right, no new dependency.
- Negative: an article can go stale when a screen changes without its article; the rule in CLAUDE.md and the content tests are the guard. People cannot correct an article themselves; a change is a code change.

## Related

ADR-0210 (delivery notes read by the model), ADR-0212 (the scan bridge), ADR-0213 (the brain directs the work); `docs/ui.md` §4 (the guide).
