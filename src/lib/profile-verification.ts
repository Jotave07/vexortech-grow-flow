type StoreLike = {
  name?: string | null;
  public_name?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsapp_number?: string | null;
  address?: string | null;
  address_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  description?: string | null;
  is_verified?: boolean | null;
};

type StoreSettingsLike = {
  accept_pix?: boolean | null;
  pix_key?: string | null;
  allow_delivery?: boolean | null;
  allow_pickup?: boolean | null;
  delivery_radius_km?: number | string | null;
  avg_prep_time_minutes?: number | string | null;
};

type UserLike = {
  email?: string | null;
};

type ProfileLike = {
  full_name?: string | null;
  phone?: string | null;
  document?: string | null;
  zip_code?: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
};

const hasText = (value: unknown) => String(value ?? "").trim().length > 0;
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const hasDocument = (value: unknown) => {
  const size = digits(value).length;
  return size === 11 || size === 14;
};
const hasPhone = (value: unknown) => digits(value).length >= 10;

const scoreChecks = (checks: Array<{ ok: boolean }>) => {
  const completed = checks.filter((check) => check.ok).length;
  return Math.round((completed / Math.max(checks.length, 1)) * 100);
};

export const getStoreProfileVerification = (store: StoreLike, settings?: StoreSettingsLike | null) => {
  const checks = [
    { key: "identity", label: "Nome, documento e descricao", ok: hasText(store.public_name || store.name) && hasDocument(store.document) && hasText(store.description) },
    { key: "contact", label: "Contato publico", ok: hasPhone(store.whatsapp || store.whatsapp_number || store.phone) || hasText(store.email) },
    { key: "address", label: "Endereco completo", ok: hasText(store.address) && hasText(store.address_number) && hasText(store.neighborhood) && hasText(store.city) && hasText(store.state) && digits(store.zip_code).length === 8 },
    { key: "visual", label: "Logo e capa", ok: hasText(store.logo_url) && hasText(store.cover_url) },
    { key: "operation", label: "Operacao configurada", ok: Boolean(settings?.allow_pickup || settings?.allow_delivery) && Number(settings?.avg_prep_time_minutes ?? 0) > 0 },
    { key: "payment", label: "Pix da loja", ok: !settings?.accept_pix || hasText(settings.pix_key) },
  ];
  const score = scoreChecks(checks);
  const status = store.is_verified ? "verified" : score >= 84 ? "complete" : score >= 50 ? "review" : "incomplete";

  return {
    score,
    status,
    checks,
    label: store.is_verified ? "Verificada" : score >= 84 ? "Perfil completo" : "Perfil em ajuste",
    detail: store.is_verified
      ? "Loja revisada pela plataforma."
      : score >= 84
        ? "Dados essenciais completos para transmitir confianca ao cliente."
        : "Complete identidade, endereco, visual e pagamento para ganhar mais confianca.",
  };
};

export const getUserProfileVerification = (profile: ProfileLike | null | undefined, user?: UserLike | null) => {
  const checks = [
    { key: "name", label: "Nome completo", ok: hasText(profile?.full_name) },
    { key: "email", label: "E-mail de acesso", ok: hasText(user?.email) },
    { key: "document", label: "CPF/CNPJ", ok: hasDocument(profile?.document) },
    { key: "phone", label: "Telefone", ok: hasPhone(profile?.phone) },
    { key: "address", label: "Endereco principal", ok: hasText(profile?.street) && hasText(profile?.number) && hasText(profile?.neighborhood) && hasText(profile?.city) && hasText(profile?.state) && digits(profile?.zip_code).length === 8 },
  ];
  const score = scoreChecks(checks);

  return {
    score,
    checks,
    label: score === 100 ? "Perfil verificado" : score >= 60 ? "Perfil quase completo" : "Perfil incompleto",
    detail: score === 100
      ? "Dados essenciais completos para pedidos e atendimento."
      : "Complete seus dados para reduzir erros em entregas e contato da loja.",
  };
};
