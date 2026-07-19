import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

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
