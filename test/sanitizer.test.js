import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitize, getSanitizer } from '../src/services/sanitizer.js';

/**
 * Tests for the HTML Sanitizer (Task 6).
 *
 * Property 12 (Sanitizer 안전성 및 멱등성) is validated with fast-check across
 * >=100 runs, composing HTML inputs from dangerous and benign fragments, plus
 * concrete malicious examples and a benign survival example. The R12.6 fallback
 * path (non-string / un-processable input → safe empty string, never raw HTML)
 * is also covered.
 *
 * Runs under Vitest's jsdom environment, which provides a global `window`/
 * `document` so DOMPurify binds and sanitizes. No jsdom runtime dependency is
 * added by the module under test.
 *
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4** (plus 12.6 fallback).
 */

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Danger assertions — the properties the output must NEVER violate.
// ---------------------------------------------------------------------------

/** Case-insensitive scan for a forbidden opening tag like `<script`. */
function containsTag(html, tag) {
  return new RegExp(`<\\s*${tag}\\b`, 'i').test(html);
}

/** Does the output contain any inline `on<word>=` event-handler attribute? */
function containsInlineHandler(html) {
  // Matches ` onclick=`, `\tonerror =`, etc. Requires a preceding whitespace
  // (so it is an attribute, not part of a word) and an `=` after the name.
  return /[\s"'`]on[a-z]+\s*=/i.test(html);
}

/** Does the output contain a dangerous scheme inside an href/src attribute? */
function containsDangerousUrlAttr(html) {
  // href= or src= whose value (quoted or not) begins with a dangerous scheme,
  // tolerating whitespace / HTML-entity obfuscation around the colon.
  return /\b(?:href|src)\s*=\s*(?:["'`]\s*)?(?:javascript|data|vbscript)\s*:/i.test(
    html,
  );
}

/** Combined safety predicate used by the property. */
function assertSafe(output) {
  expect(typeof output).toBe('string');
  for (const tag of ['script', 'iframe', 'object', 'embed']) {
    expect(containsTag(output, tag), `should not contain <${tag}>: ${output}`).toBe(false);
  }
  expect(containsInlineHandler(output), `should not contain on* handler: ${output}`).toBe(false);
  expect(
    containsDangerousUrlAttr(output),
    `should not contain dangerous url scheme: ${output}`,
  ).toBe(false);
}

// ---------------------------------------------------------------------------
// Environment sanity — DOMPurify must be bound under the jsdom env.
// ---------------------------------------------------------------------------

describe('sanitizer environment', () => {
  it('binds DOMPurify to the jsdom window', () => {
    const purifier = getSanitizer();
    expect(purifier).not.toBeNull();
    expect(typeof purifier.sanitize).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Property 12 — safety + idempotence over composed arbitrary HTML.
// ---------------------------------------------------------------------------

/** Dangerous fragments that MUST be neutralized. */
const dangerousFragmentArb = fc.constantFrom(
  '<script>alert(1)</script>',
  '<script src="https://evil.example/x.js"></script>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="evil.swf"></object>',
  '<embed src="evil.swf">',
  '<img src=x onerror=alert(1)>',
  '<div onclick="steal()">x</div>',
  '<svg onload=alert(1)></svg>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
  '<body onload=alert(1)>',
  '<input onfocus=alert(1) autofocus>',
);

/** Benign fragments that are allowed to survive (text/markup). */
const benignFragmentArb = fc.constantFrom(
  '<p>hello world</p>',
  '<b>bold</b> and <i>italic</i>',
  'plain text & more',
  '<a href="https://example.com">link</a>',
  '<a href="/relative/path">rel</a>',
  '<ul><li>one</li><li>two</li></ul>',
  '<section class="prompt-content">prompt body</section>',
  'symbols: < > & " \'',
  '',
);

/** Compose an input HTML string from a shuffled mix of fragments. */
const composedHtmlArb = fc
  .array(fc.oneof(dangerousFragmentArb, benignFragmentArb), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join('\n'));

describe('Property 12 — Sanitizer 안전성 및 멱등성', () => {
  it('removes all dangerous elements, handlers, and URL schemes (R12.1-12.4)', () => {
    fc.assert(
      fc.property(composedHtmlArb, (html) => {
        assertSafe(sanitize(html));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is idempotent: sanitize(sanitize(x)) === sanitize(x)', () => {
    fc.assert(
      fc.property(composedHtmlArb, (html) => {
        const once = sanitize(html);
        const twice = sanitize(once);
        expect(twice).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('also holds for fully-arbitrary unicode strings (fuzz)', () => {
    fc.assert(
      fc.property(fc.string(), (html) => {
        const once = sanitize(html);
        assertSafe(once);
        expect(sanitize(once)).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Concrete malicious examples (explicit regression anchors).
// ---------------------------------------------------------------------------

describe('concrete malicious examples are neutralized', () => {
  const cases = [
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['javascript: href', '<a href="javascript:alert(1)">x</a>'],
    ['iframe', '<iframe src="evil"></iframe>'],
    ['object', '<object data="x"></object>'],
    ['embed', '<embed src="x">'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['vbscript: href', '<a href="vbscript:msgbox(1)">x</a>'],
    ['data: href', '<a href="data:text/html,<b>x</b>">x</a>'],
  ];

  for (const [label, input] of cases) {
    it(`neutralizes ${label}`, () => {
      const out = sanitize(input);
      assertSafe(out);
    });
  }

  it('strips the script element but keeps surrounding benign text', () => {
    const out = sanitize('before<script>alert(1)</script>after');
    expect(containsTag(out, 'script')).toBe(false);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('drops the onerror handler but keeps the img element', () => {
    const out = sanitize('<img src="safe.png" onerror="alert(1)">');
    expect(containsInlineHandler(out)).toBe(false);
    expect(containsTag(out, 'img')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Benign content survives.
// ---------------------------------------------------------------------------

describe('benign content survives sanitization', () => {
  it('preserves safe text and markup', () => {
    const benign =
      '<article class="prompt"><section class="prompt-content"><p>hello &amp; <b>world</b></p></section></article>';
    const out = sanitize(benign);
    assertSafe(out);
    expect(out).toContain('hello');
    expect(out).toContain('world');
    expect(containsTag(out, 'p')).toBe(true);
    expect(containsTag(out, 'b')).toBe(true);
    expect(containsTag(out, 'section')).toBe(true);
    // The idempotence guarantee also holds for benign content.
    expect(sanitize(out)).toBe(out);
  });

  it('keeps safe http(s) and relative links', () => {
    const out = sanitize('<a href="https://example.com">x</a><a href="/rel">y</a>');
    assertSafe(out);
    expect(out).toContain('https://example.com');
    expect(out).toContain('/rel');
  });
});

// ---------------------------------------------------------------------------
// R12.6 — safe fallback: never return raw HTML when it cannot be processed.
// ---------------------------------------------------------------------------

describe('R12.6 fallback — returns a safe string, never throws', () => {
  it('returns empty string for non-string inputs', () => {
    for (const bad of [null, undefined, 42, {}, [], true, Symbol('x'), () => {}]) {
      // @ts-expect-error — intentionally passing non-string to exercise the guard.
      const out = sanitize(bad);
      expect(typeof out).toBe('string');
      expect(out).toBe('');
    }
  });

  it('never throws on hostile/malformed input and always returns a string', () => {
    const inputs = [
      '<<<>>>',
      '<script',
      '<a href=javascript:alert(1)',
      '</div></div></div>',
      '<img src=x onerror=alert(1)//',
      '\u0000\u0001<script>x</script>',
    ];
    for (const input of inputs) {
      let out;
      expect(() => {
        out = sanitize(input);
      }).not.toThrow();
      expect(typeof out).toBe('string');
      assertSafe(out);
    }
  });
});
