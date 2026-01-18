'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, deleteDoc, getDoc, arrayUnion 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Play, Users, Crown, Copy, CheckCircle2, Link as LinkIcon, 
  Palette, Eraser, Trash2, RefreshCw, AlertCircle, Timer,
  Send, MessageCircle, PenTool, Trophy, Star
} from 'lucide-react';

// ==================================================================
// [완료] 사용자님의 Firebase 설정값 고정 적용
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

// --- 게임 데이터 (정답 리스트) ---
const WORDS = [
  "호랑이", "비행기", "아이스크림", "축구", "피아노", "소방차", "눈사람", 
  "해바라기", "스마트폰", "치킨", "자전거", "우산", "기린", "수박", "선풍기",
  "안경", "시계", "로봇", "공룡", "햄버거", "모자", "장갑", "양말", "케이크",
  "토끼", "고양이", "강아지", "오리", "거북이", "나무", "집", "자동차"
];
const TURN_DURATION = 60; // 60초 제한

const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function CatchMindGame() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(initError);
  const [copyStatus, setCopyStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // 채팅 & 캔버스 상태
  const [chatMsg, setChatMsg] = useState('');
  const chatBoxRef = useRef(null);
  
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef([]);

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;
  const isDrawer = roomData?.currentDrawer === user?.uid;

  // --- Auth & Initial URL Check ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const code = p.get('room');
      if (code && code.length === 4) setRoomCode(code.toUpperCase());
    }
    
    if(!auth) {
      if(!initError) setError("Firebase 인증 객체가 없습니다. 설정을 확인하세요.");
      return;
    }

    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(e => setError("로그인 실패: "+e.message));
    });
    return () => unsub();
  }, []);

  // --- Data Sync ---
  useEffect(() => {
    if(!user || !roomCode || roomCode.length!==4 || !db) return;
    
    // 방 데이터 구독
    const unsubRoom = onSnapshot(doc(db,'rooms',roomCode), s => {
      if(s.exists()) {
        const data = s.data();
        setRoomData(data);
        if (data.status === 'playing' && data.turnEndTime) {
          const diff = Math.ceil((data.turnEndTime - Date.now()) / 1000);
          setTimeLeft(diff > 0 ? diff : 0);
        }
      } else setRoomData(null);
    });

    // 플레이어 목록 구독
    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- Chat Auto Scroll ---
  useEffect(() => {
    if(chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [roomData?.messages]);

  // --- Timer & Auto Turn ---
  useEffect(() => {
    if (roomData?.status === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(timer);
    }
    // 시간 종료 시 방장이 다음 턴으로 넘김
    if (isHost && roomData?.status === 'playing' && timeLeft === 0 && !roomData.isRoundOver) {
      handleNextTurn("시간 초과!"); 
    }
  }, [roomData?.status, timeLeft, isHost]);

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
      if (canvas && canvas.parentElement) {
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
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
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
          strokes: arrayUnion({ color, lineWidth, points: currentPath.current })
        });
      } catch (e) {}
    }
    currentPath.current = [];
  };

  const clearCanvas = async () => {
    if (isHost || isDrawer) {
      if (confirm("지우시겠습니까?")) await updateDoc(doc(db, 'rooms', roomCode), { strokes: [] });
    }
  };

  // --- Game Logic ---
  const handleCreate = async () => {
    if(!playerName) return setError("이름 입력 필요");
    vibrate();
    const code = Math.random().toString(36).substring(2,6).toUpperCase();
    await setDoc(doc(db,'rooms',code), {
      hostId: user.uid, status: 'lobby', 
      keyword: '', currentDrawer: '', messages: [], strokes: [],
      currentTurnIndex: 0, isRoundOver: false,
      createdAt: Date.now()
    });
    await setDoc(doc(db,'rooms',code,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now() });
    setRoomCode(code);
  };

  const handleJoin = async () => {
    if(!playerName || roomCode.length!==4) return setError("정보 확인 필요");
    vibrate();
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방 없음");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now() });
  };

  // 게임 시작 (첫 턴 설정)
  const handleStartGame = async () => {
    if(players.length < 2) return setError("최소 2명 필요");
    vibrate();
    const shuffledPlayers = players.map(p => p.id).sort(() => Math.random() - 0.5);
    
    // 첫 턴 세팅
    const firstDrawer = shuffledPlayers[0];
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];

    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'playing',
      turnOrder: shuffledPlayers,
      currentTurnIndex: 0,
      currentDrawer: firstDrawer,
      keyword: word,
      strokes: [],
      messages: [], // 채팅 초기화
      turnEndTime: Date.now() + (TURN_DURATION * 1000),
      isRoundOver: false
    });
  };

  // 채팅 전송 및 정답 체크
  const sendMessage = async (e) => {
    e.preventDefault();
    if(!chatMsg.trim()) return;
    
    const msg = chatMsg.trim();
    setChatMsg('');

    const newMsg = {
      uid: user.uid,
      name: playerName,
      text: msg,
      timestamp: Date.now(),
      type: 'user' // 'user' | 'system'
    };

    // 정답 체크 (화가는 정답 입력 불가)
    if (!isDrawer && !roomData.isRoundOver && msg === roomData.keyword) {
      // 정답!
      newMsg.type = 'correct';
      newMsg.text = `${playerName}님이 정답을 맞혔습니다! (${msg})`;
      
      // 점수 업데이트: 정답자 +2, 화가 +1
      const drawerPlayer = players.find(p => p.id === roomData.currentDrawer);
      const myRef = doc(db, 'rooms', roomCode, 'players', user.uid);
      const drawerRef = doc(db, 'rooms', roomCode, 'players', roomData.currentDrawer);
      
      const myScore = (players.find(p=>p.id===user.uid)?.score || 0) + 2;
      const drawerScore = (drawerPlayer?.score || 0) + 1;

      await Promise.all([
        updateDoc(myRef, { score: myScore }),
        updateDoc(drawerRef, { score: drawerScore }),
        updateDoc(doc(db, 'rooms', roomCode), { 
          messages: arrayUnion(newMsg),
          isRoundOver: true // 라운드 종료 플래그
        })
      ]);

      // 3초 후 다음 턴으로
      setTimeout(() => handleNextTurn(`${playerName}님 정답!`), 3000);

    } else {
      // 오답
      await updateDoc(doc(db, 'rooms', roomCode), {
        messages: arrayUnion(newMsg)
      });
    }
  };

  // 다음 턴으로 이동
  const handleNextTurn = async (reason) => {
    if(!isHost) return; // 방장만 실행

    const nextIndex = roomData.currentTurnIndex + 1;
    
    // 게임 종료 (한 바퀴 돔)
    if (nextIndex >= roomData.turnOrder.length) {
      await updateDoc(doc(db, 'rooms', roomCode), { status: 'result' });
      return;
    }

    // 다음 라운드 설정
    const nextDrawer = roomData.turnOrder[nextIndex];
    const nextWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    
    // 시스템 메시지 추가
    const sysMsg = {
      uid: 'system', name: '알림', text: `라운드 종료! (${reason})`, timestamp: Date.now(), type: 'system'
    };

    await updateDoc(doc(db, 'rooms', roomCode), {
      currentTurnIndex: nextIndex,
      currentDrawer: nextDrawer,
      keyword: nextWord,
      strokes: [],
      messages: arrayUnion(sysMsg),
      turnEndTime: Date.now() + (TURN_DURATION * 1000),
      isRoundOver: false
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
  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center bg-green-50 text-red-500 font-bold p-6 text-center">
      <AlertCircle size={40} className="mb-4"/>
      <p>{error}</p>
      <button onClick={()=>window.location.reload()} className="mt-4 bg-slate-200 px-4 py-2 rounded text-black">새로고침</button>
    </div>
  );

  if(!user) return <div className="h-screen flex items-center justify-center bg-green-50 font-bold text-green-600">Loading...</div>;

  return (
    <div className="min-h-screen bg-green-50 text-slate-800 font-sans relative overflow-x-hidden selection:bg-green-200">
      
      {/* Header */}
      <header className="bg-white border-b-4 border-green-400 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-green-400 rounded-xl text-white shadow-[2px_2px_0px_rgba(0,0,0,0.1)]">
            <Palette size={24} fill="currentColor"/>
          </div>
          <div><h1 className="text-xl font-black tracking-tight text-slate-800">캐치마인드</h1></div>
        </div>
        {isJoined && roomCode && <div className="bg-green-100 text-green-700 px-3 py-1 rounded-lg font-black">{roomCode}</div>}
      </header>

      {/* 1. Entrance */}
      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-10 animate-in fade-in zoom-in-95">
          <div className="bg-white p-8 rounded-[2rem] shadow-[8px_8px_0px_rgba(0,0,0,0.1)] border-4 border-slate-100 space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-black text-slate-800 mb-1">그림 퀴즈</h2>
              <p className="text-slate-400 text-sm font-bold">친구의 그림 실력을 볼까요?</p>
            </div>
            <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="닉네임" className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-5 py-4 text-lg font-bold outline-none focus:border-green-400 transition-all"/>
            {!roomCode && <button onClick={handleCreate} className="w-full bg-green-400 hover:bg-green-500 text-white py-4 rounded-xl font-black text-xl shadow-[4px_4px_0px_rgba(0,0,0,0.1)] active:translate-y-[2px] active:shadow-[2px_2px_0px_rgba(0,0,0,0.1)] transition-all">방 만들기</button>}
            <div className="flex gap-3">
              <input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="코드" maxLength={4} className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl text-center font-mono font-black text-xl outline-none focus:border-green-400"/>
              <button onClick={handleJoin} className="flex-[1.5] bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold shadow-[4px_4px_0px_rgba(0,0,0,0.2)] active:translate-y-[2px] active:shadow-[2px_2px_0px_rgba(0,0,0,0.2)] transition-all">입장</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Lobby */}
      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6 animate-in slide-in-from-bottom-4">
          <div className="bg-white p-6 rounded-[2rem] border-4 border-green-100 shadow-xl flex justify-between items-center">
            <div><p className="text-green-400 text-xs font-black uppercase tracking-widest">Players</p><h2 className="text-4xl font-black text-slate-800">{players.length} <span className="text-xl text-slate-300">/ 20</span></h2></div>
            <Users size={40} className="text-green-200"/>
          </div>
          <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-4 min-h-[300px] flex flex-col shadow-sm">
            <div className="flex justify-between items-center mb-4 px-2">
              <span className="text-xs font-black text-slate-400 uppercase">참가자 목록</span>
              <button onClick={copyInviteLink} className="text-[10px] font-bold text-white bg-slate-800 px-3 py-1.5 rounded-full flex gap-1 hover:bg-slate-700 transition-colors">{copyStatus==='link'?<CheckCircle2 size={12}/>:<LinkIcon size={12}/>} 초대 링크</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {players.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full ${p.id===user.uid?'bg-green-500':'bg-slate-300'}`}></div><span className={`font-bold ${p.id===user.uid ? 'text-green-600' : 'text-slate-600'}`}>{p.name}</span></div>
                  {p.id===roomData.hostId && <Crown size={16} className="text-yellow-500" />}
                </div>
              ))}
            </div>
          </div>
          {isHost ? <button onClick={handleStartGame} className="w-full bg-green-500 hover:bg-green-600 text-white p-5 rounded-2xl font-black text-xl shadow-[0_8px_20px_rgba(34,197,94,0.3)] flex items-center justify-center gap-2 active:scale-95 transition-all"><Play size={24} fill="currentColor"/> 게임 시작</button> : <div className="text-center text-slate-400 font-bold animate-pulse py-4">방장이 곧 시작합니다...</div>}
        </div>
      )}

      {/* 3. Playing Phase */}
      {isJoined && roomData?.status === 'playing' && (
        <div className="flex flex-col h-[calc(100vh-80px)] p-4 max-w-lg mx-auto">
          
          {/* Status Bar */}
          <div className="mb-3 p-4 rounded-2xl border-2 border-slate-100 bg-white flex justify-between items-center shadow-sm">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase">현재 화가</p>
              <div className="flex items-center gap-2">
                <PenTool size={16} className="text-green-500"/>
                <span className="font-black text-lg text-slate-800">
                  {players.find(p=>p.id===roomData.currentDrawer)?.name || 'Unknown'}
                </span>
                {isDrawer && <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold">ME</span>}
              </div>
            </div>
            
            {/* 정답 표시 (화가만 보임) */}
            {isDrawer ? (
              <div className="text-center bg-yellow-100 border border-yellow-300 px-4 py-1 rounded-xl">
                <p className="text-[10px] font-bold text-yellow-600 uppercase">제시어</p>
                <p className="text-xl font-black text-yellow-700">{roomData.keyword}</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Time</p>
                <div className="text-xl font-black font-mono text-slate-700 flex items-center gap-1"><Timer size={16}/> {timeLeft}</div>
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className={`relative flex-1 bg-white rounded-3xl shadow-inner border-4 overflow-hidden touch-none ${isDrawer ? 'border-green-400' : 'border-slate-200'}`}>
            {!isDrawer && <div className="absolute inset-0 z-10 bg-transparent"></div>}
            <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="w-full h-full cursor-crosshair"/>
            {isDrawer && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 p-2 rounded-2xl shadow-xl flex gap-2 border">
                {['#000000','#ef4444','#3b82f6'].map(c=><button key={c} onClick={()=>setColor(c)} className={`p-3 rounded-xl ${color===c?'bg-slate-900 ring-2 ring-slate-900':'hover:bg-slate-100'}`}><div className="w-4 h-4 rounded-full" style={{backgroundColor:c}}/></button>)}
                <div className="w-px h-8 bg-slate-200 my-auto"></div>
                <button onClick={()=>setColor('#ffffff')} className={`p-3 rounded-xl ${color==='#ffffff'?'bg-slate-200':''}`}><Eraser size={20}/></button>
                <button onClick={clearCanvas} className="p-3 rounded-xl text-red-500 hover:bg-red-50"><Trash2 size={20}/></button>
              </div>
            )}
          </div>

          {/* Chat Area */}
          <div className="h-48 mt-4 flex flex-col">
            <div ref={chatBoxRef} className="flex-1 overflow-y-auto bg-white/50 border-2 border-white rounded-t-2xl p-3 space-y-2 custom-scrollbar backdrop-blur-sm">
              {roomData.messages?.map((msg, i) => (
                <div key={i} className={`text-sm p-2 rounded-lg ${msg.type === 'correct' ? 'bg-green-100 text-green-700 font-bold text-center border border-green-200' : (msg.type === 'system' ? 'bg-slate-200 text-slate-500 text-center text-xs' : 'bg-white shadow-sm border border-slate-100')}`}>
                  {msg.type === 'user' && <span className="font-bold mr-2 text-slate-600">{msg.name}:</span>}
                  {msg.text}
                </div>
              ))}
            </div>
            
            <form onSubmit={sendMessage} className="flex gap-2 p-2 bg-white rounded-b-2xl border-t border-slate-100">
              <input 
                value={chatMsg} 
                onChange={e=>setChatMsg(e.target.value)} 
                disabled={isDrawer || roomData.isRoundOver}
                placeholder={isDrawer ? "정답을 그리는 중입니다..." : "정답을 입력하세요!"}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50"
              />
              <button disabled={isDrawer || roomData.isRoundOver} type="submit" className="bg-green-500 text-white p-2.5 rounded-xl disabled:bg-slate-300">
                <Send size={18}/>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Result Phase */}
      {isJoined && roomData?.status === 'result' && (
        <div className="p-4 max-w-lg mx-auto flex flex-col h-[calc(100vh-80px)]">
          <div className="text-center mb-6 mt-10">
            <h2 className="text-4xl font-black text-slate-800">최종 순위</h2>
            <p className="text-slate-400 font-bold">게임이 종료되었습니다!</p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pb-20 custom-scrollbar">
            <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-lg">
              {players.sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={p.id} className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-4">
                    <span className={`font-black w-8 text-center text-2xl ${i===0?'text-yellow-500':i===1?'text-slate-400':i===2?'text-orange-400':'text-slate-200'}`}>{i+1}</span>
                    <div>
                      <p className="font-bold text-slate-700 text-lg">{p.name}</p>
                      {i===0 && <span className="text-[10px] bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full font-bold">WINNER</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-lg">
                    <Star size={14} className="text-yellow-500" fill="currentColor"/>
                    <span className="font-black text-slate-800">{p.score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="fixed bottom-6 left-0 w-full px-6 flex justify-center">
              <button onClick={handleReset} className="w-full max-w-md bg-slate-900 text-white py-4 rounded-2xl font-black text-lg shadow-2xl flex items-center justify-center gap-2 active:scale-95 transition-all"><RefreshCw size={20} /> 대기실로 돌아가기</button>
            </div>
          )}
        </div>
      )}

    </div>
  );
    }
