/**
 * Camada de dados que usa Supabase para autenticação e persistência de usuários.
 * Os dados de livro e empréstimo ainda estão salvos localmente no MVP atual.
 */
import { supabase } from "./supabase";
import type { AppUser, Book, BookStatus, Loan, LoanStatus } from "../types";
import { openLibraryCoverUrl } from "../utils/format";

const KEYS = {
  books: "lib_books",
  loans: "lib_loans",
};

async function getUserProfile(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from<AppUser>("users")
    .select("id, email, role, created_at")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

// ---------- Auth ----------

export const auth = {
  async signUp(email: string, password: string, role: AppUser["role"] = "usuario"): Promise<AppUser> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    const user = data.user;
    if (!user) throw new Error("Falha ao cadastrar usuário.");

    const now = new Date().toISOString();
    const profile = {
      id: user.id,
      email,
      role,
      created_at: now,
    };

    const { error: insertError } = await supabase.from<AppUser>("users").insert(profile);
    if (insertError) throw new Error(insertError.message);

    return profile;
  },

  async logIn(email: string, password: string): Promise<AppUser> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session?.user) {
      throw new Error(error?.message || "Credenciais inválidas.");
    }

    const userId = data.session.user.id;
    const { data: profile, error: profileError } = await supabase
      .from<AppUser>("users")
      .select("id, email, role, created_at")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      throw new Error(profileError?.message || "Perfil de usuário não encontrado.");
    }

    return profile;
  },

  async logOut() {
    await supabase.auth.signOut();
  },

  async getUser(): Promise<AppUser | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const { data: profile, error: profileError } = await supabase
      .from<AppUser>("users")
      .select("id, email, role, created_at")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      console.error(profileError.message);
      return null;
    }

    return profile || null;
  },

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);
  },

  async updatePassword(_token: string, newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  },
};

// ---------- Books ----------

