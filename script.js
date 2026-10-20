"use strict";

const sb = window.sb;
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

const SUB_VIEW = "vw_substituicoes_bi";
const SUB_PAGE_SIZE = 20;
const EAD_TABLE = "ead_analise_geografica";
const EAD_PAGE_SIZE = 20;

// NOVO: cursos e protocolos EaD
const EAD_CURSOS_TABLE = "ead_cursos_protocolos";
const EAD_CURSOS_PAGE_SIZE = 20;
const EAD_CURSOS_FIELDS = [
  "id", "protocolo", "data_protocolo", "data_aprovacao",
  "data_validade", "status", "municipio", "uf", "curso",
  "portaria", "cbo", "faixa_etaria", "subsede", "polos",
  "criado_em", "atualizado_em"
];

const SUB_FIELDS = [
  "id", "subsede", "cidade", "angariador", "jovem", "empresa", "motivo",
  "situacao_substituicao", "status_da_substituicao", "jovem_foi_substituido",
  "jovem_substituto", "inicio_substituto", "fim_substituto",
  "data_desligamento", "mes_ano_desligamento", "periodo",
  "mes_da_substituicao", "dias_ate_substituicao", "dentro_do_prazo",
  "faixa_de_atraso", "prioridade", "inicio_fechamento", "fim_fechamento",
  "periodo_fechamento", "mes_fechamento", "numero_mes_fechamento",
  "ano_fechamento", "mes_fechamento_da_substituicao",
  "fechamento_da_substituicao", "dias_pendentes", "dias_em_aberto",
  "substituido_em_outro_fechamento", "ultima_atualizacao"
];

const EAD_FIELDS = [
  "id", "municipio", "uf", "potencial_cota", "latitude_municipio",
  "longitude_municipio", "ponto_mais_proximo", "uf_ponto", "tipo_ponto",
  "subsede_responsavel", "distancia_km", "classificacao_distancia",
  "classificacao_potencial", "status_calculo", "atualizado_em"
];

let subRegistros = [];
let subGraficos = {};
let subInicializado = false;
let subPaginaAtual = 1;

let eadRegistros = [];
let eadInicializado = false;
let eadPaginaAtual = 1;

// NOVO: estado independente dos protocolos
let eadCursosRegistros = [];
let eadCursosInicializado = false;
let eadCursosPaginaAtual = 1;
let eadCursosCarregando = false;

// ==================================================
// FUNÇÕES GERAIS
// ==================================================

function showMessage(id, message, type = "error") {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = type === "success" ? "message-success" : "message-error";
}

function clearMessage(id) {
  const el = $(id);
  if (el) {
    el.textContent = "";
    el.className = "";
  }
}

function setLoading(button, loading, loadingText = "Aguarde...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function friendlyError(error) {
  const m = error?.message || "";

  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(m)) return "Seu e-mail ainda não foi confirmado.";
  if (/failed to fetch|networkerror/i.test(m)) return "Não foi possível conectar. Confira a internet e o Supabase.";
  if (/permission denied|row-level security|42501/i.test(m)) return "Acesso negado. Confira as políticas de acesso do Supabase.";

  return m || "Ocorreu um erro inesperado.";
}

function isSafeDashboardUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[🔴🟢🟠🔵🟡⚪]/g, "")
    .toLowerCase()
    .trim();
}

function valorTexto(value, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value).trim();
}

function numeroSeguro(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function ehSim(value) {
  return ["sim", "yes", "true", "1", "realizado", "substituido"].includes(normalize(value));
}

function ehNao(value) {
  return ["nao", "no", "false", "0", "pendente", "nao substituido", "nao realizada"].includes(normalize(value));
}

function temValor(value) {
  const v = normalize(value);
  return !!v && ![
    "—", "-", "null", "undefined", "nao", "false", "0",
    "pendente", "nao substituido", "nao realizada"
  ].includes(v);
}

function definirMensagemSubstituicoes(message, type = "success") {
  const el = $("substituicoes-message");
  if (!el) return;
  el.textContent = message;
  el.className = type === "error" ? "message-error" : "message-success";
}

// ==================================================
// SESSÃO E LOGIN
// ==================================================

if (!sb) {
  showMessage("login-message", "O Supabase não foi configurado. Confira o arquivo config.js.");
} else {
  iniciarPortal();
}

async function iniciarPortal() {
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    if (data.session) await atualizarPortal();
    else mostrarLogin();
  } catch (error) {
    console.error(error);
    mostrarLogin();
    showMessage("login-message", friendlyError(error));
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      setTimeout(() => atualizarPortal(), 0);
    }

    if (event === "SIGNED_OUT") {
      currentUser = null;
      currentProfile = null;
      allDashboards = [];
      adminUsers = [];

      subRegistros = [];
      subInicializado = false;
      subPaginaAtual = 1;

      eadRegistros = [];
      eadInicializado = false;
      eadPaginaAtual = 1;

      // NOVO: limpar o estado dos protocolos no logout
      eadCursosRegistros = [];
      eadCursosInicializado = false;
      eadCursosPaginaAtual = 1;
      eadCursosCarregando = false;

      destruirGraficosSubstituicoes();
      destruirMapaEaD();
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  [
    "portal-section", "admin-section", "admin-nav-link",
    "substituicoes-section", "substituicoes-nav-link",
    "ead-section", "ead-nav-link"
  ].forEach(id => {
    if ($(id)) $(id).hidden = true;
  });

  if ($("login-section")) $("login-section").hidden = false;
  if ($("user-email")) $("user-email").textContent = "";
}

function mostrarPortal() {
  if ($("login-section")) $("login-section").hidden = true;
  if ($("portal-section")) $("portal-section").hidden = false;
  if ($("user-email")) $("user-email").textContent = currentUser?.email || "";
}

if ($("login-form")) {
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("login-message");

    const button = event.submitter;
    setLoading(button, true, "Entrando...");

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password) throw new Error("Informe seu e-mail e sua senha.");

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      await atualizarPortal();
    } catch (error) {
      showMessage("login-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

if ($("logout-btn")) {
  $("logout-btn").addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      mostrarLogin();
    } catch (error) {
      showMessage("dashboard-message", friendlyError(error));
    }
  });
}

async function atualizarPortal() {
  try {
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!user) return mostrarLogin();

    currentUser = user;

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) throw new Error("Seu perfil não foi encontrado na tabela profiles.");

    currentProfile = profile;
    mostrarPortal();

    const isAdmin = profile.role === "admin";

    if ($("admin-section")) $("admin-section").hidden = !isAdmin;
    if ($("admin-nav-link")) $("admin-nav-link").hidden = !isAdmin;

    await carregarDashboards();
    if (isAdmin) await carregarAdministracao();
  } catch (error) {
    console.error(error);
    showMessage("dashboard-message", friendlyError(error));
  }
}

// ==================================================
// DASHBOARDS E FILTROS
// ==================================================

async function carregarDashboards() {
  clearMessage("dashboard-message");

  const grid = $("dashboard-grid");
  if (!grid) return;
  grid.replaceChildren();

  const { data, error } = await sb
    .from("dashboards")
    .select("id, name, description, category, url")
    .order("name");

  if (error) throw error;
  allDashboards = data || [];

  allDashboards.forEach(d => {
    const card = document.createElement("article");
    card.className = "dashboard-card";

    const title = document.createElement("h3");
    title.textContent = d.name || "Dashboard sem nome";

    const desc = document.createElement("p");
    desc.textContent = d.description || "";

    const cat = document.createElement("p");
    cat.className = "card-category";
    cat.dataset.category = d.category || "outros";
    cat.textContent = "Categoria: " + (d.category || "Outros");

    card.append(title, desc, cat);

    if (isSafeDashboardUrl(d.url)) {
      const link = document.createElement("a");
      link.href = d.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Abrir dashboard";
      card.appendChild(link);
    } else {
      const warning = document.createElement("p");
      warning.textContent = "URL do dashboard inválida.";
      card.appendChild(warning);
    }

    grid.appendChild(card);
  });

  if ($("summary-total")) $("summary-total").textContent = String(allDashboards.length);

  if ($("summary-categories")) {
    $("summary-categories").textContent = String(
      new Set(allDashboards.map(d => normalize(d.category || "outros"))).size
    );
  }

  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();
  configurarAcessoSubstituicoes();
  configurarAcessoEaD();
}

function aplicarFiltrosDashboards() {
  const grid = $("dashboard-grid");
  if (!grid) return;

  const term = normalize($("dashboard-search")?.value || "");
  const category = normalize($("category-filter")?.value || "");
  let visible = 0;

  [...grid.querySelectorAll(".dashboard-card")].forEach(card => {
    const matches = normalize(card.innerText).includes(term);
    const categoryMatches = !category ||
      normalize(card.querySelector(".card-category")?.dataset.category) === category;

    card.hidden = !(matches && categoryMatches);
    if (!card.hidden) visible++;
  });

  if ($("filter-empty")) $("filter-empty").hidden = visible > 0;
}

if ($("dashboard-search")) $("dashboard-search").addEventListener("input", aplicarFiltrosDashboards);
if ($("category-filter")) $("category-filter").addEventListener("change", aplicarFiltrosDashboards);

// ==================================================
// ADMINISTRAÇÃO E PERMISSÕES
// ==================================================

async function adminCall(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("portal-admin", {
    body: { action, ...payload }
  });

  if (error) throw new Error("Falha na operação administrativa. Confira a função portal-admin.");
  if (data?.error) throw new Error(data.error);
  return data;
}

async function carregarAdministracao() {
  try {
    const result = await adminCall("list_users");
    adminUsers = result.users || [];
    preencherListaUsuarios();
    renderizarDashboardsAdministrativos();
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  }
}

