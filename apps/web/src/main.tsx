import { StrictMode, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { languageLabel, normalizeLanguageCode, supportedLanguages, type CanonicalEvent, type StageStatus, type SupportedLanguageCode, type TranscriptFinal, type TranscriptPartial, type TranslationFinal } from "@drake/contracts";
import { IngestClient, type IngestState } from "./ingest-client.js";
import "./styles.css";

type Runtime = {
  stageStatus: string; audioStatus: string; sttStatus: string; translationStatus: Record<string, string>;
  provider: string; model: string; audioSeconds: number; reconnects: number; providerRecoveries?: number; rotations: number; gaps: number;
};

type Talk = {
  conferenceId: string; conferenceName: string; stageId: string; stageName: string; talkId: string;
  title: string; speaker: string; sourceLanguage: string; targetLanguages: string[]; status: string;
  configuredAt?: string; startedAt?: string; endedAt?: string; durationSeconds: number; runtime?: Runtime;
};

type Conference = { conferenceId: string; name: string; stageCount: number; liveTalkCount: number; status: "live" | "ready"; createdAt: string };
type Stage = { conferenceId: string; stageId: string; stageName: string; talkCount: number; currentTalk?: Talk };

const stageFromPath = () => location.pathname.split("/").filter(Boolean).at(-1) ?? "main";
const slugify = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const duration = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const getOpsKey = () => {
  const existing = sessionStorage.getItem("drakeOpsKey");
  const key = existing ?? window.prompt("Operations key") ?? "";
  if (key) sessionStorage.setItem("drakeOpsKey", key);
  return key;
};

const mutate = async <T,>(url: string, body: unknown): Promise<T> => {
  const key = getOpsKey();
  if (!key) throw new Error("Operations key required");
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-ops-key": key }, body: JSON.stringify(body) });
  if (response.status === 401) sessionStorage.removeItem("drakeOpsKey");
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
};

const postPublic = async <T,>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
};

function useJson<T>(url: string, refreshMs?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const refresh = () => fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Unavailable (${response.status})`);
    setData(await response.json() as T); setError(undefined);
  }).catch((reason) => setError(String(reason)));
  useEffect(() => {
    void refresh();
    if (!refreshMs) return;
    const timer = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [url, refreshMs]);
  return { data, error, refresh };
}

function Shell({ children, crumbs = [] }: { children: ReactNode; crumbs?: Array<{ label: string; href?: string }> }) {
  return <><header className="global-nav"><a className="brand" href="/"><span>◈</span> Drake</a><nav><a href="/">Eventos</a><a href="/ops">Operaciones</a></nav></header>
    <main>{crumbs.length > 0 && <nav className="breadcrumbs">{crumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`}>{index > 0 && " / "}{crumb.href ? <a href={crumb.href}>{crumb.label}</a> : crumb.label}</span>)}</nav>}{children}</main></>;
}

function StatusPill({ value }: { value: string }) { return <span className={`status-pill ${["live", "healthy"].includes(value) ? "good" : value === "error" || value === "failed" ? "bad" : ""}`}>{value}</span>; }

function Home() {
  const { data: events, error, refresh } = useJson<Conference[]>("/api/conferences");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    try {
      const created = await postPublic<Conference>("/api/conferences", { name, conferenceId: slug || slugify(name) });
      location.href = `/events/${created.conferenceId}`;
    } catch (reason) { setMessage(String(reason)); }
  };
  return <Shell><section className="hero"><div><p className="eyebrow">Open-source conference accessibility</p><h1>Eventos multilingües, en vivo.</h1><p>Administrá escenarios, captions, traducciones y resultados desde un único lugar.</p></div><button className="primary-action" onClick={() => setCreating((value) => !value)}>+ Crear evento</button></section>
    {creating && <form className="product-form compact" onSubmit={submit}><label>Nombre del evento<input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} required /></label><label>Slug<input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required /></label><button>Crear evento</button>{message && <p className="form-error">{message}</p>}</form>}
    <section className="section-head"><div><p className="eyebrow">Workspace</p><h2>Eventos</h2></div><span>{events?.length ?? 0} configurados</span></section>
    {error && <div className="empty">{error}</div>}
    <section className="product-grid">{events?.map((conference) => <a className="product-card" href={`/events/${conference.conferenceId}`} key={conference.conferenceId}><div className="card-title"><h3>{conference.name}</h3><StatusPill value={conference.status} /></div><p>{conference.stageCount} escenarios · {conference.liveTalkCount} en vivo</p><span className="open-link">Abrir evento →</span></a>)}</section>
    {events?.length === 0 && <div className="empty">Todavía no hay eventos. Creá el primero para comenzar.</div>}
  </Shell>;
}

