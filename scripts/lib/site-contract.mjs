import { categories } from './categories.mjs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;


function invalid(file, field, message) {
  throw new Error(`${file}: ${field} ${message}`);
}

function object(value, file, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(file, field, "must be an object");
  return value;
}

function text(value, file, field) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    invalid(
      file,
      field,
      "must be a non-empty string without control characters",
    );
  return value;
}

function prose(value, file, field) {
  if (typeof value !== "string" || !value.trim())
    invalid(file, field, "must be a non-empty string");
  return value;
}

function values(value, file, field, min = 0, max = Infinity) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    invalid(file, field, `must contain ${min}–${max} items`);
  return value;
}

function strings(value, file, field, min = 0, max = Infinity) {
  return values(value, file, field, min, max).map((item, index) =>
    prose(item, file, `${field}[${index}]`),
  );
}

function choice(value, allowed, file, field) {
  if (!allowed.includes(value))
    invalid(file, field, `must be one of ${allowed.join(", ")}`);
}

function date(value, file, field, utc = false) {
  text(value, file, field);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    (utc && !value.endsWith("Z"))
  )
    invalid(file, field, "must be a valid date or UTC timestamp");
}

function url(value, file, field) {
  text(value, file, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid(file, field, "must be an HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    invalid(file, field, "must be an HTTP(S) URL without credentials");
}

export function externalCoverUrl(value, file) {
  text(value, file, "cover.url");
  const authority = /^https:\/\/([^/?#]+)/i.exec(value);
  let parsed;
  try { parsed = new URL(value); } catch { /* Report the cover-specific error below. */ }
  if (!authority || /[\s\\]/.test(value) || authority[1].includes("@") || parsed?.protocol !== "https:" || parsed.username || parsed.password)
    invalid(file, "cover.url", "must be an HTTPS URL without credentials or an archived local image");
  return parsed.href;
}

function relativePath(value, file, field, allowRoot = false) {
  text(value, file, field);
  if (allowRoot && value === ".") return;
  if (
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    invalid(file, field, "must be a safe repository-relative path");
}

function repository(value, file, field) {
  text(value, file, field);
  if (
    !/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(value) ||
    [".", ".."].includes(value.split("/")[1])
  )
    invalid(file, field, "must be a safe GitHub owner/repo");
}

function source(value, file, field) {
  object(value, file, field);
  repository(value.repo, file, `${field}.repo`);
  if (typeof value.commit !== "string" || !/^[a-f0-9]{40}$/i.test(value.commit))
    invalid(file, `${field}.commit`, "must be a full 40-character commit SHA");
}

function sameSource(a, b) {
  return (
    a.repo.toLowerCase() === b.repo.toLowerCase() &&
    a.commit.toLowerCase() === b.commit.toLowerCase()
  );
}

function installationKey(item) {
  return `${item.repo.toLowerCase()}\0${item.commit.toLowerCase()}\0${item.directory}`;
}

function translationFields(
  value,
  file,
  field,
  texts,
  arrays = [],
  objects = [],
) {
  object(value, file, field);
  for (const [key, entry] of Object.entries(value)) {
    if (texts.includes(key)) prose(entry, file, `${field}.${key}`);
    else if (arrays.includes(key)) strings(entry, file, `${field}.${key}`);
    else if (objects.includes(key)) object(entry, file, `${field}.${key}`);
    else
      invalid(file, `${field}.${key}`, "is not a translatable display field");
  }
}

function validateLocalizations(data, file) {
  if (data.localizations === undefined) return;
  translationFields(data.localizations, file, "localizations", [], [], ["en"]);
  if (data.localizations.en === undefined) return;
  const english = data.localizations.en;
  translationFields(
    english,
    file,
    "localizations.en",
    ["title", "description", "coverAlt", "overview", "usage"],
    ["tags", "scenarios"],
    ["skills", "provenance"],
  );
  for (const [id, translation] of Object.entries(english.skills || {})) {
    if (!data.skills.some((skill) => skill.id === id))
      invalid(
        file,
        `localizations.en.skills.${id}`,
        "refers to an unknown Skill ID",
      );
    translationFields(translation, file, `localizations.en.skills.${id}`, [
      "summary",
      "role",
    ]);
  }
  if (english.provenance !== undefined) {
    translationFields(
      english.provenance,
      file,
      "localizations.en.provenance",
      ["selectionReason"],
      [],
      ["evidence"],
    );
    for (const [id, translation] of Object.entries(
      english.provenance.evidence || {},
    )) {
      if (!data.provenance.evidence.some((evidence) => evidence.id === id))
        invalid(
          file,
          `localizations.en.provenance.evidence.${id}`,
          "refers to an unknown evidence ID",
        );
      translationFields(
        translation,
        file,
        `localizations.en.provenance.evidence.${id}`,
        ["title", "location", "finding"],
      );
    }
  }
}

export async function validateCollection(data, file, rootDir, { validateLocalCover } = {}) {
  object(data, file, "collection");
  if (data.curator !== undefined) {
    object(data.curator, file, "curator");
    for (const key of Object.keys(data.curator))
      if (!["name", "url"].includes(key)) invalid(file, `curator.${key}`, "is not a supported field");
    text(data.curator.name, file, "curator.name");
    if (data.curator.url !== undefined) url(data.curator.url, file, "curator.url");
  }
  if (data.schemaVersion !== 1) invalid(file, "schemaVersion", "must be 1");
  if (typeof data.id !== "string" || !UUID.test(data.id))
    invalid(file, "id", "must be a UUID v4");
  if (file !== `${data.id}.json`)
    invalid(file, "filename", "must match the collection UUID");
  if (
    typeof data.slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)
  )
    invalid(file, "slug", "must be a lowercase URL slug");
  if (!Number.isSafeInteger(data.revision) || data.revision < 1)
    invalid(file, "revision", "must be a positive integer");
  if (data.sortOrder !== undefined && !Number.isFinite(data.sortOrder))
    invalid(file, "sortOrder", "must be a finite number");
  if (data.submission !== undefined)
    invalid(file, "submission", "is only allowed in candidate files");
  date(data.createdAt, file, "createdAt", true);
  date(data.updatedAt, file, "updatedAt", true);
  if (Date.parse(data.updatedAt) < Date.parse(data.createdAt))
    invalid(file, "updatedAt", "must not precede createdAt");
  strings(data.sourceKeys, file, "sourceKeys", 1).forEach((key) =>
    text(key, file, "sourceKeys"),
  );
  choice(data.status, ["active", "archived"], file, "status");
  choice(
    data.sourceKind,
    ["author-repository", "external-recommendation", "editorial-selection"],
    file,
    "sourceKind",
  );
  for (const field of ["title", "description", "overview", "usage"])
    prose(data[field], file, field);
  choice(data.category, categories, file, "category");
  strings(data.tags, file, "tags", 0, 8);
  strings(data.scenarios, file, "scenarios", 1, 5);

  object(data.review, file, "review");
  choice(
    data.review.status,
    ["pending", "approved", "rejected"],
    file,
    "review.status",
  );
  strings(data.review.notes, file, "review.notes");
  if (data.review.status !== "pending") {
    text(data.review.reviewer, file, "review.reviewer");
    date(data.review.reviewedAt, file, "review.reviewedAt");
  }

  object(data.provenance, file, "provenance");
  const { provenance } = data;
  for (const field of ["author", "recommender"]) {
    if (provenance[field] !== undefined) {
      object(provenance[field], file, `provenance.${field}`);
      text(provenance[field].name, file, `provenance.${field}.name`);
      url(provenance[field].url, file, `provenance.${field}.url`);
    }
  }
  if (data.sourceKind === "external-recommendation" && !provenance.recommender)
    invalid(
      file,
      "provenance.recommender",
      "is required for external recommendations",
    );
  if (data.sourceKind === "editorial-selection")
    prose(provenance.selectionReason, file, "provenance.selectionReason");
  if (data.sourceKind === "author-repository") {
    source(provenance.repositoryScope, file, "provenance.repositoryScope");
    choice(
      provenance.repositoryScope.coverage,
      ["all-valid-skills"],
      file,
      "provenance.repositoryScope.coverage",
    );
    strings(
      provenance.repositoryScope.directories,
      file,
      "provenance.repositoryScope.directories",
      1,
    ).forEach((directory) =>
      relativePath(
        directory,
        file,
        "provenance.repositoryScope.directories",
        true,
      ),
    );
  }

  const skillIds = new Set();
  const skills = values(data.skills, file, "skills", 1);
  for (const [index, skill] of skills.entries()) {
    const field = `skills[${index}]`;
    object(skill, file, field);
    text(skill.id, file, `${field}.id`);
    if (skillIds.has(skill.id)) invalid(file, `${field}.id`, "must be unique");
    skillIds.add(skill.id);
    text(skill.name, file, `${field}.name`);
    prose(skill.summary, file, `${field}.summary`);
    if (skill.role !== undefined) prose(skill.role, file, `${field}.role`);
    if (skill.originalDescription !== undefined)
      prose(skill.originalDescription, file, `${field}.originalDescription`);
    if (skill.authors !== undefined) {
      for (const author of values(skill.authors, file, `${field}.authors`)) {
        object(author, file, `${field}.authors`);
        text(author.name, file, `${field}.authors.name`);
        url(author.evidenceUrl, file, `${field}.authors.evidenceUrl`);
      }
    }
    source(skill.entry, file, `${field}.entry`);
    relativePath(skill.entry.entryPoint, file, `${field}.entry.entryPoint`);
    if (!/(?:^|\/)SKILL\.md$/.test(skill.entry.entryPoint))
      invalid(file, `${field}.entry.entryPoint`, "must point to SKILL.md");
    const scope = provenance.repositoryScope;
    if (
      data.sourceKind === "author-repository" &&
      (!sameSource(skill.entry, scope) ||
        !scope.directories.some(
          (directory) =>
            directory === "." ||
            skill.entry.entryPoint.startsWith(`${directory}/`),
        ))
    )
      invalid(
        file,
        `${field}.entry`,
        "must be within the author repository scope",
      );
    choice(
      skill.installationMode,
      ["skill", "bundle"],
      file,
      `${field}.installationMode`,
    );
    const items = values(
      skill.installationItems,
      file,
      `${field}.installationItems`,
      skill.installationMode === "bundle" ? 2 : 1,
      skill.installationMode === "skill" ? 1 : Infinity,
    );
    for (const [itemIndex, item] of items.entries()) {
      const itemField = `${field}.installationItems[${itemIndex}]`;
      source(item, file, itemField);
      text(item.name, file, `${itemField}.name`);
      if (/[\\/]/.test(item.name) || [".", ".."].includes(item.name))
        invalid(file, `${itemField}.name`, "must be a safe installation name");
      relativePath(item.directory, file, `${itemField}.directory`, true);
      if (item.entryPoint !== "SKILL.md")
        invalid(file, `${itemField}.entryPoint`, "must be SKILL.md");
      object(item.license, file, `${itemField}.license`);
      text(item.license.identifier, file, `${itemField}.license.identifier`);
      if (item.license.evidenceUrl !== undefined)
        url(item.license.evidenceUrl, file, `${itemField}.license.evidenceUrl`);
    }
    if (
      !items.some(
        (item) =>
          sameSource(item, skill.entry) &&
          (item.directory === "."
            ? item.entryPoint
            : `${item.directory}/${item.entryPoint}`) ===
            skill.entry.entryPoint,
      )
    )
      invalid(
        file,
        `${field}.entry`,
        "must correspond to an actual installation item",
      );
    choice(
      skill.resourceCheck,
      ["verified", "needs-review"],
      file,
      `${field}.resourceCheck`,
    );
    prose(skill.resourceNotes, file, `${field}.resourceNotes`);
  }

  const evidenceIds = new Set();
  const supportedIds = new Set();
  for (const [index, evidence] of values(
    provenance.evidence,
    file,
    "provenance.evidence",
    1,
  ).entries()) {
    const field = `provenance.evidence[${index}]`;
    object(evidence, file, field);
    text(evidence.id, file, `${field}.id`);
    if (evidenceIds.has(evidence.id))
      invalid(file, `${field}.id`, "must be unique");
    evidenceIds.add(evidence.id);
    choice(
      evidence.kind,
      ["repository", "article", "post"],
      file,
      `${field}.kind`,
    );
    url(evidence.url, file, `${field}.url`);
    for (const key of ["title", "publisher", "location", "finding"])
      prose(evidence[key], file, `${field}.${key}`);
    date(evidence.checkedAt, file, `${field}.checkedAt`);
    if (evidence.publishedAt !== undefined)
      date(evidence.publishedAt, file, `${field}.publishedAt`);
    for (const id of strings(
      evidence.supportsItemIds,
      file,
      `${field}.supportsItemIds`,
    )) {
      if (!skillIds.has(id))
        invalid(
          file,
          `${field}.supportsItemIds`,
          `contains unknown skill ${id}`,
        );
      supportedIds.add(id);
    }
  }
  if ([...skillIds].some((id) => !supportedIds.has(id)))
    invalid(file, "provenance.evidence", "must support every display item");

  object(data.cover, file, "cover");
  prose(data.cover.alt, file, "cover.alt");
  choice(data.cover.kind, ["source-image", "concept"], file, "cover.kind");
  if (data.cover.kind === "concept") {
    choice(
      data.cover.preset,
      ["design", "engineering", "marketing", "video", "neutral"],
      file,
      "cover.preset",
    );
  } else {
    url(data.cover.sourceUrl, file, "cover.sourceUrl");
    choice(
      data.cover.rightsStatus,
      ["verified", "needs-review"],
      file,
      "cover.rightsStatus",
    );
    if (data.cover.rightsStatus === "verified")
      url(data.cover.rightsEvidenceUrl, file, "cover.rightsEvidenceUrl");
    if (data.cover.position !== undefined)
      text(data.cover.position, file, "cover.position");
    text(data.cover.url, file, "cover.url");
    if (data.cover.url.startsWith("/") && !data.cover.url.startsWith("//")) {
      let relative;
      try {
        relative = decodeURIComponent(data.cover.url.slice(1));
      } catch {
        invalid(file, "cover.url", "has invalid URL encoding");
      }
      relativePath(relative, file, "cover.url");
      if (/[?#]/.test(relative))
        invalid(file, "cover.url", "must be a local public file path");
      let coverFile;
      try {
        coverFile = validateLocalCover
          ? await validateLocalCover(data.cover.url)
          : await stat(path.join(rootDir, "public", relative));
      } catch {
        invalid(
          file,
          "cover.url",
          "must point to an existing local public file",
        );
      }
      if (!coverFile.isFile())
        invalid(file, "cover.url", "must point to a local file");
    } else externalCoverUrl(data.cover.url, file);
  }

  object(data.verification, file, "verification");
  for (const field of ["source", "files"])
    choice(
      data.verification[field],
      ["verified", "needs-review"],
      file,
      `verification.${field}`,
    );
  date(data.verification.checkedAt, file, "verification.checkedAt");
  strings(data.verification.notes, file, "verification.notes");
  for (const field of ["installation", "workflow"]) {
    choice(
      data.verification[field],
      ["not-tested", "passed", "failed"],
      file,
      `verification.${field}`,
    );
    if (data.verification[field] === "not-tested") continue;
    const evidenceField = `verification.${field}Evidence`;
    const evidence = object(
      data.verification[`${field}Evidence`],
      file,
      evidenceField,
    );
    date(evidence.testedAt, file, `${evidenceField}.testedAt`);
    for (const version of values(
      evidence.versions,
      file,
      `${evidenceField}.versions`,
      1,
    ))
      source(version, file, `${evidenceField}.versions`);
    for (const id of strings(
      evidence.itemIds,
      file,
      `${evidenceField}.itemIds`,
      1,
    ))
      if (!skillIds.has(id))
        invalid(file, `${evidenceField}.itemIds`, "contains an unknown skill");
    text(evidence.resultRef, file, `${evidenceField}.resultRef`);
    text(evidence.environment, file, `${evidenceField}.environment`);
  }
  validateLocalizations(data, file);
}

export async function loadPublishedCollections(rootDir) {
  const directory = path.join(rootDir, "content/collections");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const records = [];
  const identities = new Map();
  const slugs = new Map();
  const sourceKeys = new Map();
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    } catch (error) {
      throw new Error(`${file}: cannot read collection JSON: ${error.message}`);
    }
    await validateCollection(data, file, rootDir);
    for (const [field, keys, registry] of [
      ["id", [data.id.toLowerCase()], identities],
      ["slug", [data.slug], slugs],
      ["sourceKeys", data.sourceKeys, sourceKeys],
    ]) {
      for (const key of keys) {
        if (registry.has(key))
          invalid(file, field, `conflicts with ${registry.get(key)}`);
        registry.set(key, file);
      }
    }
    records.push(data);
  }
  return records
    .filter(
      (data) => data.status === "active" && data.review.status === "approved",
    )
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
}

export function indexItem(collection) {
  const installations = new Map();
  for (const skill of collection.skills)
    for (const item of skill.installationItems)
      installations.set(installationKey(item), item);
  const owner = collection.provenance.repositoryScope?.repo.split("/")[0];
  const authorLabel =
    collection.sourceKind === "external-recommendation"
      ? `${collection.provenance.recommender.name} 推荐`
      : collection.sourceKind === "editorial-selection"
        ? `${collection.curator?.name ?? "Skills Hub"} 整理`
        : collection.provenance.author?.name || owner;
  const licenses = [
    ...new Set(
      [...installations.values()].map((item) => item.license.identifier),
    ),
  ];
  const english = collection.localizations?.en;
  const englishSearchText = english
    ? [
        english.title ?? collection.title,
        english.description ?? collection.description,
        collection.category,
        authorLabel,
        ...(english.tags ?? collection.tags),
        ...collection.skills.flatMap((skill) => [
          skill.name,
          english.skills?.[skill.id]?.summary ?? skill.summary,
          english.skills?.[skill.id]?.role ?? skill.role ?? "",
          skill.entry.repo,
        ]),
      ].join(" ")
    : "";
  return {
    schemaVersion: 1,
    id: collection.id,
    slug: collection.slug,
    revision: collection.revision,
    title: collection.title,
    description: collection.description,
    category: collection.category,
    tags: collection.tags,
    cover: collection.cover,
    authorLabel,
    itemCount: collection.skills.length,
    installationCount: installations.size,
    searchText: [
      collection.title,
      collection.description,
      collection.category,
      authorLabel,
      ...collection.tags,
      ...collection.skills.flatMap((skill) => [
        skill.name,
        skill.summary,
        skill.role || "",
        skill.entry.repo,
      ]),
      englishSearchText,
    ].join(" "),
    ...(english
      ? {
          localizations: {
            en: {
              ...(english.title !== undefined ? { title: english.title } : {}),
              ...(english.description !== undefined
                ? { description: english.description }
                : {}),
              ...(english.tags !== undefined ? { tags: english.tags } : {}),
              ...(english.coverAlt !== undefined
                ? { coverAlt: english.coverAlt }
                : {}),
            },
          },
        }
      : {}),
    licenseLabel: licenses
      .map((license) => (license === "NOASSERTION" ? "许可待核对" : license))
      .join(" / "),
  };
}

export async function exportCollections({
  rootDir,
  outputDir = path.join(rootDir, "public/data/collections"),
}) {
  const collections = await loadPublishedCollections(rootDir);
  const index = { schemaVersion: 1, collections: collections.map(indexItem) };
  await mkdir(path.dirname(outputDir), { recursive: true });
  const staged = await mkdtemp(
    path.join(path.dirname(outputDir), ".collections-"),
  );
  try {
    for (const collection of collections)
      await writeFile(
        path.join(staged, `${collection.id}.json`),
        JSON.stringify(collection, null, 2) + "\n",
      );
    await writeFile(
      path.join(staged, "index.json"),
      JSON.stringify(index, null, 2) + "\n",
    );
    await mkdir(outputDir, { recursive: true });
    for (const collection of collections)
      await rename(
        path.join(staged, `${collection.id}.json`),
        path.join(outputDir, `${collection.id}.json`),
      );
    await rename(
      path.join(staged, "index.json"),
      path.join(outputDir, "index.json"),
    );
    const expected = new Set(
      collections.map((collection) => `${collection.id}.json`),
    );
    for (const file of await readdir(outputDir))
      if (
        file.endsWith(".json") &&
        file !== "index.json" &&
        !expected.has(file)
      )
        await rm(path.join(outputDir, file));
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  return index;
}
