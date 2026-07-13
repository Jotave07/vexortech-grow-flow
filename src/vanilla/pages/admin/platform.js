import { badge, button, createAdminPage, dataOf, date, h } from "./core.js";

const countOf = (result) => {
  if (result?.error) throw new Error(result.error.message || "Falha ao consultar indicador.");
  return Number(result?.count ?? 0);
};

export function platformHealthSummary({
  apiStatus = "unknown",
  totalPlans = 0,
  activePlans = 0,
  platformAdmins = 0,
  recentAudits = [],
} = {}) {
  const issues = [];
  if (apiStatus !== "ok") issues.push("API ou banco de dados indisponivel");
  if (Number(activePlans) < 1) issues.push("nenhum plano ativo publicado");
  if (Number(platformAdmins) < 1) issues.push("nenhum administrador de plataforma registrado");
  return {
    apiStatus,
    totalPlans: Number(totalPlans || 0),
    activePlans: Number(activePlans || 0),
    platformAdmins: Number(platformAdmins || 0),
    recentAudits: Array.isArray(recentAudits) ? recentAudits : [],
    state: issues.length ? "attention" : "operational",
    issues,
  };
}

const stat = (ctx, label, value, hint, tone = "info") =>
  h(
    ctx,
    "section",
    { className: "admin-panel admin-stat" },
    h(ctx, "span", { className: "admin-stat__label" }, label),
    h(ctx, "strong", { className: "admin-stat__value" }, value),
    h(ctx, "span", { className: "admin-stat__hint" }, hint),
    badge(ctx, tone === "success" ? "Operacional" : tone === "danger" ? "Atencao" : "Informativo", tone),
  );

const healthRequest = async (signal) => {
  try {
    const response = await fetch("/api/health", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return "error";
    const body = await response.json();
    return body?.status === "ok" ? "ok" : "error";
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return "error";
  }
};

export function renderAdminPlatform(ctx) {
  const page = createAdminPage(ctx, {
    title: "Configuracoes e saude",
    description:
      "Visao somente leitura da disponibilidade, governanca e catalogo. Credenciais e segredos nunca sao exibidos nesta pagina.",
  });

  const load = async () => {
    page.loading("Verificando a plataforma...");
    try {
      const [apiStatus, totalPlansResult, activePlansResult, adminsResult, recentAudits] =
        await Promise.all([
          healthRequest(page.signal),
          ctx.api.from("plans").select("*", { count: "exact", head: true }),
          ctx.api
            .from("plans")
            .select("*", { count: "exact", head: true })
            .eq("is_active", true),
          ctx.api
            .from("user_roles")
            .select("*", { count: "exact", head: true })
            .in("role", ["admin", "super_admin"]),
          dataOf(
            ctx.api
              .from("audit_logs")
              .select("id,action,entity_type,created_at")
              .order("created_at", { ascending: false })
              .limit(8),
            [],
          ),
        ]);
      if (!page.active()) return;
      const summary = platformHealthSummary({
        apiStatus,
        totalPlans: countOf(totalPlansResult),
        activePlans: countOf(activePlansResult),
        platformAdmins: countOf(adminsResult),
        recentAudits,
      });
      const healthy = summary.apiStatus === "ok";
      page.root.dataset.pageState = summary.state;
      page.setContent(
        h(
          ctx,
          "section",
          { className: "admin-grid", "aria-label": "Saude e governanca da plataforma" },
          stat(
            ctx,
            "API e banco",
            healthy ? "Online" : "Indisponivel",
            "verificacao segura em /api/health",
            healthy ? "success" : "danger",
          ),
          stat(
            ctx,
            "Catalogo de planos",
            `${summary.activePlans}/${summary.totalPlans}`,
            "ativos / cadastrados",
            summary.activePlans ? "success" : "danger",
          ),
          stat(
            ctx,
            "Administradores",
            String(summary.platformAdmins),
            "papeis admin e super_admin",
            summary.platformAdmins ? "success" : "danger",
          ),
          stat(
            ctx,
            "Auditoria recente",
            String(summary.recentAudits.length),
            "ultimos registros consultados",
          ),
        ),
        summary.issues.length
          ? h(
              ctx,
              "section",
              { className: "admin-alert", role: "alert" },
              h(ctx, "strong", {}, "A plataforma exige atencao"),
              h(
                ctx,
                "ul",
                {},
                summary.issues.map((issue) => h(ctx, "li", {}, issue)),
              ),
            )
          : h(
              ctx,
              "section",
              { className: "admin-panel" },
              h(ctx, "h2", { className: "admin-panel__title" }, "Estado operacional"),
              h(
                ctx,
                "p",
                {},
                "API, banco, catalogo ativo e governanca administrativa responderam aos checks disponiveis.",
              ),
            ),
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(ctx, "h2", { className: "admin-panel__title" }, "Onde configurar cada area"),
          h(
            ctx,
            "ul",
            { className: "admin-list" },
            navigationItem(
              ctx,
              "Planos e limites",
              "Publique planos e revise recursos oferecidos.",
              "/admin/planos",
            ),
            navigationItem(
              ctx,
              "Lojas e parceiros",
              "Revise ativacao, verificacao e vinculos das lojas.",
              "/admin/lojas",
            ),
            navigationItem(
              ctx,
              "Cobrancas e repasses",
              "Acompanhe assinaturas, reembolsos e transferencias.",
              "/admin/financeiro",
            ),
          ),
        ),
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(
            ctx,
            "div",
            { className: "admin-panel__header" },
            h(ctx, "h2", { className: "admin-panel__title" }, "Atividade administrativa recente"),
            h(ctx, "span", { className: "admin-stat__hint" }, "metadados sensiveis omitidos"),
          ),
          summary.recentAudits.length
            ? h(
                ctx,
                "ul",
                { className: "admin-list" },
                summary.recentAudits.map((entry) =>
                  h(
                    ctx,
                    "li",
                    { className: "admin-list__item" },
                    h(
                      ctx,
                      "span",
                      { className: "admin-list__copy" },
                      h(ctx, "strong", {}, String(entry.action || "Acao administrativa")),
                      h(
                        ctx,
                        "small",
                        { className: "admin-stat__hint" },
                        String(entry.entity_type || "entidade da plataforma"),
                      ),
                    ),
                    h(ctx, "time", { dateTime: entry.created_at || undefined }, date(ctx, entry.created_at, true)),
                  ),
                ),
              )
            : h(ctx, "p", {}, "Nenhuma atividade administrativa recente foi encontrada."),
        ),
      );
      page.announce(
        summary.state === "operational"
          ? "Plataforma operacional. Indicadores atualizados."
          : `Plataforma com ${summary.issues.length} ponto(s) de atencao.`,
      );
    } catch (error) {
      if (error?.name !== "AbortError" && page.active()) page.fail(error, load);
    }
  };

  page.actions.append(button(ctx, "Atualizar verificacao", { primary: true, onClick: load }));
  void load();
  return page.root;
}

function navigationItem(ctx, title, description, path) {
  return h(
    ctx,
    "li",
    { className: "admin-list__item" },
    h(
      ctx,
      "span",
      { className: "admin-list__copy" },
      h(ctx, "strong", {}, title),
      h(ctx, "small", { className: "admin-stat__hint" }, description),
    ),
    button(ctx, "Abrir", { onClick: () => ctx.navigate(path), ariaLabel: `Abrir ${title}` }),
  );
}

export default renderAdminPlatform;
