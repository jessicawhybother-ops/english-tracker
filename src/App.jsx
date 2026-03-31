import { useState, useRef, useEffect, useCallback } from "react";

const systemPrompt = `You are a warm, friendly English conversation coach having a real spoken conversation with a learner.
Respond naturally and conversationally. Keep replies concise (2-4 sentences) since this is spoken.
Then provide structured feedback.

IMPORTANT: Return ONLY valid JSON, no markdown, no backticks, no extra text before or after.

{
  "reply": "Your short natural response + one follow-up question",
  "feedback": {
    "grammar": "Brief grammar note or Great job — no issues!",
    "vocabulary": "Brief vocab note",
    "pronunciation": "One pronunciation tip",
    "focusOn": "Single most important thing to improve"
  },
  "scores": {
    "grammar": 8,
    "vocabulary": 7,
    "speed": 8,
    "intonation": 7,
    "fluency": 8,
    "clarity": 9,
    "confidence": 8,
    "overall": 8
  }
}`;

const C = {
  bg:"#f0faf4", sidebar:"#ffffff", sidebarBorder:"#c6e8d4",
  cardBorder:"#d1ede0", header:"#ffffff", headerBorder:"#c6e8d4",
  assistantBubble:"#edf7f1", feedbackBg:"#f5fbf7", feedbackBorder:"#c6e8d4",
  scoreBox:"#edf7f1", text:"#1f4733", subtext:"#4a7c63", muted:"#7fb89a",
  accent1:"#2d9e6b", accent2:"#1a7a50", green:"#22a55a", amber:"#d08b2e",
  red:"#c0392b", tagBg:"#d4f0e2",
};

const INDICATORS = [
  { key:"grammar",    label:"Grammar",    emoji:"🔤" },
  { key:"vocabulary", label:"Vocabulary", emoji:"📚" },
  { key:"speed",      label:"Speed",      emoji:"⚡" },
  { key:"intonation", label:"Intonation", emoji:"🎵" },
  { key:"fluency",    label:"Fluency",    emoji:"💬" },
  { key:"clarity",    label:"Clarity",    emoji:"🔍" },
  { key:"confidence", label:"Confidence", emoji:"💪" },
];

const scoreColor = v => v >= 8 ? C.green : v >= 6 ? C.amber : C.red;

const ScoreBar = ({ label, value }) => {
  const color = scoreColor(value);
  return (
    <div style={{ marginBottom:9 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3, color:C.subtext }}>
        <span>{label}</span><span style={{ fontWeight:700, color }}>{value}/10</span>
      </div>
      <div style={{ background:"#d4ede1", borderRadius:999, height:7 }}>
        <div style={{ width:`${value*10}%`, background:color, borderRadius:999, height:7, transition:"width 0.6s ease" }}/>
      </div>
    </div>
  );
};

const Avatar = ({ role }) => (
  <div style={{
    width:38, height:38, borderRadius:"50%", flexShrink:0,
    background: role==="assistant"
      ? "linear-gradient(135deg,#2d9e6b,#38b07a)"
      : "linear-gradient(135deg,#56c9a0,#8ddfc0)",
    display:"flex", alignItems:"center", justifyContent:"center",
    fontSize:18, boxShadow:"0 2px 8px rgba(45,158,107,0.2)"
  }}>
    {role==="assistant" ? "🌿" : "🙂"}
  </div>
);

