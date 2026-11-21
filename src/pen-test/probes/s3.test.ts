/**
 * Pen test S3 (#98): Templates, Handlebars and the designer. Answers H15. The findings note is
 * `docs/pen-test/findings/S3.md`. A confirmed gap is an `it.fails` for the property that should hold beside a
 * `today_…` test pinning what happens now; a refuted probe is a plain passing test.
 *
 * The designer's frames are React components. A browser is needed to see what runs inside a frame, so these checks
 * render the components to markup and pin the `sandbox` and `srcdoc` they hand the browser; the note reasons from
 * those values to what a browser does. They need no container, so they sit outside the gated describe.
 */
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createDesign,
  createHtmlBlock,
  type Design,
} from "../../templates/design/model.js";
import { Designer } from "../../ui/designer/designer.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/s3.test.ts");

/* ---------- The designer's frames, read from the components (no container needed) ---------- */

const hostileHtml =
  '<script>parent.document.title="pwned"</script>' +
  '<img src="x" onerror="parent.document.title=1">' +
  '<base href="https://evil.pen-test.invalid/">' +
  '<meta http-equiv="refresh" content="0;url=https://evil.pen-test.invalid/">' +
  '<link rel="stylesheet" href="https://evil.pen-test.invalid/x.css">';

const hostileFont = "Arial}</style><script>alert(1)</script><style>";

const decode = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");

interface Frame {
  title: string;
  sandbox: string | undefined;
  srcdoc: string;
}

const readFrames = (markup: string): Frame[] =>
  [...markup.matchAll(/<iframe\b[^>]*>/gu)].map(([tag]) => ({
    title: decode(/\stitle="([^"]*)"/u.exec(tag)?.[1] ?? ""),
    sandbox: /\ssandbox="([^"]*)"/u.exec(tag)?.[1],
    srcdoc: decode(/\ssrcDoc="([^"]*)"/iu.exec(tag)?.[1] ?? ""),
  }));

const renderDesignerFrames = (): Frame[] => {
  const base = createDesign([createHtmlBlock(hostileHtml)]);
  const design: Design = {
    ...base,
    settings: { ...base.settings, fontFamily: hostileFont },
  };
  const markup = renderToStaticMarkup(
    createElement(Designer, {
      design,
      onChange: () => undefined,
      onUndo: () => undefined,
      onRedo: () => undefined,
      canUndo: false,
      canRedo: false,
      variables: [],
      lockedTop: {
        label: "Header: hostile",
        href: "/headers/x",
        html: `<!doctype html><html><body>${hostileHtml}</body></html>`,
      },
    }),
  );
  return readFrames(markup);
};

/** Every `<iframe … />` in a component's source and the `sandbox` it is given. */
const readSourceSandboxes = async (path: string): Promise<string[]> => {
  const source = await readFile(path, "utf8");
  return [...source.matchAll(/<iframe\b[\s\S]*?\/>/gu)].map(
    ([tag]) => /\ssandbox="([^"]*)"/u.exec(tag)?.[1] ?? "(none)",
  );
};

