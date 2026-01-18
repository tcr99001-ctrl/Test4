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
  Send, PenTool, Star, Zap, Lightbulb, Clock, Volume2, VolumeX
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

// --- [SOUND ASSETS] 테스트용 무료 음원 URL ---
// 소리가 안 난다면 이 URL들이 브라우저 보안 정책에 막혔을 수 있습니다.
// 그럴 경우 직접 mp3 파일을 public 폴더에 넣고 경로를 '/bgm.mp3' 처럼 바꾸셔야 합니다.
const SOUNDS = {
  bgm_lobby: "https://cdn.pixabay.com/download/audio/2022/01/26/audio_d0c6ff1bcd.mp3",
  bgm_game: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_5b82098966.mp3", 
  sfx_correct: "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3",
  sfx_pop: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_7368582d9d.mp3",
  sfx_start: "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c3c3337a2b.mp3",
  sfx_timer: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_c8c8a73467.mp3", 
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
  initError = e.message;
}

// --- Constants ---
const WORDS = [
  "호랑이", "비행기", "아이스크림", "축구", "피아노", "소방차", "눈사람", "해바라기", "스마트폰", "치킨",
  "자전거", "우산", "기린", "수박", "선풍기", "안경", "시계", "로봇", "공룡", "햄버거",
  "모자", "장갑", "양말", "케이크", "토끼", "고양이", "강아지", "오리", "거북이", "나무",
  "집", "자동차", "바나나", "포도", "딸기", "사과", "토마토", "감자", "고구마", "옥수수",
  "경찰서", "소방서", "학교", "병원", "우체국", "은행", "마트", "백화점", "놀이터", "수영장"
];

const PALETTE = [
  "#000000", "#FF0000", "#0000FF", "#008000", "#FFFF00", "#FFA500", 
  "#800080", "#FFC0CB", "#A52A2A", "#808080", "#00FFFF", "#00FF00"
];

const TURN_DURATION = 60; 
const TOTAL_ROUNDS = 3;

const getChosung = (str) => {
  const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  let result = "";
  for(let i=0; i<str.length; i++) {
    const code = str.charCodeAt(i) - 44032;
    if(code > -1 && code < 11172) result += CHO[Math.floor(code/588)];
    else result += str.charAt(i);
  }
  return result;
};