function EventWorkspace({ conferenceId }: { conferenceId: string }) {
  const { data, error, refresh } = useJson<{ conference: Conference; stages: Stage[] }>(`/api/conferences/${conferenceId}`);
  const [creating, setCreating] = useState(false);
  const [stageName, setStageName] = useState("");
  const [stageId, setStageId] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    try {
      await postPublic(`/api/conferences/${conferenceId}/stages`, { stageName, stageId: stageId || `${conferenceId}-${slugify(stageName)}` });
      setCreating(false); setStageName(""); setStageId(""); refresh();
    } catch (reason) { setMessage(String(reason)); }
  };
  return <Shell crumbs={[{ label: "Eventos", href: "/" }, { label: data?.conference.name ?? conferenceId }]}>
    <section className="page-heading"><div><p className="eyebrow">Evento</p><h1>{data?.conference.name ?? "Cargando…"}</h1><p>{data?.conference.stageCount ?? 0} escenarios configurados</p></div><div className="heading-actions"><a href={`/events/${conferenceId}/ops`}>Abrir operaciones</a><button onClick={() => setCreating((value) => !value)}>+ Crear escenario</button></div></section>
    {error && <div className="empty">{error}</div>}
    {creating && <form className="product-form compact" onSubmit={submit}><label>Nombre del escenario<input value={stageName} onChange={(e) => { setStageName(e.target.value); if (!stageId) setStageId(`${conferenceId}-${slugify(e.target.value)}`); }} required /></label><label>Identificador<input value={stageId} onChange={(e) => setStageId(slugify(e.target.value))} required /></label><button>Crear escenario</button>{message && <p className="form-error">{message}</p>}</form>}
    <section className="product-grid">{data?.stages.map((stage) => <article className="product-card" key={stage.stageId}><div className="card-title"><div><p className="eyebrow">{stage.stageName}</p><h3>{stage.currentTalk?.title ?? "Sin charla configurada"}</h3></div><StatusPill value={stage.currentTalk?.status ?? "offline"} /></div><p>{stage.currentTalk ? `${stage.currentTalk.speaker} · ${languageLabel(stage.currentTalk.sourceLanguage)} → ${stage.currentTalk.targetLanguages.map(languageLabel).join(" + ")}` : `${stage.talkCount} charlas en historial`}</p><div className="card-links"><a href={`/events/${conferenceId}/stages/${stage.stageId}`}>Administrar</a>{stage.currentTalk && <><a href={`/ingest/${stage.stageId}`}>Control live</a><a href={`/event/${conferenceId}/stage/${stage.stageId}`}>Audience</a></>}</div></article>)}</section>
  </Shell>;
}

function LanguageConfiguration({ source, targets, onSource, onTargets }: { source: SupportedLanguageCode; targets: SupportedLanguageCode[]; onSource: (value: SupportedLanguageCode) => void; onTargets: (value: SupportedLanguageCode[]) => void }) {
  const available = supportedLanguages.filter((language) => language.code !== source);
  const changeSource = (next: SupportedLanguageCode) => { onSource(next); onTargets(targets.filter((target) => target !== next)); };
  return <fieldset className="language-config"><legend>Idiomas</legend><label>Idioma original<select value={source} onChange={(event) => changeSource(event.target.value as SupportedLanguageCode)}>{supportedLanguages.map((language) => <option value={language.code} key={language.code}>{language.label}</option>)}</select></label><div><span>Traducir a</span><div className="check-grid">{available.map((language) => <label className="check" key={language.code}><input type="checkbox" checked={targets.includes(language.code)} onChange={(event) => onTargets(event.target.checked ? [...targets, language.code] : targets.filter((target) => target !== language.code))} />{language.label}</label>)}</div></div></fieldset>;
}

