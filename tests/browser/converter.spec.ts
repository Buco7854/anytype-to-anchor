import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

test("example → tag-free ZIP, task filtering, selection, search and guide", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Anchor ZIP" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "2 notes and 2 tasks selected",
  );
  await expect(page.locator("#note-preview")).toContainText(
    "A small digital garden",
  );
  await page.getByRole("switch", { name: "Include tags" }).uncheck();
  await expect(page.locator("#note-preview .tag")).toHaveCount(0);
  await expect(page.locator("#download-hint")).toContainText("0 tags");
  await page
    .getByRole("checkbox", { name: "Notes", exact: false })
    .first()
    .uncheck();
  await expect(page.locator("#selection-summary")).toHaveText(
    "0 notes and 2 tasks selected",
  );
  await page.getByRole("searchbox").fill("reading");
  await expect(page.locator(".note-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Deselect visible" }).click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "0 notes and 1 task selected",
  );
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Anchor ZIP" }).click();
  const download = await promise;
  const zip = unzipSync(
    new Uint8Array(await readFile((await download.path())!)),
  );
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(manifest.counts.notes).toBe(1);
  expect(manifest.tags).toEqual([]);
  expect(manifest.notes[0].title).toBe("Give my notes a new home");
  await expect(page.locator("#download-success")).toBeVisible();
  await page.getByRole("button", { name: "Export & import guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export & import guide" }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("real ZIP input, warnings, error recovery and no external network or stored content", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  await page.goto("/");
  const zip = zipSync({
    "Export/notes/one.md": strToU8(
      "---\ntitle: A real upload\ntags: [Research]\n---\n# A real upload\n\n**Useful** text\n\n[Paper](../files/paper.pdf)",
    ),
    "Export/files/paper.pdf": strToU8("%PDF-test"),
  });
  await page.locator("#file-input").setInputFiles({
    name: "notes.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await expect(page.locator("#source-name")).toHaveText("notes.zip");
  await expect(page.locator("#note-preview")).toContainText("Useful");
  await expect(page.locator("#warnings")).toBeVisible();
  await page.locator("#warnings-summary").click();
  await expect(page.locator("#warnings-list")).toContainText(
    "unsupported-attachments/",
  );
  await page.locator("#file-input").setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "ZIP could not be opened",
  );
  await expect(page.locator("#note-preview")).toContainText("A real upload");
  await expect(
    page.getByRole("button", { name: "Download Anchor ZIP" }),
  ).toBeEnabled();
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

for (const width of [1440, 768, 390, 320]) {
  test(`responsive workflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `test-results/empty-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(page.locator("#selection-summary")).toHaveText(
      "2 notes and 2 tasks selected",
    );
    await expect(page.locator("#download")).toHaveCSS(
      "background-color",
      "rgb(32, 37, 38)",
    );
    await page.screenshot({
      path: `test-results/loaded-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width <= 700) await page.locator("#options-panel summary").click();
    await page.getByRole("switch", { name: "Include tags" }).uncheck();
    await expect(page.locator("#download-hint")).toContainText("0 tags");
  });
}

test("keyboard path, reduced motion, enlarged text, and accessibility of empty and loaded states", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to converter" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Try an example" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#selection-summary")).toHaveText(
    "2 notes and 2 tasks selected",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Preview Sort the reading list Task" })
    .click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const sizes = nodes.map((node) =>
      Number.parseFloat(getComputedStyle(node).fontSize),
    );
    nodes.forEach((node, index) => {
      node.style.fontSize = `${sizes[index] * 2}px`;
    });
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("unnamed notes have readable review labels but no title in the preview or Anchor ZIP", async ({
  page,
}) => {
  await page.goto("/");
  const objectId = "bafyrei" + "a".repeat(52);
  const note = {
    sbType: "Page",
    snapshot: {
      data: {
        details: { id: objectId, resolvedLayout: 9, tags: ["Reading"] },
        blocks: [
          { id: "root", smartblock: {}, childrenIds: ["heading", "body"] },
          {
            id: "body",
            text: { text: "A list of books to revisit.", style: "Paragraph" },
          },
          { id: "heading", text: { text: "À lire", style: "Header2" } },
        ],
      },
    },
  };
  await page.locator("#file-input").setInputFiles({
    name: objectId + ".pb.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(note)),
  });
  await expect(page.locator(".note-row-title")).toHaveText("À lire");
  await expect(page.locator("#note-preview h3")).toHaveCount(0);
  await expect(page.locator(".preview-meta")).toContainText("No title");
  await expect(page.locator(".preview-content")).toContainText(
    "A list of books to revisit.",
  );
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Anchor ZIP" }).click();
  const download = await promise;
  const zip = unzipSync(
    new Uint8Array(await readFile((await download.path())!)),
  );
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(manifest.notes[0].title).toBe("");
  const markdown = strFromU8(
    Object.entries(zip).find(([path]) => path.startsWith("markdown/"))![1],
  );
  expect(markdown).not.toMatch(/^# /m);
  expect(manifest.notes[0].content).toContain("A list of books to revisit.");
  expect(manifest.notes[0].tagIds).toHaveLength(1);
});

test("theme follows the device, toggles by keyboard, and remembers an explicit choice", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const toggle = page.getByRole("button", { name: "Dark theme", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("anytype-anchor-theme")),
  ).toBe("light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#111111",
  );
});

for (const width of [1440, 768, 390, 320]) {
  test(`dark theme reflows and converts at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(17, 17, 17)",
    );
    await page.screenshot({
      path: `test-results/dark-empty-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(page.locator("#selection-summary")).toHaveText(
      "2 notes and 2 tasks selected",
    );
    await expect(page.locator("#download")).toHaveCSS(
      "background-color",
      "rgb(237, 237, 237)",
    );
    await page.screenshot({
      path: `test-results/dark-loaded-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const promise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Anchor ZIP" }).click();
    const download = await promise;
    const zip = unzipSync(
      new Uint8Array(await readFile((await download.path())!)),
    );
    expect(JSON.parse(strFromU8(zip["manifest.json"])).notes).toHaveLength(4);
  });
}

test("dark theme keeps empty, loaded, success, warning, error, and guide states accessible", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator("#loaded-review")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Anchor ZIP" }).click();
  await downloadPromise;
  await expect(page.locator("#download-success")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator("#file-input").setInputFiles({
    name: "table.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Note\n\n| A | B |\n| - | - |\n| 1 | 2 |"),
  });
  await expect(page.locator("#warnings")).toBeVisible();
  await page.locator("#warnings-summary").click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator("#file-input").setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Export & import guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("theme switching and conversion work when browser storage is disabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage is disabled", "SecurityError");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "2 notes and 2 tasks selected",
  );
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`multiline code renders as continuous scrollable blocks in ${colorScheme} mode`, async ({
    page,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const first =
      'const value = "**literal**";\n\n  console.log(value);\n// ' +
      "long-code-line-".repeat(25) +
      "\n<script>window.previewCodeExecuted = true;</script>";
    const second = 'print("A separate block")\nprint("Second line")';
    await page.locator("#file-input").setInputFiles({
      name: "Code example.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Code example\n\n```js\n" +
          first +
          "\n```\n\nA paragraph between blocks.\n\n```python\n" +
          second +
          "\n```",
      ),
    });
    const blocks = page.getByRole("group", {
      name: "Code block",
      exact: true,
    });
    await expect(blocks).toHaveCount(2);
    expect(await blocks.nth(0).locator("code").textContent()).toBe(
      first + "\n",
    );
    expect(await blocks.nth(1).locator("code").textContent()).toBe(
      second + "\n",
    );
    await expect(page.locator(".preview-line.code")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).previewCodeExecuted),
    ).toBeUndefined();
    expect(
      await blocks
        .first()
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await blocks.first().focus();
    await expect(blocks.first()).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => blocks.first().evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await blocks.first().evaluate((node) => {
      node.scrollLeft = 0;
    });
    await page.screenshot({
      path: `test-results/code-block-${colorScheme}.png`,
      fullPage: true,
    });
  });
}

test("warnings identify unnamed notes and their source filenames can be searched", async ({
  page,
}) => {
  await page.goto("/");
  const object = (id: string, blocks: unknown[]) =>
    strToU8(
      JSON.stringify({
        sbType: "Page",
        snapshot: { data: { details: { id, resolvedLayout: 9 }, blocks } },
      }),
    );
  const archive = zipSync({
    "reading.pb.json": object("reading", [
      {
        id: "p",
        text: {
          text: "Reading list",
          marks: { marks: [{ type: "Keyboard", range: { from: 0, to: 7 } }] },
        },
      },
    ]),
    "empty-view.pb.json": object("empty-view", [{ id: "view", dataview: {} }]),
  });
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "notes.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
  await expect(page.locator("#warnings")).toBeVisible();
  await page.locator("#warnings-summary").click();
  await expect(page.locator("#warnings-list")).toContainText(
    "Reading list: Inline code",
  );
  await expect(page.locator("#warnings-list")).toContainText(
    "Untitled (empty-view.pb.json): Tables and views",
  );
  await page.getByRole("searchbox").fill("Reading list");
  await expect(page.locator(".note-row-title")).toHaveText("Reading list");
  await page.getByRole("searchbox").fill("empty-view.pb.json");
  await expect(page.locator(".note-row-title")).toHaveText("Untitled");
  await expect(page.locator(".preview-meta")).toContainText("No title");
  await expect(page.locator("#note-preview h3")).toHaveCount(0);
});