describe("pen test S3 (#98): the designer's frames, read from the components", () => {
  it("(regression) the designer's HTML-block and locked Header frames are sandbox=\"\", and the designer reads neither frame's document (#155)", async () => {
    const frames = renderDesignerFrames();
    expect(frames.map((frame) => [frame.title, frame.sandbox])).toEqual([
      ["Header: hostile", ""],
      ["Custom HTML", ""],
    ]);
    expect(await readSourceSandboxes("src/ui/designer/designer.tsx")).toEqual([
      "",
      "",
    ]);
    const source = await readFile("src/ui/designer/designer.tsx", "utf8");
    expect(source).not.toContain("contentDocument");
    expect(source).not.toContain("contentWindow");
  });

  it("the designer's frames share no origin with the app, as the previews' sandbox=\"\" doesn't", () => {
    const frames = renderDesignerFrames();
    for (const frame of frames) {
      expect(frame.sandbox).toBe("");
    }
  });

  it("today_ the designer's frames carry an HTML Block's and a Header's script, base, meta refresh and remote CSS verbatim", () => {
    const frames = renderDesignerFrames();
    for (const frame of frames) {
      expect(frame.srcdoc).toContain(hostileHtml);
    }
  });

  it("the designer's frames never allow scripts, forms, popups or top navigation (refuted: none is granted)", () => {
    for (const frame of renderDesignerFrames()) {
      expect(frame.sandbox).toBeDefined();
      expect(frame.sandbox).not.toMatch(
        /allow-(scripts|forms|popups|top-navigation|modals)/u,
      );
    }
  });

  it("(regression) a Design's fontFamily that is not a font stack gives way to the default in the HTML-block frame's <style> (#156)", () => {
    const [, htmlBlock] = renderDesignerFrames();
    expect(htmlBlock?.srcdoc).not.toContain("alert(1)");
    expect(htmlBlock?.srcdoc).toContain(
      "<style>body{margin:0;font-family:Arial, Helvetica, sans-serif;",
    );
  });

  it("a Design's fontFamily stays inside the HTML-block frame's <style>", () => {
    const [, htmlBlock] = renderDesignerFrames();
    expect(htmlBlock?.srcdoc).not.toContain("</style><script>");
  });

  it('the Template, thumbnail and log previews are sandbox="" (refuted: no scripts, no shared origin)', async () => {
    expect(await readSourceSandboxes("src/ui/page-templates.tsx")).toEqual([
      "",
      "",
    ]);
    expect(await readSourceSandboxes("src/ui/page-logs.tsx")).toEqual([""]);
  });
});

/* ---------- Against the server and a real Postgres ---------- */

let world: ProbeWorld;

/** These probes are about what a preview renders, not how many a key may make a minute (#162). */
const preview = async (payload: Record<string, unknown>) => {
  await world.forgetRequestLimits();
  return world.request(
    { key: "secondApp" },
    { method: "POST", url: "/v1/templates/preview", payload },
  );
};

const readRendered = (body: unknown): Record<string, string> => {
  const rendered: Record<string, string> = {};
  if (typeof body === "object" && body !== null) {
    for (const field of ["subject", "html", "text"]) {
      const value: unknown = Reflect.get(body, field);
      if (typeof value === "string") {
        rendered[field] = value;
      }
    }
  }
  return rendered;
};

/** Handlebars' published tricks for reaching a prototype, each wrapped in [] so an empty answer shows. */
const prototypeTricks = [
  "[{{constructor}}]",
  "[{{constructor.name}}]",
  "[{{__proto__}}]",
  "[{{this.constructor.constructor}}]",
  "[{{@root.constructor}}]",
  "[{{name.constructor.prototype}}]",
  "[{{list.constructor}}]",
  "[{{obj.__proto__.polluted}}]",
  '[{{lookup this "constructor"}}]',
  '[{{lookup this "__proto__"}}]',
  '[{{lookup (lookup this "constructor") "name"}}]',
  '[{{#with "s" as |s|}}{{s.constructor.name}}{{/with}}]',
  "[{{#with __proto__}}{{constructor}}{{/with}}]",
  "[{{toString}}]",
  "[{{valueOf}}]",
  "[{{hasOwnProperty}}]",
  "[{{__defineGetter__}}]",
  // The published remote-code-execution chain for Handlebars before 4.6: builds Function from String.prototype.sub.
  '[{{#with "s" as |string|}}{{#with "e"}}{{#with split as |conslist|}}{{this.pop}}{{this.push (lookup string.sub "constructor")}}{{this.pop}}{{#with string.split as |codelist|}}{{this.pop}}{{this.push "return process.pid;"}}{{this.pop}}{{#each conslist}}{{#with (string.sub.apply 0 codelist)}}{{this}}{{/with}}{{/each}}{{/with}}{{/with}}{{/with}}{{/with}}]',
];

