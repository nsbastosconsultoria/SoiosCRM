/**
 * `/admin/email` — dois defeitos da ponte entre a tela, o banco e o `.env`.
 *
 * 1. Valores vindos do `.env` aparecem na tela com "Já existe uma senha gravada.
 *    Deixe em branco para mantê-la". Salvar assim criava a linha do banco SEM
 *    senha; como o banco vence o `.env`, todo e-mail passava a falhar com 535.
 * 2. A tela promete que apagar os campos "faz o sistema voltar a usar o
 *    arquivo". Uma linha vazia no banco continuava vencendo, e a instalação
 *    ficava sem e-mail com o `.env` preenchido.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A linha de `platform_smtp_settings` que o banco "tem". */
let linha: Record<string, unknown> | null = null;
/** O que o último `upsert` gravou. */
let gravado: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha, error: null }) }) }),
      upsert: async (valor: Record<string, unknown>) => {
        gravado = valor;
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: async (_admin: unknown, texto: string) => `cifra(${texto})`,
  decryptWebhookSecret: async (_admin: unknown, cifra: string) =>
    cifra.replace(/^cifra\((.*)\)$/, "$1"),
}));

const ENV = {
  SMTP_HOST: "smtp.env.test",
  SMTP_PORT: "587",
  SMTP_SECURITY: "starttls",
  SMTP_USERNAME: "usuario-env",
  SMTP_PASSWORD: "senha-do-env",
  SMTP_FROM_EMAIL: "env@exemplo.test",
  SMTP_FROM_NAME: "Env",
};

async function carregar() {
  vi.resetModules();
  return await import("@/lib/email/config");
}

const ENTRADA = {
  host: "smtp.env.test",
  port: 587,
  security: "starttls" as const,
  username: "usuario-env",
  password: "",
  fromEmail: "env@exemplo.test",
  fromName: "Env",
  updatedBy: "00000000-0000-4000-8000-000000000001",
};

describe("saveSmtpConfig — senha em branco", () => {
  beforeEach(() => {
    linha = null;
    gravado = null;
    Object.assign(process.env, ENV);
  });

  it("sem senha no banco, o salvar leva a senha do .env cifrada", async () => {
    const { saveSmtpConfig } = await carregar();
    expect(await saveSmtpConfig(ENTRADA)).toEqual({ ok: true });
    expect(gravado?.smtp_password_encrypted).toBe("cifra(senha-do-env)");
  });

  it("com senha já no banco, ela fica — o .env não a sobrescreve", async () => {
    linha = { smtp_password_encrypted: "cifra(senha-do-banco)" };
    const { saveSmtpConfig } = await carregar();
    await saveSmtpConfig(ENTRADA);
    expect(gravado?.smtp_password_encrypted).toBe("cifra(senha-do-banco)");
  });

  it("senha digitada vence as duas", async () => {
    linha = { smtp_password_encrypted: "cifra(senha-do-banco)" };
    const { saveSmtpConfig } = await carregar();
    await saveSmtpConfig({ ...ENTRADA, password: "nova" });
    expect(gravado?.smtp_password_encrypted).toBe("cifra(nova)");
  });
});

describe("getSmtpConfig — linha vazia volta ao .env", () => {
  beforeEach(() => {
    Object.assign(process.env, ENV);
  });

  it("linha sem servidor e sem remetente não é configuração", async () => {
    linha = {
      smtp_host: null,
      smtp_port: 587,
      smtp_security: "starttls",
      smtp_username: null,
      smtp_password_encrypted: null,
      from_email: null,
      from_name: null,
    };
    const config = await (await carregar()).getSmtpConfig();
    expect(config.source).toBe("environment");
    expect(config.host).toBe("smtp.env.test");
  });

  it("linha preenchida continua vencendo o .env", async () => {
    linha = {
      smtp_host: "smtp.banco.test",
      smtp_port: 465,
      smtp_security: "tls",
      smtp_username: "u",
      smtp_password_encrypted: "cifra(p)",
      from_email: "banco@exemplo.test",
      from_name: "Banco",
    };
    const config = await (await carregar()).getSmtpConfig();
    expect(config.source).toBe("database");
    expect(config.host).toBe("smtp.banco.test");
    expect(config.password).toBe("p");
  });
});
