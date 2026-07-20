import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function r2ConfigFromEnv(): R2Config {
  return {
    endpoint: process.env.R2_ENDPOINT ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  };
}

export interface S3Like {
  send(cmd: unknown): Promise<any>;
}

export function makeS3(cfg: R2Config): S3Like {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

/** Delete every object under `prefix`. Batched (≤1000/delete), paginated. */
export async function deletePrefix(
  cfg: R2Config,
  prefix: string,
  s3: S3Like = makeS3(cfg)
): Promise<{ deleted: number }> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const list: any = await s3.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token })
    );
    const objects = (list.Contents ?? []).map((o: any) => ({ Key: o.Key }));
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: objects } }));
      deleted += objects.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return { deleted };
}

export type PresignFn = (key: string, contentType: string, expiresIn: number) => Promise<string>;

/** A presigner bound to `cfg`'s R2 client — signs PutObject URLs. */
export function makePresigner(cfg: R2Config): PresignFn {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return (key, contentType, expiresIn) =>
    getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }), { expiresIn });
}

/** Presigned PUT URL for `key`. Injectable `presign` for tests. */
export async function presignPut(
  cfg: R2Config,
  key: string,
  contentType: string,
  expiresIn = 900,
  presign: PresignFn = makePresigner(cfg)
): Promise<string> {
  return presign(key, contentType, expiresIn);
}
