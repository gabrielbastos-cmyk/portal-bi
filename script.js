
"use strict";

const sb = window.sb;

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let allDashboards = [];
let adminUsers = [];

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
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;
    button.disabled = false;
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
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  $("login-section").hidden = false;
  $("portal-section").hidden = true;
  $("admin-section").hidden = true;
  $("admin-nav-link").hidden = true;
  $("user-email").textContent = "";
}

function mostrarPortal() {
  $("login-section").hidden = true;
  $("portal-section").hidden = false;
  $("user-email").textContent = currentUser?.email || "";
}

// ==================================================
// LOGIN
// ==================================================

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage("login-message");

  const button = event.submitter;
  setLoading(button, true, "Entrando...");

  try {
    const email = $("email").value.trim();
    const password = $("password").value;

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

// ==================================================
// SAIR
// ==================================================

$("logout-btn").addEventListener("click", async () => {
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    mostrarLogin();
  } catch (error) {
    console.error("Erro ao sair:", error);
    showMessage("dashboard-message", friendlyError(error));
  }
});

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

    $("admin-section").hidden = !isAdmin;
    $("admin-nav-link").hidden = !isAdmin;

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
    return;
  }

  allDashboards.forEach(dashboard => {
    const card = document.createElement("article");
    card.className = "dashboard-card";

    const title = document.createElement("h3");
    title.textContent = dashboard.name;

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
}

// ==================================================
// BUSCA, FILTRO E RESUMO
// ==================================================

function atualizarResumo() {
  $("summary-total").textContent = String(allDashboards.length);

  const categories = new Set(
    allDashboards.map(d => normalize(d.category || "outros"))
  );

  $("summary-categories").textContent = String(categories.size);
}

function aplicarFiltrosDashboards() {
  const term = normalize($("dashboard-search").value);
  const selectedCategory = normalize($("category-filter").value);
  const cards = [...$("dashboard-grid").querySelectorAll(".dashboard-card")];

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

  $("filter-empty").hidden = visible > 0 || cards.length === 0;
}

$("dashboard-search").addEventListener(
  "input",
  aplicarFiltrosDashboards
);

$("category-filter").addEventListener(
  "change",
  aplicarFiltrosDashboards
);

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
  }
}

// ==================================================
// CRIAR USUÁRIO
// ==================================================

$("user-create-form").addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage("user-create-message");

  const button = event.submitter;
  setLoading(button, true, "Criando usuário...");

  try {
    await adminCall("create_user", {
      email: $("new-user-email").value.trim(),
      password: $("new-user-password").value,
      role: $("new-user-role").value
    });

    $("user-create-form").reset();

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

// ==================================================
// PERMISSÕES
// ==================================================

$("permission-user").addEventListener(
  "change",
  carregarPermissoesUsuario
);

async function carregarPermissoesUsuario() {
  clearMessage("permission-message");

  const userId = $("permission-user").value;
  const container = $("permission-dashboard-list");
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

    if (!allDashboards.length) {
      const { data: dashboards, error: dashboardsError } = await sb
        .from("dashboards")
        .select("id, name")
        .order("name");

      if (dashboardsError) throw dashboardsError;
      allDashboards = dashboards || [];
    }

    allDashboards.forEach(dashboard => {
      const label = document.createElement("label");
      label.className = "permission-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = dashboard.id;
      checkbox.checked = permittedIds.has(dashboard.id);

      const text = document.createElement("span");
      text.textContent = dashboard.name;

      label.append(checkbox, text);
      container.appendChild(label);
    });
  } catch (error) {
    console.error("Erro ao carregar permissões:", error);
    showMessage("permission-message", friendlyError(error));
  }
}

$("save-permissions-btn").addEventListener("click", async () => {
  clearMessage("permission-message");

  const userId = $("permission-user").value;

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

// ==================================================
// LISTA ADMINISTRATIVA
// ==================================================

function renderizarDashboardsAdministrativos() {
  const container = $("admin-dashboard-list");
  container.replaceChildren();

  allDashboards.forEach(dashboard => {
    const item = document.createElement("article");
    item.className = "admin-dashboard-item";

    const title = document.createElement("strong");
    title.textContent = dashboard.name;

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

$("dashboard-form").addEventListener("submit", async event => {
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

    $("dashboard-form").reset();

    await carregarDashboards();
    await carregarAdministracao();
  } catch (error) {
    console.error("Erro ao salvar dashboard:", error);
    showMessage("dashboard-form-message", friendlyError(error));
  } finally {
    setLoading(button, false);
  }
});
