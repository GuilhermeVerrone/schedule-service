"use client";

import { Loader2Icon, PencilIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/auth/form-alert";
import { PageFrame, PageHead } from "@/components/painel/catalog/page-head";
import { FormActions, RowPanel } from "@/components/painel/catalog/row-panel";
import { EmptyState, ListSkeleton, LoadError } from "@/components/painel/catalog/states";
import { useResource } from "@/components/painel/catalog/use-resource";
import { CONTROL } from "@/components/painel/settings/fields";
import { messageTypeLabel } from "@/components/painel/whatsapp/block-reasons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { localIssues, MESSAGE_TYPE_DETAILS, previewText, variableLabel } from "./template-text";
import {
  fetchTemplates,
  restoreDefault,
  saveVariations,
  templateIssues,
  type MessageTemplateDto,
  type TemplateIssueDto,
} from "./templates-api";

// /painel/mensagens (guia 3; D5, D16): os textos das mensagens automáticas, um por tipo da lista
// fechada, em linhas separadas por réguas. Editar abre no lugar (só uma linha aberta): variações
// com as variáveis do tipo, pré-visualização em texto puro com dados de exemplo e "Restaurar
// padrão" com "Desfazer" no toast. Não há criar nem excluir tipo: eles são do sistema.
// Celular: uma coluna (variações, depois a pré-visualização). Desktop: variações nas colunas 1 a 7
// e a pré-visualização fixa nas 8 a 12.

const sameOrder = (list: MessageTemplateDto[], template: MessageTemplateDto) =>
  list.map((item) => (item.id === template.id ? template : item));

export function TemplatesScreen() {
  const { state, reload, setData } = useResource(fetchTemplates);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const replace = (template: MessageTemplateDto) => setData((list) => sameOrder(list, template));

  async function restore(template: MessageTemplateDto) {
    setBusy(template.id);
    const result = await restoreDefault(template.id);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    replace(result.data);
    if (open === template.id) setOpen(null);
    const previous = template.variations;
    toast.success(`${messageTypeLabel(template.messageType)} voltou ao texto padrão.`, {
      action: {
        label: "Desfazer",
        onClick: () =>
          void (async () => {
            const undo = await saveVariations(template.id, previous);
            if (undo.ok) replace(undo.data);
            else toast.error(undo.message);
          })(),
      },
    });
  }

  return (
    <PageFrame>
      <PageHead
        title="Mensagens automáticas"
        lead="Os textos que o Slotz envia sozinho aos seus clientes. Cada mensagem tem algumas variações, sorteadas a cada envio, para o WhatsApp não receber sempre o mesmo texto."
      />
      <div className="mt-head-gap">
        {state.status === "loading" && <ListSkeleton label="Carregando as mensagens…" />}
        {state.status === "error" && <LoadError message={state.message} onRetry={() => void reload()} />}
        {state.status === "ready" && state.data.length === 0 && (
          <EmptyState
            title="Nenhuma mensagem automática"
            detail="Quando o Slotz tiver mensagens para enviar sozinho, como a confirmação de agendamento, os textos aparecem aqui para você ajustar."
          />
        )}
        {state.status === "ready" && state.data.length > 0 && (
          <ul aria-label="Mensagens automáticas" className="border-b border-line">
            {state.data.map((template) => (
              <li key={template.id} className="border-t border-line" data-testid={`template-${template.messageType}`}>
                {open === template.id ? (
                  <div className="py-4">
                    <TemplateEditor
                      template={template}
                      onCancel={() => setOpen(null)}
                      onSaved={(saved) => {
                        replace(saved);
                        setOpen(null);
                        toast.success("Alterações salvas.");
                      }}
                    />
                  </div>
                ) : (
                  <TemplateRow template={template}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOpen(template.id)}
                      aria-label={`Editar ${messageTypeLabel(template.messageType)}`}
                    >
                      <PencilIcon aria-hidden="true" />
                      Editar
                    </Button>
                    {!template.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void restore(template)}
                        disabled={busy === template.id}
                        aria-label={`Restaurar o texto padrão de ${messageTypeLabel(template.messageType)}`}
                      >
                        {busy === template.id ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
                        Restaurar padrão
                      </Button>
                    )}
                  </TemplateRow>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageFrame>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-pill bg-ink/7 px-2.5 py-1 text-micro text-ink">{children}</span>;
}

function TemplateRow({ template, children }: { template: MessageTemplateDto; children: ReactNode }) {
  const count = template.variations.length;
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <h2 className="text-title text-ink">{messageTypeLabel(template.messageType)}</h2>
        <p className="mt-1 max-w-[60ch] text-small text-ink-2">{MESSAGE_TYPE_DETAILS[template.messageType]}</p>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <Tag>{template.isDefault ? "Texto padrão" : "Personalizado"}</Tag>
          {!template.active && <Tag>Desligado</Tag>}
          <span className="text-micro text-ink-3 tabular-nums">
            {count} {count === 1 ? "variação" : "variações"}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Uma chave estável por variação: remover uma do meio não troca o texto das outras na tela.
let nextKey = 0;
const keyed = (texts: readonly string[]) => texts.map((text) => ({ key: nextKey++, text }));

function TemplateEditor({
  template,
  onCancel,
  onSaved,
}: {
  template: MessageTemplateDto;
  onCancel: () => void;
  onSaved: (template: MessageTemplateDto) => void;
}) {
  const { minVariations, maxVariations, maxLength } = template.limits;
  const label = messageTypeLabel(template.messageType);
  const [items, setItems] = useState(() => keyed(template.variations));
  const [selected, setSelected] = useState(0);
  const [issues, setIssues] = useState<TemplateIssueDto[]>([]);
  const [pending, setPending] = useState(false);
  const fields = useRef(new Map<number, HTMLTextAreaElement>());

  const errorAt = (index: number) => issues.find((issue) => issue.index === index)?.message;
  const listIssue = issues.find((issue) => issue.index === undefined)?.message;
  const current = Math.min(selected, items.length - 1);

  function edit(index: number, text: string) {
    setItems((list) => list.map((item, i) => (i === index ? { ...item, text } : item)));
    // O erro da variação some ao editá-la; os da lista inteira esperam o próximo "Salvar".
    setIssues((list) => list.filter((issue) => issue.index !== index));
  }

  function remove(index: number) {
    setItems((list) => list.filter((_, i) => i !== index));
    setIssues([]);
    setSelected((value) => Math.max(0, value >= index ? value - 1 : value));
  }

  function add() {
    const next = items.length;
    setItems((list) => [...list, ...keyed([""])]);
    setSelected(next);
    setIssues((list) => list.filter((issue) => issue.index !== undefined));
    requestAnimationFrame(() => fields.current.get(next)?.focus());
  }

  // Insere `{{variavel}}` onde está o cursor da variação selecionada.
  function insert(variable: string) {
    const index = current;
    const field = fields.current.get(index);
    const token = `{{${variable}}}`;
    const text = items[index].text;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    edit(index, text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function focusFirstError(found: TemplateIssueDto[]) {
    const first = found.find((issue) => issue.index !== undefined)?.index;
    if (first !== undefined) {
      setSelected(first);
      fields.current.get(first)?.focus();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const variations = items.map((item) => item.text);
    const found = localIssues(template.messageType, variations);
    if (found.length > 0) {
      setIssues(found);
      focusFirstError(found);
      return;
    }
    setPending(true);
    const result = await saveVariations(template.id, variations);
    setPending(false);
    if (result.ok) {
      onSaved(result.data);
      return;
    }
    const fromServer = templateIssues(result.issues);
    if (fromServer.length > 0) {
      setIssues(fromServer);
      focusFirstError(fromServer);
    } else {
      setIssues([{ code: result.code, message: result.message }]);
    }
  }

  return (
    <RowPanel>
      <form onSubmit={(event) => void submit(event)} noValidate aria-label={`Editar ${label}`}>
        <h2 className="text-title text-ink">{label}</h2>
        <p className="mt-1 max-w-[60ch] text-small text-ink-2">{MESSAGE_TYPE_DETAILS[template.messageType]}</p>

        <div className="mt-6 grid gap-8 lg:grid-cols-12 lg:items-start">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <fieldset className="flex flex-col gap-3">
              <legend className="text-small font-semibold text-ink">Variáveis</legend>
              <p id={`variaveis-${template.id}`} className="-mt-1 text-micro text-ink-3">
                Toque para inserir na variação {current + 1}. Na hora do envio, cada uma vira o dado do cliente.
              </p>
              <ul className="flex flex-wrap gap-2">
                {template.variables.map((variable) => (
                  <li key={variable} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => insert(variable)}
                      aria-label={`Inserir ${variableLabel(variable)} na variação ${current + 1}`}
                      className="flex min-h-chip max-w-full cursor-pointer items-center gap-1.5 rounded-pill border border-line-strong bg-surface px-3.5 text-small font-medium text-ink transition-[border-color,transform] duration-160 ease-brand-out outline-none active:scale-97 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink"
                    >
                      <PlusIcon aria-hidden="true" className="size-[15px] shrink-0 text-ink-2" />
                      <span className="truncate">{variableLabel(variable)}</span>
                      <span className="text-micro text-ink-3">{`{{${variable}}}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>

            <ol className="flex flex-col gap-5" aria-label="Variações">
              {items.map((item, index) => {
                const id = `variacao-${template.id}-${index}`;
                const error = errorAt(index);
                const length = item.text.length;
                return (
                  <li key={item.key} className="flex flex-col gap-2">
                    <div className="flex min-h-control-sm items-center justify-between gap-3">
                      <label htmlFor={id} className="text-small font-semibold text-ink">
                        Variação {index + 1}
                      </label>
                      {items.length > minVariations && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => remove(index)}
                          aria-label={`Remover a variação ${index + 1}`}
                        >
                          <XIcon aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                    <textarea
                      id={id}
                      ref={(element) => {
                        if (element) fields.current.set(index, element);
                        else fields.current.delete(index);
                      }}
                      value={item.text}
                      onChange={(event) => edit(index, event.target.value)}
                      onFocus={() => setSelected(index)}
                      rows={3}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-erro` : `${id}-tamanho`}
                      className={cn(CONTROL, "min-h-[120px] resize-y py-3 leading-[1.5]")}
                    />
                    {error ? (
                      <p id={`${id}-erro`} className="text-small text-danger">
                        {error}
                      </p>
                    ) : (
                      <p id={`${id}-tamanho`} className={cn("text-micro tabular-nums", length > maxLength ? "text-danger" : "text-ink-3")}>
                        {length} de {maxLength} caracteres
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>

            {items.length < maxVariations && (
              <Button type="button" variant="outline" size="sm" onClick={add} className="w-full sm:w-auto sm:self-start">
                <PlusIcon aria-hidden="true" />
                Adicionar variação
              </Button>
            )}
            <p className="-mt-3 text-micro text-ink-3">
              De {minVariations} a {maxVariations} variações. A cada envio o Slotz sorteia uma, sem repetir a última que o
              cliente recebeu.
            </p>
          </div>

          <Preview
            className="lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:col-span-5"
            text={previewText(template.messageType, items[current]?.text ?? "")}
            count={items.length}
            selected={current}
            onSelect={setSelected}
          />
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-line pt-6">
          {listIssue && <FormAlert message={listIssue} />}
          <FormActions pending={pending} submitLabel="Salvar alterações" pendingLabel="Salvando…" onCancel={onCancel} />
        </div>
      </form>
    </RowPanel>
  );
}

// Como o cliente recebe: texto puro (React escapa tudo; quebras de linha preservadas), com dados de
// exemplo no lugar das variáveis. Os números trocam a variação mostrada.
function Preview({
  text,
  count,
  selected,
  onSelect,
  className,
}: {
  text: string;
  count: number;
  selected: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="previa-titulo" className={cn("flex flex-col gap-3 rounded-frame bg-paper p-5 ring-1 ring-line", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="previa-titulo" className="text-label text-ink">
          Pré-visualização
        </h3>
        <span className="text-micro text-ink-3">Dados de exemplo</span>
      </div>
      <div role="group" aria-label="Variação mostrada" className="flex flex-wrap gap-1.5">
        {Array.from({ length: count }, (_, index) => (
          <button
            key={index}
            type="button"
            aria-pressed={index === selected}
            aria-label={`Mostrar a variação ${index + 1}`}
            onClick={() => onSelect(index)}
            className={cn(
              "flex size-control-sm cursor-pointer items-center justify-center rounded-pill border text-small font-semibold tabular-nums transition-[background-color,border-color,color] duration-160 ease-brand-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              index === selected
                ? "border-violet bg-violet text-on-dark"
                : "border-line-strong bg-surface text-ink [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink",
            )}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <p
        data-testid="previa-texto"
        aria-live="polite"
        className="rounded-control bg-surface px-4 py-3 text-body break-words whitespace-pre-wrap text-ink ring-1 ring-line"
      >
        {text.trim() === "" ? <span className="text-ink-3">Esta variação está vazia.</span> : text}
      </p>
    </section>
  );
}