function StageWorkspace({ conferenceId, stageId }: { conferenceId: string; stageId: string }) {
  const { data, error, refresh } = useJson<{ conference: Conference; stage: Stage; talks: Talk[] }>(`/api/conferences/${conferenceId}/stages/${stageId}`);
  const [configuring, setConfiguring] = useState(false);
  const [title, setTitle] = useState(""); const [speaker, setSpeaker] = useState("");
  const [source, setSource] = useState<SupportedLanguageCode>("en"); const [targets, setTargets] = useState<SupportedLanguageCode[]>(["es"]);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (targets.length === 0) { setMessage("Seleccioná al menos un idioma de traducción."); return; }
    const talkId = `${conferenceId}-${stageId}-${slugify(title)}-${Date.now().toString(36)}`;
    try {
      await postPublic(`/api/conferences/${conferenceId}/stages/${stageId}/talks`, { talkId, title, speaker, sourceLanguage: source, targetLanguages: targets });
      setConfiguring(false); setTitle(""); setSpeaker(""); refresh();
    } catch (reason) { setMessage(String(reason)); }
  };
  const current = data?.stage.currentTalk;
  const completed = data?.talks.filter((talk) => talk.status === "completed") ?? [];
  return <Shell crumbs={[{ label: "Eventos", href: "/" }, { label: data?.conference.name ?? conferenceId, href: `/events/${conferenceId}` }, { label: data?.stage.stageName ?? stageId }]}>
    <section className="page-heading"><div><p className="eyebrow">Escenario</p><h1>{data?.stage.stageName ?? "Cargando…"}</h1><p>{data?.talks.length ?? 0} charlas configuradas</p></div><button className="primary-action" onClick={() => setConfiguring((value) => !value)}>+ Configurar charla</button></section>
    {error && <div className="empty">{error}</div>}
    {configuring && <form className="product-form" onSubmit={submit}><label>Título de la charla<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label>Speaker<input value={speaker} onChange={(e) => setSpeaker(e.target.value)} required /></label><LanguageConfiguration source={source} targets={targets} onSource={setSource} onTargets={setTargets} /><button>Guardar charla</button>{message && <p className="form-error">{message}</p>}</form>}
    <section className="current-talk"><div className="section-head"><div><p className="eyebrow">Charla actual</p><h2>{current?.title ?? "Sin charla preparada"}</h2></div>{current && <StatusPill value={current.status} />}</div>{current && <><p>{current.speaker} · <strong>{languageLabel(current.sourceLanguage)}</strong> → {current.targetLanguages.map(languageLabel).join(" + ")}</p><div className="action-grid"><a className="action-card primary-card" href={`/ingest/${stageId}`}><strong>Abrir control live</strong><span>Capturar audio e iniciar captions →</span></a><a className="action-card" href={`/event/${conferenceId}/stage/${stageId}`}><strong>Abrir Audience</strong><span>Vista para asistentes →</span></a><a className="action-card" href={`/overlay/${conferenceId}/${stageId}?lang=${current.targetLanguages[0]}&mode=both`}><strong>Abrir OBS Overlay</strong><span>Browser Source transparente →</span></a></div></>}</section>
    <section><div className="section-head"><div><p className="eyebrow">Archivo</p><h2>Historial de charlas</h2></div><span>{completed.length} finalizadas</span></div><div className="history-list">{completed.map((talk) => <a href={`/events/${conferenceId}/stages/${stageId}/talks/${talk.talkId}/results`} key={talk.talkId}><div><strong>{talk.title}</strong><span>{talk.speaker} · {languageLabel(talk.sourceLanguage)} → {talk.targetLanguages.map(languageLabel).join(" + ")}</span></div><div><span>{duration(talk.durationSeconds)}</span><b>Ver resultados →</b></div></a>)}{completed.length === 0 && <div className="empty">Las charlas finalizadas aparecerán acá con transcript y exports.</div>}</div></section>
  </Shell>;
}

