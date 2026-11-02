"use client";

import { useState } from "react";
import "./page.css";

type Execution = {
  traceId: string;
  intent: string;
  status: string;
  confidence: number | null;
  reason: string | null;
  model: string | null;
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  eventCount: number;
};

type AuditEvent = {
  id: string;
  eventType: string;
  toolName: string | null;
  inputSummary: string | null;
  outputSummary: string | null;
  status: string;
  sourceRefs: unknown;
  spanId: string | null;
  parentSpanId: string | null;
  durationMs: number | null;
  createdAt: string;
};

type ExecutionDetail = Omit<Execution, "eventCount"> & {
  audits: AuditEvent[];
};

type Conversation = {
  id: string;
  status: string;
  agentStatus: string;
  updatedAt: string;
  messageCount: number;
};

const apiBase = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4111";

async function requestApi<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export default function ObservabilityPage() {
  const [token, setToken] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<ExecutionDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadConversations(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<Conversation[]>(token, "/conversations");
      setConversations(result);
      setConversationId("");
      setExecutions([]);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  async function loadExecutions(id: string): Promise<void> {
    setConversationId(id);
    setSelected(null);
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<Execution[]>(
        token,
        `/conversations/${id}/executions?limit=50`,
      );
      setExecutions(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
      setExecutions([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadExecution(traceId: string): Promise<void> {
    if (!conversationId) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<ExecutionDetail>(
        token,
        `/conversations/${conversationId}/executions/${traceId}`,
      );
      setSelected(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="observability-page">
      <header className="observability-header">
        <div>
          <p className="observability-eyebrow">NEXO ASSIST · OPERAÇÕES</p>
          <h1>Rastreabilidade do agente</h1>
          <p>
            Execuções, evidências e ações operacionais. Raciocínio interno do
            modelo não é coletado nem exibido.
          </p>
        </div>
        <a href="/">Voltar ao início</a>
      </header>

      <section className="observability-auth" aria-label="Autenticação">
        <label htmlFor="employee-token">Token de acesso do funcionário</label>
        <div>
          <input
            id="employee-token"
            type="password"
            autoComplete="off"
            placeholder="Cole o token JWT"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            type="button"
            disabled={!token.trim() || busy}
            onClick={() => void loadConversations()}
          >
            Carregar conversas
          </button>
        </div>
        <small>O token permanece somente na memória desta página.</small>
      </section>

      {error && (
        <p className="observability-error" role="alert">
          {error}
        </p>
      )}

      <div className="observability-grid">
        <section className="observability-panel" aria-label="Conversas">
          <h2>Conversas</h2>
          {conversations.length === 0 ? (
            <p className="observability-empty">
              Autentique-se para carregar suas conversas.
            </p>
          ) : (
            <ul className="observability-list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className={
                      conversationId === conversation.id ? "is-selected" : ""
                    }
                    disabled={busy}
                    onClick={() => void loadExecutions(conversation.id)}
                  >
                    <strong>{conversation.id.slice(0, 8)}</strong>
                    <span>
                      {conversation.status} · {conversation.messageCount}{" "}
                      mensagens
                    </span>
                    <small>{formatDate(conversation.updatedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="observability-panel" aria-label="Execuções">
          <h2>Execuções</h2>
          {executions.length === 0 ? (
            <p className="observability-empty">
              Selecione uma conversa para ver suas execuções.
            </p>
          ) : (
            <ul className="observability-list">
              {executions.map((execution) => (
                <li key={execution.traceId}>
                  <button
                    type="button"
                    className={
                      selected?.traceId === execution.traceId
                        ? "is-selected"
                        : ""
                    }
                    disabled={busy}
                    onClick={() => void loadExecution(execution.traceId)}
                  >
                    <strong>
                      {execution.intent} · {execution.status}
                    </strong>
                    <span>
                      {execution.durationMs === null
                        ? "Em andamento"
                        : `${execution.durationMs} ms`}{" "}
                      · {execution.eventCount} eventos
                    </span>
                    <small>{formatDate(execution.startedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="observability-panel observability-detail">
          <h2>Detalhes e eventos</h2>
          {!selected ? (
            <p className="observability-empty">
              Selecione uma execução para inspecionar os eventos redigidos.
            </p>
          ) : (
            <>
              <dl className="execution-metadata">
                <div>
                  <dt>Trace ID</dt>
                  <dd>{selected.traceId}</dd>
                </div>
                <div>
                  <dt>Confiança</dt>
                  <dd>
                    {selected.confidence === null
                      ? "—"
                      : `${Math.round(selected.confidence * 100)}%`}
                  </dd>
                </div>
                <div>
                  <dt>Modelo</dt>
                  <dd>{selected.model ?? "—"}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    entrada {selected.usage?.inputTokens ?? "—"} · saída{" "}
                    {selected.usage?.outputTokens ?? "—"} · total{" "}
                    {selected.usage?.totalTokens ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Justificativa operacional</dt>
                  <dd>{selected.reason ?? "—"}</dd>
                </div>
              </dl>

              <ol className="audit-timeline">
                {selected.audits.map((audit) => (
                  <li key={audit.id}>
                    <div className="audit-heading">
                      <strong>{audit.eventType}</strong>
                      <span>{audit.status}</span>
                    </div>
                    <small>
                      {formatDate(audit.createdAt)}
                      {audit.durationMs !== null
                        ? ` · ${audit.durationMs} ms`
                        : ""}
                    </small>
                    {audit.spanId && (
                      <p>
                        Span: {audit.spanId}
                        {audit.parentSpanId
                          ? ` · pai: ${audit.parentSpanId}`
                          : ""}
                      </p>
                    )}
                    {audit.toolName && <p>Ferramenta: {audit.toolName}</p>}
                    {audit.inputSummary && <p>Entrada: {audit.inputSummary}</p>}
                    {audit.outputSummary && (
                      <p>Resultado: {audit.outputSummary}</p>
                    )}
                    {audit.sourceRefs !== null && (
                      <p>Fontes: {stringify(audit.sourceRefs)}</p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
