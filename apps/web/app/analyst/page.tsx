"use client";

import { useState, type FormEvent } from "react";
import "./page.css";

type HandoffStatus =
  | "waiting_analyst"
  | "analyst_assigned"
  | "agent_resumed"
  | "resolved"
  | "closed";

type HandoffSummary = {
  id: string;
  conversationId: string;
  employeeId: string;
  status: HandoffStatus;
  reason: string;
  summary: string;
  requestedAt: string;
  assignedAt: string | null;
  assignedAnalystId: string | null;
  employee: { name: string; email: string; department: string | null };
};

type HandoffDetails = HandoffSummary & {
  conversation: {
    id: string;
    status: string;
    agentStatus: string;
    messages: Array<{
      id: string;
      sequence: number;
      actorType: "employee" | "assistant" | "analyst" | "system";
      actorId: string | null;
      content: string;
      createdAt: string;
    }>;
  };
  events: Array<{
    id: string;
    action: string;
    actorType: string;
    actorId: string;
    reason: string;
    createdAt: string;
  }>;
};

const apiBase = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4111";

async function requestApi<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T | undefined> {
  const response = await fetch(`${apiBase}/api/v1/analyst/handoffs${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined;
  return (await response.json()) as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AnalystConsolePage() {
  const [token, setToken] = useState("");
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>([]);
  const [selected, setSelected] = useState<HandoffDetails | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshQueue(): Promise<void> {
    setError("");
    try {
      const queue = await requestApi<HandoffSummary[]>(token, "");
      setHandoffs(queue ?? []);
      if (selected) {
        const detail = await requestApi<HandoffDetails>(
          token,
          `/${selected.id}`,
        );
        setSelected(detail ?? null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    }
  }

  async function selectHandoff(id: string): Promise<void> {
    setError("");
    try {
      const detail = await requestApi<HandoffDetails>(token, `/${id}`);
      setSelected(detail ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    }
  }

  async function runAction(action: "assign" | "resume" | "resolve" | "close") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await requestApi(token, `/${selected.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({
          reason:
            reason.trim() || `Operação ${action} pelo console do analista.`,
        }),
      });
      await refreshQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setBusy(true);
    setError("");
    try {
      await requestApi(token, `/${selected.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: message.trim() }),
      });
      setMessage("");
      await refreshQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  const canSendMessage = selected?.status === "analyst_assigned";
  const canResolve =
    selected?.status === "analyst_assigned" ||
    selected?.status === "agent_resumed";
  const canClose = canResolve || selected?.status === "resolved";

  return (
    <main className="analyst-console">
      <header className="console-header">
        <div>
          <p className="eyebrow">NEXO ASSIST · SERVICE DESK</p>
          <h1>Console do analista</h1>
          <p className="subheading">
            Fila de transferências, contexto e histórico de atendimento.
          </p>
        </div>
        <a href="/">Nexo Assist</a>
      </header>

      <section className="auth-panel" aria-label="Autenticação do analista">
        <label htmlFor="analyst-token">Token de acesso do analista</label>
        <input
          id="analyst-token"
          type="password"
          autoComplete="off"
          placeholder="Cole o token JWT de analista"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <button
          type="button"
          disabled={!token.trim() || busy}
          onClick={() => void refreshQueue()}
        >
          Atualizar fila
        </button>
      </section>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      <div className="console-grid">
        <section className="queue-panel" aria-label="Fila de transferências">
          <div className="panel-heading">
            <h2>Fila</h2>
            <span>{handoffs.length}</span>
          </div>
          {handoffs.length === 0 ? (
            <p className="empty-state">Nenhuma transferência carregada.</p>
          ) : (
            <ul className="handoff-list">
              {handoffs.map((handoff) => (
                <li key={handoff.id}>
                  <button
                    type="button"
                    className={`handoff-item ${selected?.id === handoff.id ? "selected" : ""}`}
                    onClick={() => void selectHandoff(handoff.id)}
                  >
                    <span className={`status-pill status-${handoff.status}`}>
                      {handoff.status.replaceAll("_", " ")}
                    </span>
                    <strong>{handoff.employee.name}</strong>
                    <span>{handoff.reason}</span>
                    <small>{formatDate(handoff.requestedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="detail-panel"
          aria-label="Detalhes da transferência"
        >
          {!selected ? (
            <p className="empty-state">
              Selecione uma transferência para ver o resumo e atender.
            </p>
          ) : (
            <>
              <div className="panel-heading detail-heading">
                <div>
                  <span className={`status-pill status-${selected.status}`}>
                    {selected.status.replaceAll("_", " ")}
                  </span>
                  <h2>{selected.employee.name}</h2>
                  <p>
                    {selected.employee.email}
                    {selected.employee.department
                      ? ` · ${selected.employee.department}`
                      : ""}
                  </p>
                </div>
                <small>Solicitado {formatDate(selected.requestedAt)}</small>
              </div>

              <article className="summary-card">
                <h3>Motivo</h3>
                <p>{selected.reason}</p>
                <h3>Resumo da conversa</h3>
                <p className="summary-text">{selected.summary}</p>
              </article>

              <div className="action-panel">
                <label htmlFor="transition-reason">Motivo da operação</label>
                <input
                  id="transition-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Descreva a ação para o histórico"
                />
                {selected.status === "waiting_analyst" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runAction("assign")}
                  >
                    Assumir atendimento
                  </button>
                ) : selected?.status === "analyst_assigned" ||
                  selected?.status === "agent_resumed" ||
                  selected?.status === "resolved" ? (
                  <div className="action-buttons">
                    {selected.status === "analyst_assigned" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction("resume")}
                      >
                        Retomar agente
                      </button>
                    )}
                    {canResolve && selected.status !== "resolved" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runAction("resolve")}
                      >
                        Resolver
                      </button>
                    )}
                    {canClose && (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => void runAction("close")}
                      >
                        Encerrar
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              <section className="messages-section">
                <h3>Conversa</h3>
                <ol className="messages-list">
                  {selected.conversation.messages.map((item) => (
                    <li
                      key={item.id}
                      className={`message message-${item.actorType}`}
                    >
                      <div>
                        <strong>{item.actorType}</strong>
                        <time>{formatDate(item.createdAt)}</time>
                      </div>
                      <p>{item.content}</p>
                    </li>
                  ))}
                </ol>
                {canSendMessage && (
                  <form className="message-form" onSubmit={sendMessage}>
                    <label
                      className="visually-hidden"
                      htmlFor="analyst-message"
                    >
                      Mensagem ao funcionário
                    </label>
                    <textarea
                      id="analyst-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={10_000}
                      placeholder="Escreva uma mensagem ao funcionário..."
                    />
                    <button type="submit" disabled={busy || !message.trim()}>
                      Enviar mensagem
                    </button>
                  </form>
                )}
              </section>

              <section className="events-section">
                <h3>Histórico de operações</h3>
                <ol>
                  {selected.events.map((event) => (
                    <li key={event.id}>
                      <strong>{event.action.replaceAll("_", " ")}</strong>
                      <span>
                        {event.actorType} · {event.reason}
                      </span>
                      <time>{formatDate(event.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
