---
name: diagnose-click-not-working
description: Diagnose a button, icon, or link that doesn't respond to a click or tap — nothing happens, no console error, no crash. Use this whenever someone reports a UI element that "doesn't work," "doesn't respond," "stopped working," or "nothing happens when I press it," especially if the report is device- or viewport-specific (works on desktop but not on a phone, works at one window size but not another). Also use it before touching any CSS (z-index, pointer-events, backdrop-filter, touch-action, position) as a guess-based fix for an unresponsive element — get proof of the actual cause first, every time, rather than trying properties one at a time.
---

# Diagnosing an unresponsive click/tap target

This exists because of a real bug: a share button that silently ate every
tap. Five different CSS fixes were tried and deployed, one at a time, each
targeting a plausible-sounding mechanism (`pointer-events`, `backdrop-filter`,
safe-area insets, `touch-action`, swapping an `<img>` for a background-image)
— all wrong, all requiring a full build-deploy-and-ask-the-user-to-test cycle
to rule out. Two browser console commands found the actual cause in under a
minute once they were finally used. The lesson isn't any one of those five
guesses — it's that guessing at CSS properties for an invisible-overlap bug
is almost always slower than just asking the browser what's actually there.

## Step 0 — rule out a crash first

Before assuming this is a hit-testing/overlap problem, make sure the handler
isn't simply throwing. If the app has any error/crash telemetry (Sentry, a
custom logger, even `console.error`), check it for the relevant time window.
If there's no such telemetry, temporarily add one direct, unconditional log
call as the very first line inside the handler in question, deploy, and have
the person reproduce it once. If nothing you do reaches that log, you've
already learned something concrete: the tap isn't reaching the handler at
all, which is a layout/overlap problem, not a logic bug — skip straight to
Step 2 for that case.

Don't skip this step by "reasoning" that the code looks too simple to throw.
Small, boring functions still throw on unexpected input.

## Step 1 — find a working control, if one exists

If the same state/handler is triggered from more than one place in the UI,
check whether the *other* one works. A second button that calls the exact
same `onClick` and works fine proves the underlying logic is sound and the
bug is specific to one element's position/rendering — which rules out an
entire category of hypothesis (state bugs, prop bugs, handler bugs) in one
check, before touching any CSS.

## Step 2 — get proof of what's actually there, don't guess

This is the part that was skipped for five rounds and shouldn't be. Open the
browser's DevTools console (real device via remote debugging if available,
otherwise the device-emulation/responsive mode in desktop DevTools
reproduces most layout bugs — see the note on viewport-vs-touch below) and
run:

```js
const r = document.querySelector('SELECTOR_FOR_THE_BROKEN_ELEMENT').getBoundingClientRect()
document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
```

This returns the actual DOM element the browser considers to be at that
exact point on screen — the real button, or whatever is actually sitting on
top of it. There is no better first move than this. It turns "maybe it's
z-index, maybe it's pointer-events, maybe it's backdrop-filter" into a single
fact, and every fix after this point targets that fact instead of a guess.

If it returns the element you expected, the problem isn't an overlap at
all — go back to Step 0 and look harder for a thrown error, or suspect
something at the touch/pointer-event level itself (rare, but real: see the
viewport-vs-touch note below).

If it returns something else, measure that element and its relevant
neighbors next:

```js
document.querySelector('.the-intercepting-element').getBoundingClientRect()
document.querySelector('.the-element-that-should-have-received-it').getBoundingClientRect()
```

Compare the actual `x`/`y`/`top`/`height` numbers directly. Don't reason
about the CSS in the abstract at this point — the numbers either overlap or
they don't, and they'll usually make the mechanism obvious (e.g., two
elements sharing an identical `top` is a much stronger clue than any amount
of staring at the stylesheet).

## Step 3 — fix the actual geometry, not a symptom

Once you know *what* is overlapping and *why* the numbers come out that way,
prefer a fix that makes the layout correct by construction over one that
merely stops the specific symptom:

- If the intercepting element is purely decorative (no click handler of its
  own — a title, an image, a gradient overlay), `pointer-events: none` on
  that specific element is safe and permanent, because it can only ever
  remove a false hit, never break a real one. Don't apply it to a container
  that also holds real interactive children, though — that disables them too.
- If the intercepting element is a real content block that's landing in the
  wrong place because a layout mechanism didn't have the room it assumed it
  would have, fix the sizing/spacing assumption itself rather than patching
  around the click (see the flex-end footgun below — that was this bug).

## A specific footgun worth knowing before you hit it again

`justify-content: flex-end` (or `center`, or `space-between`) inside a
container sized by `min-height` only has room to distribute space when the
content is *shorter* than that `min-height`. The moment content grows taller
than the minimum — more text, a wrapped line, translated copy that runs
longer than the original — there's no extra space left to redistribute, and
the "anchored to the bottom" element renders flush at the top instead,
silently overlapping whatever was positioned to sit above it (often an
absolutely-positioned icon row, exactly like this bug). This is precisely
why the failure was viewport-width-dependent: a narrower width means more
text wrapping, means more likely to exceed the minimum height, means more
likely to lose the gap entirely. It reproduces in desktop DevTools' mobile
emulation and is invisible in a normal desktop window for the same reason —
it was never about touch or Android, only about width and how much room the
text needed.

The durable fix isn't hoping content stays short: give the anchored content
an explicit `margin-top` (or otherwise reserve flow space) equal to at least
the height of whatever it must never overlap, so the guarantee holds
regardless of how tall the content grows.

## Viewport width vs. real touch hardware — don't conflate them

"Works on desktop, broken on phone" does **not** by itself mean the bug is
about touch events, Android quirks, or mobile-browser gesture handling.
Desktop-vs-mobile differs in several independent ways at once: viewport
width (and therefore which CSS breakpoints apply and how much text wraps),
simulated vs. real touch events, and sometimes user-agent-based behavior.
Before chasing a touch-specific theory (`touch-action`, `backdrop-filter`
compositing, native long-press gesture handling), check whether the bug
reproduces in plain desktop DevTools device-emulation mode at a narrow
width, mouse-only. If it does, the variable is width/layout, not touch —
which is a much smaller, cheaper space to search, and exactly where Step 2's
`elementFromPoint` check will find the answer directly instead of needing
another round of touch-specific guessing.
