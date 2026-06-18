import { useCallback, useEffect, useState } from "react";
import type { Book, Loan } from "../types";
import { booksApi, loansApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export function useBooks() {
  const { user } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await booksApi.list(user.id);
      setBooks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar livros");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { books, loading, error, refresh, setBooks };
}

export function useLoans() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await loansApi.list(user.id);
      setLoans(data);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { loans, loading, refresh, setLoans };
}

export function useBookSearch<T extends { titulo: string; autor: string; isbn: string }>(
  items: T[],
  query: string,
  debounceMs = 300,
) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  if (!debounced.trim()) return items;
  const q = debounced.toLowerCase();
  return items.filter(
    (i) =>
      i.titulo.toLowerCase().includes(q) ||
      i.autor.toLowerCase().includes(q) ||
      i.isbn.toLowerCase().includes(q),
  );
}