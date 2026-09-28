import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  source: "database" | "environment" | "none";
}

const EMPTY: SmtpConfig = {
  host: "",
  port: 587,
  security: "starttls",
  username: "",
  password: "",
  fromEmail: "",
  fromName: "",
  source: "none",
};

/**
 * Banco primeiro; o .env permite provisionar uma VPS sem abrir a interface.
 *
 * Linha SEM servidor e SEM remetente não é configuração: é o que sobra quando o
 * dono apaga os campos em `/admin/email`. A tela promete que apagar "faz o
 * sistema voltar a usar o arquivo"; tratar essa linha vazia como fonte deixava
 * a instalação sem e-mail nenhum, com o `.env` preenchido logo embaixo.
 */
export async function getSmtpConfig(): Promise<SmtpConfig> {
  try {
    const { data, error } = await createAdminClient()
      .from("platform_smtp_settings")
      .select(
        "smtp_host,smtp_port,smtp_security,smtp_username,smtp_password_encrypted,from_email,from_name",
      )
      .eq("id", 1)
      .maybeSingle();
    const vazia =
      !data ||
      (!(data as { smtp_host?: string | null }).smtp_host?.trim() &&
        !(data as { from_email?: string | null }).from_email?.trim());
    if (!error && !vazia) {
      const row = data as {
        smtp_host: string | null;
        smtp_port: number;
        smtp_security: SmtpSecurity;
        smtp_username: string | null;
        smtp_password_encrypted: string | null;
        from_email: string | null;
        from_name: string | null;
      };
      return {
        host: row.smtp_host?.trim() ?? "",
        port: row.smtp_port,
        security: row.smtp_security,
        username: row.smtp_username?.trim() ?? "",
        password: row.smtp_password_encrypted
          ? ((await decryptWebhookSecret(createAdminClient(), row.smtp_password_encrypted)) ?? "")
          : "",
        fromEmail: row.from_email?.trim() ?? "",
        fromName: row.from_name?.trim() ?? "",
        source: "database",
      };
    }
  } catch {
    // Clones anteriores à migration caem no ambiente até serem atualizados.
  }
  const config: SmtpConfig = {
    host: env.SMTP_HOST.trim(),
    port: env.SMTP_PORT,
    security: env.SMTP_SECURITY,
    username: env.SMTP_USERNAME.trim(),
    password: env.SMTP_PASSWORD,
    fromEmail: env.SMTP_FROM_EMAIL.trim(),
    fromName: env.SMTP_FROM_NAME.trim(),
    source: "environment",
  };
  return config.host || config.fromEmail ? config : EMPTY;
}

export async function saveSmtpConfig(input: Omit<SmtpConfig, "source"> & { updatedBy: string }) {
  const admin = createAdminClient();
  let encrypted: string | null = null;
  // A senha que vai ser cifrada: a digitada, ou — campo em branco, nada gravado
  // no banco — a do `.env`. A tela mostra "Já existe uma senha gravada. Deixe
  // em branco para mantê-la" quando os valores vieram do arquivo; sem este
  // piso, salvar assim criava a linha do banco SEM senha, a linha passava a
  // valer no lugar do arquivo, e todo e-mail da instalação parava com 535.
  let senhaNova = input.password;
  if (!senhaNova) {
    const { data } = await admin
      .from("platform_smtp_settings")
      .select("smtp_password_encrypted")
      .eq("id", 1)
      .maybeSingle();
    encrypted =
      (data as { smtp_password_encrypted?: string | null } | null)?.smtp_password_encrypted ?? null;
    if (!encrypted && env.SMTP_PASSWORD) senhaNova = env.SMTP_PASSWORD;
  }
  if (senhaNova) encrypted = await encryptWebhookSecret(admin, senhaNova);
  if (senhaNova && !encrypted)
    return {
      ok: false as const,
      error: "A cifra está indisponível nesta instalação; a senha não foi gravada.",
    };
  const { error } = await admin.from("platform_smtp_settings").upsert(
    {
      id: 1,
      smtp_host: input.host || null,
      smtp_port: input.port,
      smtp_security: input.security,
      smtp_username: input.username || null,
      smtp_password_encrypted: encrypted,
      from_email: input.fromEmail || null,
      from_name: input.fromName || null,
      updated_by: input.updatedBy,
    },
    { onConflict: "id" },
  );
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