function Results({ conferenceId, stageId, talkId }: { conferenceId: string; stageId: string; talkId: string }) {
  const { data, error } = useJson<{ talk: Talk; original: TranscriptFinal[]; translations: TranslationFinal[] }>(`/api/conferences/${conferenceId}/stages/${stageId}/talks/${talkId}`);
  const [tab, setTab] = useState<"transcript" | "exports">("transcript");
  const [target, setTarget] = useState("es");
  useEffect(() => { if (data?.talk.targetLanguages[0] && !data.talk.targetLanguages.includes(target)) setTarget(data.talk.targetLanguages[0]); }, [data, target]);
  return <Shell crumbs={[{ label: "Eventos", href: "/" }, { label: data?.talk.conferenceName ?? conferenceId, href: `/events/${conferenceId}` }, { label: data?.talk.stageName ?? stageId, href: `/events/${conferenceId}/stages/${stageId}` }, { label: "Resultados" }]}>
    {error ? <div className="empty">{error}</div> : <><section className="page-heading"><div><p className="eyebrow">Resultados · {data?.talk.stageName}</p><h1>{data?.talk.title ?? "Cargando…"}</h1><p>{data?.talk.speaker} · {duration(data?.talk.durationSeconds)}</p></div><StatusPill value={data?.talk.status ?? "loading"} /></section>
      <nav className="result-tabs"><button className={tab === "transcript" ? "active" : ""} onClick={() => setTab("transcript")}>Transcript</button><button className={tab === "exports" ? "active" : ""} onClick={() => setTab("exports")}>Exportar</button></nav>
      {tab === "transcript" && <section><div className="result-toolbar"><span>Original: <strong>{languageLabel(data?.talk.sourceLanguage ?? "")}</strong></span>{data && data.talk.targetLanguages.length > 0 && <select value={target} onChange={(e) => setTarget(e.target.value)}>{data.talk.targetLanguages.map((language) => <option value={language} key={language}>{languageLabel(language)}</option>)}</select>}</div><div className="transcript-list">{data?.original.map((original) => { const translated = data.translations.find((item) => item.sourceSegmentId === original.segmentId && item.targetLanguage === target); return <article key={original.segmentId}><time>{duration(Math.round(original.audioStartSample / original.sampleRate))}</time><div><p>{original.text}</p>{translated && <p className="translated">{translated.text}</p>}</div></article>; })}</div>{data?.original.length === 0 && <div className="empty">Esta charla todavía no tiene transcript final persistido.</div>}</section>}
      {tab === "exports" && data && <section className="export-panel"><h2>Descargar captions</h2><p>Los timestamps provienen del reloj canónico del audio.</p><div className="export-grid"><a href={`/api/talks/${talkId}/export.vtt?language=original`}>Original · VTT</a><a href={`/api/talks/${talkId}/export.txt?language=original`}>Original · TXT</a>{data.talk.targetLanguages.flatMap((language) => [<a key={`${language}-vtt`} href={`/api/talks/${talkId}/export.vtt?language=${language}`}>{languageLabel(language)} · VTT</a>, <a key={`${language}-txt`} href={`/api/talks/${talkId}/export.txt?language=${language}`}>{languageLabel(language)} · TXT</a>])}</div></section>}</>}
  </Shell>;
}

function useStage(stageId: string) {
  return useJson<Talk>(`/api/stages/${stageId}`, 3_000);
}

