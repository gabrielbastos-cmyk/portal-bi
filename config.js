
const SUPABASE_URL = "https://oigqmmkaqbpzgaeztajx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_--VlC5l4qTiPI6uivLIf5w_Ww6uPbyb";

if (!window.supabase) {
  console.error("A biblioteca do Supabase não foi carregada.");
} else {
  window.sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
}
