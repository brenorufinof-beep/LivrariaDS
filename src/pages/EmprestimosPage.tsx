import { useEffect, useMemo, useState } from "react";
import { Plus, BookOpen, RefreshCw, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Layout } from "../components/Layout";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Badge, dueTone, statusTone } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/Modal";
import { LoanFormModal } from "../components/LoanFormModal";
import { useBooks, useLoans } from "../hooks/useBooks";
import { loansApi } from "../lib/api";
import type { Book, Loan } from "../types";
import { useAuth } from "../context/AuthContext";
import { daysUntilDue, formatDate } from "../utils/format";
import { toast } from "sonner";

type Tab = "ativos" | "devolvidos" | "atrasados";

export function EmprestimosPage() {
  const { user } = useAuth();
  const { books, setBooks } = useBooks();
  const { loans, setLoans } = useLoans();
  const [tab, setTab] = useState<Tab>("ativos");
  const [loanOpen, setLoanOpen] = useState(false);
  const [preselectedBookId, setPreselectedBookId] = useState<string | null>(null);
  const [returningLoan, setReturningLoan] = useState<Loan | null>(null);
  const [renewingLoan, setRenewingLoan] = useState<Loan | null>(null);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Detecta pré-seleção via hash (#loan=xxx)
  useEffect(() => {
    const hash = window.location.hash;
    const m = hash.match(/loan=([^&]+)/);
    if (m) {
      setPreselectedBookId(m[1]);
      setLoanOpen(true);
      window.location.hash = "";
    }
  }, []);

  const availableBooks = useMemo(
    () => books.filter((b) => b.status === "Disponível"),
    [books],
  );

  const counts = useMemo(
    () => ({
      ativos: loans.filter((l) => l.status === "Ativo" || l.status === "Renovado").length,
      devolvidos: loans.filter((l) => l.status === "Devolvido").length,
      atrasados: loans.filter((l) => l.status === "Atrasado").length,
    }),
    [loans],
  );

  const filteredLoans = useMemo(() => {
    return loans.filter((l) => {
      if (tab === "ativos") return l.status === "Ativo" || l.status === "Renovado";
      if (tab === "devolvidos") return l.status === "Devolvido";
      if (tab === "atrasados") return l.status === "Atrasado";
      return true;
    });
  }, [loans, tab]);

  const bookById = (id: string) => books.find((b) => b.id === id);

  const handleCreateLoan = async (values: any) => {
    if (!user) return;
    setActionLoading(true);
    try {
      const { loan } = await loansApi.create(user.id, {
        book_id: values.book_id,
        data_emprestimo: values.data_emprestimo,
        data_devolucao_prevista: values.data_devolucao_prevista,
        bookStatus: "Emprestado",
      });
      // Atualiza estado local
      setLoans((prev) => [loan, ...prev]);
      setBooks((prev) =>
        prev.map((b) => (b.id === loan.book_id ? { ...b, status: "Emprestado" } : b)),
      );
      toast.success("Empréstimo registrado");
      setLoanOpen(false);
      setPreselectedBookId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!user || !returningLoan) return;
    setActionLoading(true);
    try {
      const updated = await loansApi.returnLoan(user.id, returningLoan.id);
      setLoans((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setBooks((prev) =>
        prev.map((b) => (b.id === updated.book_id ? { ...b, status: "Disponível" } : b)),
      );
      toast.success("Devolução confirmada");
      setReturningLoan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao devolver");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRenew = async () => {
    if (!user || !renewingLoan) return;
    setActionLoading(true);
    try {
      const updated = await loansApi.renew(user.id, renewingLoan.id);
      setLoans((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success("Empréstimo renovado (+14 dias)");
      setRenewingLoan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao renovar");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !deletingLoan) return;
    try {
      await loansApi.remove(user.id, deletingLoan.id);
      setLoans((prev) => prev.filter((l) => l.id !== deletingLoan.id));
      toast.success("Empréstimo removido");
      setDeletingLoan(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  };

  const preselectedBook: Book | null = preselectedBookId ? bookById(preselectedBookId) ?? null : null;

  return (
    <Layout>
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-600">Empréstimos</p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900">Controle de saídas</h1>
            <p className="mt-1 text-sm text-slate-500">
              Registre empréstimos, acompanhe prazos e processe devoluções.
            </p>
          </div>
          <Button onClick={() => { setPreselectedBookId(null); setLoanOpen(true); }} size="lg">
            <Plus className="h-4 w-4" /> Novo empréstimo
          </Button>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "ativos", label: "Ativos", count: counts.ativos },
              { value: "atrasados", label: "Atrasados", count: counts.atrasados },
              { value: "devolvidos", label: "Devolvidos", count: counts.devolvidos },
            ]}
          />
        </div>

        {/* Lista - desktop/tablet */}
        <div className="hidden md:block rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {filteredLoans.length === 0 ? (
            <EmptyState message="Nenhum empréstimo nesta categoria" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">Livro</th>
                    <th className="px-4 py-3 font-medium">Empréstimo</th>
                    <th className="px-4 py-3 font-medium">Devolução</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLoans.map((loan) => {
                    const book = bookById(loan.book_id);
                    const days = daysUntilDue(loan.data_devolucao_prevista);
                    return (
                      <tr key={loan.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-9 rounded bg-slate-100 overflow-hidden flex-shrink-0">
                              {book?.capa_url ? (
                                <img src={book.capa_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                  <BookOpen className="h-4 w-4 text-slate-400" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate">{book?.titulo ?? "—"}</p>
                              <p className="text-xs text-slate-500 truncate">{book?.autor}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(loan.data_emprestimo)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-700">{formatDate(loan.data_devolucao_prevista)}</span>
                            {!loan.data_devolucao_efetiva && (
                              <Badge tone={dueTone(days)}>
                                {days < 0 ? `${Math.abs(days)}d atraso` : `${days}d`}
                              </Badge>
                            )}
                          </div>
                          {loan.renovacoes > 0 && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              Renovado {loan.renovacoes}x
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(loan.status)}>{loan.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {(loan.status === "Ativo" || loan.status === "Renovado") && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRenewingLoan(loan)}
                                  disabled={loan.renovacoes >= 2}
                                  aria-label="Renovar"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  <span className="hidden lg:inline">Renovar</span>
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => setReturningLoan(loan)}
                                  aria-label="Devolver"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span className="hidden lg:inline">Devolver</span>
                                </Button>
                              </>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeletingLoan(loan)}
                              aria-label="Excluir"
                            >
                              <AlertTriangle className="h-4 w-4 text-rose-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lista - mobile (cards simplificados, touch targets ≥44px) */}
        <div className="md:hidden space-y-3">
          {filteredLoans.length === 0 ? (
            <EmptyState message="Nenhum empréstimo nesta categoria" />
          ) : (
            filteredLoans.map((loan) => {
              const book = bookById(loan.book_id);
              const days = daysUntilDue(loan.data_devolucao_prevista);
              return (
                <div key={loan.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-11 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                      {book?.capa_url ? (
                        <img src={book.capa_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <BookOpen className="h-5 w-5 text-slate-400" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 line-clamp-2">{book?.titulo ?? "—"}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{book?.autor}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone(loan.status)}>{loan.status}</Badge>
                        {!loan.data_devolucao_efetiva && (
                          <Badge tone={dueTone(days)}>
                            {days < 0 ? `${Math.abs(days)}d atraso` : `${days}d restantes`}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        Devolução: {formatDate(loan.data_devolucao_prevista)}
                      </div>
                    </div>
                  </div>
                  {(loan.status === "Ativo" || loan.status === "Renovado") && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        size="md"
                        variant="outline"
                        onClick={() => setRenewingLoan(loan)}
                        disabled={loan.renovacoes >= 2}
                      >
                        <RefreshCw className="h-4 w-4" /> Renovar
                      </Button>
                      <Button size="md" onClick={() => setReturningLoan(loan)}>
                        <CheckCircle2 className="h-4 w-4" /> Devolver
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <LoanFormModal
        open={loanOpen}
        preselectedBook={preselectedBook}
        availableBooks={availableBooks}
        onClose={() => { setLoanOpen(false); setPreselectedBookId(null); }}
        onSubmit={handleCreateLoan}
        submitting={actionLoading}
      />

      <Modal
        open={!!returningLoan}
        onClose={() => setReturningLoan(null)}
        title="Confirmar devolução"
        description="O livro será marcado como devolvido e liberado para novo empréstimo."
        size="sm"
      >
        <p className="text-sm text-slate-600">
          Confirmar devolução de{" "}
          <strong>{bookById(returningLoan?.book_id ?? "")?.titulo ?? "—"}</strong>?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReturningLoan(null)}>Cancelar</Button>
          <Button onClick={handleReturn} loading={actionLoading}>Confirmar devolução</Button>
        </div>
      </Modal>

      <Modal
        open={!!renewingLoan}
        onClose={() => setRenewingLoan(null)}
        title="Renovar empréstimo"
        description="Adiciona 14 dias ao prazo de devolução."
        size="sm"
      >
        <p className="text-sm text-slate-600">
          Renovar{" "}
          <strong>{bookById(renewingLoan?.book_id ?? "")?.titulo ?? "—"}</strong>?
          {renewingLoan && (
            <span className="block mt-1 text-xs text-slate-500">
              Renovações: {renewingLoan.renovacoes}/2
            </span>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenewingLoan(null)}>Cancelar</Button>
          <Button onClick={handleRenew} loading={actionLoading} disabled={!!renewingLoan && renewingLoan.renovacoes >= 2}>
            Renovar
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingLoan}
        title="Excluir empréstimo"
        message="Tem certeza que deseja excluir este empréstimo? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeletingLoan(null)}
      />
    </Layout>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-10 text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <BookOpen className="h-7 w-7" />
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{message}</h3>
      <p className="mt-1 text-sm text-slate-500">Ajuste os filtros ou registre um novo empréstimo.</p>
    </div>
  );
}