function useCaptions(talkId?: string) {
  const [partial, setPartial] = useState<TranscriptPartial>(); const [finals, setFinals] = useState<TranscriptFinal[]>([]);
  const [translations, setTranslations] = useState<Record<string, TranslationFinal>>({}); const [status, setStatus] = useState<StageStatus>(); const [connected, setConnected] = useState(false);
  useEffect(() => {
    setPartial(undefined); setFinals([]); setTranslations({}); setStatus(undefined);
    if (!talkId) return;
    const source = new EventSource(`/api/events/${talkId}`); source.onopen = () => setConnected(true); source.onerror = () => setConnected(false);
    const consume = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as CanonicalEvent;
      if (event.type === "transcript.partial") setPartial(event);
      if (event.type === "transcript.final") { setPartial((current) => current?.segmentId === event.segmentId ? undefined : current); setFinals((items) => [...items.filter((item) => item.segmentId !== event.segmentId), event].sort((a, b) => a.sequence - b.sequence).slice(-12)); }
      if (event.type === "translation.final") setTranslations((items) => ({ ...items, [`${event.sourceSegmentId}:${event.targetLanguage}`]: event }));
      if (event.type === "stage.status") setStatus(event);
    };
    for (const type of ["transcript.partial", "transcript.final", "translation.final", "stage.status"]) source.addEventListener(type, consume as EventListener);
    return () => source.close();
  }, [talkId]);
  return { partial, finals, translations, status, connected };
}

function CaptionRows({ talkId, target, mode, overlay = false, lifecycle }: { talkId: string | undefined; target: string; mode: "both" | "original" | "translation"; overlay?: boolean; lifecycle?: string }) {
  const { partial, finals, translations, connected } = useCaptions(talkId);
  const rows = finals.slice(overlay ? -2 : -6).map((original) => ({ original, translation: translations[`${original.segmentId}:${target}`] }));
  const badge = !connected ? "RECONNECTING" : lifecycle === "live" ? "● LIVE" : (lifecycle ?? "connected").toUpperCase();
  return <>{!overlay && <span className={`live-badge ${connected && lifecycle === "live" ? "online" : "offline"}`}>{badge}</span>}<section className={`caption-feed ${overlay ? "overlay-feed" : ""}`} aria-live="polite">{rows.length === 0 && !partial && !overlay && <div className="empty">Esperando audio del escenario…</div>}{rows.map(({ original, translation }) => <article className="caption-card" key={original.segmentId}>{mode !== "translation" && <p className="original">{original.text}</p>}{mode !== "original" && <p className={`translation ${translation ? "" : "pending"}`}>{translation?.text ?? "Traduciendo…"}</p>}</article>)}{partial && mode !== "translation" && <article className="caption-card current"><p className="original">{partial.text}<span className="cursor" /></p></article>}</section></>;
}

function Audience() {
  const stageId = stageFromPath(); const { data: stage, error } = useStage(stageId);
  const [mode, setMode] = useState<"both" | "original" | "translation">("both"); const [target, setTarget] = useState("");
  useEffect(() => { if (stage?.targetLanguages[0] && !stage.targetLanguages.includes(target)) setTarget(stage.targetLanguages[0]); }, [stage, target]);
  if (!stage) return <Shell><div className="empty">{error ?? "Cargando escenario…"}</div></Shell>;
  return <Shell crumbs={[{ label: stage.conferenceName, href: `/events/${stage.conferenceId}` }, { label: stage.stageName }]}><main className="audience-shell"><header className="audience-header"><div><p className="eyebrow">{stage.conferenceName} · {stage.stageName}</p><h1>{stage.title}</h1><p className="speaker">{stage.speaker}</p></div><StatusPill value={stage.status === "live" ? "live" : stage.status} /></header><div className="audience-controls"><nav className="mode-switch" aria-label="Caption display mode">{(["original", "both", "translation"] as const).map((item) => <button className={mode === item ? "active" : ""} onClick={() => setMode(item)} key={item}>{item === "both" ? "Original + traducción" : item === "original" ? "Original" : "Traducción"}</button>)}</nav>{mode !== "original" && <label className="target-control">Idioma<select value={target} onChange={(event) => setTarget(event.target.value)}>{stage.targetLanguages.map((language) => <option value={language} key={language}>{languageLabel(language)}</option>)}</select></label>}</div><p className="language-context">Original en <strong>{languageLabel(stage.sourceLanguage)}</strong>{stage.targetLanguages.length > 0 && <> · Traducciones: {stage.targetLanguages.map(languageLabel).join(" + ")}</>}</p><CaptionRows talkId={stage.talkId} target={target} mode={mode} /><div className="audience-meta"><span>Captions de accesibilidad en tiempo real</span>{stage.status === "completed" && <a href={`/events/${stage.conferenceId}/stages/${stage.stageId}/talks/${stage.talkId}/results`}>Ver transcript y descargas →</a>}</div></main></Shell>;
}