const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function CatchMindFixedAudio() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(initError);
  const [copyStatus, setCopyStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Audio State
  const [isMuted, setIsMuted] = useState(true); // 기본적으로 음소거 시작 (브라우저 정책 대응)
  const [audioBlocked, setAudioBlocked] = useState(false); // 오디오 차단 감지
  const audioRefs = useRef({}); 

  const [chatMsg, setChatMsg] = useState('');
  const chatBoxRef = useRef(null);
  const [toastMsg, setToastMsg] = useState(null);
  
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef([]);

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;
  const isDrawer = roomData?.currentDrawer === user?.uid;
  const myData = players.find(p => p.id === user?.uid);

  // --- Audio Logic ---
  useEffect(() => {
    Object.keys(SOUNDS).forEach(key => {
      const audio = new Audio(SOUNDS[key]);
      if(key.includes('bgm')) audio.loop = true;
      audio.volume = 0.5; // 볼륨 50%
      audioRefs.current[key] = audio;
    });
    
    return () => {
      Object.values(audioRefs.current).forEach(audio => audio.pause());
    };
  }, []);

  const playSound = (key) => {
    if (isMuted) return;
    const audio = audioRefs.current[key];
    if (audio) {
      if (!key.includes('bgm')) audio.currentTime = 0;
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.warn("Audio play blocked:", error);
          setAudioBlocked(true); // 차단됨 감지 -> UI에 표시
        });
      }
    }
  };

  const stopSound = (key) => {
    const audio = audioRefs.current[key];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  };

  // BGM Controller
  useEffect(() => {
    if (!isJoined || isMuted) {
      stopSound('bgm_lobby');
      stopSound('bgm_game');
      return;
    }

    if (roomData?.status === 'lobby' || roomData?.status === 'result') {
      stopSound('bgm_game');
      playSound('bgm_lobby');
    } else if (roomData?.status === 'playing') {
      stopSound('bgm_lobby');
      playSound('bgm_game');
    }
  }, [roomData?.status, isJoined, isMuted]);

  // 음소거 해제 (유저 인터랙션 필수)
  const enableSound = () => {
    setIsMuted(false);
    setAudioBlocked(false);
    
    // 오디오 컨텍스트 깨우기 위한 더미 재생
    const dummy = audioRefs.current['sfx_pop'];
    if(dummy) {
      dummy.play().catch(() => {});
      dummy.pause();
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      enableSound();
    } else {
      setIsMuted(true);
      Object.values(audioRefs.current).forEach(audio => audio.pause());
    }
  };

  // --- Auth ---
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
        if (data.lastSkillEffect && data.lastSkillEffect.timestamp > Date.now() - 3000) {
           setToastMsg(data.lastSkillEffect);
           if (!isMuted) {
             if (data.lastSkillEffect.type === 'correct') playSound('sfx_correct');
             if (data.lastSkillEffect.type === 'start') playSound('sfx_start');
             if (['pass','time','hint'].includes(data.lastSkillEffect.type)) playSound('sfx_pop');
           }
           setTimeout(() => setToastMsg(null), 3000);
        }
      } else setRoomData(null);
    });

    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- Timer Sound ---
  useEffect(() => {
    if (roomData?.status === 'playing' && timeLeft > 0) {
      if (timeLeft <= 10 && !isMuted) playSound('sfx_timer');
      const timer = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(timer);
    }
    if (isHost && roomData?.status === 'playing' && timeLeft === 0 && !roomData.isRoundOver) {
      handleNextTurn("시간 초과!"); 
    }
  }, [roomData?.status, timeLeft, isHost, isMuted]);

  // --- Chat Auto Scroll ---
  useEffect(() => {
    if(chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [roomData?.messages]);

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

  // --- Skills ---
  const usePass = async () => {
    if (!isDrawer || myData.items.pass <= 0) return;
    vibrate();
    if(!isMuted) playSound('sfx_pop');
    const newWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    await updateDoc(doc(db, 'rooms', roomCode, 'players', user.uid), { 'items.pass': myData.items.pass - 1 });
    await updateDoc(doc(db, 'rooms', roomCode), {
      keyword: newWord, hintText: null, strokes: [],
      lastSkillEffect: { type: 'pass', text: '🔄 패스권 사용!', timestamp: Date.now() }
    });
  };

  const useHint = async () => {
    if (!isDrawer || roomData.hintText) return;
    vibrate();
    if(!isMuted) playSound('sfx_pop');
    const chosung = getChosung(roomData.keyword);
    await updateDoc(doc(db, 'rooms', roomCode), {
      hintText: chosung, isHintUsed: true,
      lastSkillEffect: { type: 'hint', text: `💡 초성 힌트: ${chosung}`, timestamp: Date.now() }
    });
  };

  const useTime = async () => {
    if (!isDrawer || myData.items.timeAdd <= 0) return;
    vibrate();
    if(!isMuted) playSound('sfx_pop');
    await updateDoc(doc(db, 'rooms', roomCode, 'players', user.uid), { 'items.timeAdd': myData.items.timeAdd - 1 });
    await updateDoc(doc(db, 'rooms', roomCode), {
      turnEndTime: roomData.turnEndTime + 15000,
      lastSkillEffect: { type: 'time', text: '⏰ 시간 연장 (+15초)', timestamp: Date.now() }
    });
  };

  // --- Game Actions ---
  const handleCreate = async () => {
    if(!playerName) return setError("이름 입력 필요");
    vibrate(); enableSound(); // 생성 시 사운드 활성화 시도
    const code = Math.random().toString(36).substring(2,6).toUpperCase();
    await setDoc(doc(db,'rooms',code), {
      hostId: user.uid, status: 'lobby', 
      keyword: '', currentDrawer: '', messages: [], strokes: [],
      currentTurnIndex: 0, isRoundOver: false, currentRound: 1,
      hintText: null, isHintUsed: false, lastSkillEffect: null,
      createdAt: Date.now()
    });
    await setDoc(doc(db,'rooms',code,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now(), items: { pass: 2, timeAdd: 1 }, lastActive: Date.now() });
    setRoomCode(code);
  };

  const handleJoin = async () => {
    if(!playerName || roomCode.length!==4) return setError("정보 확인 필요");
    vibrate(); enableSound(); // 입장 시 사운드 활성화 시도
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방 없음");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, score: 0, joinedAt: Date.now(), items: { pass: 2, timeAdd: 1 }, lastActive: Date.now() });
  };

  const handleStartGame = async () => {
    if(players.length < 2) return setError("최소 2명 필요");
    vibrate();
    
    const resetScores = players.map(p => updateDoc(doc(db,'rooms',roomCode,'players',p.id), { score: 0, items: { pass: 2, timeAdd: 1 } }));
    await Promise.all(resetScores);

    const shuffledPlayers = players.map(p => p.id).sort(() => Math.random() - 0.5);
    const firstDrawer = shuffledPlayers[0];
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];

    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'playing', turnOrder: shuffledPlayers, currentTurnIndex: 0, currentRound: 1,
      currentDrawer: firstDrawer, keyword: word, strokes: [], messages: [],
      turnEndTime: Date.now() + (TURN_DURATION * 1000), isRoundOver: false, hintText: null, isHintUsed: false,
      lastSkillEffect: { type: 'start', text: '게임 시작!', timestamp: Date.now() }
    });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if(!chatMsg.trim()) return;
    const msg = chatMsg.trim();
    setChatMsg('');

    const newMsg = { uid: user.uid, name: playerName, text: msg, timestamp: Date.now(), type: 'user' };

    if (!isDrawer && !roomData.isRoundOver && msg === roomData.keyword) {
      newMsg.type = 'correct';
      newMsg.text = `${playerName}님 정답! (${msg})`;
      
      const drawerPlayer = players.find(p => p.id === roomData.currentDrawer);
      const speedBonus = timeLeft >= 30 ? 1 : 0;
      const myScoreAdd = 2 + speedBonus;
      const drawerScoreAdd = roomData.isHintUsed ? 1 : 2;

      await Promise.all([
        updateDoc(doc(db,'rooms',roomCode,'players',user.uid), { score: (myData.score || 0) + myScoreAdd }),
        updateDoc(doc(db,'rooms',roomCode,'players',roomData.currentDrawer), { score: (drawerPlayer?.score || 0) + drawerScoreAdd }),
        updateDoc(doc(db, 'rooms', roomCode), { 
          messages: arrayUnion(newMsg),
          isRoundOver: true,
          lastSkillEffect: { type: 'correct', text: `🎉 정답! (${msg})`, timestamp: Date.now() }
        })
      ]);
      setTimeout(() => handleNextTurn(`${playerName}님 정답!`), 3000);
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), { messages: arrayUnion(newMsg) });
    }
  };

  const handleNextTurn = async (reason) => {
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
    const nextWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    
    await updateDoc(doc(db, 'rooms', roomCode), {
      currentTurnIndex: nextIndex, currentRound: nextRound, currentDrawer: nextDrawer,
      keyword: nextWord, strokes: [],
      messages: arrayUnion({ uid:'system', name:'알림', text:`${reason}`, timestamp:Date.now(), type:'system' }),
      turnEndTime: Date.now() + (TURN_DURATION * 1000), isRoundOver: false, hintText: null, isHintUsed: false
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
    if(!isMuted) playSound('sfx_pop');
  };

  const handleReset = async () => await updateDoc(doc(db,'rooms',roomCode), { status: 'lobby', strokes: [], keyword: '', messages: [] });

  // --- Render ---
  if(error) return <div className="h-screen flex items-center justify-center bg-slate-50 text-red-500 font-bold">{error}</div>;
  if(!user) return <div className="h-screen flex items-center justify-center bg-indigo-50 text-indigo-600 font-bold">로딩 중...</div>;

  return (
    <div className="min-h-screen bg-indigo-50 text-slate-800 font-sans relative overflow-x-hidden selection:bg-indigo-200">
      
      {/* Sound Toggle (Fixed) */}
      <button 
        onClick={toggleMute} 
        className={`fixed top-4 right-4 z-50 p-2 rounded-full shadow-md border backdrop-blur-sm transition-all ${isMuted || audioBlocked ? 'bg-red-100 border-red-200 animate-pulse' : 'bg-white/80 border-slate-200'}`}
        title="소리 켜기/끄기"
      >
        {(isMuted || audioBlocked) ? <VolumeX size={20} className="text-red-500"/> : <Volume2 size={20} className="text-indigo-600"/>}
      </button>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-none">
          <div className="bg-slate-800/95 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-white/20">
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
        {isJoined && roomCode && <div className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg font-black mr-8">{roomCode}</div>}
      </header>

      {/* 1. Entrance */}
      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-10 animate-in fade-in zoom-in-95">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border-4 border-slate-100 space-y-6">
            <h2 className="text-3xl font-black text-center text-slate-800">그림 퀴즈 입장</h2>
            <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="닉네임" className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-5 py-4 text-lg font-bold outline-none focus:border-indigo-400"/>
            {!roomCode && <button onClick={handleCreate} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-xl font-black text-xl shadow-lg transition-all">방 만들기</button>}
            <div className="flex gap-3">
              <input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="CODE" className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl text-center font-mono font-black text-xl outline-none focus:border-indigo-400"/>
              <button onClick={handleJoin} className="flex-[1.5] bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all">입장</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Lobby */}
      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6 animate-in slide-in-from-bottom-4">
          <div className="bg-white p-6 rounded-[2rem] border-4 border-indigo-100 shadow-xl flex justify-between items-center">
            <div><p className="text-indigo-400 text-xs font-black uppercase tracking-widest">Players</p><h2 className="text-4xl font-black text-slate-800">{players.length} <span className="text-xl text-slate-300">/ 20</span></h2></div>
            <Users size={40} className="text-indigo-200"/>
          </div>
          <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-4 min-h-[300px] flex flex-col shadow-sm">
            <div className="flex justify-between items-center mb-4 px-2">
              <span className="text-xs font-black text-slate-400 uppercase">대기 명단</span>
              <button onClick={copyInviteLink} className="text-[10px] font-bold text-white bg-slate-800 px-3 py-1.5 rounded-full flex gap-1 hover:bg-slate-700 transition-colors">{copyStatus==='link'?<CheckCircle2 size={12}/>:<LinkIcon size={12}/>} 초대 링크</button>
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
          {isHost ? <button onClick={handleStartGame} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white p-5 rounded-2xl font-black text-xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"><Play size={24} fill="currentColor"/> 게임 시작</button> : <div className="text-center text-slate-400 font-bold animate-pulse py-4">대기 중...</div>}
        </div>
      )}

      {/* 3. Playing Phase */}
      {isJoined && roomData?.status === 'playing' && (
        <div className="flex flex-col h-[calc(100vh-80px)] p-4 max-w-lg mx-auto">
          
          <div className="mb-3 p-3 rounded-2xl border-2 border-slate-100 bg-white flex justify-between items-center shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded font-bold">R{roomData.currentRound}</span>
                <span className="font-black text-lg text-slate-800">{players.find(p=>p.id===roomData.currentDrawer)?.name}</span>
                {isDrawer && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-bold">YOU</span>}
              </div>
            </div>
            
            <div className="text-center">
              {isDrawer ? (
                <div className="flex flex-col items-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">제시어</p>
                  <p className="text-xl font-black text-indigo-600">{roomData.keyword}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  {roomData.hintText ? (
                    <div className="bg-yellow-100 px-3 py-1 rounded-lg animate-pulse">
                      <p className="text-[10px] text-yellow-600 font-bold">힌트</p>
                      <p className="text-lg font-black text-yellow-700">{roomData.hintText}</p>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {roomData.keyword.split('').map((_,i) => (
                        <div key={i} className="w-6 h-8 bg-slate-100 rounded border border-slate-200 flex items-center justify-center">
                          <span className="text-slate-300 font-bold">?</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="text-center">
              <div className={`text-xl font-black font-mono flex items-center gap-1 ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-700'}`}>
                <Timer size={16}/> {timeLeft}
              </div>
            </div>
          </div>

          <div className={`relative flex-1 bg-white rounded-3xl shadow-inner border-4 overflow-hidden touch-none ${isDrawer ? 'border-indigo-400' : 'border-slate-200'}`}>
            {!isDrawer && <div className="absolute inset-0 z-10 bg-transparent"></div>}
            <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="w-full h-full cursor-crosshair"/>
            
            {isDrawer && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 p-3 rounded-3xl shadow-2xl flex flex-col gap-2 border border-slate-200 items-center w-[90%] max-w-sm backdrop-blur-md">
                <div className="flex gap-2 overflow-x-auto w-full pb-2 scrollbar-hide px-1">
                  {PALETTE.map(c => (
                    <button key={c} onClick={()=>setColor(c)} className={`shrink-0 p-1 rounded-full transition-all ${color===c ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''}`}>
                      <div className="w-6 h-6 rounded-full border border-black/10" style={{backgroundColor:c}}></div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4 w-full justify-center border-t border-slate-100 pt-2">
                  <button onClick={()=>setLineWidth(5)} className={`p-2 rounded-xl ${lineWidth===5 && color!=='#ffffff' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400'}`}><PenTool size={20}/></button>
                  <button onClick={()=>setColor('#ffffff')} className={`p-2 rounded-xl ${color==='#ffffff' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}><Eraser size={20}/></button>
                  <button onClick={clearCanvas} className="p-2 rounded-xl text-red-400 hover:bg-red-50"><Trash2 size={20}/></button>
                </div>
              </div>
            )}
          </div>

          {isDrawer && (
            <div className="flex justify-center gap-2 mt-2">
              <button onClick={usePass} disabled={myData?.items?.pass <= 0} className="flex items-center gap-1 px-3 py-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold disabled:opacity-50"><RefreshCw size={14}/> 패스 ({myData?.items?.pass})</button>
              <button onClick={useHint} disabled={roomData.isHintUsed} className="flex items-center gap-1 px-3 py-2 bg-yellow-100 text-yellow-700 rounded-xl text-xs font-bold disabled:opacity-50"><Lightbulb size={14}/> 초성힌트</button>
              <button onClick={useTime} disabled={myData?.items?.timeAdd <= 0} className="flex items-center gap-1 px-3 py-2 bg-green-100 text-green-700 rounded-xl text-xs font-bold disabled:opacity-50"><Clock size={14}/> +15초 ({myData?.items?.timeAdd})</button>
            </div>
          )}

          <div className="h-40 mt-2 flex flex-col">
            <div ref={chatBoxRef} className="flex-1 overflow-y-auto bg-white/60 border-2 border-white rounded-t-2xl p-3 space-y-2 custom-scrollbar backdrop-blur-sm shadow-sm">
              {roomData.messages?.map((msg, i) => (
                <div key={i} className={`text-sm p-2 rounded-lg ${msg.type === 'correct' ? 'bg-indigo-100 text-indigo-700 font-bold text-center border border-indigo-200 animate-bounce' : (msg.type === 'system' ? 'bg-slate-200 text-slate-500 text-center text-xs' : 'bg-white shadow-sm border border-slate-100')}`}>
                  {msg.type === 'user' && <span className="font-bold mr-2 text-slate-600">{msg.name}:</span>}
                  {msg.text}
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="flex gap-2 p-2 bg-white rounded-b-2xl border-t border-slate-100 shadow-sm">
              <input value={chatMsg} onChange={e=>setChatMsg(e.target.value)} disabled={isDrawer || roomData.isRoundOver} placeholder={isDrawer ? "그림을 그려주세요!" : "정답을 맞춰보세요!"} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"/>
              <button disabled={isDrawer || roomData.isRoundOver} type="submit" className="bg-indigo-500 text-white p-2.5 rounded-xl disabled:bg-slate-300 transition-all active:scale-95"><Send size={18}/></button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Result Phase */}
      {isJoined && roomData?.status === 'result' && (
        <div className="p-4 max-w-lg mx-auto flex flex-col h-[calc(100vh-80px)]">
          <div className="text-center mb-6 mt-10 animate-in zoom-in">
            <h2 className="text-4xl font-black text-slate-800">최종 순위</h2>
            <p className="text-slate-400 font-bold">명예의 전당</p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-4 pb-20 custom-scrollbar">
            <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-lg">
              {players.sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={p.id} className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-4">
                    <span className={`font-black w-8 text-center text-2xl ${i===0?'text-yellow-500':i===1?'text-slate-400':i===2?'text-orange-400':'text-slate-200'}`}>{i+1}</span>
                    <div><p className="font-bold text-slate-700 text-lg">{p.name}</p>{i===0 && <span className="text-[10px] bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full font-bold">WINNER</span>}</div>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-lg"><Star size={14} className="text-yellow-500" fill="currentColor"/><span className="font-black text-slate-800">{p.score}</span></div>
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
