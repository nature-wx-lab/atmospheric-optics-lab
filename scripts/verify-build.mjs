#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist");

async function walk(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(root);
const relativeFiles = files.map((path) => relative(root, path).split(sep).join("/")).sort();
assert(relativeFiles.includes("index.html"), "dist/index.html is missing");
assert(relativeFiles.includes("robots.txt"), "dist/robots.txt is missing");
assert(relativeFiles.includes("favicon.svg"), "dist/favicon.svg is missing");
assert(relativeFiles.some((path) => /^assets\/[^/]+\.js$/.test(path)), "bundled JavaScript is missing");
assert(relativeFiles.some((path) => /^assets\/[^/]+\.css$/.test(path)), "bundled CSS is missing");

for (const path of relativeFiles) {
  assert(!path.endsWith(".map"), `source map must not be published: ${path}`);
  assert(
    path === "index.html" ||
      path === "robots.txt" ||
      path === "favicon.svg" ||
      path === "deployment.json" ||
      /^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path),
    `unexpected public artifact: ${path}`
  );
}

const html = await readFile(join(root, "index.html"), "utf8");
assert(html.includes("noindex,nofollow,noarchive"), "beta noindex directive is missing");
assert(html.includes("大気光学3Dラボ"), "product title is missing");
assert(html.includes('href="./favicon.svg"'), "local SVG favicon link is missing");
assert(!html.includes("/" + "Users/"), "local absolute path leaked into the build");
assert(!html.includes("sourceMappingURL"), "source map reference leaked into the build");

const robots = await readFile(join(root, "robots.txt"), "utf8");
assert(robots.includes("Disallow: /"), "robots.txt must keep the beta private from indexing");

console.log(JSON.stringify({ status: "ok", file_count: relativeFiles.length, files: relativeFiles }, null, 2));