function Overlay() { const stageId = stageFromPath(); const { data: stage } = useStage(stageId); const query = new URLSearchParams(location.search); const target = query.get("lang") ?? stage?.targetLanguages[0] ?? ""; const requestedMode = query.get("mode"); const mode = requestedMode === "original" || requestedMode === "translation" ? requestedMode : "both"; return <main className="overlay-shell"><CaptionRows talkId={stage?.talkId} target={target} mode={mode} overlay /></main>; }

function Ingest() {
  const stageId = stageFromPath(); const { data: stage, error } = useStage(stageId); const [state, setState] = useState<IngestState>("idle"); const [detail, setDetail] = useState("Listo para conectar"); const [level, setLevel] = useState(0);
  const client = useMemo(() => stage ? new IngestClient(stage.stageId, stage.talkId, stage.sourceLanguage, (next, message) => { setState(next); setDetail(message ?? (next === "live" ? "Audio conectado" : next)); }, setLevel) : undefined, [stage?.stageId, stage?.talkId, stage?.sourceLanguage]);
  const start = async () => { try { await client?.start(); } catch (reason) { setState("error"); setDetail(reason instanceof Error ? reason.message : String(reason)); } };
  if (!stage) return <Shell><div className="empty">{error ?? "Cargando control live…"}</div></Shell>;
  return <Shell crumbs={[{ label: stage.conferenceName, href: `/events/${stage.conferenceId}` }, { label: stage.stageName, href: `/events/${stage.conferenceId}/stages/${stage.stageId}` }, { label: "Control live" }]}><section className="ingest-shell"><p className="eyebrow">Control live · {stage.stageName}</p><h1>{stage.title}</h1><p className="speaker">{stage.speaker} · {languageLabel(stage.sourceLanguage)} → {stage.targetLanguages.map(languageLabel).join(" + ")}</p><div className="ingest-panel"><div className={`status-orb ${state}`} /><div><strong>{state === "idle" ? "LISTO" : state.toUpperCase()}</strong><p>{detail}</p></div><div className="meter"><span style={{ width: `${Math.max(2, level * 100)}%` }} /></div>{state === "idle" || state === "error" ? <button className="primary" onClick={start}>Iniciar captions en vivo</button> : <button className="danger" onClick={() => void client?.stop()} disabled={state === "connecting"}>Finalizar charla</button>}</div><div className="link-row"><a href={`/event/${stage.conferenceId}/stage/${stage.stageId}`}>Abrir Audience →</a><a href={`/overlay/${stage.conferenceId}/${stage.stageId}?lang=${stage.targetLanguages[0]}`}>Abrir OBS Overlay →</a></div></section></Shell>;
}

