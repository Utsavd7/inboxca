import { z } from "zod";

// Server settings from PLAN.md section 10, checked once at start up.
// Values are never printed: an error names the setting, not what it holds.

const secret = z.string().min(1).optional();
const url = z.url().optional();

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_BASE_URL: url,

    // Read by the server at run time, so the browser bundle never holds them.
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: secret,
    SUPABASE_SECRET_KEY: secret, // job workers and admin only

    KMS_KEY_ID: secret, // the key's ARN, which names its region (ap-south-1)
    KMS_CREDENTIALS: secret, // "access key id:secret" of a user that may only use that key
    LOCAL_KEK: secret, // development and tests only; production uses KMS

    // Orelu's workspace store on Backblaze B2's S3 API (safety copies); all four, or it is off.
    B2_ENDPOINT: url,
    B2_KEY_ID: secret,
    B2_APPLICATION_KEY: secret,
    B2_WORKSPACE_BUCKET: secret,

    MS_DRIVE_CLIENT_ID: secret,
    MS_DRIVE_CLIENT_SECRET: secret,
    DROPBOX_APP_KEY: secret, // Dropbox signs in with PKCE, so signing in needs no app secret
    DROPBOX_APP_SECRET: secret, // only checks Dropbox's change notices; empty, they are off

    FILE_WORKER_URL: url,
    FILE_WORKER_SECRET: secret,
    JOB_WORKER_SECRET: secret,
    // Phone notifications (Web Push): a P-256 key pair, base64url. Make one with
    // node -e "const j=require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});console.log(Buffer.concat([Buffer.of(4),Buffer.from(j.x,'base64url'),Buffer.from(j.y,'base64url')]).toString('base64url'),j.d)"
    VAPID_PUBLIC_KEY: secret,
    VAPID_PRIVATE_KEY: secret,
    TEMPLATE_WATCH_SOURCES: z.string().optional(),

    AWS_SES_REGION: z.string().default("ap-south-1"),
    EMAIL_FROM_DOMAIN: z.string().optional(),
    // Orelu's system mail over SES SMTP: smtps://user:password@email-smtp.ap-south-1.amazonaws.com:465
    SYSTEM_MAIL_URL: secret,

    GOOGLE_OAUTH_CLIENT_ID: secret,
    GOOGLE_OAUTH_CLIENT_SECRET: secret,
    MICROSOFT_CLIENT_ID: secret,
    MICROSOFT_CLIENT_SECRET: secret,
    ZOHO_CLIENT_ID: secret,
    ZOHO_CLIENT_SECRET: secret,

    AI_PROVIDER: z.enum(["openai"]).default("openai"),
    OPENAI_API_KEY: secret,
    AI_AGENT_MODEL: z.string().default("gpt-5-mini"),
    AI_EXTRACTION_MODEL: z.string().default("gpt-5-mini"),
    AI_CLASSIFIER_MODEL: z.string().default("gpt-5-nano"),
    AI_GLOBAL_DAILY_CAP_USD: z.coerce.number().positive().optional(),

    SENTRY_DSN: url,
    MAIL_MODE: z.enum(["fake", "live"]).default("fake"),

    ORELU_RAZORPAY_KEY_ID: secret,
    ORELU_RAZORPAY_KEY_SECRET: secret,
    ORELU_RAZORPAY_WEBHOOK_SECRET: secret,
  })
  // PLAN.md section 11: development and tests never send real email.
  .refine((env) => env.MAIL_MODE === "fake" || env.NODE_ENV === "production", {
    path: ["MAIL_MODE"],
    message: "can be live only in production",
  });

export type ServerEnv = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Server settings are not valid: ${problems.join("; ")}`);
    this.name = "EnvError";
  }
}

// Empty strings count as unset, so a blank line in an env file does not fail a check.
export function readServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success)
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
    );
  return result.data;
}
