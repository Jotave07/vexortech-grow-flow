const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
};

export const getSupabaseServerConfig = () => {
  const url =
    clean(process.env.SUPABASE_URL) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    clean(process.env.VITE_SUPABASE_URL);
  const publishableKey =
    clean(process.env.SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.SUPABASE_ANON_KEY) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    clean(process.env.VITE_SUPABASE_ANON_KEY);
  const secretKey =
    clean(process.env.SUPABASE_SECRET_KEY) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    clean(process.env.SUPABASE_SERVICE_KEY);

  return {
    url: url.replace(/\/$/, ""),
    publishableKey,
    secretKey,
    apiKey: secretKey || publishableKey,
  };
};

export const hasSupabaseServerConfig = () => {
  const config = getSupabaseServerConfig();
  return Boolean(config.url && config.apiKey);
};

export const hasSupabaseAdminConfig = () => {
  const config = getSupabaseServerConfig();
  return Boolean(config.url && config.secretKey);
};

export const fetchSupabaseUserByToken = async (token?: string) => {
  if (!token) return null;
  const config = getSupabaseServerConfig();
  if (!config.url || !config.apiKey) return null;

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

export const createSupabaseAuthUser = async (
  email: string,
  password: string,
  metadata: Record<string, unknown>,
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para criar usuarios pelo servidor.");
  }

  const response = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao criar usuario no Supabase Auth.");
  }
  return payload;
};

export const updateSupabaseAuthUser = async (
  userId: string,
  input: { password?: string; user_metadata?: Record<string, unknown> },
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para atualizar usuarios pelo servidor.");
  }

  const body: Record<string, unknown> = {};
  if (input.password) body.password = input.password;
  if (input.user_metadata) body.user_metadata = input.user_metadata;

  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao atualizar usuario no Supabase Auth.");
  }
  return payload;
};

export const deleteSupabaseAuthUser = async (userId: string) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para remover usuarios pelo servidor.");
  }

  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao remover usuario no Supabase Auth.");
  }
  return payload;
};

export const listSupabaseAuthUsers = async () => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para listar usuarios pelo servidor.");
  }

  const response = await fetch(`${config.url}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao listar usuarios no Supabase Auth.");
  }
  return Array.isArray(payload?.users) ? payload.users : [];
};

export const sendSupabasePasswordRecoveryEmail = async (email: string, redirectTo?: string) => {
  const config = getSupabaseServerConfig();
  const apiKey = config.publishableKey || config.secretKey;
  if (!config.url || !apiKey) {
    throw new Error("Supabase Auth nao configurado para recuperacao de senha.");
  }

  const url = new URL(`${config.url}/auth/v1/recover`);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({ email }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao enviar recuperacao de senha pelo Supabase.");
  }
  return payload;
};

export const uploadObjectToSupabaseStorage = async (input: {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
  upsert?: boolean;
}) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) return null;

  const cleanPath = input.path.replace(/^\/+/, "");
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;

  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(input.bucket)}/${cleanPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "POST",
      headers: {
        "Content-Type": input.contentType,
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
        "x-upsert": input.upsert ? "true" : "false",
      },
      body,
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Falha ao enviar arquivo para o Supabase Storage.");
  }
  return payload;
};

export const downloadObjectFromSupabaseStorage = async (bucket: string, objectPath: string) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para ler arquivos privados.");
  }

  const cleanPath = objectPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const response = await fetch(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath}`,
    {
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
      },
    },
  );

  if (!response.ok) return null;
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
};

export const getSupabasePublicObjectUrl = (bucket: string, objectPath: string) => {
  const config = getSupabaseServerConfig();
  if (!config.url) return "";
  const cleanPath = objectPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${config.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${cleanPath}`;
};