export const booksApi = {
  async list(userId: string): Promise<Book[]> {
    await delay(150);
    const all = read<Book[]>(KEYS.books, []);
    // Todos os usuários podem ver todos os livros (adicionados pelo admin)
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async create(userId: string, data: Omit<Book, "id" | "user_id" | "created_at" | "updated_at">): Promise<Book> {
    await delay();
    // Verifica se o usuário é administrador
    const user = await getUserProfile(userId);
    if (!user || user.role !== "bibliotecario") {
      throw new Error("Apenas administradores podem adicionar livros.");
    }
    const all = read<Book[]>(KEYS.books, []);
    if (all.some((b) => b.user_id === userId && b.isbn === data.isbn)) {
      throw new Error("Já existe um livro com este ISBN no seu acervo.");
    }
    const now = new Date().toISOString();
    const book: Book = {
      ...data,
      capa_url: data.capa_url || openLibraryCoverUrl(data.isbn),
      id: uid(),
      user_id: userId,
      created_at: now,
      updated_at: now,
    };
    all.push(book);
    write(KEYS.books, all);
    return book;
  },

  async update(userId: string, id: string, data: Partial<Book>): Promise<Book> {
    await delay();
    const all = read<Book[]>(KEYS.books, []);
    const idx = all.findIndex((b) => b.id === id && b.user_id === userId);
    if (idx === -1) throw new Error("Livro não encontrado.");
    const nextCover = data.capa_url === "" && data.isbn ? openLibraryCoverUrl(data.isbn) : data.capa_url;
    all[idx] = {
      ...all[idx],
      ...data,
      ...(nextCover !== undefined ? { capa_url: nextCover } : {}),
      updated_at: new Date().toISOString(),
    };
    write(KEYS.books, all);
    return all[idx];
  },

  async remove(userId: string, id: string): Promise<void> {
    await delay();
    const all = read<Book[]>(KEYS.books, []);
    const filtered = all.filter((b) => !(b.id === id && b.user_id === userId));
    write(KEYS.books, filtered);
  },
};

// ---------- Loans ----------

/**
 * Recalcula status "Atrasado" automaticamente:
 * data_devolucao_prevista < current_date AND data_devolucao_efetiva IS NULL
 */
export function recomputeLoanStatus(loan: Loan): LoanStatus {
  if (loan.data_devolucao_efetiva) {
    return loan.status === "Atrasado" ? "Devolvido" : loan.status;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(loan.data_devolucao_prevista + "T00:00:00");
  if (due < today) return "Atrasado";
  return loan.status === "Atrasado" ? "Ativo" : loan.status;
}

export const loansApi = {
  async list(userId: string): Promise<Loan[]> {
    await delay(120);
    const all = read<Loan[]>(KEYS.loans, []);
    return all
      .filter((l) => l.user_id === userId)
      .map((l) => ({ ...l, status: recomputeLoanStatus(l) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async create(
    userId: string,
    data: Omit<Loan, "id" | "user_id" | "status" | "renovacoes" | "created_at" | "updated_at"> & {
      bookStatus?: BookStatus;
    },
  ): Promise<{ loan: Loan; bookId: string }> {
    await delay();
    // Verifica se o usuário existe
    const user = await getUserProfile(userId);
    if (!user) {
      throw new Error("Usuário não encontrado.");
    }
    const all = read<Loan[]>(KEYS.loans, []);
    const now = new Date().toISOString();
    const loan: Loan = {
      ...data,
      id: uid(),
      user_id: userId,
      status: "Ativo",
      renovacoes: 0,
      created_at: now,
      updated_at: now,
    };
    all.push(loan);
    write(KEYS.loans, all);

    // Atualiza status do livro
    if (data.bookStatus) {
      const books = read<Book[]>(KEYS.books, []);
      const bIdx = books.findIndex((b) => b.id === data.book_id && b.user_id === userId);
      if (bIdx !== -1) {
        books[bIdx] = { ...books[bIdx], status: data.bookStatus, updated_at: now };
        write(KEYS.books, books);
      }
    }
    return { loan, bookId: data.book_id };
  },

  async returnLoan(userId: string, loanId: string): Promise<Loan> {
    await delay();
    const all = read<Loan[]>(KEYS.loans, []);
    const idx = all.findIndex((l) => l.id === loanId && l.user_id === userId);
    if (idx === -1) throw new Error("Empréstimo não encontrado.");
    const today = new Date().toISOString().slice(0, 10);
    all[idx] = {
      ...all[idx],
      data_devolucao_efetiva: today,
      status: "Devolvido",
      updated_at: new Date().toISOString(),
    };
    write(KEYS.loans, all);

    // Devolve o livro para Disponível
    const books = read<Book[]>(KEYS.books, []);
    const bIdx = books.findIndex((b) => b.id === all[idx].book_id && b.user_id === userId);
    if (bIdx !== -1) {
      books[bIdx] = { ...books[bIdx], status: "Disponível", updated_at: new Date().toISOString() };
      write(KEYS.books, books);
    }
    return all[idx];
  },

  async renew(userId: string, loanId: string): Promise<Loan> {
    await delay();
    const all = read<Loan[]>(KEYS.loans, []);
    const idx = all.findIndex((l) => l.id === loanId && l.user_id === userId);
    if (idx === -1) throw new Error("Empréstimo não encontrado.");
    if (all[idx].renovacoes >= 2) throw new Error("Limite de 2 renovações atingido.");
    const due = new Date(all[idx].data_devolucao_prevista + "T00:00:00");
    due.setDate(due.getDate() + 14);
    all[idx] = {
      ...all[idx],
      data_devolucao_prevista: due.toISOString().slice(0, 10),
      status: "Renovado",
      renovacoes: all[idx].renovacoes + 1,
      updated_at: new Date().toISOString(),
    };
    write(KEYS.loans, all);
    return all[idx];
  },

  async remove(userId: string, id: string): Promise<void> {
    await delay();
    const all = read<Loan[]>(KEYS.loans, []);
    write(
      KEYS.loans,
      all.filter((l) => !(l.id === id && l.user_id === userId)),
    );
  },
};

function migrateDemoCovers(currentUserId: string, books: Book[]) {
  let changed = false;
  const migrated = books.map((book) => {
    if (book.user_id !== currentUserId) return book;
    if (!book.capa_url?.includes("images.unsplash.com")) return book;
    changed = true;
    return {
      ...book,
      capa_url: openLibraryCoverUrl(book.isbn),
      updated_at: new Date().toISOString(),
    };
  });
  if (changed) write(KEYS.books, migrated);
}

function delay(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}