export default function App() {
  const [messages, setMessages]       = useState([]);
  const [scores, setScores]           = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [status, setStatus]           = useState("idle");
  const [transcript, setTranscript]   = useState("");
  const [error, setError]             = useState("");
  const bottomRef        = useRef(null);
  const recognitionRef   = useRef(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("et_sessions");
      if (saved) setAllSessions(JSON.parse(saved));
    } catch(e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (allSessions.length === 0) return;
    try { localStorage.setItem("et_sessions", JSON.stringify(allSessions)); }
    catch(e) { console.error(e); }
  }, [allSessions]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, status]);

  const avg    = key => scores.length    ? (scores.reduce((s,r)=>s+(r[key]||0),0)/scores.length).toFixed(1) : 0;
  const allScores = allSessions.flatMap(s => s.scores);
  const avgAll = key => allScores.length ? (allScores.reduce((s,r)=>s+(r[key]||0),0)/allScores.length).toFixed(1) : 0;

  useEffect(() => {
    if (scores.length === 0) return;
    setAllSessions(prev => {
      const updated = prev.map(s => s.current ? { ...s, scores, messageCount: scores.length } : s);
      localStorage.setItem("et_sessions", JSON.stringify(updated));
      return updated;
    });
  }, [scores]);

  const speak = useCallback((text, onEnd) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95; utt.pitch = 1.05; utt.lang = "en-US";
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => /samantha|karen|google uk english female/i.test(v.name)) ||
      voices.find(v => v.lang === "en-US") ||
      voices.find(v => v.lang.startsWith("en"));
    if (preferred) utt.voice = preferred;
    utt.onend  = () => { setStatus("idle"); onEnd?.(); };
    utt.onerror= () => { setStatus("idle"); onEnd?.(); };
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, []);

  const callAPI = async (history) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-iab": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: history,
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const raw  = data.content?.find(b => b.type==="text")?.text || "";
    return JSON.parse(raw.replace(/```json|```/g,"").trim());
  };

  const handleAPIResponse = useCallback(async (history) => {
    setError(""); setStatus("thinking");
    try {
      const parsed = await callAPI(history);
      setMessages(prev => [...prev, { role:"assistant", parsed }]);
      setScores(prev  => [...prev, parsed.scores]);
      speak(parsed.reply);
    } catch(e) {
      console.error(e);
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }, [speak]);

  const startSession = async () => {
    const entry = { id:Date.now(), date:new Date().toLocaleString(), scores:[], messageCount:0, current:true };
    setAllSessions(prev => {
      const next = [...prev.map(s=>({...s,current:false})), entry];
      localStorage.setItem("et_sessions", JSON.stringify(next));
      return next;
    });
    setScores([]); setMessages([]); setSessionStarted(true);
    const init = { role:"user", content:"Hello! I want to practice my spoken English today." };
    setMessages([init]);
    await handleAPIResponse([{ role:"user", content:init.content }]);
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("Speech recognition not supported. Please use Chrome or Edge."); return; }
    window.speechSynthesis.cancel();
    setTranscript(""); finalTranscriptRef.current = ""; setError("");
    const recog = new SR();
    recog.lang = "en-US"; recog.interimResults = true; recog.continuous = false;
    recog.onstart  = () => setStatus("listening");
    recog.onresult = e => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        e.results[i].isFinal ? (final += t) : (interim += t);
      }
      if (final) finalTranscriptRef.current += final;
      setTranscript(finalTranscriptRef.current || interim);
    };
    recog.onend = async () => {
      const spoken = finalTranscriptRef.current.trim();
      setTranscript("");
      if (!spoken) { setStatus("idle"); return; }
      setMessages(prev => [...prev, { role:"user", content:spoken }]);
      const history = [
        ...messages.map(m => m.role==="user"
          ? { role:"user", content:m.content }
          : { role:"assistant", content:JSON.stringify(m.parsed) }),
        { role:"user", content:spoken },
      ];
      await handleAPIResponse(history);
    };
    recog.onerror = e => {
      if (e.error !== "no-speech") setError(`Mic error: ${e.error}`);
      setStatus("idle");
    };
    recognitionRef.current = recog;
    recog.start();
  };

  const stopListening = () => recognitionRef.current?.stop();
  const isListening = status === "listening";
  const isThinking  = status === "thinking";
  const isSpeaking  = status === "speaking";
  const micDisabled = isThinking || isSpeaking;

  const clearAll = () => {
    localStorage.removeItem("et_sessions");
    setAllSessions([]); setScores([]); setMessages([]);
    setSessionStarted(false); setStatus("idle"); setError("");
    window.speechSynthesis.cancel();
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, color:C.text, fontFamily:"'Inter',sans-serif", overflow:"hidden" }}>
      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(231,76,60,0.5), 0 4px 20px rgba(231,76,60,0.4); }
          70%  { box-shadow: 0 0 0 18px rgba(231,76,60,0), 0 4px 20px rgba(231,76,60,0.4); }
          100% { box-shadow: 0 0 0 0 rgba(231,76,60,0), 0 4px 20px rgba(231,76,60,0.4); }
        }
        @keyframes bounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
      `}</style>

      {/* Sidebar */}
      <div style={{ width:252, background:C.sidebar, borderRight:`1px solid ${C.sidebarBorder}`, display:"flex", flexDirection:"column", padding:18, gap:16, flexShrink:0, overflowY:"auto", boxShadow:"2px 0 12px rgba(45,158,107,0.06)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, paddingBottom:12, borderBottom:`1px solid ${C.sidebarBorder}` }}>
          <span style={{ fontSize:20 }}>🌱</span>
          <span style={{ fontWeight:800, fontSize:15, color:C.accent1 }}>My Progress</span>
        </div>
        <div>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:C.muted, marginBottom:10 }}>This Session</div>
          {INDICATORS.map(({key,label}) => <ScoreBar key={key} label={label} value={parseFloat(avg(key))}/>)}
          <div style={{ marginTop:6 }}><ScoreBar label="⭐ Overall" value={parseFloat(avg("overall"))}/></div>
        </div>
        {allScores.length > 0 && (
          <div style={{ borderTop:`1px solid ${C.sidebarBorder}`, paddingTop:14 }}>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:C.muted, marginBottom:10 }}>All-Time Average</div>
            {INDICATORS.map(({key,label}) => <ScoreBar key={key} label={label} value={parseFloat(avgAll(key))}/>)}
            <div style={{ marginTop:6 }}><ScoreBar label="⭐ Overall" value={parseFloat(avgAll("overall"))}/></div>
          </div>
        )}
        {allSessions.length > 0 && (
          <div style={{ borderTop:`1px solid ${C.sidebarBorder}`, paddingTop:14 }}>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:C.muted, marginBottom:10 }}>Past Sessions</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:160, overflowY:"auto" }}>
              {[...allSessions].reverse().map((sess,i) => (
                <div key={sess.id} style={{ background:C.scoreBox, border:`1px solid ${C.cardBorder}`, borderRadius:10, padding:"8px 10px", fontSize:11 }}>
                  <div style={{ color:C.muted, marginBottom:3, fontWeight:600 }}>{sess.current ? "🟢 Current" : `Session ${allSessions.length-i}`}</div>
                  <div style={{ color:C.subtext, fontSize:10, marginBottom:4 }}>{sess.date}</div>
                  <div style={{ color:C.accent1, fontWeight:700 }}>
                    {sess.messageCount} turn{sess.messageCount!==1?"s":""} · ⭐ {sess.scores.length ? (sess.scores.reduce((s,r)=>s+(r.overall||0),0)/sess.scores.length).toFixed(1) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop:"auto", paddingTop:8, display:"flex", flexDirection:"column", gap:8 }}>
          <button onClick={() => { setMessages([]); setScores([]); setSessionStarted(false); setStatus("idle"); setError(""); window.speechSynthesis.cancel(); }}
            style={{ width:"100%", padding:"9px 0", background:C.tagBg, border:`1px solid ${C.sidebarBorder}`, borderRadius:10, color:C.accent2, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            🔄 New Session
          </button>
          <button onClick={clearAll}
            style={{ width:"100%", padding:"9px 0", background:"#fff0f0", border:"1px solid #ffcccc", borderRadius:10, color:C.red, fontSize:12, fontWeight:600, cursor:"pointer" }}>
            🗑 Clear All History
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"14px 24px", borderBottom:`1px solid ${C.headerBorder}`, background:C.header, display:"flex", alignItems:"center", gap:14, boxShadow:"0 2px 8px rgba(45,158,107,0.06)" }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:"linear-gradient(135deg,#2d9e6b,#56c9a0)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🌿</div>
          <div>
            <div style={{ fontWeight:800, fontSize:16, color:C.text }}>English Performance Tracker</div>
            <div style={{ fontSize:12, color:C.muted }}>Speak naturally · Get scored · Improve every turn 🎤</div>
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"24px 28px 12px", display:"flex", flexDirection:"column", gap:20 }}>
          {!sessionStarted ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:20, textAlign:"center" }}>
              <div style={{ fontSize:60 }}>🎤</div>
              <div>
                <div style={{ fontSize:24, fontWeight:800, color:C.text, marginBottom:8 }}>Let's talk in English!</div>
                <div style={{ fontSize:14, color:C.subtext, maxWidth:380, lineHeight:1.8 }}>
                  Have a real spoken conversation with your AI coach.<br/>
                  Speak freely — get scored on <strong>7 indicators</strong> every turn.
                </div>
              </div>
              <button onClick={startSession} style={{ padding:"13px 36px", background:"linear-gradient(135deg,#2d9e6b,#38b07a)", border:"none", borderRadius:50, color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer", boxShadow:"0 4px 18px rgba(45,158,107,0.35)" }}>
                Start Conversation 🌱
              </button>
            </div>
          ) : (
            <>
              {messages.map((msg,i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <Avatar role={msg.role}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:C.muted, marginBottom:5, fontWeight:600 }}>
                      {msg.role==="assistant" ? "English Coach 🌿" : "You 🎤"}
                    </div>
                    <div style={{
                      background: msg.role==="assistant" ? C.assistantBubble : "linear-gradient(135deg,#2d9e6b,#38b07a)",
                      padding:"12px 16px",
                      borderRadius: msg.role==="assistant" ? "4px 18px 18px 18px" : "18px 4px 18px 18px",
                      fontSize:14, lineHeight:1.7,
                      color: msg.role==="user" ? "#fff" : C.text,
                      maxWidth:520,
                      border: msg.role==="assistant" ? `1px solid ${C.cardBorder}` : "none",
                      boxShadow:"0 2px 8px rgba(45,158,107,0.08)"
                    }}>
                      {msg.role==="user" ? msg.content : msg.parsed?.reply}
                    </div>
                    {msg.role==="assistant" && msg.parsed && (
                      <div style={{ marginTop:12, background:C.feedbackBg, border:`1px solid ${C.feedbackBorder}`, borderRadius:16, padding:16, maxWidth:520 }}>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7, marginBottom:14 }}>
                          {INDICATORS.map(({key,label,emoji}) => (
                            <div key={key} style={{ background:"#fff", border:`1px solid ${C.cardBorder}`, borderRadius:11, padding:"7px 5px", textAlign:"center" }}>
                              <div style={{ fontSize:10, color:C.muted, marginBottom:2 }}>{emoji} {label}</div>
                              <div style={{ fontSize:17, fontWeight:800, color:scoreColor(msg.parsed.scores[key]||0) }}>
                                {msg.parsed.scores[key]||0}<span style={{ fontSize:10, color:C.muted }}>/10</span>
                              </div>
                            </div>
                          ))}
                          <div style={{ background:"#fff", border:`1.5px solid ${C.accent1}`, borderRadius:11, padding:"7px 5px", textAlign:"center" }}>
                            <div style={{ fontSize:10, color:C.accent1, marginBottom:2 }}>⭐ Overall</div>
                            <div style={{ fontSize:17, fontWeight:800, color:scoreColor(msg.parsed.scores.overall||0) }}>
                              {msg.parsed.scores.overall||0}<span style={{ fontSize:10, color:C.muted }}>/10</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize:12, fontWeight:700, color:C.accent1, marginBottom:10 }}>📝 Feedback</div>
                        {[
                          ["🔤 Grammar",      msg.parsed.feedback.grammar],
                          ["📚 Vocabulary",   msg.parsed.feedback.vocabulary],
                          ["🔊 Pronunciation",msg.parsed.feedback.pronunciation],
                          ["⭐ Focus On",     msg.parsed.feedback.focusOn],
                        ].map(([lbl,txt]) => (
                          <div key={lbl} style={{ marginBottom:8 }}>
                            <div style={{ fontSize:11, fontWeight:700, color:C.accent2, marginBottom:2 }}>{lbl}</div>
                            <div style={{ fontSize:13, color:C.subtext, lineHeight:1.6 }}>{txt}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isThinking && (
                <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <Avatar role="assistant"/>
                  <div style={{ background:C.assistantBubble, border:`1px solid ${C.cardBorder}`, padding:"14px 18px", borderRadius:"4px 18px 18px 18px", display:"flex", gap:5, alignItems:"center" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:C.accent1, animation:`bounce 1.2s ${i*0.2}s infinite` }}/>)}
                  </div>
                </div>
              )}
              {error && (
                <div style={{ background:"#fff0f0", border:"1px solid #ffcccc", borderRadius:12, padding:"10px 16px", fontSize:13, color:"#c0392b" }}>
                  ⚠️ {error}
                </div>
              )}
              <div ref={bottomRef}/>
            </>
          )}
        </div>

        {sessionStarted && (
          <div style={{ padding:"18px 24px", borderTop:`1px solid ${C.sidebarBorder}`, background:C.header, display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
            {transcript && (
              <div style={{ fontSize:13, color:C.subtext, background:"#edf7f1", padding:"8px 16px", borderRadius:12, border:`1px solid ${C.cardBorder}`, maxWidth:500, textAlign:"center" }}>
                "{transcript}"
              </div>
            )}
            <button
              onPointerDown={!micDisabled ? startListening : undefined}
              onPointerUp={isListening ? stopListening : undefined}
              disabled={micDisabled}
              style={{
                width:68, height:68, borderRadius:"50%", border:"none",
                cursor: micDisabled ? "not-allowed" : "pointer",
                background: isListening ? "linear-gradient(135deg,#e74c3c,#c0392b)" : micDisabled ? "#c6e8d4" : "linear-gradient(135deg,#2d9e6b,#38b07a)",
                animation: isListening ? "pulse-ring 1s ease-out infinite" : "none",
                fontSize:26, transition:"all 0.2s",
                boxShadow: micDisabled ? "none" : "0 4px 20px rgba(45,158,107,0.4)"
              }}>
              {isListening ? "⏹" : isSpeaking ? "🔊" : isThinking ? "⏳" : "🎤"}
            </button>
            <div style={{ fontSize:13, color:C.muted, fontWeight:600 }}>
              {isListening ? "🔴 Listening… release to send" : isSpeaking ? "🔊 Coach is speaking…" : isThinking ? "⏳ Thinking…" : "Hold to speak"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
