import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured for App Storage.");
  }
  return dir.replace(/\/+$/, "");
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  const parts = (path.startsWith("/") ? path : `/${path}`).split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid App Storage object path.");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function getSignImageFile(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Invalid sign image object path.");
  }
  const { bucketName, objectName } = parseObjectPath(
    `${getPrivateObjectDir()}/${objectPath.slice("/objects/".length)}`,
  );
  return objectStorageClient.bucket(bucketName).file(objectName);
}

export function getSignImagePath(id: string): string {
  return `/objects/sign-cards/${id}.png`;
}

export async function saveSignImage(
  objectPath: string,
  bytes: Uint8Array,
): Promise<void> {
  await getSignImageFile(objectPath).save(Buffer.from(bytes), {
    resumable: false,
    metadata: {
      contentType: "image/png",
      cacheControl: "public, max-age=60, s-maxage=300",
    },
  });
}

export async function readSignImage(objectPath: string): Promise<Buffer> {
  const file = getSignImageFile(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Sign image not found.");
  const [bytes] = await file.download();
  return bytes;
}

export async function deleteSignImage(objectPath: string): Promise<void> {
  await getSignImageFile(objectPath).delete({ ignoreNotFound: true });
}