function preencherListaUsuarios() {
  const select = $("permission-user");
  if (!select) return;

  const previous = select.value;
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione um usuário";
  select.appendChild(placeholder);

  adminUsers.forEach(user => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.email || "Sem e-mail"} — ${user.role || "user"}`;
    select.appendChild(option);
  });

  if (adminUsers.some(u => u.id === previous)) select.value = previous;
  if (select.value) carregarPermissoesUsuario();
}

if ($("user-create-form")) {
  $("user-create-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true, "Criando usuário...");

    try {
      const email = $("new-user-email")?.value.trim();
      const password = $("new-user-password")?.value;
      const role = $("new-user-role")?.value;

      if (!email || !password || !role) throw new Error("Preencha todos os campos do usuário.");

      await adminCall("create_user", { email, password, role });
      $("user-create-form").reset();
      showMessage("user-create-message", "Usuário criado com sucesso!", "success");
      await carregarAdministracao();
    } catch (error) {
      showMessage("user-create-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

if ($("permission-user")) {
  $("permission-user").addEventListener("change", carregarPermissoesUsuario);
}

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");

  const userId = $("permission-user")?.value;
  const container = $("permission-dashboard-list");
  if (!container) return;
  container.replaceChildren();
  if (!userId) return;

  const user = adminUsers.find(u => u.id === userId);
  if (!user) return;

  if (user.role === "admin") {
    showMessage("permission-message", "Administradores possuem acesso a todos os dashboards.", "success");
    return;
  }

  try {
    const { data: permissions, error } = await sb
      .from("dashboard_permissions")
      .select("dashboard_id")
      .eq("user_id", userId);

    if (error) throw error;
    const ids = new Set((permissions || []).map(p => p.dashboard_id));

    const { data: dashboards, error: dError } = await sb
      .from("dashboards")
      .select("id, name, description, category, url")
      .order("name");

    if (dError) throw dError;

    (dashboards || []).forEach(d => {
      const label = document.createElement("label");
      label.className = "permission-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = d.id;
      input.checked = ids.has(d.id);

      const span = document.createElement("span");
      span.textContent = d.name || "Dashboard sem nome";

      label.append(input, span);
      container.appendChild(label);
    });
  } catch (error) {
    showMessage("permission-message", friendlyError(error));
  }
}

if ($("save-permissions-btn")) {
  $("save-permissions-btn").addEventListener("click", async () => {
    const userId = $("permission-user")?.value;

    if (!userId) {
      return showMessage("permission-message", "Selecione um usuário primeiro.");
    }

    const user = adminUsers.find(u => u.id === userId);
    if (user?.role === "admin") {
      return showMessage("permission-message", "Administradores já possuem acesso a todos os dashboards.");
    }

    const button = $("save-permissions-btn");
    setLoading(button, true, "Salvando...");

    try {
      const ids = [...$("permission-dashboard-list").querySelectorAll('input[type="checkbox"]:checked')]
        .map(i => i.value);

      await adminCall("set_permissions", { user_id: userId, dashboard_ids: ids });
      showMessage("permission-message", "Permissões salvas com sucesso!", "success");
    } catch (error) {
      showMessage("permission-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

function renderizarDashboardsAdministrativos() {
  const container = $("admin-dashboard-list");
  if (!container) return;
  container.replaceChildren();

  allDashboards.forEach(d => {
    const item = document.createElement("article");
    item.className = "admin-dashboard-item";

    const title = document.createElement("strong");
    title.textContent = d.name || "Dashboard sem nome";

    const desc = document.createElement("p");
    desc.textContent = `${d.category || "outros"} — ID: ${d.id}`;

    item.append(title, desc);
    container.appendChild(item);
  });
}

if ($("dashboard-form")) {
  $("dashboard-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true, "Salvando...");

    try {
      const d = {
        id: $("dashboard-id").value.trim(),
        name: $("dashboard-name").value.trim(),
        description: $("dashboard-description").value.trim(),
        category: $("dashboard-category").value,
        url: $("dashboard-url").value.trim()
      };

      if (!d.id || !d.name || !d.description || !isSafeDashboardUrl(d.url)) {
        throw new Error("Preencha todos os campos e informe uma URL válida.");
      }

      const { error } = await sb.from("dashboards").upsert(d, { onConflict: "id" });
      if (error) throw error;

      showMessage("dashboard-form-message", "Dashboard salvo com sucesso!", "success");
      $("dashboard-form").reset();
      await carregarDashboards();

      if (currentProfile?.role === "admin") await carregarAdministracao();
    } catch (error) {
      showMessage("dashboard-form-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// SUBSTITUIÇÕES — ACESSO
// ==================================================

function dashboardEhSubstituicoes(d) {
  const nome = normalize(d?.name);
  const id = normalize(d?.id);
  return nome.includes("bi de substituicoes") ||
    nome.includes("bi substituicoes") ||
    id === "bi_substituicoes" ||
    id === "bi-substituicoes";
}

function configurarAcessoSubstituicoes() {
  const section = $("substituicoes-section");
  const nav = $("substituicoes-nav-link");
  if (!section || !nav) return;

  const allowed = currentProfile?.role === "admin" || allDashboards.some(dashboardEhSubstituicoes);
  section.hidden = !allowed;
  nav.hidden = !allowed;

  if (allowed && !subInicializado) {
    subInicializado = true;
    prepararInterfaceSubstituicoes();
    carregarSubstituicoes().catch(error => mostrarErroSubstituicoes(friendlyError(error)));
  }
}

function prepararInterfaceSubstituicoes() {
  if ($("substituicoes-atualizar")) {
    $("substituicoes-atualizar").addEventListener("click", async () => {
      const button = $("substituicoes-atualizar");
      setLoading(button, true, "Atualizando...");
      try {
        await carregarSubstituicoes();
      } catch (error) {
        mostrarErroSubstituicoes(friendlyError(error));
      } finally {
        setLoading(button, false);
      }
    });
  }

  [
    "sub-filtro-subsede", "sub-filtro-angariador", "sub-filtro-ano",
    "sub-filtro-periodo-fechamento", "sub-filtro-situacao"
  ].forEach(id => {
    if ($(id)) $(id).addEventListener("change", () => {
      subPaginaAtual = 1;
      renderizarBISelecionado();
    });
  });

  if ($("sub-pagina-anterior")) {
    $("sub-pagina-anterior").addEventListener("click", () => {
      if (subPaginaAtual > 1) {
        subPaginaAtual--;
        renderizarBISelecionado();
      }
    });
  }

  if ($("sub-pagina-proxima")) {
    $("sub-pagina-proxima").addEventListener("click", () => {
      const totalPaginas = Math.max(1, Math.ceil(obterRegistrosFiltrados().length / SUB_PAGE_SIZE));
      if (subPaginaAtual < totalPaginas) {
        subPaginaAtual++;
        renderizarBISelecionado();
      }
    });
  }
}

function mostrarErroSubstituicoes(message) {
  definirMensagemSubstituicoes(message, "error");
}

async function carregarSubstituicoes() {
  if (!sb || !currentUser || !currentProfile) return;
  definirMensagemSubstituicoes("Carregando dados de substituições...");

  const all = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb.from(SUB_VIEW)
      .select(SUB_FIELDS.join(","))
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = data || [];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  subRegistros = all.map(normalizarRegistroSubstituicao);
  subPaginaAtual = 1;
  preencherFiltrosSubstituicoes();

  definirMensagemSubstituicoes(`${subRegistros.length.toLocaleString("pt-BR")} registros carregados.`);
  renderizarBISelecionado();
}

function normalizarRegistroSubstituicao(row) {
  const situacao = normalize(row.situacao_substituicao);
  const status = normalize(row.status_da_substituicao);
  const jovemFoiSubstituido = normalize(row.jovem_foi_substituido);
  const outroFechamento = ehSim(row.substituido_em_outro_fechamento);
  const faixa = normalize(row.faixa_de_atraso);
  const prazo = normalize(row.dentro_do_prazo);

  const sinalRealizada =
    situacao.includes("substituido realizado") ||
    status.includes("realizado") ||
    (temValor(jovemFoiSubstituido) && !ehNao(jovemFoiSubstituido)) ||
    temValor(row.jovem_substituto) ||
    outroFechamento ||
    (temValor(row.fechamento_da_substituicao) && !ehNao(row.fechamento_da_substituicao));

  const declaradaPendente =
    situacao.includes("nao substituido") ||
    status.includes("nao substituido") ||
    situacao.includes("nao realizada") ||
    status.includes("nao realizada");

  const realizada = sinalRealizada && !declaradaPendente;

  const dias = numeroSeguro(row.dias_pendentes) ??
    numeroSeguro(row.dias_em_aberto) ??
    numeroSeguro(row.dias_ate_substituicao);

  const faixaNoFechamento = faixa.includes("no fechamento");
  const faixaAtrasada = /31 a 60|61 a 90|mais de 90|acima de 90|acima de 60|mais de 60|atraso/.test(faixa);

  const atrasada = !realizada && !faixaNoFechamento &&
    ((dias !== null && dias > 30) || (dias === null && faixaAtrasada && prazo !== "sim"));

  const periodoFechamento = valorTexto(row.periodo_fechamento, "");
  const mes = valorTexto(
    row.mes_fechamento || periodoFechamento || row.mes_fechamento_da_substituicao ||
    row.mes_ano_desligamento || row.mes_da_substituicao,
    "Sem mês"
  );

  const anoExtraido = String(
    periodoFechamento || row.mes_fechamento || row.mes_ano_desligamento ||
    row.data_desligamento || ""
  ).match(/20\d{2}/)?.[0] || "Sem ano";

  return {
    ...row,
    _realizada: realizada,
    _realizadaCerta: realizada && !outroFechamento,
    _realizadaOutro: realizada && outroFechamento,
    _atrasada: atrasada,
    _situacao: realizada ? "realizada" : atrasada ? "atrasada" : "pendente",
    _dias: dias,
    _mes: mes,
    _ano: valorTexto(row.ano_fechamento, "") || anoExtraido,
    _periodoFechamento: periodoFechamento,
    _prioridade: realizada ? "Resolvida" : atrasada ? "Atrasada" : valorTexto(row.prioridade, "Normal")
  };
}

// ==================================================
// FILTROS DINÂMICOS
// ==================================================

function preencherSelectDinamico({ id, values, placeholder, preserveValue = true, descending = false }) {
  const select = $(id);
  if (!select) return;

  const current = preserveValue ? select.value : "";
  const unique = [...new Set(values.map(v => String(v ?? "").trim()).filter(Boolean))];

  unique.sort((a, b) => descending
    ? b.localeCompare(a, "pt-BR", { numeric: true })
    : a.localeCompare(b, "pt-BR", { numeric: true }));

  select.replaceChildren();

  const optionAll = document.createElement("option");
  optionAll.value = "";
  optionAll.textContent = placeholder;
  select.appendChild(optionAll);

  unique.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (unique.includes(current)) select.value = current;
}

function preencherFiltrosSubstituicoes() {
  preencherSelectDinamico({ id: "sub-filtro-subsede", values: subRegistros.map(r => r.subsede), placeholder: "Todas as subsedes" });
  preencherSelectDinamico({ id: "sub-filtro-angariador", values: subRegistros.map(r => r.angariador), placeholder: "Todos os angariadores" });
  preencherSelectDinamico({ id: "sub-filtro-ano", values: subRegistros.map(r => r._ano).filter(a => a && a !== "Sem ano"), placeholder: "Todos os anos", descending: true });
  preencherSelectDinamico({ id: "sub-filtro-periodo-fechamento", values: subRegistros.map(r => r._periodoFechamento), placeholder: "Todos os períodos", descending: true });
}

function obterRegistrosFiltrados() {
  const subsede = $("sub-filtro-subsede")?.value || "";
  const angariador = $("sub-filtro-angariador")?.value || "";
  const ano = $("sub-filtro-ano")?.value || "";
  const periodo = $("sub-filtro-periodo-fechamento")?.value || "";
  const situacao = $("sub-filtro-situacao")?.value || "";

  return subRegistros.filter(r =>
    (!subsede || String(r.subsede || "").trim() === subsede) &&
    (!angariador || String(r.angariador || "").trim() === angariador) &&
    (!ano || r._ano === ano) &&
    (!periodo || r._periodoFechamento === periodo) &&
    (!situacao || r._situacao === situacao)
  );
}

function renderizarBISelecionado() {
  const rows = obterRegistrosFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(rows.length / SUB_PAGE_SIZE));
  if (subPaginaAtual > totalPaginas) subPaginaAtual = totalPaginas;

  atualizarIndicadoresSubstituicoes(rows);
  renderizarGraficosSubstituicoes(rows);
  renderizarTabelaSubstituicoes(rows);
}

function atualizarIndicadoresSubstituicoes(rows) {
  const values = {
    "sub-total": rows.length,
    "sub-realizadas": rows.filter(r => r._realizada).length,
    "sub-pendentes": rows.filter(r => !r._realizada && !r._atrasada).length,
    "sub-atrasadas": rows.filter(r => r._atrasada).length
  };

  Object.entries(values).forEach(([id, value]) => {
    if ($(id)) $(id).textContent = value.toLocaleString("pt-BR");
  });
}

// ==================================================
// GRÁFICOS DE SUBSTITUIÇÕES
// ==================================================

function destruirGraficosSubstituicoes() {
  Object.values(subGraficos).forEach(chart => chart?.destroy?.());
  subGraficos = {};
}

const pluginRotulosSubstituicoes = {
  id: "rotulosSubstituicoes",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
        if (chart.config.type === "doughnut" && Number(value) === 0) return;

        const position = element.tooltipPosition();
        const isHorizontal = chart.options.indexAxis === "y";

        ctx.fillStyle = chart.config.type === "doughnut" ? "#ffffff" : "#263746";
        ctx.textAlign = isHorizontal ? "left" : "center";

        const x = isHorizontal ? position.x + 7 : position.x;
        const y = isHorizontal ? position.y : position.y - 10;
        ctx.fillText(Number(value).toLocaleString("pt-BR"), x, y);
      });
    });

    ctx.restore();
  }
};

function criarGraficoSubstituicoes(id, config) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;

  if (subGraficos[id]) subGraficos[id].destroy();

  subGraficos[id] = new Chart(canvas, {
    ...config,
    plugins: [...(config.plugins || []), pluginRotulosSubstituicoes]
  });
}

function agruparContagem(rows, keyFn) {
  const map = new Map();

  rows.forEach(row => {
    const label = String(keyFn(row) || "Não informado").trim();
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function ordenarPeriodosMensais(periodos) {
  const meses = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  return [...periodos].sort((a, b) => {
    const anoA = Number(String(a[0]).match(/20\d{2}/)?.[0] || 0);
    const anoB = Number(String(b[0]).match(/20\d{2}/)?.[0] || 0);
    if (anoA !== anoB) return anoA - anoB;

    const mesA = normalize(a[0]);
    const mesB = normalize(b[0]);
    const indexA = meses.findIndex(m => mesA.includes(m));
    const indexB = meses.findIndex(m => mesB.includes(m));

    if (indexA !== -1 && indexB !== -1 && indexA !== indexB) return indexA - indexB;
    return String(a[0]).localeCompare(String(b[0]), "pt-BR", { numeric: true });
  });
}

function opcoesGraficoSubstituicoes() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } },
    scales: {
      x: { ticks: { maxRotation: 45, minRotation: 0 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 } }
    }
  };
}

function renderizarGraficosSubstituicoes(rows) {
  if (typeof Chart === "undefined") {
    mostrarErroSubstituicoes("A biblioteca Chart.js não carregou.");
    return;
  }

  const meses = ordenarPeriodosMensais(agruparContagem(rows, r => r._mes));
  const datasets = [
    { label: "Fechadas no período correto", key: r => r._realizadaCerta, color: "#16835b" },
    { label: "Fechadas em outro período", key: r => r._realizadaOutro, color: "#7b61a8" },
    { label: "Pendentes", key: r => !r._realizada && !r._atrasada, color: "#3678c8" },
    { label: "Em atraso", key: r => r._atrasada, color: "#c94c4c" }
  ];

  criarGraficoSubstituicoes("sub-grafico-mensal", {
    type: "line",
    data: {
      labels: meses.map(item => item[0]),
      datasets: datasets.map(d => ({
        label: d.label,
        data: meses.map(([mes]) => rows.filter(r => r._mes === mes && d.key(r)).length),
        borderColor: d.color,
        backgroundColor: d.color + "20",
        pointBackgroundColor: d.color,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.25
      }))
    },
    options: opcoesGraficoSubstituicoes()
  });

  const subsedes = agruparContagem(rows, r => r.subsede).slice(0, 12);
  criarGraficoSubstituicoes("sub-grafico-subsede", {
    type: "bar",
    data: {
      labels: subsedes.map(i => i[0]),
      datasets: [{ label: "Registros", data: subsedes.map(i => i[1]), backgroundColor: "#3678c8", borderRadius: 5 }]
    },
    options: { ...opcoesGraficoSubstituicoes(), indexAxis: "y" }
  });

  const motivos = agruparContagem(rows, r => r.motivo || "Não informado").slice(0, 10);
  criarGraficoSubstituicoes("sub-grafico-motivos", {
    type: "bar",
    data: {
      labels: motivos.map(i => i[0]),
      datasets: [{ label: "Registros", data: motivos.map(i => i[1]), backgroundColor: "#244b78", borderRadius: 5 }]
    },
    options: { ...opcoesGraficoSubstituicoes(), indexAxis: "y" }
  });

  const certas = rows.filter(r => r._realizadaCerta).length;
  const outras = rows.filter(r => r._realizadaOutro).length;
  const pendentes = rows.filter(r => !r._realizada && !r._atrasada).length;
  const atrasadas = rows.filter(r => r._atrasada).length;

  criarGraficoSubstituicoes("sub-grafico-situacao", {
    type: "doughnut",
    data: {
      labels: ["Fechadas no período correto", "Fechadas em outro período", "Pendentes", "Em atraso"],
      datasets: [{
        data: [certas, outras, pendentes, atrasadas],
        backgroundColor: ["#16835b", "#7b61a8", "#3678c8", "#c94c4c"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } }
    }
  });
}

// ==================================================
// TABELA E PAGINAÇÃO DE SUBSTITUIÇÕES
// ==================================================

function criarCelulaTabela(value, row) {
  const td = document.createElement("td");
  td.textContent = valorTexto(value);
  if (row) td.title = String(value ?? "");
  return td;
}

function renderizarTabelaSubstituicoes(rows) {
  const tbody = $("sub-tabela-corpo");
  const contagem = $("sub-tabela-contagem");
  if (!tbody) return;
  tbody.replaceChildren();

  if (contagem) contagem.textContent = `${rows.length.toLocaleString("pt-BR")} registros`;

  const sorted = [...rows].sort((a, b) => (b._dias ?? -1) - (a._dias ?? -1));
  const totalPaginas = Math.max(1, Math.ceil(sorted.length / SUB_PAGE_SIZE));
  if (subPaginaAtual > totalPaginas) subPaginaAtual = totalPaginas;
  if (subPaginaAtual < 1) subPaginaAtual = 1;

  if (!sorted.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "Nenhum registro encontrado para os filtros selecionados.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    atualizarPaginacaoSubstituicoes(0, 0, 0, 1);
    return;
  }

  const inicio = (subPaginaAtual - 1) * SUB_PAGE_SIZE;
  const fim = Math.min(inicio + SUB_PAGE_SIZE, sorted.length);

  sorted.slice(inicio, fim).forEach(r => {
    const tr = document.createElement("tr");

    const situacao = r._realizada
      ? (r._realizadaOutro ? "Fechada em outro período" : "Fechada no período correto")
      : r._atrasada ? "Em atraso" : "Pendente";

    const fechamento = valorTexto(
      r.periodo_fechamento || r.mes_fechamento || r.fim_fechamento ||
      r.inicio_fechamento || r.mes_da_substituicao
    );

    [
      r.subsede, r.jovem, r.empresa, r.motivo, fechamento,
      r._dias, situacao, r._prioridade
    ].forEach((value, index) => {
      tr.appendChild(criarCelulaTabela(index === 5 && value == null ? "—" : value, r));
    });

    tbody.appendChild(tr);
  });

  atualizarPaginacaoSubstituicoes(sorted.length, inicio + 1, fim, totalPaginas);
}

function atualizarPaginacaoSubstituicoes(total, primeiro, ultimo, totalPaginas) {
  const info = $("sub-paginacao-info");
  const anterior = $("sub-pagina-anterior");
  const proxima = $("sub-pagina-proxima");
  const container = $("sub-paginacao");

  if (info) {
    info.textContent = total
      ? `Exibindo ${primeiro}–${ultimo} de ${total.toLocaleString("pt-BR")} registros · Página ${subPaginaAtual} de ${totalPaginas}`
      : "Nenhum registro para exibir.";
  }

  if (anterior) anterior.disabled = subPaginaAtual <= 1;
  if (proxima) proxima.disabled = subPaginaAtual >= totalPaginas || total === 0;
  if (container) container.hidden = false;
}

// ==================================================
// EaD — ACESSO E INTERFACE
// ==================================================

function dashboardEhEaD(d) {
  const nome = normalize(d?.name);
  const id = normalize(d?.id);
  return nome.includes("analise geografica ead") ||
    nome.includes("analise geografica") ||
    id === "analise_geografica_ead" ||
    id === "analise-geografica-ead" ||
    id === "bi_ead" ||
    id === "bi-ead";
}

function configurarAcessoEaD() {
  const section = $("ead-section");
  const nav = $("ead-nav-link");
  if (!section || !nav) return;

  const allowed = currentProfile?.role === "admin" || allDashboards.some(dashboardEhEaD);
  section.hidden = !allowed;
  nav.hidden = !allowed;

  if (allowed && !eadInicializado) {
    eadInicializado = true;
    prepararInterfaceEaD();

    carregarAnaliseEaD()
      .catch(error => mostrarMensagemEaD(friendlyError(error), "error"))
      .finally(() => {
        // O módulo de protocolos é independente da análise geográfica.
        prepararInterfaceCursosEaD();
        carregarCursosProtocolosEaD().catch(error => {
          mostrarMensagemCursosEaD(friendlyError(error), "error");
        });
      });
  }
}

function prepararInterfaceEaD() {
  if ($("ead-atualizar")) {
    $("ead-atualizar").addEventListener("click", async () => {
      const button = $("ead-atualizar");
      setLoading(button, true, "Atualizando...");
      try {
        await carregarAnaliseEaD();
      } catch (error) {
        mostrarMensagemEaD(friendlyError(error), "error");
      } finally {
        setLoading(button, false);
      }
    });
  }

  ["ead-filtro-uf", "ead-filtro-distancia", "ead-filtro-potencial"].forEach(id => {
    if ($(id)) $(id).addEventListener("change", () => {
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  });

  if ($("ead-filtro-municipio")) {
    $("ead-filtro-municipio").addEventListener("input", () => {
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  }

  if ($("ead-pagina-anterior")) {
    $("ead-pagina-anterior").addEventListener("click", () => {
      if (eadPaginaAtual > 1) {
        eadPaginaAtual--;
        renderizarAnaliseEaD();
      }
    });
  }

  if ($("ead-pagina-proxima")) {
    $("ead-pagina-proxima").addEventListener("click", () => {
      const totalPaginas = Math.max(1, Math.ceil(obterRegistrosEaDFiltrados().length / EAD_PAGE_SIZE));
      if (eadPaginaAtual < totalPaginas) {
        eadPaginaAtual++;
        renderizarAnaliseEaD();
      }
    });
  }
}

function mostrarMensagemEaD(message, type = "success") {
  const el = $("ead-message");
  if (!el) return;
  el.textContent = message;
  el.className = type === "error" ? "message-error" : "message-success";
}

async function carregarAnaliseEaD() {
  if (!sb || !currentUser || !currentProfile) return;
  mostrarMensagemEaD("Carregando análise geográfica EaD...");

  const registros = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb.from(EAD_TABLE)
      .select(EAD_FIELDS.join(","))
      .order("municipio")
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const pagina = data || [];
    registros.push(...pagina);
    if (pagina.length < pageSize) break;
    offset += pageSize;
  }

  eadRegistros = registros;
  eadPaginaAtual = 1;
  preencherFiltrosEaD();
  renderizarAnaliseEaD();
  mostrarMensagemEaD(`${eadRegistros.length.toLocaleString("pt-BR")} municípios carregados.`);
}

function preencherFiltrosEaD() {
  preencherSelectDinamico({ id: "ead-filtro-uf", values: eadRegistros.map(r => r.uf), placeholder: "Todas as UFs" });
  preencherSelectDinamico({ id: "ead-filtro-distancia", values: eadRegistros.map(r => r.classificacao_distancia), placeholder: "Todas as classificações de distância" });
  preencherSelectDinamico({ id: "ead-filtro-potencial", values: eadRegistros.map(r => r.classificacao_potencial), placeholder: "Todas as classificações de potencial" });
}

function obterRegistrosEaDFiltrados() {
  const municipio = normalize($("ead-filtro-municipio")?.value || "");
  const uf = $("ead-filtro-uf")?.value || "";
  const distancia = $("ead-filtro-distancia")?.value || "";
  const potencial = $("ead-filtro-potencial")?.value || "";

  return eadRegistros.filter(r =>
    (!municipio || normalize(r.municipio).includes(municipio)) &&
    (!uf || String(r.uf || "") === uf) &&
    (!distancia || String(r.classificacao_distancia || "") === distancia) &&
    (!potencial || String(r.classificacao_potencial || "") === potencial)
  );
}

// ==================================================
// EaD — MAPA INTERATIVO
// ==================================================

let eadMapa = null;
let eadMapaMarcadoresMunicipios = null;
let eadMapaMarcadoresAtendimento = null;
let eadMapaCamadaSelecao = null;
let eadMapaLinhaConexao = null;
let eadMapaCarregamento = null;
let eadMapaPreparado = false;
let eadMapaUltimaSelecao = "";

const EAD_MAPA_PONTOS = [
  ["SUBSEDE","Curitiba","PR","Curitiba",-25.432956,-49.271848],
  ["POLO","São José dos Pinhais","PR","Curitiba",-25.537702,-49.200082],
  ["POLO","Araucária","PR","Curitiba",-25.591645,-49.401940],
  ["POLO","Campo Largo","PR","Curitiba",-25.459491,-49.528841],
  ["POLO","Paranaguá","PR","Curitiba",-25.506842,-48.524733],
  ["SUBSEDE","Ponta Grossa","PR","Ponta Grossa",-25.092547,-50.161442],
  ["POLO","Carambeí","PR","Ponta Grossa",-24.950873,-50.113092],
  ["POLO","Castro","PR","Ponta Grossa",-24.795418,-50.002811],
  ["POLO","Palmeira","PR","Ponta Grossa",-25.418568,-50.003247],
  ["POLO","Porto Amazonas","PR","Ponta Grossa",-25.541573,-49.889721],
  ["SUBSEDE","Maringá","PR","Maringá",-23.422280,-51.939882],
  ["POLO","Cianorte","PR","Maringá",-23.653813,-52.609151],
  ["POLO","Campo Mourão","PR","Maringá",-24.041223,-52.381115],
  ["POLO","Jandaia do Sul","PR","Maringá",-23.601179,-51.643395],
  ["POLO","Ivatuba","PR","Maringá",-23.618274,-52.217669],
  ["SUBSEDE","Joinville","SC","Joinville",-26.304518,-48.849409],
  ["POLO","Rio Negrinho","SC","Joinville",-26.255325,-49.517295],
  ["POLO","São Bento do Sul","SC","Joinville",-26.249485,-49.386979],
  ["POLO","Jaraguá do Sul","SC","Joinville",-26.490484,-49.076299],
  ["POLO","Itapoá","SC","Joinville",-26.006048,-48.604168],
  ["POLO","Garuva","SC","Joinville",-26.022076,-48.849842],
  ["POLO","Araquari","SC","Joinville",-26.375952,-48.692707],
  ["POLO","Itajaí","SC","Joinville",-26.907426,-48.657023],
  ["POLO","Navegantes","SC","Joinville",-26.897439,-48.649183],
  ["POLO","Luiz Alves","SC","Joinville",-26.721111,-48.926047],
  ["SUBSEDE","Cascavel","PR","Cascavel",-24.953798,-53.459722],
  ["POLO","Foz do Iguaçu","PR","Cascavel",-25.542493,-54.587102],
  ["POLO","Toledo","PR","Cascavel",-24.732077,-53.741411],
  ["POLO","Palotina","PR","Cascavel",-24.279409,-53.838772],
  ["POLO","Assis Chateaubriand","PR","Cascavel",-24.408530,-53.521237],
  ["POLO","Umuarama","PR","Cascavel",-23.763950,-53.308460],
  ["POLO","Marechal Cândido Rondon","PR","Cascavel",-24.559255,-54.060008],
  ["POLO","Terra Roxa","PR","Cascavel",-24.167484,-54.098514],
  ["POLO","Maripá","PR","Cascavel",-24.417209,-53.833478],
  ["SUBSEDE","Florianópolis","SC","Florianópolis",-27.587796,-48.547638],
  ["POLO","São José","SC","Florianópolis",-27.590312,-48.616023],
  ["POLO","Criciúma","SC","Florianópolis",-28.673573,-49.365940],
  ["POLO","Tubarão","SC","Florianópolis",-28.480034,-49.005268],
  ["POLO","Palhoça","SC","Florianópolis",-27.647044,-48.670288],
  ["SUBSEDE","Londrina","PR","Londrina",-23.312156,-51.162773],
  ["POLO","Rolândia","PR","Londrina",-23.313592,-51.362781],
  ["SUBSEDE","Blumenau","SC","Blumenau",-26.916108,-49.057631],
  ["POLO","Brusque","SC","Blumenau",-27.098310,-48.915163],
  ["POLO","Gaspar","SC","Blumenau",-26.918369,-48.967707],
  ["POLO","Indaial","SC","Blumenau",-26.906256,-49.240140],
  ["POLO","Pomerode","SC","Blumenau",-26.744827,-49.174197],
  ["SUBSEDE","Guarapuava","PR","Guarapuava",-25.393592,-51.463431],
  ["POLO","Pato Branco","PR","Guarapuava",-26.229958,-52.677362],
  ["POLO","Francisco Beltrão","PR","Guarapuava",-26.078450,-53.056136]
];

function eadMapaPrepararElemento() {
  const section = $("ead-section");
  if (!section) return null;

  let painel = $("ead-mapa-painel");
  if (painel) return painel;

  painel = document.createElement("section");
  painel.id = "ead-mapa-painel";
  painel.className = "ead-mapa-painel";
  painel.style.cssText = "margin:20px 0;padding:20px;border:1px solid #d8e5f3;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(20,65,110,.07)";

  const titulo = document.createElement("h3");
  titulo.textContent = "Mapa geográfico — EaD";
  titulo.style.cssText = "margin:0 0 6px;font-size:20px;font-weight:700;color:#174a7e";

  const descricao = document.createElement("p");
  descricao.id = "ead-mapa-descricao";
  descricao.textContent = "Visualize os municípios da análise e os pontos de atendimento.";
  descricao.style.cssText = "margin:0 0 14px;color:#60758b;font-size:13px;line-height:1.6";

  const legenda = document.createElement("div");
  legenda.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin:0 0 14px;font-size:12px;color:#334e68";
  legenda.innerHTML = [
    '<span><span style="color:#2474c7;font-size:16px">●</span> Município analisado</span>',
    '<span><span style="color:#16835b;font-size:16px">●</span> Subsede</span>',
    '<span><span style="color:#e58a22;font-size:16px">●</span> Polo</span>',
    '<span><span style="color:#174a7e;font-size:16px">●</span> Município selecionado</span>'
  ].join("");

  const conteudo = document.createElement("div");
  conteudo.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:14px";

  const mapa = document.createElement("div");
  mapa.id = "ead-mapa-canvas";
  mapa.setAttribute("role", "application");
  mapa.setAttribute("aria-label", "Mapa interativo da análise geográfica EaD");
  mapa.style.cssText = "width:100%;height:480px;min-height:320px;border:1px solid #dce7f2;border-radius:12px;background:#eef5fb;z-index:1;overflow:hidden";

  const detalhes = document.createElement("aside");
  detalhes.id = "ead-mapa-detalhes";
  detalhes.style.cssText = "padding:16px;border:1px solid #dce7f2;border-radius:12px;background:#f7fbff;color:#243b53;min-height:80px";
  detalhes.innerHTML = `
    <h4 style="margin:0 0 8px;color:#174a7e;font-size:15px">Detalhes do município</h4>
    <p style="margin:0;color:#60758b;font-size:13px;line-height:1.6">
      Digite o nome de um município no filtro acima para localizá-lo no mapa.
    </p>`;

  const aviso = document.createElement("p");
  aviso.id = "ead-mapa-aviso";
  aviso.textContent = "Carregando mapa...";
  aviso.style.cssText = "font-size:12px;color:#60758b;margin:10px 0 0;line-height:1.5";

  conteudo.append(mapa, detalhes);
  painel.append(titulo, descricao, legenda, conteudo, aviso);

  const tabela = section.querySelector(".ead-tabela");
  if (tabela) section.insertBefore(painel, tabela);
  else section.appendChild(painel);

  if (!eadMapaPreparado) {
    const style = document.createElement("style");
    style.id = "ead-mapa-estilos";
    style.textContent = `
      #ead-mapa-painel .leaflet-container{font-family:Arial,sans-serif}
      #ead-mapa-canvas .leaflet-popup-content{line-height:1.5;color:#243b53}
      #ead-mapa-canvas .ead-popup-titulo{font-weight:700;font-size:14px;color:#174a7e;margin-bottom:7px}
      #ead-mapa-canvas .ead-popup-linha{margin:3px 0}
      #ead-mapa-detalhes .ead-detalhe-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:12px}
      #ead-mapa-detalhes .ead-detalhe-item{background:#fff;border:1px solid #e0eaf4;border-radius:9px;padding:10px;min-width:0}
      #ead-mapa-detalhes .ead-detalhe-label{display:block;font-size:11px;color:#60758b;margin-bottom:5px}
      #ead-mapa-detalhes .ead-detalhe-valor{display:block;font-size:13px;font-weight:700;color:#174a7e;overflow-wrap:anywhere}
      #ead-mapa-painel .ead-mapa-botao{border:1px solid #c6dbef;border-radius:8px;background:#fff;color:#174a7e;padding:8px 12px;font-weight:600;cursor:pointer}
      #ead-mapa-painel .ead-mapa-botao:hover{background:#eaf4ff}
      @media(max-width:600px){#ead-mapa-canvas{height:380px!important}#ead-mapa-painel{padding:12px!important}}
    `;
    document.head.appendChild(style);
    eadMapaPreparado = true;
  }

  return painel;
}

function eadMapaCarregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (eadMapaCarregamento) return eadMapaCarregamento;

  eadMapaCarregamento = new Promise((resolve, reject) => {
    const cssId = "ead-leaflet-css";
    const jsId = "ead-leaflet-js";

    if (!document.getElementById(cssId)) {
      const css = document.createElement("link");
      css.id = cssId;
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
    }

    const existente = document.getElementById(jsId);

    if (existente) {
      if (window.L) return resolve(window.L);

      existente.addEventListener("load", () => {
        if (window.L) resolve(window.L);
        else reject(new Error("A biblioteca do mapa não ficou disponível."));
      }, { once: true });

      existente.addEventListener("error", () => {
        eadMapaCarregamento = null;
        reject(new Error("Não foi possível carregar a biblioteca do mapa."));
      }, { once: true });

      return;
    }

    const script = document.createElement("script");
    script.id = jsId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => window.L
      ? resolve(window.L)
      : reject(new Error("A biblioteca Leaflet não foi inicializada."));
    script.onerror = () => {
      eadMapaCarregamento = null;
      reject(new Error("Não foi possível carregar o mapa. Verifique sua conexão."));
    };
    document.head.appendChild(script);
  });

  return eadMapaCarregamento;
}

function eadMapaIcone(cor, selecionado = false) {
  const tamanho = selecionado ? 22 : 14;
  const borda = selecionado ? 4 : 2;

  return window.L.divIcon({
    className: "ead-mapa-icone",
    html: `<div style="width:${tamanho}px;height:${tamanho}px;border:${borda}px solid #fff;border-radius:50%;background:${cor};box-shadow:0 2px 9px rgba(15,45,75,.4);${selecionado ? "outline:3px solid rgba(36,116,199,.22);" : ""}"></div>`,
    iconSize: [tamanho + borda * 2, tamanho + borda * 2],
    iconAnchor: [(tamanho + borda * 2) / 2, (tamanho + borda * 2) / 2],
    popupAnchor: [0, -(tamanho + borda * 2) / 2]
  });
}

function eadMapaPopupMunicipio(r) {
  const distancia = numeroSeguro(r.distancia_km);
  const potencial = numeroSeguro(r.potencial_cota);

  const distanciaTexto = distancia === null
    ? "Não informada"
    : `${distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

  const potencialTexto = potencial === null
    ? valorTexto(r.potencial_cota)
    : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const itens = [
    ["UF", valorTexto(r.uf)],
    ["Potencial de cota", potencialTexto],
    ["Ponto mais próximo", valorTexto(r.ponto_mais_proximo)],
    ["UF do ponto", valorTexto(r.uf_ponto)],
    ["Tipo do ponto", valorTexto(r.tipo_ponto)],
    ["Subsede responsável", valorTexto(r.subsede_responsavel)],
    ["Distância registrada", distanciaTexto],
    ["Classificação de distância", valorTexto(r.classificacao_distancia)],
    ["Classificação de potencial", valorTexto(r.classificacao_potencial)],
    ["Status do cálculo", valorTexto(r.status_calculo)]
  ];

  return `<div class="ead-popup-titulo">${escaparHTML(valorTexto(r.municipio))} - ${escaparHTML(valorTexto(r.uf))}</div>` +
    itens.map(([label, value]) =>
      `<div class="ead-popup-linha"><strong>${escaparHTML(label)}:</strong> ${escaparHTML(value)}</div>`
    ).join("") +
    `<div style="margin-top:7px;font-size:11px;color:#667085">A distância exibida é a que consta na base do sistema; não significa necessariamente distância por estrada.</div>`;
}

function escaparHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function eadMapaAdicionarPontosAtendimento() {
  if (!eadMapa || !eadMapaMarcadoresAtendimento) return;

  eadMapaMarcadoresAtendimento.clearLayers();

  EAD_MAPA_PONTOS.forEach(p => {
    const [tipo, municipio, uf, subsede, lat, lng] = p;
    const cor = tipo === "SUBSEDE" ? "#16835b" : "#e58a22";

    const marcador = window.L.marker([lat, lng], {
      icon: eadMapaIcone(cor),
      title: `${tipo}: ${municipio} - ${uf}`
    });

    marcador.bindPopup(
      `<div class="ead-popup-titulo">${escaparHTML(municipio)} - ${escaparHTML(uf)}</div>` +
      `<div class="ead-popup-linha"><strong>Tipo:</strong> ${escaparHTML(tipo)}</div>` +
      `<div class="ead-popup-linha"><strong>Subsede responsável:</strong> ${escaparHTML(subsede)}</div>` +
      `<div style="font-size:11px;color:#667085;margin-top:6px">Coordenada aproximada do município; não representa necessariamente o endereço físico.</div>`
    );

    marcador.addTo(eadMapaMarcadoresAtendimento);
  });
}

function eadMapaCoordenadasValidas(r) {
  const lat = numeroSeguro(r.latitude_municipio);
  const lng = numeroSeguro(r.longitude_municipio);

  return lat !== null && lng !== null &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}

function eadMapaEncontrarPonto(r) {
  const nomePonto = normalize(r.ponto_mais_proximo);
  const ufPonto = normalize(r.uf_ponto);
  const subsede = normalize(r.subsede_responsavel);
  const tipoPonto = normalize(r.tipo_ponto);

  if (!nomePonto) return null;

  const candidatos = EAD_MAPA_PONTOS.filter(p => {
    const nome = normalize(p[1]);
    const uf = normalize(p[2]);
    const subsedePonto = normalize(p[3]);
    const tipo = normalize(p[0]);

    const nomeCompativel = nome === nomePonto ||
      nome.includes(nomePonto) || nomePonto.includes(nome);
    const ufCompativel = !ufPonto || uf === ufPonto;
    const tipoCompativel = !tipoPonto || tipo.includes(tipoPonto) || tipoPonto.includes(tipo);
    const subsedeCompativel = !subsede || subsedePonto === subsede ||
      subsedePonto.includes(subsede) || subsede.includes(subsedePonto);

    return nomeCompativel && ufCompativel && tipoCompativel && subsedeCompativel;
  });

  if (candidatos.length) return candidatos[0];

  const alternativas = EAD_MAPA_PONTOS.filter(p =>
    normalize(p[1]) === nomePonto &&
    (!ufPonto || normalize(p[2]) === ufPonto)
  );

  return alternativas.length === 1 ? alternativas[0] : null;
}

function eadMapaRenderizarDetalhes(r, ponto = null) {
  const container = $("ead-mapa-detalhes");
  if (!container) return;

  if (!r) {
    container.innerHTML = `
      <h4 style="margin:0 0 8px;color:#174a7e;font-size:15px">Visão geral</h4>
      <p style="margin:0;color:#60758b;font-size:13px;line-height:1.6">
        O mapa está exibindo os municípios e os pontos de atendimento. Use o filtro de município para destacar um município específico.
      </p>`;
    return;
  }

  const distancia = numeroSeguro(r.distancia_km);
  const potencial = numeroSeguro(r.potencial_cota);
  const distanciaTexto = distancia === null
    ? "Não informada"
    : `${distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
  const potencialTexto = potencial === null
    ? valorTexto(r.potencial_cota)
    : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const itens = [
    ["Município", `${valorTexto(r.municipio)} - ${valorTexto(r.uf)}`],
    ["Potencial de cota", potencialTexto],
    ["Ponto mais próximo", valorTexto(r.ponto_mais_proximo)],
    ["UF do ponto", valorTexto(r.uf_ponto)],
    ["Tipo de ponto", valorTexto(r.tipo_ponto)],
    ["Subsede responsável", valorTexto(r.subsede_responsavel)],
    ["Distância registrada", distanciaTexto],
    ["Classificação de distância", valorTexto(r.classificacao_distancia)],
    ["Classificação de potencial", valorTexto(r.classificacao_potencial)],
    ["Status do cálculo", valorTexto(r.status_calculo)]
  ];

  const avisoPonto = ponto
    ? `Ponto localizado no mapa: ${ponto[1]} - ${ponto[2]}.`
    : "Não foi possível localizar uma coordenada correspondente ao ponto informado. A conexão não foi desenhada para evitar indicar um local incorreto.";

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div>
        <h4 style="margin:0 0 5px;color:#174a7e;font-size:16px">
          ${escaparHTML(valorTexto(r.municipio))} - ${escaparHTML(valorTexto(r.uf))}
        </h4>
        <p style="margin:0;color:#60758b;font-size:12px">Detalhes do registro selecionado</p>
      </div>
      <button type="button" id="ead-mapa-limpar-selecao" class="ead-mapa-botao">Ver mapa geral</button>
    </div>
    <div class="ead-detalhe-grade">
      ${itens.map(([label, value]) => `
        <div class="ead-detalhe-item">
          <span class="ead-detalhe-label">${escaparHTML(label)}</span>
          <span class="ead-detalhe-valor">${escaparHTML(value)}</span>
        </div>`).join("")}
    </div>
    <p style="font-size:12px;line-height:1.5;color:#60758b;margin:12px 0 0">
      ${escaparHTML(avisoPonto)}
      A distância apresentada é a registrada na base e não representa necessariamente uma distância rodoviária.
    </p>`;

  const limpar = $("ead-mapa-limpar-selecao");
  if (limpar) {
    limpar.addEventListener("click", () => {
      if ($("ead-filtro-municipio")) $("ead-filtro-municipio").value = "";
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();
    });
  }
}

function eadMapaLimparSelecao() {
  if (eadMapaCamadaSelecao) eadMapaCamadaSelecao.clearLayers();
  if (eadMapaLinhaConexao) {
    eadMapa.removeLayer(eadMapaLinhaConexao);
    eadMapaLinhaConexao = null;
  }
}

function eadMapaSelecionarMunicipio(r, ajustarEnquadramento = true) {
  if (!eadMapa || !eadMapaCamadaSelecao) return;

  eadMapaLimparSelecao();

  if (!r || !eadMapaCoordenadasValidas(r)) {
    eadMapaRenderizarDetalhes(r, null);
    return;
  }

  const lat = numeroSeguro(r.latitude_municipio);
  const lng = numeroSeguro(r.longitude_municipio);
  const coordenadaMunicipio = [lat, lng];
  const ponto = eadMapaEncontrarPonto(r);

  const marcadorMunicipio = window.L.marker(coordenadaMunicipio, {
    icon: eadMapaIcone("#174a7e", true),
    zIndexOffset: 1000,
    title: `Selecionado: ${r.municipio} - ${r.uf}`
  });

  marcadorMunicipio.bindPopup(eadMapaPopupMunicipio(r));
  marcadorMunicipio.addTo(eadMapaCamadaSelecao);

  const coordenadasEnquadramento = [coordenadaMunicipio];

  if (ponto) {
    const coordenadaPonto = [ponto[4], ponto[5]];
    const corPonto = ponto[0] === "SUBSEDE" ? "#16835b" : "#e58a22";

    const marcadorPonto = window.L.marker(coordenadaPonto, {
      icon: eadMapaIcone(corPonto, true),
      zIndexOffset: 900,
      title: `${ponto[0]} mais próximo: ${ponto[1]} - ${ponto[2]}`
    });

    marcadorPonto.bindPopup(`
      <div class="ead-popup-titulo">${escaparHTML(ponto[1])} - ${escaparHTML(ponto[2])}</div>
      <div class="ead-popup-linha"><strong>Tipo:</strong> ${escaparHTML(ponto[0])}</div>
      <div class="ead-popup-linha"><strong>Subsede:</strong> ${escaparHTML(ponto[3])}</div>
      <div style="margin-top:6px;font-size:11px;color:#60758b">
        Coordenada aproximada do município do ponto de atendimento.
      </div>`);
    marcadorPonto.addTo(eadMapaCamadaSelecao);

    eadMapaLinhaConexao = window.L.polyline(
      [coordenadaMunicipio, coordenadaPonto],
      { color: "#174a7e", weight: 3, opacity: 0.9, dashArray: "8 7", lineCap: "round" }
    ).addTo(eadMapa);

    coordenadasEnquadramento.push(coordenadaPonto);
  }

  eadMapaRenderizarDetalhes(r, ponto);

  if (ajustarEnquadramento) {
    const bounds = window.L.latLngBounds(coordenadasEnquadramento);
    eadMapa.fitBounds(bounds.pad(ponto ? 0.45 : 0.15), {
      maxZoom: ponto ? 9 : 10,
      animate: true
    });

    if (coordenadasEnquadramento.length === 1) {
      eadMapa.setView(coordenadaMunicipio, 8, { animate: true });
    }
  }

  marcadorMunicipio.openPopup();
}

function eadMapaObterSelecao(registros) {
  const texto = normalize($("ead-filtro-municipio")?.value || "");
  if (!texto) return null;

  const exatos = registros.filter(r => normalize(r.municipio) === texto);
  if (exatos.length === 1) return exatos[0];

  if (registros.length === 1 && normalize(registros[0].municipio).includes(texto)) {
    return registros[0];
  }

  return null;
}

async function atualizarMapaEaD(registros) {
  const painel = eadMapaPrepararElemento();
  if (!painel) return;

  const aviso = $("ead-mapa-aviso");

  try {
    await eadMapaCarregarLeaflet();

    const container = $("ead-mapa-canvas");
    if (!container) return;

    if (!eadMapa) {
      eadMapa = window.L.map(container, { scrollWheelZoom: false }).setView([-25.5, -50.5], 6);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(eadMapa);

      eadMapaMarcadoresMunicipios = window.L.featureGroup().addTo(eadMapa);
      eadMapaMarcadoresAtendimento = window.L.featureGroup().addTo(eadMapa);
      eadMapaCamadaSelecao = window.L.featureGroup().addTo(eadMapa);
      eadMapaAdicionarPontosAtendimento();

      setTimeout(() => eadMapa?.invalidateSize(), 150);
    }

    eadMapaMarcadoresMunicipios.clearLayers();
    let validos = 0;

    registros.forEach(r => {
      if (!eadMapaCoordenadasValidas(r)) return;

      const lat = numeroSeguro(r.latitude_municipio);
      const lng = numeroSeguro(r.longitude_municipio);
      const marcador = window.L.marker([lat, lng], {
        icon: eadMapaIcone("#2474c7"),
        title: `${r.municipio || "Município"} - ${r.uf || ""}`
      });

      marcador.bindPopup(eadMapaPopupMunicipio(r));
      marcador.on("click", () => {
        if ($("ead-filtro-municipio")) $("ead-filtro-municipio").value = r.municipio || "";
        eadPaginaAtual = 1;
        renderizarAnaliseEaD();
      });

      marcador.addTo(eadMapaMarcadoresMunicipios);
      validos++;
    });

    const selecao = eadMapaObterSelecao(registros);

    if (selecao) {
      eadMapaSelecionarMunicipio(selecao, true);
      if (aviso) {
        aviso.textContent =
          `Município selecionado: ${selecao.municipio} - ${selecao.uf}. ` +
          "O mapa destaca o município e o ponto mais próximo quando há correspondência nas coordenadas cadastradas.";
      }
    } else {
      eadMapaLimparSelecao();
      eadMapaRenderizarDetalhes(null);

      const pontosVisiveis = eadMapaMarcadoresMunicipios.getLayers().length;
      const todosPontos = eadMapaMarcadoresAtendimento.getLayers().length;

      if (pontosVisiveis > 0) {
        const bounds = eadMapaMarcadoresMunicipios.getBounds();
        if (bounds.isValid()) eadMapa.fitBounds(bounds.pad(0.08), { maxZoom: 7, animate: true });
      } else if (todosPontos > 0) {
        const bounds = eadMapaMarcadoresAtendimento.getBounds();
        if (bounds.isValid()) eadMapa.fitBounds(bounds.pad(0.08), { maxZoom: 7, animate: true });
      } else {
        eadMapa.setView([-25.5, -50.5], 6);
      }

      if (aviso) {
        aviso.textContent =
          `${validos.toLocaleString("pt-BR")} municípios com coordenadas válidas nos filtros atuais. ` +
          `${todosPontos} pontos de atendimento aproximados no mapa. ` +
          "Digite o nome completo de um município para destacá-lo.";
      }
    }

    setTimeout(() => eadMapa?.invalidateSize(), 100);
  } catch (error) {
    console.error("Erro ao carregar mapa EaD:", error);
    if (aviso) aviso.textContent = "Não foi possível carregar o mapa. Confira a conexão e tente atualizar a página.";
  }
}

function destruirMapaEaD() {
  if (eadMapa) eadMapa.remove();

  eadMapa = null;
  eadMapaMarcadoresMunicipios = null;
  eadMapaMarcadoresAtendimento = null;
  eadMapaCamadaSelecao = null;
  eadMapaLinhaConexao = null;
  eadMapaCarregamento = null;
  eadMapaPreparado = false;
  eadMapaUltimaSelecao = "";

  const painel = $("ead-mapa-painel");
  if (painel) painel.remove();
}

// ==================================================
// EaD — INDICADORES, MAPA E TABELA
// ==================================================

function renderizarAnaliseEaD() {
  const registros = obterRegistrosEaDFiltrados();

  const total = registros.length;
  const ate70 = registros.filter(r => {
    const d = numeroSeguro(r.distancia_km);
    return d !== null && d <= 70;
  }).length;

  const acima70 = registros.filter(r => {
    const d = numeroSeguro(r.distancia_km);
    return d !== null && d > 70;
  }).length;

  const potencialAte99 = registros.filter(r => {
    const p = numeroSeguro(r.potencial_cota);
    return p !== null && p <= 99;
  }).length;

  const indicadores = {
    "ead-total": total,
    "ead-ate70": ate70,
    "ead-acima70": acima70,
    "ead-potencial99": potencialAte99
  };

  Object.entries(indicadores).forEach(([id, valor]) => {
    if ($(id)) $(id).textContent = valor.toLocaleString("pt-BR");
  });

  renderizarTabelaEaD(registros);
  atualizarMapaEaD(registros);
}

// ==================================================
// EaD — TABELA
// ==================================================

function renderizarTabelaEaD(registros) {
  const tbody = $("ead-tabela-corpo");
  if (!tbody) return;
  tbody.replaceChildren();

  const ordenados = [...registros].sort((a, b) =>
    String(a.municipio || "").localeCompare(String(b.municipio || ""), "pt-BR")
  );

  const total = ordenados.length;
  const totalPaginas = Math.max(1, Math.ceil(total / EAD_PAGE_SIZE));

  if (eadPaginaAtual > totalPaginas) eadPaginaAtual = totalPaginas;
  if (eadPaginaAtual < 1) eadPaginaAtual = 1;

  if (!total) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "Nenhum município encontrado para os filtros selecionados.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    atualizarPaginacaoEaD(0, 0, 0, 1);
    return;
  }

  const inicio = (eadPaginaAtual - 1) * EAD_PAGE_SIZE;
  const fim = Math.min(inicio + EAD_PAGE_SIZE, total);

  ordenados.slice(inicio, fim).forEach(r => {
    const tr = document.createElement("tr");
    const distancia = numeroSeguro(r.distancia_km);
    const potencial = numeroSeguro(r.potencial_cota);

    const distanciaFormatada = distancia === null
      ? "—"
      : `${distancia.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;

    const potencialFormatado = potencial === null
      ? valorTexto(r.potencial_cota)
      : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

    const atualizado = r.atualizado_em ? formatarDataEaD(r.atualizado_em) : "—";

    [
      r.municipio, r.uf, potencialFormatado, r.ponto_mais_proximo,
      r.uf_ponto, r.tipo_ponto, r.subsede_responsavel, distanciaFormatada,
      r.classificacao_distancia, r.classificacao_potencial, r.status_calculo
    ].forEach(valor => {
      const td = document.createElement("td");
      td.textContent = valorTexto(valor);
      tr.appendChild(td);
    });

    tr.title = `Última atualização: ${atualizado}`;
    tr.style.cursor = "pointer";

    tr.addEventListener("click", () => {
      const filtroMunicipio = $("ead-filtro-municipio");
      if (filtroMunicipio) filtroMunicipio.value = r.municipio || "";
      eadPaginaAtual = 1;
      renderizarAnaliseEaD();

      const painelMapa = $("ead-mapa-painel");
      if (painelMapa) painelMapa.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    tbody.appendChild(tr);
  });

  atualizarPaginacaoEaD(total, inicio + 1, fim, totalPaginas);
}

function formatarDataEaD(value) {
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return String(value);
  return data.toLocaleString("pt-BR");
}

function atualizarPaginacaoEaD(total, primeiro, ultimo, totalPaginas) {
  const info = $("ead-paginacao-info");
  const anterior = $("ead-pagina-anterior");
  const proxima = $("ead-pagina-proxima");

  if (info) {
    info.textContent = total
      ? `Exibindo ${primeiro}–${ultimo} de ${total.toLocaleString("pt-BR")} municípios · Página ${eadPaginaAtual} de ${totalPaginas}`
      : "Nenhum município para exibir.";
  }

  if (anterior) anterior.disabled = eadPaginaAtual <= 1;
  if (proxima) proxima.disabled = eadPaginaAtual >= totalPaginas || total === 0;
}

// ==================================================
// NOVO MÓDULO — CURSOS E PROTOCOLOS EaD
// ==================================================

function mostrarMensagemCursosEaD(message, type = "success") {
  const el = $("ead-cursos-message");
  if (!el) return;
  el.textContent = message;
  el.className = type === "error" ? "message-error" : "message-success";
}

function chaveMunicipioUF(municipio, uf) {
  return `${normalize(municipio)}|${normalize(uf)}`;
}

function dataValidaCursosEaD(value) {
  if (!value) return null;

  // Evita interpretar uma data sem horário como o dia anterior por fuso horário.
  const texto = String(value).trim();
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    const ano = Number(match[1]);
    const mes = Number(match[2]) - 1;
    const dia = Number(match[3]);
    const data = new Date(ano, mes, dia);
    return Number.isNaN(data.getTime()) ? null : data;
  }

  const data = new Date(value);
  return Number.isNaN(data.getTime()) ? null : data;
}

function formatarDataCursosEaD(value) {
  const data = dataValidaCursosEaD(value);
  return data ? data.toLocaleDateString("pt-BR") : "—";
}

function normalizarStatusCursoEaD(registro) {
  const status = normalize(registro.status);
  const validade = dataValidaCursosEaD(registro.data_validade);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  if (
    status.includes("vencido") ||
    status.includes("expirado") ||
    (validade && validade < hoje)
  ) {
    return "Vencido";
  }

  if (status.includes("reprov")) return "Reprovado";
  if (status.includes("pendente")) return "Pendente";
  if (status.includes("analise") || status.includes("em análise")) return "Em análise";
  if (status.includes("aprov") || status.includes("valid") || status === "ativo") return "Aprovado";

  return valorTexto(registro.status, "Não informado");
}

function protocoloEstaAprovadoEaD(registro) {
  return normalize(normalizarStatusCursoEaD(registro)) === "aprovado";
}

function protocoloEstaVencidoEaD(registro) {
  return normalize(normalizarStatusCursoEaD(registro)) === "vencido";
}

function prepararInterfaceCursosEaD() {
  const section = $("ead-section");
  if (!section) return;

  let painel = $("ead-cursos-painel");

  if (!painel) {
    painel = document.createElement("section");
    painel.id = "ead-cursos-painel";
    painel.className = "ead-cursos-painel";
    painel.style.cssText = [
      "margin:24px 0",
      "padding:20px",
      "border:1px solid #d8e5f3",
      "border-radius:16px",
      "background:#fff",
      "box-shadow:0 8px 24px rgba(20,65,110,.07)"
    ].join(";");

    // Insere o módulo depois da tabela geográfica, sem substituir o mapa.
    const tabela = section.querySelector(".ead-tabela");
    if (tabela?.parentElement) {
      tabela.parentElement.insertAdjacentElement("afterend", painel);
    } else {
      section.appendChild(painel);
    }
  }

  if (!$("ead-cursos-conteudo")) {
    painel.replaceChildren();

    const titulo = document.createElement("h3");
    titulo.textContent = "Cursos e Protocolos EaD";
    titulo.style.cssText = "margin:0 0 6px;color:#174a7e;font-size:21px";

    const descricao = document.createElement("p");
    descricao.textContent = "Consulte os protocolos cadastrados, suas validades e os dados geográficos relacionados ao município.";
    descricao.style.cssText = "margin:0 0 18px;color:#60758b;font-size:13px;line-height:1.6";

    const atualizar = document.createElement("button");
    atualizar.type = "button";
    atualizar.id = "ead-cursos-atualizar";
    atualizar.textContent = "Atualizar protocolos";
    atualizar.style.cssText = "border:0;border-radius:8px;background:#174a7e;color:#fff;padding:10px 14px;font-weight:600;cursor:pointer;margin-bottom:16px";

    const mensagem = document.createElement("p");
    mensagem.id = "ead-cursos-message";
    mensagem.setAttribute("role", "status");
    mensagem.style.cssText = "font-size:13px;margin:8px 0 14px;color:#60758b";

    const indicadores = document.createElement("div");
    indicadores.id = "ead-cursos-indicadores";
    indicadores.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px";

    const cards = [
      ["ead-cursos-total", "Total de protocolos"],
      ["ead-cursos-aprovados", "Aprovados / válidos"],
      ["ead-cursos-vencidos", "Protocolos vencidos"],
      ["ead-cursos-municipios", "Municípios cadastrados"]
    ];

    cards.forEach(([id, label]) => {
      const card = document.createElement("article");
      card.style.cssText = "border:1px solid #e0eaf4;border-radius:12px;padding:15px;background:#f7fbff";

      const nome = document.createElement("p");
      nome.textContent = label;
      nome.style.cssText = "font-size:12px;color:#60758b;margin:0 0 8px";

      const valor = document.createElement("strong");
      valor.id = id;
      valor.textContent = "0";
      valor.style.cssText = "font-size:25px;color:#174a7e";

      card.append(nome, valor);
      indicadores.appendChild(card);
    });

    const filtros = document.createElement("div");
    filtros.id = "ead-cursos-filtros";
    filtros.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px";

    const definicoes = [
      ["ead-cursos-filtro-subsede", "Subsede", "Todas as subsedes", "select"],
      ["ead-cursos-filtro-polo", "Polo", "Todos os polos", "select"],
      ["ead-cursos-filtro-municipio", "Município", "Todos os municípios", "select"],
      ["ead-cursos-filtro-curso", "Curso", "Todos os cursos", "select"],
      ["ead-cursos-filtro-status", "Status", "Todos os status", "select"]
    ];

    definicoes.forEach(([id, label, placeholder, tipo]) => {
      const grupo = document.createElement("label");
      grupo.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:#52677d;font-weight:600";

      const texto = document.createElement("span");
      texto.textContent = label;

      const select = document.createElement("select");
      select.id = id;
      select.setAttribute("aria-label", label);
      select.style.cssText = "width:100%;min-width:0;padding:10px;border:1px solid #d5e1ee;border-radius:8px;background:#fff;color:#243b53;font:inherit";

      const opcao = document.createElement("option");
      opcao.value = "";
      opcao.textContent = placeholder;
      select.appendChild(opcao);

      grupo.append(texto, select);
      filtros.appendChild(grupo);
    });

    const tabelaWrapper = document.createElement("div");
    tabelaWrapper.style.cssText = "width:100%;overflow-x:auto;border:1px solid #e0eaf4;border-radius:10px";

    const tabela = document.createElement("table");
    tabela.id = "ead-cursos-tabela";
    tabela.style.cssText = "width:100%;min-width:1450px;border-collapse:collapse;font-size:12px";

    const cabecalho = document.createElement("thead");
    const trCabecalho = document.createElement("tr");
    trCabecalho.style.cssText = "background:#edf4fb;color:#174a7e;text-align:left";

    [
      "Protocolo", "Município / UF", "Curso", "Status",
      "Data do protocolo", "Aprovação", "Validade", "Portaria",
      "CBO", "Faixa etária", "Subsede", "Polos",
      "Potencial de cota", "Distância", "Classificação da distância",
      "Subsede responsável"
    ].forEach(texto => {
      const th = document.createElement("th");
      th.textContent = texto;
      th.style.cssText = "padding:12px 10px;border-bottom:1px solid #d5e1ee;white-space:nowrap";
      trCabecalho.appendChild(th);
    });

    cabecalho.appendChild(trCabecalho);

    const tbody = document.createElement("tbody");
    tbody.id = "ead-cursos-tabela-corpo";

    tabela.append(cabecalho, tbody);
    tabelaWrapper.appendChild(tabela);

    const paginacao = document.createElement("div");
    paginacao.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px";

    const info = document.createElement("span");
    info.id = "ead-cursos-paginacao-info";
    info.textContent = "Nenhum protocolo para exibir.";
    info.style.cssText = "font-size:12px;color:#60758b";

    const botoes = document.createElement("div");
    botoes.style.cssText = "display:flex;gap:8px";

    const anterior = document.createElement("button");
    anterior.id = "ead-cursos-pagina-anterior";
    anterior.type = "button";
    anterior.textContent = "Anterior";
    anterior.disabled = true;

    const proxima = document.createElement("button");
    proxima.id = "ead-cursos-pagina-proxima";
    proxima.type = "button";
    proxima.textContent = "Próxima";
    proxima.disabled = true;

    [anterior, proxima].forEach(botao => {
      botao.style.cssText = "border:1px solid #c6dbef;border-radius:8px;background:#fff;color:#174a7e;padding:8px 12px;cursor:pointer";
    });

    botoes.append(anterior, proxima);
    paginacao.append(info, botoes);

    const conteudo = document.createElement("div");
    conteudo.id = "ead-cursos-conteudo";
    conteudo.append(mensagem, indicadores, filtros, tabelaWrapper, paginacao);

    painel.append(titulo, descricao, atualizar, conteudo);
  }

  // Os eventos são registrados apenas uma vez por elemento.
  const botaoAtualizar = $("ead-cursos-atualizar");
  if (botaoAtualizar && !botaoAtualizar.dataset.eventoConfigurado) {
    botaoAtualizar.dataset.eventoConfigurado = "true";
    botaoAtualizar.addEventListener("click", async () => {
      setLoading(botaoAtualizar, true, "Atualizando...");
      try {
        await carregarCursosProtocolosEaD();
      } catch (error) {
        mostrarMensagemCursosEaD(friendlyError(error), "error");
      } finally {
        setLoading(botaoAtualizar, false);
      }
    });
  }

  [
    "ead-cursos-filtro-subsede",
    "ead-cursos-filtro-polo",
    "ead-cursos-filtro-municipio",
    "ead-cursos-filtro-curso",
    "ead-cursos-filtro-status"
  ].forEach(id => {
    const elemento = $(id);
    if (elemento && !elemento.dataset.eventoConfigurado) {
      elemento.dataset.eventoConfigurado = "true";
      elemento.addEventListener("change", () => {
        eadCursosPaginaAtual = 1;
        renderizarCursosProtocolosEaD();
      });
    }
  });

  const anterior = $("ead-cursos-pagina-anterior");
  if (anterior && !anterior.dataset.eventoConfigurado) {
    anterior.dataset.eventoConfigurado = "true";
    anterior.addEventListener("click", () => {
      if (eadCursosPaginaAtual > 1) {
        eadCursosPaginaAtual--;
        renderizarCursosProtocolosEaD();
      }
    });
  }

  const proxima = $("ead-cursos-pagina-proxima");
  if (proxima && !proxima.dataset.eventoConfigurado) {
    proxima.dataset.eventoConfigurado = "true";
    proxima.addEventListener("click", () => {
      const totalPaginas = Math.max(
        1,
        Math.ceil(obterCursosProtocolosFiltradosEaD().length / EAD_CURSOS_PAGE_SIZE)
      );

      if (eadCursosPaginaAtual < totalPaginas) {
        eadCursosPaginaAtual++;
        renderizarCursosProtocolosEaD();
      }
    });
  }
}

async function carregarCursosProtocolosEaD() {
  if (!sb || !currentUser || !currentProfile || eadCursosCarregando) return;

  eadCursosCarregando = true;
  mostrarMensagemCursosEaD("Carregando cursos e protocolos EaD...");

  try {
    const registros = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await sb
        .from(EAD_CURSOS_TABLE)
        .select(EAD_CURSOS_FIELDS.join(","))
        .order("municipio")
        .range(offset, offset + pageSize - 1);

      if (error) throw error;

      const pagina = data || [];
      registros.push(...pagina);

      if (pagina.length < pageSize) break;
      offset += pageSize;
    }

    eadCursosRegistros = registros;
    eadCursosPaginaAtual = 1;
    preencherFiltrosCursosEaD();
    renderizarCursosProtocolosEaD();

    mostrarMensagemCursosEaD(
      `${eadCursosRegistros.length.toLocaleString("pt-BR")} protocolos carregados.`
    );
  } catch (error) {
    // O erro deste módulo não deve interromper o mapa nem a análise geográfica.
    console.error("Erro ao carregar cursos e protocolos EaD:", error);
    mostrarMensagemCursosEaD(
      `Não foi possível carregar os protocolos: ${friendlyError(error)}`,
      "error"
    );
  } finally {
    eadCursosCarregando = false;
  }
}

function preencherFiltrosCursosEaD() {
  preencherSelectDinamico({
    id: "ead-cursos-filtro-subsede",
    values: eadCursosRegistros.map(r => r.subsede),
    placeholder: "Todas as subsedes"
  });

  const polos = eadCursosRegistros.flatMap(r =>
    String(r.polos ?? "")
      .split(/[;,|\n]/)
      .map(p => p.trim())
      .filter(Boolean)
  );

  preencherSelectDinamico({
    id: "ead-cursos-filtro-polo",
    values: polos,
    placeholder: "Todos os polos"
  });

  preencherSelectDinamico({
    id: "ead-cursos-filtro-municipio",
    values: eadCursosRegistros.map(r => r.municipio),
    placeholder: "Todos os municípios"
  });

  preencherSelectDinamico({
    id: "ead-cursos-filtro-curso",
    values: eadCursosRegistros.map(r => r.curso),
    placeholder: "Todos os cursos"
  });

  preencherSelectDinamico({
    id: "ead-cursos-filtro-status",
    values: eadCursosRegistros.map(normalizarStatusCursoEaD),
    placeholder: "Todos os status"
  });
}

function obterRegistrosCursosProtocolosFiltradosEaD() {
  return obterCursosProtocolosFiltradosEaD();
}

function obterCursosProtocolosFiltradosEaD() {
  const subsede = normalize($("ead-cursos-filtro-subsede")?.value || "");
  const polo = normalize($("ead-cursos-filtro-polo")?.value || "");
  const municipio = normalize($("ead-cursos-filtro-municipio")?.value || "");
  const curso = normalize($("ead-cursos-filtro-curso")?.value || "");
  const status = normalize($("ead-cursos-filtro-status")?.value || "");

  return eadCursosRegistros.filter(r => {
    const polosRegistro = normalize(r.polos || "");
    const statusRegistro = normalize(normalizarStatusCursoEaD(r));

    return (!subsede || normalize(r.subsede) === subsede) &&
      (!polo || polosRegistro.split(/[;,|\n]/).some(p => normalize(p) === polo)) &&
      (!municipio || normalize(r.municipio) === municipio) &&
      (!curso || normalize(r.curso) === curso) &&
      (!status || statusRegistro === status);
  });
}

function criarCelulaCursoEaD(valor, titulo = "") {
  const td = document.createElement("td");
  td.textContent = valorTexto(valor);
  td.style.cssText = "padding:10px;border-bottom:1px solid #e7eef5;vertical-align:top";
  if (titulo) td.title = titulo;
  return td;
}

function renderizarCursosProtocolosEaD() {
  const tbody = $("ead-cursos-tabela-corpo");
  if (!tbody) return;

  const registros = obterCursosProtocolosFiltradosEaD();
  const total = registros.length;
  const totalPaginas = Math.max(1, Math.ceil(total / EAD_CURSOS_PAGE_SIZE));

  if (eadCursosPaginaAtual > totalPaginas) eadCursosPaginaAtual = totalPaginas;
  if (eadCursosPaginaAtual < 1) eadCursosPaginaAtual = 1;

  // Relaciona por município + UF, evitando cruzar municípios homônimos.
  const mapaGeografico = new Map();

  eadRegistros.forEach(r => {
    const chave = chaveMunicipioUF(r.municipio, r.uf);
    if (chave !== "|") mapaGeografico.set(chave, r);
  });

  const aprovados = eadCursosRegistros.filter(protocoloEstaAprovadoEaD).length;
  const vencidos = eadCursosRegistros.filter(protocoloEstaVencidoEaD).length;
  const municipios = new Set(
    eadCursosRegistros
      .map(r => chaveMunicipioUF(r.municipio, r.uf))
      .filter(chave => chave !== "|")
  ).size;

  const indicadores = {
    "ead-cursos-total": eadCursosRegistros.length,
    "ead-cursos-aprovados": aprovados,
    "ead-cursos-vencidos": vencidos,
    "ead-cursos-municipios": municipios
  };

  Object.entries(indicadores).forEach(([id, valor]) => {
    if ($(id)) $(id).textContent = Number(valor).toLocaleString("pt-BR");
  });

  tbody.replaceChildren();

  if (!total) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 16;
    td.textContent = "Nenhum protocolo encontrado para os filtros selecionados.";
    td.style.cssText = "padding:18px;text-align:center;color:#60758b";
    tr.appendChild(td);
    tbody.appendChild(tr);
    atualizarPaginacaoCursosEaD(0, 0, 0, 1);
    return;
  }

  const inicio = (eadCursosPaginaAtual - 1) * EAD_CURSOS_PAGE_SIZE;
  const fim = Math.min(inicio + EAD_CURSOS_PAGE_SIZE, total);

  registros.slice(inicio, fim).forEach(r => {
    const tr = document.createElement("tr");
    const geo = mapaGeografico.get(chaveMunicipioUF(r.municipio, r.uf));
    const distancia = geo ? numeroSeguro(geo.distancia_km) : null;
    const potencial = geo ? numeroSeguro(geo.potencial_cota) : null;

    const distanciaTexto = distancia === null
      ? "Sem correspondência geográfica"
      : `${distancia.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;

    const potencialTexto = potencial === null
      ? "—"
      : potencial.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

    const status = normalizarStatusCursoEaD(r);
    const statusCell = criarCelulaCursoEaD(status);

    statusCell.style.fontWeight = "700";
    if (status === "Aprovado") statusCell.style.color = "#16835b";
    else if (status === "Vencido" || status === "Reprovado") statusCell.style.color = "#c94c4c";
    else statusCell.style.color = "#9a6700";

    const valores = [
      r.protocolo,
      `${valorTexto(r.municipio)} / ${valorTexto(r.uf)}`,
      r.curso,
      null,
      formatarDataCursosEaD(r.data_protocolo),
      formatarDataCursosEaD(r.data_aprovacao),
      formatarDataCursosEaD(r.data_validade),
      r.portaria,
      r.cbo,
      r.faixa_etaria,
      r.subsede,
      r.polos,
      potencialTexto,
      distanciaTexto,
      geo?.classificacao_distancia || "Sem correspondência geográfica",
      geo?.subsede_responsavel || "Sem correspondência geográfica"
    ];

    valores.forEach((valor, index) => {
      if (index === 3) tr.appendChild(statusCell);
      else tr.appendChild(criarCelulaCursoEaD(valor));
    });

    if (geo) {
      tr.title = `Dados geográficos do município: ${valorTexto(geo.municipio)} - ${valorTexto(geo.uf)}. Distância registrada: ${distanciaTexto}.`;
    } else {
      tr.title = "Não foi encontrado município com a mesma combinação de município e UF na análise geográfica.";
    }

    tbody.appendChild(tr);
  });

  atualizarPaginacaoCursosEaD(total, inicio + 1, fim, totalPaginas);
}

function atualizarPaginacaoCursosEaD(total, primeiro, ultimo, totalPaginas) {
  const info = $("ead-cursos-paginacao-info");
  const anterior = $("ead-cursos-pagina-anterior");
  const proxima = $("ead-cursos-pagina-proxima");

  if (info) {
    info.textContent = total
      ? `Exibindo ${primeiro}–${ultimo} de ${total.toLocaleString("pt-BR")} protocolos · Página ${eadCursosPaginaAtual} de ${totalPaginas}`
      : "Nenhum protocolo para exibir.";
  }

  if (anterior) anterior.disabled = eadCursosPaginaAtual <= 1;
  if (proxima) proxima.disabled = eadCursosPaginaAtual >= totalPaginas || total === 0;
}