const trickVariables = { name: "Ada", list: ["a", "b"], obj: { a: 1 } };

/** A designed Template's Blocks, each holding a link or image a recipient's mail app should never run. */
const hostileDesign = {
  version: 1,
  settings: {
    fontFamily: "Arial&#59background:url(https://evil.pen-test.invalid/f)",
  },
  blocks: [
    { type: "button", label: "Go", url: "javascript:alert(document.domain)" },
    {
      type: "image",
      src: "data:image/svg+xml,<svg onload=alert(1)>",
      href: "javascript:alert(2)",
      alt: "a",
    },
    {
      type: "social",
      links: [
        { network: "website", url: "javascript:alert(3)" },
        { network: "website", url: "data:text/html,<script>alert(4)</script>" },
      ],
    },
    { type: "html", html: hostileHtml },
    {
      type: "text",
      html: "<p>hi</p>",
      showIf: 'true}}{{#with "show-if-ran"}}{{this}}{{/with}}{{/if}}{{#if true',
    },
  ],
};

/** The design is re-rendered on the server only when the Template has a Header or Footer (compose.ts:67-72). */
const previewHostileDesign = async () => {
  const response = await preview({
    subject: "s",
    html: "<p>own</p>",
    design: hostileDesign,
    headerId: world.ids.parts.header,
    variables: {},
  });
  expect(response.statusCode).toBe(200);
  return readRendered(response.json()).html ?? "";
};

const readUrls = (html: string): string[] =>
  [...html.matchAll(/\s(?:href|src)="([^"]*)"/gu)].map(([, url = ""]) => url);

