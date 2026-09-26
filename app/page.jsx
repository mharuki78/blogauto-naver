"use client";

import { useEffect, useState } from "react";

const initialForm = { blogId: "", topic: "", category: "", purpose: "", tone: "", sourceText: "" };

async function postJson(url, body, method = "POST") {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

export default function HomePage() {
  const [form, setForm] = useState(initialForm);
  const [jobs, setJobs] = useState([]);
  const [job, setJob] = useState(null);
  const [title, setTitle] = useState("");
  const [article, setArticle] = useState("");
  const [tags, setTags] = useState("");
  const [contextId, setContextId] = useState("");
  const [liveViewUrl, setLiveViewUrl] = useState("");
  const [sessionState, setSessionState] = useState("연결 전");
  const [visibility, setVisibility] = useState("public");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("blogauto-web-form");
    if (saved) { try { setForm({ ...initialForm, ...JSON.parse(saved) }); } catch {} }
    setContextId(localStorage.getItem("blogauto-context-id") || "");
    refreshJobs();
  }, []);

  async function refreshJobs() {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setJobs(data.jobs || []);
    } catch (error) { setNotice(error.message); }
  }

  function updateForm(key, value) {
    const next = { ...form, [key]: value };
    setForm(next);
    localStorage.setItem("blogauto-web-form", JSON.stringify(next));
  }

  function selectJob(item) {
    setJob(item);
    setTitle(item.title);
    setArticle(item.article);
    setTags((item.tags || []).join(", "));
    setNotice("");
  }

  async function generate(event) {
    event.preventDefault();
    setBusy("generate"); setNotice("");
    try {
      const sourceUrls = form.sourceText.split(/[\s,]+/).map((url) => url.trim()).filter(Boolean);
      const data = await postJson("/api/generate", { blogId: form.blogId, topic: form.topic, category: form.category, purpose: form.purpose, tone: form.tone, sourceUrls });
      selectJob(data.job);
      await refreshJobs();
      setNotice("초안이 클라우드에 저장되었습니다. 내용을 검토한 뒤 발행하세요.");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(""); }
  }

  async function saveDraft() {
    if (!job) return;
    setBusy("save"); setNotice("");
    try {
      const data = await postJson(`/api/jobs/${job.id}`, { title, article, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, "PATCH");
      selectJob(data.job);
      await refreshJobs();
      setNotice("수정한 초안이 저장되었습니다.");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(""); }
  }

  async function connectNaver() {
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(form.blogId)) { setNotice("먼저 올바른 네이버 블로그 ID를 입력해 주세요."); return; }
    setBusy("session"); setNotice(""); setSessionState("클라우드 브라우저 준비 중"); setLiveViewUrl("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blogId: form.blogId, contextId }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const block of blocks) {
          const type = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.match(/^data: (.+)$/m)?.[1];
          if (!type || !raw) continue;
          const data = JSON.parse(raw);
          if (type === "ready") {
            setContextId(data.contextId); localStorage.setItem("blogauto-context-id", data.contextId);
            setLiveViewUrl(data.liveViewUrl); setSessionState("네이버에서 직접 로그인해 주세요");
          } else if (type === "complete") {
            setSessionState("로그인 세션 저장됨"); setNotice(data.message); setLiveViewUrl("");
          } else if (type === "error" || type === "timeout") { throw new Error(data.message); }
        }
      }
    } catch (error) { setSessionState("연결 실패"); setNotice(error.message); }
    finally { setBusy(""); }
  }

  async function publish() {
    if (!job || !contextId) { setNotice("초안과 네이버 로그인 세션을 먼저 준비해 주세요."); return; }
    setBusy("publish"); setNotice("네이버 블로그에 발행 중입니다. 이 화면을 닫지 마세요.");
    try {
      const saved = await postJson(`/api/jobs/${job.id}`, { title, article, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, "PATCH");
      const data = await postJson("/api/publish", { jobId: saved.job.id, contextId, visibility });
      selectJob(data.job);
      await refreshJobs();
      setNotice("네이버 블로그 발행이 완료되었습니다.");
    } catch (error) { setNotice(error.message); }
    finally { setBusy(""); }
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">B</span><div><strong>blogauto</strong><small>네이버 블로그 작업실</small></div></div><div className="top-note"><span className="status-dot"/> Cloud workspace <span className="top-divider">/</span> 월 예산 $10</div></header>
    <main className="workspace">
      <div className="heading"><div><p className="eyebrow">WRITING DESK</p><h1>새 글을 준비하세요</h1><p>주제를 입력해 초안을 만들고, 내용을 확인한 뒤 네이버에 발행합니다.</p></div><div className="step-chip">01 <span>작성</span> <i/> 02 <span>검토</span> <i/> 03 <span>발행</span></div></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="columns"><section className="main-col">
        <form onSubmit={generate} className="panel form-panel"><div className="panel-heading"><div><span className="section-num">01</span><h2>글 생성</h2></div><span className="quiet">필수 항목 *</span></div>
          <div className="form-grid"><label>네이버 블로그 ID *<input value={form.blogId} onChange={(e) => updateForm("blogId", e.target.value)} placeholder="blog.naver.com/뒤의 ID" required /></label><label>카테고리<input value={form.category} onChange={(e) => updateForm("category", e.target.value)} placeholder="예: 생활 정보" /></label></div>
          <label>글 주제 *<textarea className="topic-field" value={form.topic} onChange={(e) => updateForm("topic", e.target.value)} placeholder="어떤 이야기를 쓰고 싶으신가요?" required /></label>
          <div className="form-grid"><label>발행 목적<input value={form.purpose} onChange={(e) => updateForm("purpose", e.target.value)} placeholder="예: 초보자에게 사용법 설명" /></label><label>원하는 어조<input value={form.tone} onChange={(e) => updateForm("tone", e.target.value)} placeholder="예: 친근하고 간결하게" /></label></div>
          <label>참고 URL <span className="quiet">최대 8개, 쉼표나 줄바꿈으로 구분</span><textarea className="source-field" value={form.sourceText} onChange={(e) => updateForm("sourceText", e.target.value)} placeholder="https://..." /></label>
          <div className="form-footer"><p>최신 사실은 발행 전 직접 확인해 주세요.</p><button className="button primary" disabled={!!busy}>{busy === "generate" ? "생성 중…" : "초안 생성하기 →"}</button></div>
        </form>
        <section className="panel draft-panel"><div className="panel-heading"><div><span className="section-num">02</span><h2>초안 검토</h2></div><span className={`draft-state ${job?.status === "published" ? "done" : ""}`}>{job?.status === "published" ? "발행 완료" : job ? "초안 저장됨" : "초안 없음"}</span></div>
          {job ? <><label>제목<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={job.status === "published"} /></label><label>본문<textarea className="article-field" value={article} onChange={(e) => setArticle(e.target.value)} disabled={job.status === "published"} /></label><label>태그 <span className="quiet">쉼표로 구분</span><input value={tags} onChange={(e) => setTags(e.target.value)} disabled={job.status === "published"} /></label><div className="form-footer"><p>{new Date(job.createdAt).toLocaleString("ko-KR")}</p>{job.status !== "published" && <button className="button secondary" onClick={saveDraft} disabled={!!busy}>수정 저장</button>}</div></> : <div className="empty-draft"><div className="empty-icon">✎</div><strong>아직 작성된 초안이 없습니다</strong><p>주제와 블로그 ID를 입력하고 초안을 생성해 보세요.</p></div>}
        </section>
      </section><aside className="side-col">
        <section className="panel side-panel"><div className="panel-heading"><div><span className="section-num">03</span><h2>네이버 발행</h2></div></div><p className="side-copy">네이버 아이디와 비밀번호는 이 앱에 입력하지 않습니다. 클라우드 브라우저의 네이버 화면에서 직접 로그인합니다.</p><div className="session-box"><span className="status-dot"/><div><small>로그인 상태</small><strong>{sessionState}</strong></div></div><button className="button secondary full" type="button" onClick={connectNaver} disabled={!!busy}>{busy === "session" ? "로그인 대기 중…" : contextId ? "네이버 다시 연결" : "네이버 연결하기"}</button>{liveViewUrl && <><a className="live-link" href={liveViewUrl} target="_blank" rel="noreferrer">로그인 창을 새 탭으로 열기 ↗</a><iframe className="live-view" title="네이버 클라우드 로그인" src={liveViewUrl} /></>}
          <div className="divider"/><label>공개 범위<select value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="public">전체 공개</option><option value="private">비공개</option></select></label><button className="button primary full publish-button" type="button" onClick={publish} disabled={!job || job.status === "published" || !contextId || !!busy}>{busy === "publish" ? "발행 중…" : "네이버에 발행하기 →"}</button><p className="side-footnote">발행은 버튼을 누른 뒤에만 시작됩니다.</p>
        </section>
        <section className="panel history-panel"><div className="panel-heading"><div><h2>최근 작업</h2></div><button className="text-button" onClick={refreshJobs}>새로고침 ↻</button></div>{jobs.length ? <div className="history-list">{jobs.slice(0, 8).map((item) => <button className={job?.id === item.id ? "history-item selected" : "history-item"} key={item.id} onClick={() => selectJob(item)}><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleDateString("ko-KR")} · {item.input.blogId}</small></span><em>{item.status === "published" ? "발행" : "초안"}</em></button>)}</div> : <p className="history-empty">저장된 작업이 없습니다.</p>}</section>
        <div className="budget-note"><strong>사용량 안내</strong><p>AI 생성에는 월 $5 프로젝트 예산을 설정했습니다. 이 예산은 소프트 한도입니다. 클라우드 브라우저는 Browserbase 무료 요금제로 연결하며, 전체 요금은 각 대시보드에서 확인해 주세요.</p></div>
      </aside></div>
    </main>
  </div>;
}
