
"use strict";

const sb = window.sb;
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

// ==================================================
// BI DE SUBSTITUIÇÕES — ESTADO
// ==================================================

const SUB_VIEW = "vw_substituicoes_bi";

const SUB_FIELDS = [
  "id",
  "subsede",
  "cidade",
  "jovem",
  "empresa",
  "motivo",
  "jovem_substituto",
  "mes_da_substituicao",
  "dentro_do_prazo",
  "faixa_de_atraso",
  "prioridade",
  "inicio_fechamento",
  "fim_fechamento",
  "mes_fechamento",
  "ano_fechamento",
  "fechamento_da_substituicao",
  "dias_pendentes",
  "dias_em_aberto",
  "substituido_em_outro_fechamento",
  "ultima_atualizacao"
];

let subRegistros = [];
let subGraficos = {};
let subInicializado = false;

// ==================================================
// MENSAGENS E FUNÇÕES AUXILIARES
// ==================================================

function showMessage(id, message, type = "error") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className =
    type === "success" ? "message-success" : "message-error";
}

function clearMessage(id) {
  const element = $(id);

  if (element) {
    element.textContent = "";
    element.className = "";
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
    button.textContent =
      button.dataset.originalText || button.textContent;

    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function friendlyError(error) {
  const message = error?.message || "";

  if (/invalid login credentials/i.test(message)) {
    return "E-mail ou senha incorretos.";
  }

  if (/email not confirmed/i.test(message)) {
    return "Seu e-mail ainda não foi confirmado.";
  }

  if (/failed to fetch|networkerror/i.test(message)) {
    return "Não foi possível conectar. Confira a internet e a configuração do Supabase.";
  }

  if (/permission denied|row-level security|42501/i.test(message)) {
    return "Acesso negado. Confira as políticas de acesso do Supabase.";
  }

  return message || "Ocorreu um erro inesperado.";
}

function isSafeDashboardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function valorTexto(value, fallback = "—") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }

  return String(value).trim();
}

function numeroSeguro(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const result = Number(String(value).replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

function valorVerdadeiro(value) {
  const text = normalize(value);

  if (!text) return false;

  return ![
    "nao",
    "false",
    "0",
    "nenhum",
    "nenhuma",
    "nao substituido",
    "nao realizada",
    "pendente",
    "null"
  ].includes(text);
}

// ==================================================
// INICIALIZAÇÃO E SESSÃO
// ==================================================

if (!sb) {
  showMessage(
    "login-message",
    "O Supabase não foi configurado. Confira o arquivo config.js."
  );
} else {
  iniciarPortal();
}

async function iniciarPortal() {
  try {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session) {
      await atualizarPortal();
    } else {
      mostrarLogin();
    }
  } catch (error) {
    console.error("Erro ao iniciar portal:", error);
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

      destruirGraficosSubstituicoes();
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  const loginSection = $("login-section");
  const portalSection = $("portal-section");
  const adminSection = $("admin-section");
  const adminNavLink = $("admin-nav-link");
  const userEmail = $("user-email");

  if (loginSection) loginSection.hidden = false;
  if (portalSection) portalSection.hidden = true;
  if (adminSection) adminSection.hidden = true;
  if (adminNavLink) adminNavLink.hidden = true;
  if (userEmail) userEmail.textContent = "";

  const subSection = $("substituicoes-section");
  const subNavLink = $("substituicoes-nav-link");

  if (subSection) subSection.hidden = true;
  if (subNavLink) subNavLink.hidden = true;
}

function mostrarPortal() {
  const loginSection = $("login-section");
  const portalSection = $("portal-section");
  const userEmail = $("user-email");

  if (loginSection) loginSection.hidden = true;
  if (portalSection) portalSection.hidden = false;

  if (userEmail) {
    userEmail.textContent = currentUser?.email || "";
  }
}

// ==================================================
// LOGIN
// ==================================================

const loginForm = $("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("login-message");

    const button = event.submitter;
    setLoading(button, true, "Entrando...");

    try {
      const email = $("email")?.value.trim();
      const password = $("password")?.value;

      if (!email || !password) {
        throw new Error("Informe seu e-mail e sua senha.");
      }

      const { error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await atualizarPortal();
    } catch (error) {
      console.error("Erro no login:", error);
      showMessage("login-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// SAIR
// ==================================================

const logoutButton = $("logout-btn");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signOut();

      if (error) throw error;

      mostrarLogin();
    } catch (error) {
      console.error("Erro ao sair:", error);
      showMessage("dashboard-message", friendlyError(error));
    }
  });
}

// ==================================================
// ATUALIZAR PORTAL E PERFIL
// ==================================================

async function atualizarPortal() {
  try {
    const {
      data: { user },
      error: userError
    } = await sb.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      mostrarLogin();
      return;
    }

    currentUser = user;

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      throw new Error(
        "Seu perfil não foi encontrado. Peça ao administrador para verificar a tabela profiles."
      );
    }

    currentProfile = profile;

    mostrarPortal();

    const isAdmin = profile.role === "admin";

    if ($("admin-section")) {
      $("admin-section").hidden = !isAdmin;
    }

    if ($("admin-nav-link")) {
      $("admin-nav-link").hidden = !isAdmin;
    }

    await carregarDashboards();

    if (isAdmin) {
      await carregarAdministracao();
    }
  } catch (error) {
    console.error("Erro ao atualizar portal:", error);
    showMessage("dashboard-message", friendlyError(error));
  }
}

