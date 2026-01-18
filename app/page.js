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
  Send, PenTool, Star, PaintBucket, Trophy, MessageCircle, 
  ThumbsUp, Laugh, Frown, Heart, PartyPopper
} from 'lucide-react';

// ==================================================================
// [필수] 사용자님의 Firebase 설정값
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
let initError = null;

try {
  if (!getApps().length) {
    firebaseApp = initializeApp(firebaseConfig);
  } else {
    firebaseApp = getApps()[0];
  }
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (e) { 
  console.error("Firebase Init Error:", e);
  initError = e.message;
}

// --- Constants ---
const WORDS = [
  "호랑이", "비행기", "아이스크림", "축구", "피아노", "소방차", "눈사람", "해바라기", "스마트폰", "치킨",
  "자전거", "우산", "기린", "수박", "선풍기", "안경", "시계", "로봇", "공룡", "햄버거",
  "모자", "장갑", "양말", "케이크", "토끼", "고양이", "강아지", "거북이", "나무", "자동차",
  "경찰서", "병원", "학교", "은행", "마트", "수영장", "놀이터", "도서관", "미술관", "영화관",
  "아이언맨", "스파이더맨", "엘사", "손흥민", "피카츄", "자유의여신상", "에펠탑", "피라미드", "제주도", "한라산",
  "라면", "떡볶이", "김밥", "삼겹살", "초밥", "탕후루", "마라탕", "붕어빵", "호떡", "군고구마"
];

const PALETTE = [
  "#1a1a1a", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", 
  "#a855f7", "#ec4899", "#78350f", "#64748b", "#06b6d4", "#84cc16"
];

const TURN_DURATION = 60; 
const TOTAL_ROUNDS = 3;

// 진동 헬퍼
const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function CatchMindFinal() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(initError);
  const [copyStatus, setCopyStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // UI State
  const [chatMsg, setChatMsg] = useState('');
  const chatBoxRef = useRef(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [reactions, setReactions] = useState([]); // 이모지 파티클 상태
  const [showConfetti, setShowConfetti] = useState(false);

  // Canvas State
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#1a1a1a');
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); 
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
      const code = p.get('room');
      if (code && code.length === 4) setRoomCode(code.toUpperCase());
    }
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(e => setError("로그인 실패: "+e.message));
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
        
        // 이모지 & 효과 트리거 감지
        if (data.lastEffect && data.lastEffect.timestamp > Date.now() - 2000) {
           if (data.lastEffect.type === 'reaction') {
             triggerReaction(data.lastEffect.emoji); // 로컬 애니메이션 실행
           } else if (data.lastEffect.type === 'correct') {
             setShowConfetti(true);
             setTimeout(() => setShowConfetti(false), 3000);
             setToastMsg(data.lastEffect);
           } else {
             setToastMsg(data.lastEffect);
           }
           if (data.lastEffect.type !== 'reaction') {
             setTimeout(() => setToastMsg(null), 3000);
           }
        }
      } else setRoomData(null);
    });

    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- Reaction Animation System (확실한 효과) ---
  const triggerReaction = (emoji) => {
    const id = Date.now() + Math.random();
    // 화면 하단 랜덤 위치에서 시작
    const startX = Math.random() * 80 + 10; 
    setReactions(prev => [...prev, { id, emoji, x: startX }]);
    
    // 2초 후 제거
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  };

  const sendReaction = async (emoji) => {
    vibrate();
    // 로컬 즉시 실행 (내 화면 반응성)
    triggerReaction(emoji);
    // 서버 전송 (다른 사람 화면에도 뜨게)
    await updateDoc(doc(db, 'rooms', roomCode), {
      lastEffect: { type: 'reaction', emoji, timestamp: Date.now() }
    });
  };

  // --- Timer & Logic ---
  useEffect(() => {
    if (roomData?.status === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(timer);
    }
    // 타임오버 처리
    if (isHost && roomData?.status === 'playing' && timeLeft === 0 && !roomData.isRoundOver) {
      handleRoundEnd("⏰ 타임 오버!", false); 
    }
    // 정답 후 자동 넘기기
    if (isHost && roomData?.status === 'round_end') {
      const timer = setTimeout(() => {
        handleNextTurn("다음 라운드");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [roomData?.status, timeLeft, isHost, roomData?.isRoundOver]);

  // --- Canvas Logic ---
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
    
    // 점수 초기화
    const resetScores = players.map(p => updateDoc(doc(db,'rooms',roomCode,'players',p.id), { score: 0 }));
    await Promise.all(resetScores);

    const shuffled = players.map(p => p.id).sort(() => Math.random() - 0.5);
    const nextDrawer = shuffled[0];

    // [NEW] 4개의 단어 후보 생성
    const candidates = [];
    while(candidates.length < 4) {
      const w = WORDS[Math.floor(Math.random() * WORDS.length)];
      if(!candidates.includes(w)) candidates.push(w);
    }

    // 첫 턴 단어 선택 단계로 이동
    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'selecting',
      turnOrder: shuffled, currentTurnIndex: 0, currentRound: 1,
      currentDrawer: nextDrawer,
      wordChoices: candidates, // 후보 단어 저장
      messages: [{type:'system', text:'게임 시작!'}],
      isRoundOver: false,
      scores: players.reduce((acc, p) => ({...acc, [p.id]: 0}), {})
    });
  };

  // 단어 선택 (4개 중 1개)
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
      await handleRoundEnd(`${playerName}님 정답!`, true, user.uid);
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), { messages: arrayUnion(newMsg) });
    }
  };

  const handleRoundEnd = async (reasonText, isCorrect, winnerId = null) => {
    let scoreUpdates = {};
    if (isCorrect && winnerId) {
      scoreUpdates[`scores.${winnerId}`] = (roomData.scores?.[winnerId] || 0) + 2; 
      scoreUpdates[`scores.${roomData.currentDrawer}`] = (roomData.scores?.[roomData.currentDrawer] || 0) + 1;
    }

    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'round_end',
      isRoundOver: true,
      roundWinner: isCorrect ? players.find(p=>p.id===winnerId)?.name : null,
      roundReason: reasonText,
      ...scoreUpdates,
      lastEffect: isCorrect ? { type: 'correct', text: `🎉 정답! (${roomData.keyword})`, timestamp: Date.now() } : null,
      messages: arrayUnion({ type: 'system', text: reasonText, timestamp: Date.now() })
    });
  };

  const handleNextTurn = async () => {
    if(!isHost) return;

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

    const nextDrawer = roomData.turnOrder[nextIndex];
    
    // [NEW] 다음 턴을 위한 4개 단어 후보 생성
    const candidates = [];
    while(candidates.length < 4) {
      const w = WORDS[Math.floor(Math.random() * WORDS.length)];
      if(!candidates.includes(w)) candidates.push(w);
    }

    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'selecting',
      currentTurnIndex: nextIndex,
      currentRound: nextRound,
      currentDrawer: nextDrawer,
      wordChoices: candidates, // 후보 업데이트
      isRoundOver: false,
      roundWinner: null
    });
  };

  const copyInviteLink = () => {
    if (typeof window === 'undefined') return;
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
      
      {/* CSS Animation Injection for Reactions */}
      <style jsx global>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.8); opacity: 1; }
          100% { transform: translateY(-200px) scale(1.5); opacity: 0; }
        }
        .reaction-bubble {
          animation: floatUp 2s ease-out forwards;
        }
      `}</style>

      {/* Floating Reactions */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {reactions.map(r => (
          <div key={r.id} className="absolute bottom-20 text-5xl reaction-bubble" style={{left: `${r.x}%`}}>
            {r.emoji}
          </div>
        ))}
      </div>

      {/* Confetti (Simple) */}
      {showConfetti && (
        <div className="fixed inset-0 z-50 pointer-events-none flex justify-center items-center">
          <div className="text-6xl animate-bounce">🎉🎊✨</div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-none w-full max-w-sm px-4">
          <div className="bg-slate-800/95 text-white px-6 py-4 rounded-2xl shadow-2xl flex flex-col items-center gap-1 border border-white/20 text-center">
            <span className="font-bold text-lg">{toastMsg.text}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b-4 border-indigo-400 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-500 rounded-xl text-white shadow-sm"><Palette size={24} fill="currentColor"/></div>
          <div><h1 className="text-xl font-black tracking-tight text-slate-800">CATCH MIND</h1></div>
        </div>
        {isJoined && roomCode && <div className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg font-black">{roomCode}</div>}
      </header>

      {/* 1. Entrance */}
      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-10 animate-in fade-in zoom-in-95">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border-4 border-indigo-50 space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-black text-indigo-600 tracking-tighter">CATCH MIND</h1>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Remastered</p>
            </div>
            <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="닉네임" className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-5 py-4 text-lg font-bold outline-none focus:border-indigo-400 text-center"/>
            {!roomCode && <button onClick={handleCreate} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-xl font-black text-xl shadow-lg transition-all active:scale-95">방 만들기</button>}
            <div className="flex gap-2">
              <input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="CODE" className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl text-center font-mono font-black text-xl outline-none focus:border-indigo-400"/>
              <button onClick={handleJoin} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95">입장</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Lobby */}
      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6 mt-6">
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

      {/* 2.5 Word Selection (4 Options) */}
      {isJoined && roomData?.status === 'selecting' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-[2rem] shadow-2xl w-full max-w-sm text-center animate-in zoom-in">
            {isDrawer ? (
              <>
                <h3 className="text-xl font-black text-slate-800 mb-2">그림 그릴 단어 선택</h3>
                <p className="text-xs text-slate-400 font-bold mb-6">자신 있는 단어를 고르세요!</p>
                <div className="grid grid-cols-2 gap-3">
                  {(roomData.wordChoices || []).map((w,i)=>(
                    <button key={i} onClick={()=>selectWord(w)} className="bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 py-4 rounded-xl font-black text-lg transition-all border-2 border-indigo-100 shadow-sm active:scale-95">
                      {w}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8">
                <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4"></div>
                <p className="font-bold text-slate-700 text-lg">{players.find(p=>p.id===roomData.currentDrawer)?.name}</p>
                <p className="text-xs text-slate-400 font-bold mt-1">단어를 고르고 있습니다...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Playing Phase */}
      {isJoined && roomData?.status !== 'lobby' && roomData?.status !== 'result' && (
        <div className="flex flex-col h-screen pt-20 pb-0">
          
          {/* Reaction Overlay (Viewer) */}
          {!isDrawer && (
            <div className="absolute right-4 bottom-32 flex flex-col gap-2 z-30">
              {['👍','😂','😲','🔥'].map(emoji => (
                <button key={emoji} onClick={()=>sendReaction(emoji)} className="w-12 h-12 bg-white rounded-full shadow-lg text-2xl flex items-center justify-center border border-slate-100 hover:scale-110 transition-transform active:scale-90 active:bg-indigo-50">
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Round End Modal */}
          {roomData.status === 'round_end' && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl text-center transform scale-110 border-4 border-indigo-50">
                <h2 className="text-3xl font-black text-indigo-600 mb-2">{roomData.roundWinner ? roomData.roundWinner : '타임 오버'}</h2>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">{roomData.roundWinner ? '정답을 맞혔습니다!' : '아무도 못 맞혔네요'}</p>
                <div className="mt-6 bg-slate-100 px-8 py-3 rounded-2xl">
                  <p className="text-xs text-slate-400 font-bold uppercase mb-1">정답</p>
                  <p className="text-3xl font-black text-slate-800">{roomData.keyword}</p>
                </div>
                <div className="mt-6 flex justify-center gap-1">
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100"></div>
                   <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></div>
                </div>
              </div>
            </div>
          )}

          {/* Status Bar */}
          <div className="mx-4 mb-2 p-3 rounded-2xl border-2 border-slate-100 bg-white flex justify-between items-center shadow-sm">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg font-black text-xs">R{roomData.currentRound}</div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Artist</span>
                <span className="font-bold text-sm text-slate-800 leading-none">{players.find(p=>p.id===roomData.currentDrawer)?.name}</span>
              </div>
            </div>
            
            <div className="text-center">
              {isDrawer ? (
                <div className="bg-yellow-50 px-4 py-1 rounded-lg border border-yellow-100">
                  <p className="text-[10px] font-bold text-yellow-600 uppercase">제시어</p>
                  <p className="text-lg font-black text-yellow-700 leading-none">{roomData.keyword}</p>
                </div>
              ) : (
                 <div className="flex gap-1">
                   {(roomData.keyword || "").split('').map((_,i) => (
                      <div key={i} className="w-6 h-7 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-300 font-bold text-xs">?</div>
                   ))}
                </div>
              )}
            </div>

            <div className={`text-xl font-black font-mono flex items-center gap-1 ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-700'}`}>
              <Timer size={16}/> {timeLeft}
            </div>
          </div>

          {/* Canvas */}
          <div className={`relative flex-1 bg-white mx-2 rounded-[2rem] shadow-inner border-4 overflow-hidden touch-none ${isDrawer ? 'border-indigo-400' : 'border-slate-200'}`}>
            {!isDrawer && <div className="absolute inset-0 z-10 bg-transparent"></div>}
            <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="w-full h-full cursor-crosshair"/>
            
            {isDrawer && roomData.status === 'playing' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 p-2 rounded-3xl shadow-xl flex flex-col gap-2 border border-slate-200 items-center w-[90%] max-w-sm backdrop-blur-md">
                <div className="flex gap-2 overflow-x-auto w-full pb-2 scrollbar-hide px-1">
                  {PALETTE.map(c => (
                    <button key={c} onClick={()=>{setColor(c); setTool('pen');}} className={`shrink-0 p-1 rounded-full transition-all ${color===c && tool==='pen' ? 'ring-2 ring-offset-1 ring-indigo-500 scale-110' : ''}`}>
                      <div className="w-6 h-6 rounded-full border border-black/10" style={{backgroundColor:c}}></div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4 w-full justify-center border-t border-slate-100 pt-2">
                  <button onClick={()=>setLineWidth(5)} className={`p-2 rounded-xl ${lineWidth===5 && tool==='pen' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400'}`}><PenTool size={20}/></button>
                  <button onClick={()=>setTool('fill')} className={`p-2 rounded-xl ${tool==='fill' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400'}`}><PaintBucket size={20}/></button>
                  <button onClick={()=>setTool('eraser')} className={`p-2 rounded-xl ${tool==='eraser' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}><Eraser size={20}/></button>
                  <button onClick={clearCanvas} className="p-2 rounded-xl text-red-400 hover:bg-red-50"><Trash2 size={20}/></button>
                </div>
              </div>
            )}
          </div>

          {/* Chat */}
          <div className="h-1/3 bg-white border-t border-slate-200 flex flex-col">
            <div ref={chatBoxRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
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
            <p className="text-slate-400 font-bold uppercase tracking-widest mt-2">Hall of Fame</p>
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
