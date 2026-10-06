---
name: frontend-engineer
description: Build and change UI in this repo with keyboard access, real empty and error states, consistent action names, and browser verification on the single shared dev server. Use when implementing or reshaping pages, components, layout, or client behavior. For a new or visually reshaped page, also follow the frontend-design skill; the repo plan wins if that skill would invent a subject.
---

# Frontend engineer

Engineering rules for UI. Visual direction is not in this skill.

## When the page is new or being reshaped

Follow the `frontend-design` skill for palette, type, layout, and copy. If it would invent a product subject, use the repo plan instead.

## Floor

- Visible keyboard focus. Honor reduced motion.
- Empty and error states say what happened and what to do next.
- One action keeps the same name through the flow. The button and the confirmation use the same verb.
- Layout works down to a phone width.

## Done

Before calling UI work done, exercise the changed flow in the browser on the one shared dev server: the main path, the empty or error state it touches, and one other page that reads the same state. A screenshot of the first render is not enough. Stay on the main checkout. Do not start a second server or pick another port. Browser verification does not replace `grill`. Do not commit until that grill has been answered.

Stack paths and commands are unset until the architecture doc names them. Do not pick a framework in this skill.