// ==================================================
// CARREGAR DASHBOARDS
// A POLÍTICA RLS PRECISA FILTRAR OS ACESSOS
// ==================================================

async function carregarDashboards() {
  clearMessage("dashboard-message");

  const grid = $("dashboard-grid");

  if (!grid) {
    console.error("Elemento dashboard-grid não encontrado.");
    return;
  }

  grid.replaceChildren();

  const { data, error } = await sb
    .from("dashboards")
    .select("id, name, description, category, url")
    .order("name");

  if (error) throw error;

  allDashboards = data || [];

  if (!allDashboards.length) {
    showMessage(
      "dashboard-message",
      "Nenhum dashboard foi liberado para sua conta.",
      "success"
    );

    atualizarResumo();
    atualizarListaAdministrativa();
    configurarAcessoSubstituicoes();
    return;
  }

  allDashboards.forEach(dashboard => {
    const card = document.createElement("article");
    card.className = "dashboard-card";

    const title = document.createElement("h3");
    title.textContent = dashboard.name || "Dashboard sem nome";

    const description = document.createElement("p");
    description.textContent = dashboard.description || "";

    const category = document.createElement("p");
    category.className = "card-category";
    category.dataset.category = dashboard.category || "outros";
    category.textContent =
      "Categoria: " + (dashboard.category || "Outros");

    card.append(title, description, category);

    if (isSafeDashboardUrl(dashboard.url)) {
      const link = document.createElement("a");

      link.href = dashboard.url;
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

  atualizarResumo();
  aplicarFiltrosDashboards();
  renderizarDashboardsAdministrativos();

  configurarAcessoSubstituicoes();
}

// ==================================================
// BUSCA, FILTRO E RESUMO
// ==================================================

function atualizarResumo() {
  const summaryTotal = $("summary-total");
  const summaryCategories = $("summary-categories");

  if (summaryTotal) {
    summaryTotal.textContent = String(allDashboards.length);
  }

  const categories = new Set(
    allDashboards.map(d => normalize(d.category || "outros"))
  );

  if (summaryCategories) {
    summaryCategories.textContent = String(categories.size);
  }
}

function aplicarFiltrosDashboards() {
  const grid = $("dashboard-grid");
  if (!grid) return;

  const term = normalize($("dashboard-search")?.value || "");
  const selectedCategory = normalize($("category-filter")?.value || "");

  const cards = [...grid.querySelectorAll(".dashboard-card")];
  let visible = 0;

  cards.forEach(card => {
    const category = normalize(
      card.querySelector(".card-category")?.dataset.category
    );

    const matchesSearch = normalize(card.innerText).includes(term);

    const matchesCategory =
      !selectedCategory || category === selectedCategory;

    const show = matchesSearch && matchesCategory;
    card.hidden = !show;

    if (show) visible++;
  });

  const filterEmpty = $("filter-empty");

  if (filterEmpty) {
    filterEmpty.hidden = visible > 0 || cards.length === 0;
  }
}

const searchInput = $("dashboard-search");
const categoryFilter = $("category-filter");

if (searchInput) {
  searchInput.addEventListener("input", aplicarFiltrosDashboards);
}

if (categoryFilter) {
  categoryFilter.addEventListener("change", aplicarFiltrosDashboards);
}

// ==================================================
// CHAMAR EDGE FUNCTION portal-admin
// ==================================================

async function adminCall(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("portal-admin", {
    body: {
      action,
      ...payload
    }
  });

  if (error) {
    console.error("Erro na função portal-admin:", error);

    throw new Error(
      "Não foi possível executar a operação administrativa. Confira a publicação da função e o perfil da sua conta."
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

// ==================================================
// ADMINISTRAÇÃO
// ==================================================

async function carregarAdministracao() {
  try {
    const result = await adminCall("list_users");

    adminUsers = result.users || [];

    preencherListaUsuarios();
    renderizarDashboardsAdministrativos();
  } catch (error) {
    console.error("Erro ao carregar administração:", error);
    showMessage("permission-message", friendlyError(error));
  }
}

function preencherListaUsuarios() {
  const select = $("permission-user");
  if (!select) return;

  const previousValue = select.value;
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecione um usuário";
  select.appendChild(placeholder);

  adminUsers.forEach(user => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent =
      `${user.email || "Sem e-mail"} — ${user.role || "user"}`;

    select.appendChild(option);
  });

  if (adminUsers.some(user => user.id === previousValue)) {
    select.value = previousValue;
  }

  if (select.value) {
    carregarPermissoesUsuario();
  } else {
    clearMessage("permission-message");

    const container = $("permission-dashboard-list");
    if (container) container.replaceChildren();
  }
}

// ==================================================
// CRIAR USUÁRIO
// ==================================================

const userCreateForm = $("user-create-form");

if (userCreateForm) {
  userCreateForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("user-create-message");

    const button = event.submitter;
    setLoading(button, true, "Criando usuário...");

    try {
      const email = $("new-user-email")?.value.trim();
      const password = $("new-user-password")?.value;
      const role = $("new-user-role")?.value;

      if (!email || !password || !role) {
        throw new Error("Preencha todos os campos do usuário.");
      }

      await adminCall("create_user", { email, password, role });

      userCreateForm.reset();

      showMessage(
        "user-create-message",
        "Usuário criado com sucesso!",
        "success"
      );

      await carregarAdministracao();
    } catch (error) {
      console.error("Erro ao criar usuário:", error);
      showMessage("user-create-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// PERMISSÕES
// ==================================================

const permissionUserSelect = $("permission-user");

if (permissionUserSelect) {
  permissionUserSelect.addEventListener(
    "change",
    carregarPermissoesUsuario
  );
}

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");

  const userId = $("permission-user")?.value;
  const container = $("permission-dashboard-list");

  if (!container) return;

  container.replaceChildren();
  if (!userId) return;

  const selectedUser = adminUsers.find(user => user.id === userId);
  if (!selectedUser) return;

  if (selectedUser.role === "admin") {
    showMessage(
      "permission-message",
      "Administradores possuem acesso a todos os dashboards.",
      "success"
    );
    return;
  }

  try {
    const { data, error } = await sb
      .from("dashboard_permissions")
      .select("dashboard_id")
      .eq("user_id", userId);

    if (error) throw error;

    const permittedIds = new Set(
      (data || []).map(item => item.dashboard_id)
    );

    // Consulta o catálogo para preencher a lista de permissões.
    const {
      data: dashboards,
      error: dashboardsError
    } = await sb
      .from("dashboards")
      .select("id, name, description, category, url")
      .order("name");

    if (dashboardsError) throw dashboardsError;

    // A consulta de permissões precisa conseguir listar o catálogo
    // completo para que o administrador possa conceder acessos.
    allDashboards = dashboards || [];

    if (!allDashboards.length) {
      showMessage(
        "permission-message",
        "Cadastre pelo menos um dashboard antes de configurar acessos."
      );
      return;
    }

    allDashboards.forEach(dashboard => {
      const label = document.createElement("label");
      label.className = "permission-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = dashboard.id;
      checkbox.checked = permittedIds.has(dashboard.id);

      const text = document.createElement("span");
      text.textContent = dashboard.name || "Dashboard sem nome";

      label.append(checkbox, text);
      container.appendChild(label);
    });
  } catch (error) {
    console.error("Erro ao carregar permissões:", error);
    showMessage("permission-message", friendlyError(error));
  }
}

const savePermissionsButton = $("save-permissions-btn");

if (savePermissionsButton) {
  savePermissionsButton.addEventListener("click", async () => {
    clearMessage("permission-message");

    const userId = $("permission-user")?.value;

    if (!userId) {
      showMessage("permission-message", "Selecione um usuário primeiro.");
      return;
    }

    const selectedUser = adminUsers.find(user => user.id === userId);

    if (!selectedUser) {
      showMessage("permission-message", "Usuário inválido.");
      return;
    }

    if (selectedUser.role === "admin") {
      showMessage(
        "permission-message",
        "Administradores já possuem acesso a todos os dashboards."
      );
      return;
    }

    const button = $("save-permissions-btn");
    setLoading(button, true, "Salvando...");

    try {
      const dashboardIds = Array.from(
        $("permission-dashboard-list").querySelectorAll(
          'input[type="checkbox"]:checked'
        )
      ).map(checkbox => checkbox.value);

      await adminCall("set_permissions", {
        user_id: userId,
        dashboard_ids: dashboardIds
      });

      showMessage(
        "permission-message",
        "Permissões salvas com sucesso!",
        "success"
      );
    } catch (error) {
      console.error("Erro ao salvar permissões:", error);
      showMessage("permission-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// LISTA ADMINISTRATIVA DE DASHBOARDS
// ==================================================

function atualizarListaAdministrativa() {
  renderizarDashboardsAdministrativos();
}

function renderizarDashboardsAdministrativos() {
  const container = $("admin-dashboard-list");
  if (!container) return;

  container.replaceChildren();

  allDashboards.forEach(dashboard => {
    const item = document.createElement("article");
    item.className = "admin-dashboard-item";

    const title = document.createElement("strong");
    title.textContent = dashboard.name || "Dashboard sem nome";

    const description = document.createElement("p");
    description.textContent =
      `${dashboard.category || "outros"} — ID: ${dashboard.id}`;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Editar";

    editButton.addEventListener("click", () => {
      preencherFormularioDashboard(dashboard);
    });

    item.append(title, description, editButton);
    container.appendChild(item);
  });

  if (!allDashboards.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum dashboard cadastrado.";
    container.appendChild(empty);
  }
}

function preencherFormularioDashboard(dashboard) {
  $("dashboard-id").value = dashboard.id;
  $("dashboard-name").value = dashboard.name;
  $("dashboard-description").value = dashboard.description || "";
  $("dashboard-category").value = dashboard.category || "outros";
  $("dashboard-url").value = dashboard.url || "";

  $("dashboard-form").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ==================================================
// CADASTRAR OU ATUALIZAR DASHBOARD
// ==================================================

const dashboardForm = $("dashboard-form");

if (dashboardForm) {
  dashboardForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("dashboard-form-message");

    const button = event.submitter;
    setLoading(button, true, "Salvando...");

    try {
      const dashboard = {
        id: $("dashboard-id").value.trim(),
        name: $("dashboard-name").value.trim(),
        description: $("dashboard-description").value.trim(),
        category: $("dashboard-category").value,
        url: $("dashboard-url").value.trim()
      };

      if (
        !dashboard.id ||
        !dashboard.name ||
        !dashboard.description ||
        !isSafeDashboardUrl(dashboard.url)
      ) {
        throw new Error(
          "Preencha todos os campos e informe uma URL válida."
        );
      }

      const { error } = await sb
        .from("dashboards")
        .upsert(dashboard, { onConflict: "id" });

      if (error) throw error;

      showMessage(
        "dashboard-form-message",
        "Dashboard salvo com sucesso!",
        "success"
      );

      dashboardForm.reset();

      await carregarDashboards();

      if (currentProfile?.role === "admin") {
        await carregarAdministracao();
      }
    } catch (error) {
      console.error("Erro ao salvar dashboard:", error);
      showMessage("dashboard-form-message", friendlyError(error));
    } finally {
      setLoading(button, false);
    }
  });
}

// ==================================================
// BI DE SUBSTITUIÇÕES — CONTROLE DE ACESSO NA INTERFACE
// ==================================================

function dashboardEhSubstituicoes(dashboard) {
  const nome = normalize(dashboard?.name);
  const id = normalize(dashboard?.id);

  return (
    nome.includes("bi de substituicoes") ||
    nome.includes("bi substituicoes") ||
    id === "bi_substituicoes" ||
    id === "bi-substituicoes"
  );
}

function configurarAcessoSubstituicoes() {
  const section = $("substituicoes-section");
  const navLink = $("substituicoes-nav-link");

  if (!section || !navLink) return;

  // Administradores podem ver o BI pela interface.
  // Para usuários comuns, é necessário haver um dashboard
  // de Substituições entre os dashboards liberados à conta.
  const isAdmin = currentProfile?.role === "admin";

  const hasPermission = isAdmin ||
    allDashboards.some(dashboardEhSubstituicoes);

  section.hidden = !hasPermission;
  navLink.hidden = !hasPermission;

  if (hasPermission && !subInicializado) {
    subInicializado = true;
    prepararInterfaceSubstituicoes();

    carregarSubstituicoes().catch(error => {
      console.error("Erro ao carregar BI de Substituições:", error);
      mostrarErroSubstituicoes(friendlyError(error));
    });
  }
}

function prepararInterfaceSubstituicoes() {
  const botao = $("substituicoes-atualizar");

  if (botao) {
    botao.addEventListener("click", async () => {
      setLoading(botao, true, "Atualizando...");

      try {
        await carregarSubstituicoes();
      } catch (error) {
        console.error(error);
        mostrarErroSubstituicoes(friendlyError(error));
      } finally {
        setLoading(botao, false);
      }
    });
  }

  [
    "sub-filtro-subsede",
    "sub-filtro-ano",
    "sub-filtro-situacao"
  ].forEach(id => {
    const element = $(id);
    if (element) element.addEventListener("change", renderizarBISelecionado);
  });
}

function mostrarErroSubstituicoes(message) {
  const element = $("substituicoes-message");
  if (!element) return;

  element.textContent = message;
  element.className = "message-error";
}

// ==================================================
// BUSCAR DADOS DA VIEW SUPABASE
// PAGINA OS RESULTADOS PARA NÃO PARAR EM 1.000 LINHAS
// ==================================================

async function carregarSubstituicoes() {
  if (!sb || !currentUser || !currentProfile) return;

  const message = $("substituicoes-message");
  if (message) {
    message.textContent = "Carregando dados de substituições...";
    message.className = "";
  }

  const acumulado = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from(SUB_VIEW)
      .select(SUB_FIELDS.join(","))
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = data || [];
    acumulado.push(...page);

    if (page.length < pageSize) break;

    offset += pageSize;
  }

  subRegistros = acumulado.map(normalizarRegistroSubstituicao);

  preencherFiltrosSubstituicoes();

  if (message) {
    message.textContent =
      `${subRegistros.length.toLocaleString("pt-BR")} registros carregados.`;
    message.className = "message-success";
  }

  renderizarBISelecionado();
}

function normalizarRegistroSubstituicao(row) {
  const diasPendentes = numeroSeguro(row.dias_pendentes);
  const diasEmAberto = numeroSeguro(row.dias_em_aberto);

  const temSubstituto = Boolean(
    String(row.jovem_substituto || "").trim()
  );

  const outroFechamento = valorVerdadeiro(
    row.substituido_em_outro_fechamento
  );

  const fechamentoSubstituicao = normalize(
    row.fechamento_da_substituicao
  );

  const temFechamentoSubstituicao =
    fechamentoSubstituicao !== "" &&
    ![
      "nao",
      "false",
      "0",
      "pendente",
      "nao substituido",
      "nao realizada"
    ].includes(fechamentoSubstituicao);

  const realizada =
    temSubstituto || outroFechamento || temFechamentoSubstituicao;

  const prazoTexto = normalize(row.dentro_do_prazo);
  const faixaTexto = normalize(row.faixa_de_atraso);
  const prioridadeTexto = normalize(row.prioridade);

  const sinalAtraso =
    faixaTexto.includes("atras") ||
    prioridadeTexto.includes("atras") ||
    prazoTexto === "nao" ||
    prazoTexto === "fora do prazo";

  // Critério provisório para pendências:
  // atrasada se o campo de prazo ou os dias indicarem atraso.
  // O valor final deve seguir a regra de negócio da base.
  const diasAtraso =
    (diasPendentes !== null && diasPendentes > 30) ||
    (diasEmAberto !== null && diasEmAberto > 30);

  const atrasada = !realizada && (sinalAtraso || diasAtraso);

  return {
    ...row,
    _realizada: realizada,
    _atrasada: atrasada,
    _situacao: realizada
      ? "realizada"
      : atrasada
        ? "atrasada"
        : "pendente",
    _dias: diasPendentes ?? diasEmAberto,
    _mes: valorTexto(row.mes_fechamento, valorTexto(row.mes_ano_desligamento, "Sem mês")),
    _ano: valorTexto(row.ano_fechamento, "Sem ano")
  };
}

// ==================================================
// FILTROS
// ==================================================

function preencherFiltrosSubstituicoes() {
  const subsedeSelect = $("sub-filtro-subsede");
  const anoSelect = $("sub-filtro-ano");

  if (subsedeSelect) {
    const current = subsedeSelect.value;
    const values = [...new Set(
      subRegistros
        .map(row => String(row.subsede || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));

    subsedeSelect.replaceChildren();

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todas as subsedes";
    subsedeSelect.appendChild(all);

    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      subsedeSelect.appendChild(option);
    });

    if (values.includes(current)) subsedeSelect.value = current;
  }

  if (anoSelect) {
    const current = anoSelect.value;
    const values = [...new Set(
      subRegistros
        .map(row => String(row.ano_fechamento || "").trim())
        .filter(Boolean)
    )].sort((a, b) => b.localeCompare(a, "pt-BR", { numeric: true }));

    anoSelect.replaceChildren();

    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todos os anos";
    anoSelect.appendChild(all);

    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      anoSelect.appendChild(option);
    });

    if (values.includes(current)) anoSelect.value = current;
  }
}

function obterRegistrosFiltrados() {
  const subsede = $("sub-filtro-subsede")?.value || "";
  const ano = $("sub-filtro-ano")?.value || "";
  const situacao = $("sub-filtro-situacao")?.value || "";

  return subRegistros.filter(row => {
    if (subsede && String(row.subsede || "") !== subsede) return false;
    if (ano && String(row.ano_fechamento || "") !== ano) return false;
    if (situacao && row._situacao !== situacao) return false;
    return true;
  });
}

function renderizarBISelecionado() {
  const rows = obterRegistrosFiltrados();

  atualizarIndicadoresSubstituicoes(rows);
  renderizarGraficosSubstituicoes(rows);
  renderizarTabelaSubstituicoes(rows);
}

// ==================================================
// INDICADORES
// ==================================================

function atualizarIndicadoresSubstituicoes(rows) {
  const realizadas = rows.filter(row => row._situacao === "realizada").length;
  const pendentes = rows.filter(row => row._situacao === "pendente").length;
  const atrasadas = rows.filter(row => row._situacao === "atrasada").length;

  if ($("sub-total")) {
    $("sub-total").textContent = rows.length.toLocaleString("pt-BR");
  }

  if ($("sub-realizadas")) {
    $("sub-realizadas").textContent = realizadas.toLocaleString("pt-BR");
  }

  if ($("sub-pendentes")) {
    $("sub-pendentes").textContent = pendentes.toLocaleString("pt-BR");
  }

  if ($("sub-atrasadas")) {
    $("sub-atrasadas").textContent = atrasadas.toLocaleString("pt-BR");
  }
}

// ==================================================
// GRÁFICOS CHART.JS
// ==================================================

function destruirGraficosSubstituicoes() {
  Object.values(subGraficos).forEach(chart => {
    if (chart && typeof chart.destroy === "function") {
      chart.destroy();
    }
  });

  subGraficos = {};
}

function criarGraficoSubstituicoes(id, config) {
  const canvas = $(id);

  if (!canvas || typeof Chart === "undefined") {
    console.warn("Chart.js ou canvas não encontrado:", id);
    return;
  }

  if (subGraficos[id]) {
    subGraficos[id].destroy();
  }

  subGraficos[id] = new Chart(canvas, config);
}

function agruparContagem(rows, keyFn) {
  const counts = new Map();

  rows.forEach(row => {
    const label = String(keyFn(row) || "Não informado").trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderizarGraficosSubstituicoes(rows) {
  if (typeof Chart === "undefined") {
    mostrarErroSubstituicoes(
      "A biblioteca Chart.js não carregou. Confira sua conexão com a internet."
    );
    return;
  }

  const meses = agruparContagem(rows, row => row._mes);

  const mensalRealizada = [];
  const mensalPendente = [];
  const mensalAtrasada = [];

  meses.forEach(([mes]) => {
    const mesRows = rows.filter(row => row._mes === mes);

    mensalRealizada.push(
      mesRows.filter(row => row._situacao === "realizada").length
    );
    mensalPendente.push(
      mesRows.filter(row => row._situacao === "pendente").length
    );
    mensalAtrasada.push(
      mesRows.filter(row => row._situacao === "atrasada").length
    );
  });

  criarGraficoSubstituicoes("sub-grafico-mensal", {
    type: "line",
    data: {
      labels: meses.map(item => item[0]),
      datasets: [
        {
          label: "Realizadas",
          data: mensalRealizada,
          borderColor: "#16835b",
          backgroundColor: "rgba(22,131,91,.12)",
          tension: 0.25
        },
        {
          label: "Pendentes",
          data: mensalPendente,
          borderColor: "#3678c8",
          backgroundColor: "rgba(54,120,200,.10)",
          tension: 0.25
        },
        {
          label: "Em atraso",
          data: mensalAtrasada,
          borderColor: "#c94c4c",
          backgroundColor: "rgba(201,76,76,.10)",
          tension: 0.25
        }
      ]
    },
    options: opcoesGraficoSubstituicoes()
  });

  const porSubsede = agruparContagem(rows, row => row.subsede).slice(0, 12);

  criarGraficoSubstituicoes("sub-grafico-subsede", {
    type: "bar",
    data: {
      labels: porSubsede.map(item => item[0]),
      datasets: [{
        label: "Registros",
        data: porSubsede.map(item => item[1]),
        backgroundColor: "#3678c8",
        borderRadius: 5
      }]
    },
    options: {
      ...opcoesGraficoSubstituicoes(),
      indexAxis: "y"
    }
  });

  const porMotivo = agruparContagem(
    rows,
    row => row.motivo || "Não informado"
  ).slice(0, 10);

  criarGraficoSubstituicoes("sub-grafico-motivos", {
    type: "bar",
    data: {
      labels: porMotivo.map(item => item[0]),
      datasets: [{
        label: "Registros",
        data: porMotivo.map(item => item[1]),
        backgroundColor: "#244b78",
        borderRadius: 5
      }]
    },
    options: {
      ...opcoesGraficoSubstituicoes(),
      indexAxis: "y"
    }
  });

  const realizadas = rows.filter(row => row._situacao === "realizada").length;
  const pendentes = rows.filter(row => row._situacao === "pendente").length;
  const atrasadas = rows.filter(row => row._situacao === "atrasada").length;

  criarGraficoSubstituicoes("sub-grafico-situacao", {
    type: "doughnut",
    data: {
      labels: ["Realizadas", "Pendentes", "Em atraso"],
      datasets: [{
        data: [realizadas, pendentes, atrasadas],
        backgroundColor: ["#16835b", "#3678c8", "#c94c4c"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });
}

function opcoesGraficoSubstituicoes() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: "index"
    },
    plugins: {
      legend: {
        position: "bottom"
      }
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 0
        },
        grid: {
          display: false
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        }
      }
    }
  };
}

// ==================================================
// TABELA DE DETALHAMENTO
// ==================================================

function renderizarTabelaSubstituicoes(rows) {
  const tbody = $("sub-tabela-corpo");
  const contagem = $("sub-tabela-contagem");

  if (!tbody) return;

  tbody.replaceChildren();

  if (contagem) {
    contagem.textContent =
      `${rows.length.toLocaleString("pt-BR")} registros`;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 8;
    td.textContent = "Nenhum registro encontrado para os filtros selecionados.";

    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const aDays = a._dias ?? -1;
    const bDays = b._dias ?? -1;
    return bDays - aDays;
  });

  // Limita a tabela para evitar renderização excessiva no navegador.
  sorted.slice(0, 500).forEach(row => {
    const tr = document.createElement("tr");

    const prazo = row._realizada
      ? "Realizada"
      : row._atrasada
        ? "Em atraso"
        : "Pendente";

    const cells = [
      row.subsede,
      row.jovem,
      row.empresa,
      row.motivo,
      row.mes_fechamento,
      row._dias,
      prazo,
      row.prioridade
    ];

    cells.forEach((value, index) => {
      const td = document.createElement("td");

      if (index === 5) {
        td.textContent = value === null || value === undefined
          ? "—"
          : String(value);
      } else {
        td.textContent = valorTexto(value);
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  if (sorted.length > 500) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 8;
    td.textContent =
      `Exibindo 500 de ${sorted.length.toLocaleString("pt-BR")} registros. Use os filtros para refinar a consulta.`;

    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}