const isSafeScheme = (url: string) =>
  /^(https?:|mailto:|tel:|#|\{\{)/iu.test(url.trim());

describe.skipIf(!hasContainerRuntime)(
  "pen test S3 (#98): Templates, Handlebars and the designer",
  () => {
    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
    }, 300_000);
    afterAll(async () => {
      await world.stop();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /* Probe 1: Handlebars prototype access */

    it("prototype tricks render nothing in the subject, HTML and text through /v1/templates/preview (refuted)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const trick of prototypeTricks) {
        for (const field of ["subject", "html", "text"] as const) {
          const response = await preview({
            subject: "s",
            html: "<p>h</p>",
            text: "t",
            variables: trickVariables,
            [field]: trick,
          });
          expect(response.statusCode, trick).toBe(200);
          expect(readRendered(response.json())[field], trick).toBe("[]");
        }
      }
    });

    it("prototype tricks render nothing in a sent Message's stored subject, HTML and text (refuted)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const [lookup = "", rce = ""] = [
        prototypeTricks[8],
        prototypeTricks.at(-1),
      ];
      const created = await world.request(
        { key: "secondApp" },
        {
          method: "POST",
          url: "/v1/templates",
          payload: {
            name: "S3 prototype probe",
            slug: "s3-prototype-probe",
            subject: "[{{constructor.name}}]",
            html: rce,
            text: lookup,
          },
        },
      );
      expect(created.statusCode).toBe(201);
      const sent = await world.request(
        { key: "secondApp" },
        {
          method: "POST",
          url: "/v1/messages",
          payload: {
            to: ["s3@x.pen-test.invalid"],
            templateSlug: "s3-prototype-probe",
          },
        },
      );
      expect(sent.statusCode).toBe(202);
      const { rows } = await world.database.$client.query<{
        subject: string;
        html: string;
        text: string;
      }>("select subject, html, text from messages where id = $1", [
        sent.json<{ id: string }>().id,
      ]);
      expect(rows[0]).toEqual({ subject: "[]", html: "[]", text: "[]" });
      await world.reloadFixtures();
    });

    it("a __proto__ or constructor.prototype key in the variables is refused before Handlebars (refuted)", async () => {
      for (const body of [
        '{"subject":"s","html":"h","variables":{"__proto__":{"x":1}}}',
        '{"subject":"s","html":"h","variables":{"constructor":{"prototype":{"x":1}}}}',
      ]) {
        const response = await world.request(
          { key: "secondApp" },
          {
            method: "POST",
            url: "/v1/templates/preview",
            payload: body,
            headers: { "content-type": "application/json" },
          },
        );
        expect(response.statusCode).toBe(400);
      }
    });

    it("(regression) a Template's {{log}} renders nothing and writes nothing to the server's console, and a prototype denial writes no warning (#136)", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map(
        (method) =>
          vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const response = await preview({
        subject: "[{{log resetUrl}}]",
        html: "<p>[{{log resetUrl}}][{{#log resetUrl}}x{{/log}}][{{constructor.name}}]</p>",
        text: '[{{log resetUrl level="error"}}]',
        variables: { resetUrl: "https://wizzaroo.pen-test.invalid/reset/s3" },
      });
      expect(response.statusCode).toBe(200);
      expect(readRendered(response.json())).toEqual({
        subject: "[]",
        html: "<p>[][][]</p>",
        text: "[]",
      });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it("a Template cannot write its variables to the server's log", async () => {
      const info = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      await preview({
        subject: "s",
        html: "<p>{{log resetUrl}}</p>",
        variables: { resetUrl: "https://wizzaroo.pen-test.invalid/reset/s3" },
      });
      expect(info).not.toHaveBeenCalled();
    });

    // #136 made {{log}} write nothing, so these #153 probes find the showIf's own Handlebars by the literal it renders.
    it("(regression) a Block's showIf that is not a variable path is dropped, so its Handlebars never runs and the Block shows (#153)", async () => {
      const html = await previewHostileDesign();
      expect(html).not.toContain("show-if-ran");
      expect(html).toContain("<p");
      expect(html).toContain(">hi</p>");
    });

    it("a Block's showIf is only ever a condition", async () => {
      expect(await previewHostileDesign()).not.toContain("show-if-ran");
    });

    /* Probe 2: javascript: and data: URLs in Button, Image and Socials Blocks */

    it("(regression) Button, Image and Socials Blocks drop javascript: and data: URLs: the Button links to #, the image and the socials are left out (#154)", async () => {
      const html = await previewHostileDesign();
      const urls = readUrls(html);
      expect(
        urls.filter(
          (url) => url.startsWith("javascript:") || url.startsWith("data:"),
        ),
      ).toEqual([]);
      // The Button's link is written twice: the VML shape for Outlook and the <a> for everyone else.
      expect(urls.filter((url) => url === "#")).toHaveLength(2);
      expect(html).not.toContain('alt="a"');
      expect(html).not.toContain('title="Website"');
    });

    it("a Block's link or image keeps only an http(s), mailto or tel URL or a Handlebars variable", async () => {
      const urls = readUrls(await previewHostileDesign());
      const blockUrls = urls.filter(
        (url) =>
          url.startsWith("javascript:") ||
          url.startsWith("data:") ||
          isSafeScheme(url),
      );
      expect(blockUrls.filter((url) => !isSafeScheme(url))).toEqual([]);
    });

    /* Probe 3: script, handlers, <base>, <meta http-equiv> and remote CSS in an HTML Block and a Header */

    it("today_ an HTML Block's and a Header's script, handlers, base, meta refresh and remote CSS reach the rendered HTML verbatim", async () => {
      expect(await previewHostileDesign()).toContain(hostileHtml);
      // Wizzaroo's own key: since K1's fix (#113), only the Header's own Application's keys can replace it.
      const header = await world.request(
        { key: "wizzaroo" },
        {
          method: "PUT",
          url: `/v1/headers/${world.ids.parts.header}`,
          payload: { name: "Wizzaroo header", html: hostileHtml },
        },
      );
      expect(header.statusCode).toBe(200);
      const composed = await preview({
        subject: "s",
        html: "<html><body><p>own</p></body></html>",
        headerId: world.ids.parts.header,
      });
      expect(readRendered(composed.json()).html).toContain(hostileHtml);
      await world.reloadFixtures();
    });

    /* Probe 4: CSS-breaking text in a Design's fontFamily */

    it("(regression) a fontFamily that is not a font stack, &#59 and all, gives way to the default on every styled element (#156)", async () => {
      const html = await previewHostileDesign();
      expect(html).not.toContain("evil.pen-test.invalid/f");
      expect(html).toContain("font-family:Arial, Helvetica, sans-serif;");
    });

    it("a Design's fontFamily cannot add a CSS declaration to the email", async () => {
      const html = await previewHostileDesign();
      expect(html).not.toMatch(/font-family:[^;"]*&#/u);
    });

    /* Probe 5: the server cost of a deep or large Template through /v1/templates/preview */

    it("(regression) three nested {{#each}} over 100 variables are refused with 422 for the work they do, and a render past 1,000,000 characters for its length (#137)", async () => {
      const list = Array.from({ length: 100 }, (_, index) => index);
      const nested = await preview({
        subject: "s",
        html: "{{#each l}}{{#each ../l}}{{#each ../../l}}x{{/each}}{{/each}}{{/each}}",
        variables: { l: list },
      });
      expect(nested.statusCode).toBe(422);
      expect(nested.json()).toEqual({
        error: "validation_failed",
        message:
          "The template does not render: it does more work than one render may, such as a loop or nesting that grows too far",
        errors: [
          {
            field: "html",
            message:
              "The template does not render: it does more work than one render may, such as a loop or nesting that grows too far",
          },
        ],
      });

      const long = await preview({
        subject: "s",
        html: "{{#each l}}{{../v}}{{/each}}",
        variables: { l: [...list, ...list], v: "x".repeat(5001) },
      });
      expect(long.statusCode).toBe(422);
      expect(long.json()).toMatchObject({
        errors: [
          {
            field: "html",
            message:
              "The rendered HTML is 1,000,200 characters, longer than the 1,000,000 it may have",
          },
        ],
      });
    });

    it("/v1/templates/preview refuses a render that grows past a bound (1 MB of output here)", async () => {
      const list = Array.from({ length: 101 }, (_, index) => index);
      const html =
        "{{#each l}}{{#each ../l}}{{#each ../../l}}x{{/each}}{{/each}}{{/each}}";
      const response = await preview({
        subject: "s",
        html,
        variables: { l: list },
      });
      expect(response.statusCode).not.toBe(200);
    });

    it("today_ nesting 5,000 deep is refused with 422 for its Handlebars length before it compiles, and 2,500 deep with V8's message, not a 500", async () => {
      const nest = (depth: number) =>
        preview({
          subject: "s",
          html: `${"{{#if a}}".repeat(depth)}x${"{{/if}}".repeat(depth)}`,
          variables: { a: true },
        });
      const deep = await nest(5000);
      expect(deep.statusCode).toBe(422);
      expect(deep.json<{ message: string }>().message).toBe(
        "The template does not render: it has more than the 50,000 characters of {{…}} expressions a subject, HTML or text may have",
      );
      const within = await nest(2500);
      expect(within.statusCode).toBe(422);
      expect(within.json<{ message: string }>().message).toBe(
        "The template does not render: Maximum call stack size exceeded",
      );
    }, 60_000);

    it("(regression) a hand-written Template of 150,000 unclosed <body tags (750 KB) is composed with a Header in linear time and answered 200 (#137)", async () => {
      const started = performance.now();
      const response = await preview({
        subject: "s",
        html: "<body".repeat(150_000),
        headerId: world.ids.parts.header,
      });
      expect(response.statusCode).toBe(200);
      // The quadratic scan took about 94 ms for 8,000 and would take about half a minute for this.
      expect(performance.now() - started).toBeLessThan(5000);
    }, 60_000);
  },
);
