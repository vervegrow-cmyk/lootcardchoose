import { DeleteObjectCommand, PutObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/env";

export type R2UploadInput = {
  key: string;
  filePath: string;
  contentType?: string;
};

export type R2UploadOutput = {
  key: string;
  publicUrl: string;
};

export type R2Service = {
  listObjects: (prefix?: string) => Promise<string[]>;
  uploadFile: (input: R2UploadInput) => Promise<R2UploadOutput>;
  deleteObject: (key: string) => Promise<void>;
  buildPublicUrl: (key: string) => string;
};

const resolveR2Config = () => {
  const env = loadEnv();
  if (!env.r2AccessKeyId) {
    throw new Error("Missing R2_ACCESS_KEY_ID");
  }
  if (!env.r2SecretAccessKey) {
    throw new Error("Missing R2_SECRET_ACCESS_KEY");
  }
  if (!env.r2Bucket) {
    throw new Error("Missing R2_BUCKET");
  }
  if (!env.r2Endpoint) {
    throw new Error("Missing R2_ENDPOINT");
  }
  if (!env.r2PublicUrl) {
    throw new Error("Missing R2_PUBLIC_URL");
  }

  return env;
};

const createClient = (): S3Client => {
  const env = resolveR2Config();
  return new S3Client({
    region: "auto",
    endpoint: env.r2Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
  });
};

const inferContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
};

const normalizeKey = (key: string): string => key.replace(/\\/g, "/").replace(/^\/+/, "");

export const r2Service: R2Service = {
  async listObjects(prefix) {
    const env = resolveR2Config();
    const client = createClient();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: env.r2Bucket,
        Prefix: prefix,
      })
    );

    return (response.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === "string");
  },

  async uploadFile(input) {
    const env = resolveR2Config();
    const client = createClient();
    const body = await readFile(input.filePath);
    const key = normalizeKey(input.key);

    await client.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: key,
        Body: body,
        ContentType: input.contentType ?? inferContentType(input.filePath),
      })
    );

    return {
      key,
      publicUrl: r2Service.buildPublicUrl(key),
    };
  },

  async deleteObject(key) {
    const env = resolveR2Config();
    const client = createClient();
    const normalizedKey = normalizeKey(key);

    await client.send(
      new DeleteObjectCommand({
        Bucket: env.r2Bucket,
        Key: normalizedKey,
      })
    );
  },

  buildPublicUrl(key) {
    const env = resolveR2Config();
    return `${env.r2PublicUrl.replace(/\/+$/, "")}/${normalizeKey(key)}`;
  },
};