function Operations({ conferenceId }: { conferenceId?: string }) {
  const operationsUrl = conferenceId ? `/api/ops/stages?conferenceId=${encodeURIComponent(conferenceId)}` : "/api/ops/stages";
  const { data: stages, refresh } = useJson<Talk[]>(operationsUrl, 2_000);
  const command = async (stage: Talk, action: "start" | "stop") => { try { await mutate(`/api/ops/stages/${stage.stageId}/${action}`, { talkId: stage.talkId }); refresh(); } catch (reason) { window.alert(String(reason)); } };
  const conferenceName = stages?.[0]?.conferenceName ?? conferenceId;
  const crumbs = conferenceId
    ? [{ label: "Eventos", href: "/" }, { label: conferenceName ?? conferenceId, href: `/events/${conferenceId}` }, { label: "Operaciones" }]
    : [{ label: "Operaciones" }];
  return <Shell crumbs={crumbs}>
    <section className="page-heading"><div><p className="eyebrow">{conferenceId ? "Operaciones del evento" : "Centro de operación global"}</p><h1>{conferenceName ?? "Escenarios"}</h1><p>Estado de captions y traducciones en tiempo real.</p></div><span>{stages?.length ?? 0} pipelines</span></section>
    <section className="stage-grid">{stages?.map((stage) => {
      const runtime = stage.runtime;
      const primaryStatus = runtime?.stageStatus ?? stage.status;
      const captionHealth = runtime?.sttStatus ?? "offline";
      const translationHealth = runtime ? Object.values(runtime.translationStatus).some((value) => value !== "healthy") ? "degraded" : "healthy" : "offline";
      const completed = primaryStatus === "completed";
      return <article className="stage-card" key={`${stage.stageId}:${stage.talkId}`}>
        <div className="stage-card-head"><div><p className="eyebrow">{stage.stageName}</p><h2>{stage.title}</h2><p>{stage.speaker}</p></div><StatusPill value={primaryStatus} /></div>
        <p className="language-route">{languageLabel(stage.sourceLanguage)} → {stage.targetLanguages.map(languageLabel).join(" + ")}</p>
        <dl className="operator-metrics"><div><dt>Captions</dt><dd>{captionHealth}</dd></div><div><dt>Traducción</dt><dd>{translationHealth}</dd></div><div><dt>Duración</dt><dd>{duration(Math.round(runtime?.audioSeconds ?? stage.durationSeconds))}</dd></div></dl>
        <div className="card-actions">
          {!completed && <a className="main-action" href={`/ingest/${stage.stageId}`}>Control live</a>}
          <a href={`/event/${stage.conferenceId}/stage/${stage.stageId}`}>Audience</a>
          {!completed && <a href={`/overlay/${stage.conferenceId}/${stage.stageId}?lang=${stage.targetLanguages[0]}`}>OBS</a>}
          {completed && <a className="main-action" href={`/events/${stage.conferenceId}/stages/${stage.stageId}/talks/${stage.talkId}/results`}>Ver resultados</a>}
          {primaryStatus === "ready" && <button onClick={() => void command(stage, "start")}>Preparar</button>}
          {["live", "starting", "finalizing"].includes(primaryStatus) && <button className="stop" onClick={() => void command(stage, "stop")}>Finalizar</button>}
        </div>
        <details><summary>Detalles técnicos</summary><dl className="technical-metrics"><div><dt>Audio</dt><dd>{runtime?.audioStatus ?? "disconnected"}</dd></div><div><dt>STT</dt><dd>{runtime?.sttStatus ?? "disconnected"}</dd></div><div><dt>Provider</dt><dd>{runtime?.provider ?? "—"}</dd></div><div><dt>Reconexiones</dt><dd>{runtime?.reconnects ?? 0}</dd></div><div><dt>Recuperaciones</dt><dd>{runtime?.providerRecoveries ?? 0}</dd></div><div><dt>Gaps</dt><dd>{runtime?.gaps ?? 0}</dd></div></dl></details>
      </article>;
    })}</section>
  </Shell>;
}

function App() {
  const path = location.pathname; const parts = path.split("/").filter(Boolean);
  if (path === "/") return <Home />;
  if (path === "/ops") return <Operations />;
  if (path.startsWith("/ingest/")) return <Ingest />;
  if (path.startsWith("/overlay/")) return <Overlay />;
  if (path.startsWith("/event/")) return <Audience />;
  if (parts[0] === "events" && parts.length === 2) return <EventWorkspace conferenceId={parts[1]!} />;
  if (parts[0] === "events" && parts[2] === "ops" && parts.length === 3) return <Operations conferenceId={parts[1]!} />;
  if (parts[0] === "events" && parts[2] === "stages" && parts.length === 4) return <StageWorkspace conferenceId={parts[1]!} stageId={parts[3]!} />;
  if (parts[0] === "events" && parts[2] === "stages" && parts[4] === "talks" && parts[6] === "results") return <Results conferenceId={parts[1]!} stageId={parts[3]!} talkId={parts[5]!} />;
  return <Shell><div className="empty"><h2>Página no encontrada</h2><a href="/">Volver a eventos</a></div></Shell>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
