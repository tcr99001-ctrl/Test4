'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, deleteDoc, getDoc, arrayUnion 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Play, Users, Crown, CheckCircle2, Link as LinkIcon, 
  Palette, Eraser, Trash2, RefreshCw, AlertCircle, Timer,
  Send, PenTool, Star, Zap, PaintBucket, Trophy, MessageCircle
} from 'lucide-react';

// ==================================================================
// [필수] Firebase 설정 (기존 값 유지)
// ==================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBPd5xk9UseJf79GTZogckQmKKwwogneco",
  authDomain: "test-4305d.firebaseapp.com",
  projectId: "test-4305d",
  storageBucket: "test-4305d.firebasestorage.app",
  messagingSenderId: "402376205992",
  appId: "1:402376205992:web:be662592fa4d5f0efb849d"
};

// --- Firebase Init ---
let firebaseApp;
let db;
let auth;

try {
  if (!getApps().length) firebaseApp = initializeApp(firebaseConfig);
  else firebaseApp = getApps()[0];
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (e) { console.error(e); }

// --- Game Constants ---
const WORDS = [
  "호랑이", "비행기", "아이스크림", "축구", "피아노", "소방차", "눈사람", "해바라기", "스마트폰", "치킨",
  "자전거", "우산", "기린", "수박", "선풍기", "안경", "시계", "로봇", "공룡", "햄버거",
  "모자", "장갑", "양말", "케이크", "토끼", "고양이", "강아지", "거북이", "나무", "자동차",
  "경찰서", "병원", "학교", "은행", "마트", "수영장", "놀이터", "도서관", "미술관", "영화관",
  "아이언맨", "스파이더맨", "엘사", "손흥민", "피카츄", "자유의여신상", "에펠탑", "피라미드", "제주도", "한라산"
];

const PALETTE = [
  "#1a1a1a", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", 
  "#a855f7", "#ec4899", "#78350f", "#64748b", "#06b6d4", "#84cc16"
];

const TURN_DURATION = 60; 
const TOTAL_ROUNDS = 3;

// --- Helper Functions ---
const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function CatchMindRemastered() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // UI State
  const [chatMsg, setChatMsg] = useState('');
  const chatBoxRef = useRef(null);
  const [reactions, setReactions] = useState([]); // 이모지 파티클
  const requestRef = useRef(); // 애니메이션 프레임

  // Canvas State
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#1a1a1a');
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); // pen, eraser, fill
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef([]);

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;
  const isDrawer = roomData?.currentDrawer === user?.uid;
  const myData = players.find(p => p.id === user?.uid);

  // --- Auth & Setup ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('room')) setRoomCode(p.get('room').toUpperCase());
    }
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(e => setError("로그인 실패"));
    });
    return () => unsub();
  }, []);

  // --- Data Sync ---
  useEffect(() => {
    if(!user || !roomCode || roomCode.length!==4 || !db) return;
    
    const unsubRoom = onSnapshot(doc(db,'rooms',roomCode), s => {
      if(s.exists()) {
        const data = s.data();
        setRoomData(data);
        if (data.status === 'playing' && data.turnEndTime) {
          const diff = Math.ceil((data.turnEndTime - Date.now()) / 1000);
          setTimeLeft(diff > 0 ? diff : 0);
        }
        // 리액션 트리거
        if (data.lastReaction && data.lastReaction.timestamp > Date.now() - 2000) {
           triggerReaction(data.lastReaction.emoji);
        }
      } else setRoomData(null);
    });

    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- Particle System (고품질 이모지 효과) ---
  const triggerReaction = (emoji) => {
    const newParticles = Array.from({ length: 5 }).map(() => ({
      id: Math.random(),
      emoji,
      x: 50 + (Math.random() - 0.5) * 20, // 화면 중앙 부근
      y: 80,
      vx: (Math.random() - 0.5) * 4, // 좌우 퍼짐
      vy: - (Math.random() * 5 + 5), // 위로 솟구침
      opacity: 1,
      scale: 0.5 + Math.random()
    }));
    setReactions(prev => [...prev, ...newParticles]);
  };

  const updateParticles = useCallback(() => {
    setReactions(prev => prev
      .map(p => ({
        ...p,
        x: p.x + p.vx * 0.2, // 속도 조절
        y: p.y + p.vy * 0.2,
        vy: p.vy + 0.1, // 중력
        opacity: p.opacity - 0.01
      }))
      .filter(p => p.opacity > 0)
    );
    requestRef.current = requestAnimationFrame(updateParticles);
  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(updateParticles);
    return () => cancelAnimationFrame(requestRef.current);
  }, [updateParticles]);

  const sendReaction = async (emoji) => {
    vibrate();
    triggerReaction(emoji); // 내 화면 즉시 표시
    await updateDoc(doc(db, 'rooms', roomCode), {
      lastReaction: { emoji, timestamp: Date.now() }
    });
  };

  // --- Auto Flow Logic ---
  useEffect(() => {
    // 1. 타이머 종료 처리
    if (roomData?.status === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(timer);
    }
    if (isHost && roomData?.status === 'playing' && timeLeft === 0 && !roomData.isRoundOver) {
       // 타임오버 -> 정답 공개 -> 3초 뒤 다음 턴
       handleRoundEnd("⏰ 타임 오버!", false);
    }

    // 2. 정답 맞혔을 때 자동 넘기기 (호스트가 감시)
    if (isHost && roomData?.status === 'round_end') {
      const timer = setTimeout(() => {
        handleNextTurn("다음 라운드");
      }, 3000); // 3초 대기 후 이동
      return () => clearTimeout(timer);
    }
  }, [roomData?.status, timeLeft, isHost, roomData?.isRoundOver]);


  // --- Canvas Logic (Optimized) ---
  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roomData?.strokes) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    roomData.strokes.forEach(stroke => {
      if (stroke.type === 'fill') {
        ctx.fillStyle = stroke.color;
        ctx.fillRect(0, 0, width, height);
        return;
      }
      if (stroke.points.length < 1) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      const startX = stroke.points[0].x * width;
      const startY = stroke.points[0].y * height;
      ctx.moveTo(startX, startY);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
      }
      ctx.stroke();
    });
  }, [roomData?.strokes]);

  useEffect(() => { drawStrokes(); }, [drawStrokes, roomData?.strokes]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas?.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientWidth; 
        drawStrokes();
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); 
    return () => window.removeEventListener('resize', handleResize);
  }, [drawStrokes]);

  const getRelativePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const startDrawing = (e) => {
    if (!isDrawer || roomData.isRoundOver) return;
    if (tool === 'fill') { handleFill(); return; }
    setIsDrawing(true);
    currentPath.current = [getRelativePos(e)];
  };

  const draw = (e) => {
    if (!isDrawing || !canvasRef.current) return;
    e.preventDefault(); 
    const pos = getRelativePos(e);
    currentPath.current.push(pos);
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    
    ctx.lineWidth = tool === 'eraser' ? 20 : lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
    
    const prev = currentPath.current[currentPath.current.length - 2];
    if (prev) {
      ctx.beginPath();
      ctx.moveTo(prev.x * width, prev.y * height);
      ctx.lineTo(pos.x * width, pos.y * height);
      ctx.stroke();
    }
  };

  const endDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPath.current.length > 0) {
      try {
        await updateDoc(doc(db, 'rooms', roomCode), {
          strokes: arrayUnion({ 
            color: tool === 'eraser' ? '#FFFFFF' : color, 
            lineWidth: tool === 'eraser' ? 20 : lineWidth, 
            points: currentPath.current,
            type: 'line'
          })
        });
      } catch (e) {}
    }
    currentPath.current = [];
  };

  const handleFill = async () => {
    if (confirm("배경을 채우시겠습니까?")) {
      await updateDoc(doc(db, 'rooms', roomCode), {
        strokes: arrayUnion({ color: color, type: 'fill', points: [] })
      });
    }
  };

  const clearCanvas = async () => {
    if (isHost || isDrawer) {
      if (confirm("지우시겠습니까?")) await updateDoc(doc(db, 'rooms', roomCode), { strokes: [] });
    }
  };

  // --- Game Actions ---
  const handleCreate = async () => {
    if(!playerName) return setError("이름을 입력하세요");
    vibrate();
    const code = Math.random().toString(36).substring(2,6).toUpperCase();
    await setDoc(doc(db,'rooms',code), {
      hostId: user.uid, status: 'lobby', 
      keyword: '', currentDrawer: '', messages: [], strokes: [],
      currentTurnIndex: 0, isRoundOver: false, currentRound: 1,
      createdAt: Date.now()
    });
    await setDoc(doc(db,'rooms',code,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now() });
    setRoomCode(code);
  };

  const handleJoin = async () => {
    if(!playerName || roomCode.length!==4) return setError("정보를 확인하세요");
    vibrate();
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방 없음");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now() });
  };

  const handleStartGame = async () => {
    if(players.length < 2) return setError("최소 2명 필요");
    vibrate();
    const shuffled = players.map(p => p.id).sort(() => Math.random() - 0.5);
    
    // 첫 턴 단어 선택 단계로 이동
    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'selecting',
      turnOrder: shuffled, currentTurnIndex: 0, currentRound: 1,
      currentDrawer: shuffled[0],
      messages: [{type:'system', text:'게임 시작!'}],
      isRoundOver: false,
      scores: players.reduce((acc, p) => ({...acc, [p.id]: 0}), {})
    });
  };

  const selectWord = async (word) => {
    vibrate();
    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'playing',
      keyword: word,
      strokes: [],
      turnEndTime: Date.now() + (TURN_DURATION * 1000),
      isRoundOver: false
    });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if(!chatMsg.trim()) return;
    const msg = chatMsg.trim();
    setChatMsg('');

    const newMsg = { uid: user.uid, name: playerName, text: msg, timestamp: Date.now(), type: 'user' };

    // 정답 체크
    if (!isDrawer && !roomData.isRoundOver && roomData.status === 'playing' && msg === roomData.keyword) {
      // 정답 처리 (즉시 라운드 종료 상태로 전환)
      await handleRoundEnd(`${playerName}님 정답!`, true, user.uid);
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), { messages: arrayUnion(newMsg) });
    }
  };

  // 라운드 종료 처리 (정답 혹은 타임오버)
  const handleRoundEnd = async (reasonText, isCorrect, winnerId = null) => {
    // 점수 업데이트
    let scoreUpdates = {};
    if (isCorrect && winnerId) {
      scoreUpdates[`scores.${winnerId}`] = (roomData.scores?.[winnerId] || 0) + 2; // 정답자 +2
      scoreUpdates[`scores.${roomData.currentDrawer}`] = (roomData.scores?.[roomData.currentDrawer] || 0) + 1; // 화가 +1
    }

    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'round_end', // 대기 상태
      isRoundOver: true,
      roundWinner: isCorrect ? players.find(p=>p.id===winnerId)?.name : null,
      roundReason: reasonText,
      ...scoreUpdates,
      messages: arrayUnion({ type: 'system', text: reasonText, timestamp: Date.now() })
    });
  };

  // 다음 턴으로 넘기기
  const handleNextTurn = async () => {
    let nextIndex = roomData.currentTurnIndex + 1;
    let nextRound = roomData.currentRound;

    if (nextIndex >= roomData.turnOrder.length) {
      nextIndex = 0;
      nextRound += 1;
    }

    if (nextRound > TOTAL_ROUNDS) {
      await updateDoc(doc(db, 'rooms', roomCode), { status: 'result' });
      return;
    }

    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'selecting', // 단어 선택으로 이동
      currentTurnIndex: nextIndex,
      currentRound: nextRound,
      currentDrawer: roomData.turnOrder[nextIndex],
      isRoundOver: false,
      roundWinner: null
    });
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin.split('?')[0]}?room=${roomCode}`;
    const el = document.createElement('textarea');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setCopyStatus('link');
    setTimeout(() => setCopyStatus(null), 2000);
    vibrate();
  };

  const handleReset = async () => await updateDoc(doc(db,'rooms',roomCode), { status: 'lobby', strokes: [], keyword: '', messages: [] });

  // --- Render ---
  if(error) return <div className="h-screen flex items-center justify-center bg-slate-50 text-red-500 font-bold">{error}</div>;
  if(!user) return <div className="h-screen flex items-center justify-center bg-indigo-50 text-indigo-600 font-bold">로딩 중...</div>;

  return (
    <div className="min-h-screen bg-indigo-50 text-slate-800 font-sans relative overflow-x-hidden selection:bg-indigo-200">
      
      {/* HUD (Heads-Up Display) */}
      {isJoined && roomData?.status !== 'lobby' && (
        <div className="fixed top-0 left-0 w-full bg-white/90 backdrop-blur-md shadow-sm z-40 px-4 py-3 flex items-center justify-between border-b border-indigo-100">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600 font-black text-sm">
              R{roomData.currentRound}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase">My Score</span>
              <span className="text-sm font-black text-slate-800">{roomData.scores?.[user.uid] || 0}</span>
            </div>
          </div>

          {/* 중앙 정보 (화가/제시어/힌트) */}
          <div className="absolute left-1/2 -translate-x-1/2 text-center">
             {roomData.status === 'selecting' ? (
                <span className="text-xs font-bold text-indigo-500 animate-pulse">단어 선택 중...</span>
             ) : isDrawer ? (
                <div className="flex flex-col items-center">
                   <span className="text-[9px] font-bold text-slate-400">제시어</span>
                   <span className="text-lg font-black text-indigo-600 leading-none">{roomData.keyword}</span>
                </div>
             ) : (
                <div className="flex gap-1">
                   {/* 글자 수 힌트 */}
                   {roomData.keyword?.split('').map((_,i) => (
                      <div key={i} className="w-5 h-6 bg-slate-200 rounded-sm flex items-center justify-center text-slate-400 font-bold text-xs">?</div>
                   ))}
                </div>
             )}
          </div>

          <div className={`flex items-center gap-1 font-mono font-black text-lg ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-700'}`}>
            <Timer size={16}/> {timeLeft}
          </div>
        </div>
      )}

      {/* --- SCENE 1: ENTRANCE --- */}
      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-20 animate-in fade-in zoom-in-95">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border-4 border-indigo-50 space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-black text-indigo-600 tracking-tighter">CATCH MIND</h1>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Remastered</p>
            </div>
            <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="닉네임" className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-5 py-4 text-lg font-bold outline-none focus:border-indigo-400 transition-all text-center"/>
            {!roomCode && <button onClick={handleCreate} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-xl font-black text-xl shadow-lg transition-all active:scale-95">방 만들기</button>}
            <div className="flex gap-2">
              <input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="CODE" className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl text-center font-mono font-black text-xl outline-none focus:border-indigo-400"/>
              <button onClick={handleJoin} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95">입장</button>
            </div>
          </div>
        </div>
      )}

      {/* --- SCENE 2: LOBBY --- */}
      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6 mt-10">
          <div className="bg-white p-6 rounded-[2rem] border-4 border-indigo-50 shadow-xl flex justify-between items-center">
            <div><p className="text-indigo-400 text-xs font-black uppercase tracking-widest">Waiting</p><h2 className="text-4xl font-black text-slate-800">{players.length} <span className="text-xl text-slate-300">/ 20</span></h2></div>
            <Users size={40} className="text-indigo-200"/>
          </div>
          <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-4 min-h-[300px] flex flex-col shadow-sm">
            <div className="flex justify-between items-center mb-4 px-2">
              <span className="text-xs font-black text-slate-400 uppercase">Players</span>
              <button onClick={copyInviteLink} className="text-[10px] font-bold text-white bg-indigo-500 px-3 py-1.5 rounded-full flex gap-1 hover:bg-indigo-600 transition-colors">{copyStatus==='link'?<CheckCircle2 size={12}/>:<LinkIcon size={12}/>} 초대</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {players.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className={`font-bold ${p.id===user.uid?'text-indigo-600':'text-slate-600'}`}>{p.name}</span>
                  {p.id===roomData.hostId && <Crown size={16} className="text-yellow-500" />}
                </div>
              ))}
            </div>
          </div>
          {isHost ? <button onClick={handleStartGame} className="w-full bg-indigo-600 text-white p-5 rounded-2xl font-black text-xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"><Play size={24} fill="currentColor"/> 게임 시작</button> : <div className="text-center text-slate-400 font-bold animate-pulse py-4">대기 중...</div>}
        </div>
      )}

      {/* --- SCENE 3: GAMEPLAY --- */}
      {isJoined && roomData?.status !== 'lobby' && roomData?.status !== 'result' && (
        <div className="flex flex-col h-screen pt-16 pb-0">
          
          {/* Reaction Particles (Overlay) */}
          <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden">
             {reactions.map(r => (
               <div key={r.id} className="absolute text-4xl animate-float-up opacity-0" style={{left: `${r.x}%`, top: `${r.y}%`, '--tw-translate-x': `${r.vx}px`, '--tw-translate-y': `${r.vy}px` }}>
                 {r.emoji}
               </div>
             ))}
          </div>

          {/* Round End Modal (Overlay) */}
          {roomData.status === 'round_end' && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2rem] shadow-2xl text-center transform scale-110">
                {roomData.roundWinner ? (
                  <>
                    <div className="text-6xl mb-4 animate-bounce">🎉</div>
                    <h2 className="text-3xl font-black text-indigo-600 mb-2">{roomData.roundWinner}</h2>
                    <p className="text-slate-500 font-bold">정답을 맞혔습니다!</p>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-4">⏰</div>
                    <h2 className="text-2xl font-black text-slate-700 mb-2">타임 오버</h2>
                    <p className="text-slate-400 font-bold">아무도 못 맞혔네요...</p>
                  </>
                )}
                <div className="mt-6 bg-slate-100 px-6 py-2 rounded-xl">
                  <p className="text-xs text-slate-400 font-bold uppercase">정답</p>
                  <p className="text-2xl font-black text-slate-800">{roomData.keyword}</p>
                </div>
                <p className="mt-4 text-xs text-slate-400 animate-pulse">3초 뒤 다음 라운드로...</p>
              </div>
            </div>
          )}

          {/* Word Selection Modal */}
          {roomData.status === 'selecting' && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white p-6 rounded-[2rem] shadow-2xl w-full max-w-sm text-center">
                {isDrawer ? (
                  <>
                    <h3 className="text-xl font-black text-slate-800 mb-4">제시어를 선택하세요</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[WORDS[Math.floor(Math.random()*WORDS.length)], WORDS[Math.floor(Math.random()*WORDS.length)]].map((w,i)=>(
                        <button key={i} onClick={()=>selectWord(w)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-6 rounded-xl font-black text-lg transition-all border-2 border-indigo-100">{w}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="py-8">
                    <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="font-bold text-slate-500">{players.find(p=>p.id===roomData.currentDrawer)?.name}님이<br/>단어를 고르고 있습니다.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Canvas Area */}
          <div className="flex-1 relative bg-white m-2 rounded-3xl shadow-inner border-4 border-slate-200 overflow-hidden touch-none">
             {!isDrawer && <div className="absolute inset-0 z-10 bg-transparent"></div>}
             <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="w-full h-full cursor-crosshair"/>
             
             {/* Floating Tools (Drawer) */}
             {isDrawer && roomData.status === 'playing' && (
               <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl border border-slate-200">
                 {PALETTE.slice(0,5).map(c => (
                   <button key={c} onClick={()=>{setColor(c); setTool('pen');}} className={`w-8 h-8 rounded-full border border-black/10 transition-transform ${color===c && tool==='pen' ? 'scale-125 ring-2 ring-slate-800':''}`} style={{backgroundColor:c}}/>
                 ))}
                 <div className="w-px h-8 bg-slate-200 mx-1"></div>
                 <button onClick={()=>setTool('fill')} className={`p-1.5 rounded-lg ${tool==='fill'?'bg-indigo-100 text-indigo-600':'text-slate-400'}`}><PaintBucket size={20}/></button>
                 <button onClick={()=>setTool('eraser')} className={`p-1.5 rounded-lg ${tool==='eraser'?'bg-slate-200 text-slate-700':'text-slate-400'}`}><Eraser size={20}/></button>
                 <button onClick={clearCanvas} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50"><Trash2 size={20}/></button>
               </div>
             )}

             {/* Reactions (Viewer) */}
             {!isDrawer && (
               <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
                 {['👍','😂','😲','👏'].map(emoji => (
                   <button key={emoji} onClick={()=>sendReaction(emoji)} className="w-10 h-10 bg-white/90 rounded-full shadow-lg text-xl flex items-center justify-center active:scale-90 transition-transform border border-slate-100">{emoji}</button>
                 ))}
               </div>
             )}
          </div>

          {/* Chat Area */}
          <div className="h-1/3 bg-white border-t border-slate-100 flex flex-col">
            <div ref={chatBoxRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
              {roomData.messages?.map((msg, i) => (
                <div key={i} className={`text-sm px-3 py-2 rounded-xl w-fit max-w-[85%] whitespace-nowrap ${msg.type==='correct'?'bg-indigo-500 text-white font-bold mx-auto':msg.type==='system'?'bg-slate-200 text-slate-500 text-xs mx-auto':'bg-white border border-slate-200 text-slate-700 shadow-sm'}`}>
                   {msg.type==='user' && <span className="font-bold mr-1 text-slate-900">{msg.name}</span>}
                   {msg.text}
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="p-2 bg-white border-t border-slate-100 flex gap-2">
              <input value={chatMsg} onChange={e=>setChatMsg(e.target.value)} disabled={isDrawer || roomData.status !== 'playing'} placeholder={isDrawer ? "그림을 그려주세요!" : "정답을 입력하세요"} className="flex-1 bg-slate-100 rounded-xl px-4 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"/>
              <button disabled={isDrawer || roomData.status !== 'playing'} type="submit" className="bg-indigo-600 text-white p-3 rounded-xl disabled:bg-slate-300 transition-all active:scale-95"><Send size={18}/></button>
            </form>
          </div>

        </div>
      )}

      {/* --- SCENE 4: RESULT --- */}
      {isJoined && roomData?.status === 'result' && (
        <div className="p-6 max-w-md mx-auto mt-10 animate-in zoom-in">
          <div className="text-center mb-8">
            <Trophy size={60} className="mx-auto text-yellow-400 mb-4 drop-shadow-lg"/>
            <h2 className="text-4xl font-black text-slate-800">최종 순위</h2>
          </div>
          <div className="space-y-3">
             {players.sort((a,b) => b.score - a.score).map((p, i) => (
               <div key={p.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm">
                 <div className="flex items-center gap-4">
                   <span className={`text-2xl font-black ${i===0?'text-yellow-500':i===1?'text-slate-400':i===2?'text-orange-400':'text-slate-200'}`}>{i+1}</span>
                   <span className="font-bold text-slate-700 text-lg">{p.name}</span>
                 </div>
                 <div className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg font-black">{p.score}점</div>
               </div>
             ))}
          </div>
          {isHost && <button onClick={handleReset} className="w-full mt-8 bg-slate-800 text-white py-4 rounded-xl font-bold shadow-lg">대기실로 돌아가기</button>}
        </div>
      )}

    </div>
  );
        }
