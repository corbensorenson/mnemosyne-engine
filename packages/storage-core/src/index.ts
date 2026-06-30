import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createObjectManifest,
  objectBuckets,
  type ObjectBucket,
  type ObjectManifest,
  type ObjectRetentionPolicy
} from "@mnemosyne/ops-core";

export type ObjectStoragePutInput = {
  bucket: ObjectBucket;
  key: string;
  contentType: string;
  body: Uint8Array | string;
  ownerId?: string;
  retentionPolicy?: ObjectRetentionPolicy;
  metadata?: Record<string, unknown>;
  expectedSha256?: string;
  encryption?: ObjectManifest["encryption"];
  createdAt?: string;
};

export type ObjectStorageRef = {
  bucket: ObjectBucket;
  key: string;
};

export type ObjectStoragePutResult = {
  manifest: ObjectManifest;
  bytes_written: number;
  sha256: string;
  storage_path?: string;
};

export type ObjectStorageReadResult = {
  manifest: ObjectManifest;
  body: Uint8Array;
};

export type ObjectStorageDeleteResult = {
  bucket: ObjectBucket;
  key: string;
  deleted: boolean;
};

export type ObjectManifestListInput = {
  bucket?: ObjectBucket;
  ownerId?: string;
};

export type ObjectStorageInputErrorCode =
  "object_hash_mismatch" | "unsafe_object_key" | "unknown_object_bucket";

export class ObjectStorageInputError extends Error {
  constructor(
    readonly code: ObjectStorageInputErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ObjectStorageInputError";
  }
}

export interface ObjectStorageAdapter {
  putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult>;
  getObject(ref: ObjectStorageRef): Promise<ObjectStorageReadResult | undefined>;
  deleteObject(ref: ObjectStorageRef): Promise<ObjectStorageDeleteResult>;
  listManifests(input?: ObjectManifestListInput): Promise<ObjectManifest[]>;
}

export class LocalObjectStorage implements ObjectStorageAdapter {
  constructor(private readonly rootDir: string) {}

  async putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult> {
    assertBucket(input.bucket);
    const body = bodyToBuffer(input.body);
    const sha256 = sha256Hex(body);
    if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256) {
      throw new ObjectStorageInputError(
        "object_hash_mismatch",
        `Object SHA-256 mismatch for ${input.bucket}/${input.key}`
      );
    }

    const objectPath = this.objectPath(input);
    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, body);

    const manifest = createObjectManifest({
      bucket: input.bucket,
      key: input.key,
      contentType: input.contentType,
      sizeBytes: body.byteLength,
      sha256,
      ownerId: input.ownerId,
      retentionPolicy: input.retentionPolicy,
      encryption: input.encryption,
      metadata: {
        ...(input.metadata ?? {}),
        storage_driver: "local"
      },
      createdAt: input.createdAt
    });
    await writeFile(this.manifestPath(input), JSON.stringify(manifest, null, 2));

    return {
      manifest,
      bytes_written: body.byteLength,
      sha256,
      storage_path: objectPath
    };
  }

  async getObject(ref: ObjectStorageRef): Promise<ObjectStorageReadResult | undefined> {
    assertBucket(ref.bucket);
    const objectPath = this.objectPath(ref);
    const manifestPath = this.manifestPath(ref);
    try {
      const [body, manifestJson] = await Promise.all([readFile(objectPath), readFile(manifestPath, "utf8")]);
      const manifest = JSON.parse(manifestJson) as ObjectManifest;
      assertObjectIntegrity(manifest, body);
      return { manifest, body };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async deleteObject(ref: ObjectStorageRef): Promise<ObjectStorageDeleteResult> {
    assertBucket(ref.bucket);
    const objectPath = this.objectPath(ref);
    const manifestPath = this.manifestPath(ref);
    const existed = await exists(objectPath);
    await Promise.all([rm(objectPath, { force: true }), rm(manifestPath, { force: true })]);
    return {
      bucket: ref.bucket,
      key: ref.key,
      deleted: existed
    };
  }

  async listManifests(input: ObjectManifestListInput = {}): Promise<ObjectManifest[]> {
    const buckets = input.bucket ? [input.bucket] : [...objectBuckets];
    const manifests: ObjectManifest[] = [];
    for (const bucket of buckets) {
      assertBucket(bucket);
      const bucketPath = resolve(this.rootDir, bucket);
      if (!(await exists(bucketPath))) continue;
      for (const manifestPath of await listManifestFiles(bucketPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ObjectManifest;
        if (input.ownerId && manifest.owner_id !== input.ownerId) continue;
        manifests.push(manifest);
      }
    }
    return manifests.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  private objectPath(ref: ObjectStorageRef): string {
    const segments = safeKeySegments(ref.key);
    const path = resolve(this.rootDir, ref.bucket, ...segments);
    const bucketRoot = resolve(this.rootDir, ref.bucket);
    if (path !== bucketRoot && !path.startsWith(`${bucketRoot}/`)) {
      throw new ObjectStorageInputError("unsafe_object_key", `Unsafe object key: ${ref.key}`);
    }
    return path;
  }

  private manifestPath(ref: ObjectStorageRef): string {
    return `${this.objectPath(ref)}.manifest.json`;
  }
}

export function createLocalObjectStorage(rootDir: string): ObjectStorageAdapter {
  return new LocalObjectStorage(rootDir);
}

export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(bodyToBuffer(body)).digest("hex");
}

export function assertObjectIntegrity(manifest: ObjectManifest, body: Uint8Array | string): void {
  const bodyBuffer = bodyToBuffer(body);
  if (manifest.size_bytes !== bodyBuffer.byteLength) {
    throw new Error(`Object size mismatch for ${manifest.bucket}/${manifest.key}`);
  }
  if (manifest.sha256.toLowerCase() !== sha256Hex(bodyBuffer)) {
    throw new Error(`Object SHA-256 mismatch for ${manifest.bucket}/${manifest.key}`);
  }
}

function bodyToBuffer(body: Uint8Array | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
}

function assertBucket(bucket: ObjectBucket): void {
  if (!(objectBuckets as readonly string[]).includes(bucket))
    throw new ObjectStorageInputError("unknown_object_bucket", `Unknown object bucket: ${bucket}`);
}

function safeKeySegments(key: string): string[] {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new ObjectStorageInputError("unsafe_object_key", `Unsafe object key: ${key}`);
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ObjectStorageInputError("unsafe_object_key", `Unsafe object key: ${key}`);
  }
  return segments;
}

async function listManifestFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) return listManifestFiles(path);
      return entry.isFile() && entry.name.endsWith(".manifest.json") ? [path] : [];
    })
  );
  return nested.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
