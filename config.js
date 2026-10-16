
(() => {
  "use strict";

  const SUPABASE_URL =
    "https://oigqmmkaqbpzgaeztajx.supabase.co";

  // Cole aqui a chave Publishable copiada do projeto correto
  // no painel do Supabase. Não use uma chave Secret.
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_--VlC5l4qTiPI6uivLIf5w_Ww6uPbyb";

  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    console.error(
      "Supabase JS não carregou. Confira a biblioteca no HTML."
    );
    return;
  }

  if (
    !SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_") &&
    !SUPABASE_PUBLISHABLE_KEY.startsWith("eyJ")
  ) {
    console.error(
      "A chave Supabase está ausente ou tem formato inesperado."
    );
    return;
  }

  try {
    window.sb = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );

    if (
      !window.sb ||
      !window.sb.auth ||
      typeof window.sb.auth.getSession !== "function"
    ) {
      console.error(
        "O cliente Supabase não foi inicializado corretamente."
      );
      window.sb = undefined;
    }
  } catch (error) {
    window.sb = undefined;
    console.error(
      "Erro ao inicializar o Supabase:",
      error.message
    );
  }
})();
