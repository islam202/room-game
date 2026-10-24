import React, { useState, useEffect } from 'react';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    try {
      // محاولة قراءة كود الغرفة من Query Parameters أو الـ Hash
      const params = new URLSearchParams(window.location.search);
      let code = params.get('room');

      if (!code && window.location.hash.includes('room=')) {
        code = window.location.hash.split('room=')[1];
      }

      if (code) {
        const cleanCode = code.trim().toUpperCase();
        setRoomCode(cleanCode);
        setIsInRoom(true);
      }
    } catch (e) {
      console.error("Error reading room:", e);
      setHasError(true);
    }
  }, []);

  const createRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(randomCode);
    setIsInRoom(true);
    window.history.pushState({}, '', `?room=${randomCode}`);
  };

  const joinRoom = () => {
    if (inputCode.trim() !== '') {
      const code = inputCode.trim().toUpperCase();
      setRoomCode(code);
      setIsInRoom(true);
      window.history.pushState({}, '', `?room=${code}`);
    }
  };

  const leaveRoom = () => {
    setIsInRoom(false);
    setRoomCode('');
    setInputCode('');
    window.history.pushState({}, '', window.location.pathname);
  };

  if (hasError) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="bg-red-800 p-6 rounded-xl text-center">
          <h2 className="text-xl font-bold mb-2">عذراً، حدث خطأ في تحميل الغرفة</h2>
          <button onClick={() => window.location.href = window.location.pathname} className="mt-4 bg-white text-gray-900 px-4 py-2 rounded-lg font-bold">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700">
        <h1 className="text-3xl font-extrabold text-center mb-6 text-indigo-400">
          🎮 Room Game
        </h1>

        {!isInRoom ? (
          <div className="space-y-4">
            <button
              onClick={createRoom}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-lg">
              إنشاء غرفة جديدة
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-700"></div>
              <span className="flex-shrink mx-4 text-gray-400 text-sm">أو</span>
              <div className="flex-grow border-t border-gray-700"></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="أدخل كود الغرفة"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white uppercase font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={joinRoom}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition shadow-lg">
                انضمام
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-6">
            <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
              <p className="text-sm text-gray-400 mb-1">كود الغرفة الحالي:</p>
              <span className="text-2xl font-mono font-bold text-yellow-400 tracking-wider">
                {roomCode}
              </span>
            </div>

            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
              <p className="text-gray-300">أنت الآن داخل الغرفة وجاهز للعب!</p>
            </div>

            <button
              onClick={leaveRoom}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-lg">
              مغادرة الغرفة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
